import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'
import { getCorsHeaders } from '../_shared/cors.ts'
import { logger } from '../_shared/logger.ts'

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? ""
  const corsHeaders = getCorsHeaders(origin)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    // ─── Auth ────────────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const anonClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: authErr } = await anonClient.auth.getUser()
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const userId = user.id
    const supabase = createClient(supabaseUrl, serviceKey)

    const body = await req.json()
    const { action = 'scan_and_match' } = body

    // ─── STEP 1: Fetch Xero accounts ─────────────────────────────────
    const { data: tokens, error: tokenErr } = await supabase
      .from('xero_tokens')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(1)

    if (tokenErr || !tokens || tokens.length === 0) {
      return new Response(JSON.stringify({ error: 'No Xero connection found' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let xeroToken = tokens[0]

    // Refresh if needed
    const xeroClientId = Deno.env.get('XERO_CLIENT_ID')!
    const xeroClientSecret = Deno.env.get('XERO_CLIENT_SECRET')!
    const expiresAt = new Date(xeroToken.expires_at)
    if (expiresAt.getTime() - Date.now() < 5 * 60 * 1000) {
      const refreshResp = await fetch(XERO_TOKEN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Authorization': `Basic ${btoa(`${xeroClientId}:${xeroClientSecret}`)}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: xeroToken.refresh_token,
        }),
      })
      if (refreshResp.ok) {
        const td = await refreshResp.json()
        const newExp = new Date(Date.now() + td.expires_in * 1000).toISOString()
        await supabase.from('xero_tokens').update({
          access_token: td.access_token,
          refresh_token: td.refresh_token,
          expires_at: newExp,
          updated_at: new Date().toISOString(),
        }).eq('id', xeroToken.id)
        xeroToken = { ...xeroToken, access_token: td.access_token }
      }
    }

    // Fetch active accounts from Xero
    const accountsResp = await fetch(
      'https://api.xero.com/api.xro/2.0/Accounts?where=Status%3D%3D%22ACTIVE%22',
      {
        headers: {
          'Authorization': `Bearer ${xeroToken.access_token}`,
          'Accept': 'application/json',
          'Xero-tenant-id': xeroToken.tenant_id,
        },
      }
    )

    if (!accountsResp.ok) {
      const errText = await accountsResp.text()
      console.error('Xero accounts error:', accountsResp.status, errText)
      return new Response(JSON.stringify({ error: `Xero API error: ${accountsResp.status}` }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const accountsData = await accountsResp.json()
    const xeroAccounts = (accountsData.Accounts || []).map((a: any) => ({
      code: a.Code,
      name: a.Name,
      type: a.Type,
      taxType: a.TaxType,
      description: a.Description || '',
    }))

    // ─── Cache CoA in xero_chart_of_accounts ──────────────────────
    // Soft-delete: mark missing accounts as inactive, don't hard-delete
    // (protects against partial Xero API responses)
    try {
      const xeroAccountRows = (accountsData.Accounts || [])
        .filter((a: any) => a.AccountID)
        .map((a: any) => ({
          user_id: userId,
          xero_account_id: a.AccountID,
          account_code: a.Code || null,
          account_name: a.Name,
          account_type: a.Type || null,
          tax_type: a.TaxType || null,
          description: a.Description || null,
          is_active: true,
          synced_at: new Date().toISOString(),
        }));

      // GUARD: Never soft-delete if Xero returns empty (API timeout, token issue, etc.)
      if (xeroAccountRows.length === 0) {
        logger.warn('[ai-account-mapper] No accounts returned from Xero — skipping soft delete');
        return;
      }

      // Upsert current accounts
      await supabase.from('xero_chart_of_accounts').upsert(
        xeroAccountRows,
        { onConflict: 'user_id,xero_account_id' }
      );

      // Mark accounts not in current fetch as inactive (soft-delete)
      const currentIds = xeroAccountRows.map((r: any) => r.xero_account_id);
      await supabase
        .from('xero_chart_of_accounts')
        .update({ is_active: false })
        .eq('user_id', userId)
        .eq('is_active', true)
        .not('xero_account_id', 'in', `(${currentIds.join(',')})`);

      logger.debug(`[ai-account-mapper] Cached ${xeroAccountRows.length} CoA accounts for user ${userId}`);
    } catch (coaErr: any) {
      logger.warn('[ai-account-mapper] CoA cache failed (non-fatal):', coaErr.message);
    }

    // If action is scan_only, just return the accounts
    if (action === 'scan_only') {
      return new Response(JSON.stringify({ success: true, accounts: xeroAccounts }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ─── STEP 1b: Check learned contact→account mappings ────────────
    // Normalise contact name for lookup
    function normaliseContactName(name: string): string {
      return name
        .toLowerCase()
        .trim()
        .replace(/\b(pty|ltd|limited|inc|corp|co)\b/gi, '')
        .replace(/[^\w\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    }

    if (body.contact_name) {
      const normKey = normaliseContactName(body.contact_name)
      const { data: learned } = await supabase
        .from('xero_contact_account_mappings')
        .select('account_code, usage_count, confidence_pct')
        .eq('user_id', userId)
        .eq('normalised_contact_key', normKey)
        .gte('confidence_pct', 70)
        .gte('usage_count', 3)
        .order('usage_count', { ascending: false })

      // EDGE CASE 3: Also check total_uses >= 5 by summing all codes for this contact
      if (learned && learned.length > 0) {
        const totalUses = learned.reduce((sum: number, l: any) => sum + l.usage_count, 0)
        if (totalUses >= 5) {
          const accountLookup = new Map(xeroAccounts.map((a: any) => [a.code || a.Code, a.name || a.Name]))
          logger.debug(`[ai-account-mapper] Using learned mapping for contact "${body.contact_name}" → normalised "${normKey}" (${learned.length} codes, top confidence: ${learned[0].confidence_pct}%, total uses: ${totalUses})`)

          return new Response(JSON.stringify({
            success: true,
            mapping_source: 'learned_from_xero',
            learned_accounts: learned.map((l: any) => ({
              code: l.account_code,
              name: (accountLookup.get(l.account_code) as string) || `Account ${l.account_code}`,
              usage_count: l.usage_count,
              confidence_pct: l.confidence_pct,
            })),
            accounts: xeroAccounts,
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
      }
    }

    // ─── STEP 1c: Load active marketplaces for per-rail suggestions ─
    const { data: connections } = await supabase
      .from('marketplace_connections')
      .select('marketplace_name, marketplace_code')
      .eq('user_id', userId)
      .eq('connection_status', 'connected')

    let activeMarketplaces: { name: string; code: string }[] = []
    if (connections && connections.length > 0) {
      activeMarketplaces = connections.map((c: any) => ({
        name: c.marketplace_name,
        code: c.marketplace_code,
      }))
    } else {
      // Fall back to settlements
      const { data: settlements } = await supabase
        .from('settlements')
        .select('marketplace')
        .eq('user_id', userId)
        .not('status', 'in', '("duplicate_suppressed","already_recorded")')
      if (settlements) {
        const unique = [...new Set(settlements.map((s: any) => s.marketplace).filter(Boolean))]
        const labelMap: Record<string, string> = {
          amazon_au: 'Amazon AU', amazon_us: 'Amazon USA', amazon_jp: 'Amazon JP',
          amazon_sg: 'Amazon SG', amazon_uk: 'Amazon UK',
          bunnings: 'Bunnings', shopify_payments: 'Shopify',
          shopify_orders: 'Shopify', catch: 'Catch', mydeal: 'MyDeal',
          kogan: 'Kogan', woolworths: 'Everyday Market', ebay_au: 'eBay AU',
          etsy: 'Etsy', theiconic: 'The Iconic', bigw: 'BigW',
          everyday_market: 'Everyday Market',
        }
        activeMarketplaces = unique.map(code => ({
          name: labelMap[code || ''] || code || '',
          code: code || '',
        })).filter(m => m.name)
      }
    }

    // ─── STEP 1d: Deterministic keyword pre-scan ─────────────────────
    // Before sending to AI, do a keyword scan to find obvious marketplace-specific accounts.
    // This catches accounts like "Kogan Sales AU" (203), "Bunnings Sales" (209), etc. that AI may miss.
    const MARKETPLACE_KEYWORDS: Record<string, string[]> = {
      'Amazon AU': ['amazon'],
      'Amazon USA': ['amazon'],
      'Amazon JP': ['amazon'],
      'Amazon SG': ['amazon'],
      'Amazon UK': ['amazon'],
      'Shopify': ['shopify'],
      'Bunnings': ['bunnings'],
      'eBay AU': ['ebay', 'e-bay'],
      'Catch': ['catch'],
      'MyDeal': ['mydeal', 'my deal'],
      'Kogan': ['kogan'],
      'Everyday Market': ['everyday', 'woolworths marketplus', 'everyday market'],
      'The Iconic': ['iconic', 'theiconic'],
      'Etsy': ['etsy'],
      'BigW': ['bigw', 'big w'],
    }

    const CATEGORY_KEYWORDS: Record<string, string[]> = {
      'Sales': ['sales', 'revenue', 'income'],
      'Shipping': ['shipping', 'freight', 'postage', 'delivery'],
      'Seller Fees': ['seller fee', 'seller fees', 'referral fee', 'commission', 'selling fee', 'fees'],
      'FBA Fees': ['fba', 'fulfilment', 'fulfillment', 'pick and pack'],
      'Storage Fees': ['storage', 'warehouse', 'inventory fee'],
      'Refunds': ['refund', 'return'],
      'Reimbursements': ['reimbursement'],
      'Advertising Costs': ['advertising', 'sponsored', 'ppc', 'ad spend'],
      'Other Fees': ['other fee', 'adjustment', 'miscellaneous'],
      'Promotional Discounts': ['promotion', 'discount', 'voucher', 'coupon'],
    }

    // Negative keywords: if account name contains these, exclude from the category
    const CATEGORY_EXCLUSIONS: Record<string, string[]> = {
      'Sales': ['shipping', 'freight', 'postage', 'delivery', 'fee', 'refund', 'reimbursement'],
      'Shipping': ['sales', 'fee', 'refund'],
      'Seller Fees': ['fba', 'storage', 'advertising', 'shipping', 'transaction service'],
      'FBA Fees': ['seller', 'storage', 'advertising'],
      'Storage Fees': ['seller', 'fba', 'advertising'],
      'Refunds': ['fee', 'reimbursement'],
      'Reimbursements': ['refund', 'fee'],
    }

    // Pre-scan: find marketplace-specific accounts by keyword matching
    const deterministicOverrides: Record<string, string> = {}
    // Search ALL account types (revenue + expense) for marketplace-specific accounts
    const allActiveAccounts = xeroAccounts.filter((a: any) => {
      const type = (a.type || '').toUpperCase()
      return ['REVENUE', 'SALES', 'OTHERINCOME', 'DIRECTCOSTS', 'EXPENSE', 'OVERHEADS', 'CURRLIAB', 'LIABILITY'].includes(type)
    })

    for (const mp of activeMarketplaces) {
      const mpKeywords = MARKETPLACE_KEYWORDS[mp.name] || [mp.name.toLowerCase().replace(/[^a-z0-9]/g, '')]
      
      // Derive country hint from marketplace name (e.g. "Amazon AU" → "au", "eBay AU" → "au")
      const countryMatch = mp.name.match(/\b(AU|US|UK|NZ|SG|CA|DE|FR|IT|ES|JP|IN)\b/i)
      const countryHint = countryMatch ? countryMatch[1].toLowerCase() : null
      const countryLongForms: Record<string, string[]> = {
        au: ['australia', 'australian', ' au'],
        us: ['usa', 'united states', 'america'],
        uk: ['united kingdom', 'britain'],
        nz: ['new zealand'],
        sg: ['singapore', 'singapre'],
        jp: ['japan', 'japanese'],
        ca: ['canada', 'canadian'],
        de: ['germany', 'german'],
      }
      
      for (const [cat, catKeywords] of Object.entries(CATEGORY_KEYWORDS)) {
        const exclusions = CATEGORY_EXCLUSIONS[cat] || []
        // Find ALL accounts matching marketplace + category (not just the first)
        const candidates = allActiveAccounts.filter((a: any) => {
          const nameLower = (a.name || '').toLowerCase()
          const hasMarketplace = mpKeywords.some((kw: string) => nameLower.includes(kw))
          const hasCategory = catKeywords.some((kw: string) => nameLower.includes(kw))
          const hasExclusion = exclusions.some((kw: string) => nameLower.includes(kw))
          return hasMarketplace && hasCategory && !hasExclusion
        })
        
        if (candidates.length > 0) {
          // Prefer the candidate whose name contains the country code or long form
          let best = candidates[0]
          if (countryHint && candidates.length > 1) {
            const countryTerms = [countryHint, ...(countryLongForms[countryHint] || [])]
            const countryMatch = candidates.find((a: any) => {
              const nameLower = (a.name || '').toLowerCase()
              return countryTerms.some(term => nameLower.includes(term))
            })
            if (countryMatch) best = countryMatch
          }
          
          const key = `${cat}:${mp.name}`
          deterministicOverrides[key] = best.code
          logger.debug(`[ai-account-mapper] Deterministic match: ${key} → ${best.code} (${best.name})`)
        }
      }
    }

    logger.debug(`[ai-account-mapper] Deterministic pre-scan found ${Object.keys(deterministicOverrides).length} marketplace overrides`)

    // ─── STEP 2: AI Matching via Lovable AI ──────────────────────────
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'AI service not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const marketplaceNames = activeMarketplaces.map(m => m.name)
    
    // Build a highlighted section showing accounts that contain marketplace names
    const marketplaceAccountHints: string[] = []
    for (const mp of activeMarketplaces) {
      const mpKeywords = MARKETPLACE_KEYWORDS[mp.name] || [mp.name.toLowerCase().replace(/[^a-z0-9]/g, '')]
      const matchingAccounts = xeroAccounts.filter((a: any) => {
        const nameLower = (a.name || '').toLowerCase()
        return mpKeywords.some((kw: string) => nameLower.includes(kw))
      })
      if (matchingAccounts.length > 0) {
        marketplaceAccountHints.push(
          `  ${mp.name}: ${matchingAccounts.map((a: any) => `${a.code} "${a.name}"`).join(', ')}`
        )
      }
    }
    
    const perRailPromptSection = marketplaceNames.length > 0
      ? `\n\nThe business sells on these marketplaces: ${marketplaceNames.join(', ')}.
For ALL categories (Sales, Shipping, Seller Fees, FBA Fees, Storage Fees, Refunds, Reimbursements, Promotional Discounts, Advertising Costs, Other Fees), look for marketplace-specific accounts.
For example, "Amazon Seller Fees AU" should map to "Seller Fees:Amazon AU", "Bunnings Refunds" to "Refunds:Bunnings".
Return per-marketplace overrides in "marketplace_overrides" keyed as "<Category>:<Marketplace Name>".
Only include overrides where you find a SPECIFIC account for that marketplace — don't repeat the global mapping.

IMPORTANT: I've pre-identified these accounts that appear to be marketplace-specific. USE THEM:
${marketplaceAccountHints.length > 0 ? marketplaceAccountHints.join('\n') : '  (none found by keyword scan)'}`
      : ''

    const systemPrompt = `You are an Australian ecommerce accounting assistant.
You will be given a list of Xero account codes from an Australian business and must match each of 9 ecommerce settlement categories to the most appropriate account.
Always prefer existing accounts over creating new ones.
Australian GST applies — revenue accounts use OUTPUT tax, expense/fee accounts use INPUT tax, reimbursements use BASEXCLUDED (compensation payments, not taxable supplies).
Advertising Costs (Sponsored Products, PPC ads) MUST be separated from Other Fees for BAS accuracy.

IMPORTANT MATCHING RULES:
- SCAN EVERY SINGLE ACCOUNT in the list — there are ${xeroAccounts.length} accounts, do not skip any
- Look at account NAMES carefully for keywords like "sales", "revenue", "fees", "commission", "fulfilment", "shipping", "freight", "refund", "advertising", "storage", "reimbursement"
- Also look for MARKETPLACE NAMES in account names: amazon, shopify, ebay, bunnings, kogan, mydeal, catch, everyday, iconic, etsy, bigw
- Match by semantic meaning, not just exact text
- If multiple accounts could match, prefer the one that is most specific (e.g. "Marketplace Fees" over "Other Expenses")
- If no specific match exists, look for general-purpose accounts of the right type (Revenue for income, Expense for costs)
- NEVER guess codes that don't exist in the provided list
- Revenue categories (Sales, Shipping, Promotional Discounts, Refunds, Reimbursements) should map to REVENUE, SALES, or OTHERINCOME type accounts
- Expense categories (Seller Fees, FBA Fees, Storage Fees, Advertising Costs, Other Fees) should map to EXPENSE, OVERHEADS, or DIRECTCOSTS type accounts
- For marketplace_overrides: if an account like "209 Bunnings Sales" exists, map "Sales:Bunnings" to "209" — DO NOT leave it out
Return only valid JSON, no explanation.`

    const userPrompt = `Here are ALL ${xeroAccounts.length} Xero accounts for this business (code, name, type):
${xeroAccounts.map((a: any) => `${a.code || '???'} | ${a.name} | ${a.type}`).join('\n')}

Match each category to the BEST account code from the list above:
- Sales: gross product sales and shipping revenue
- Shipping: shipping revenue charged to customers (look for "shipping", "freight", "postage" accounts)
- Promotional Discounts: vouchers and promotions reducing sale price
- Refunds: product and shipping refunds to customers
- Reimbursements: Amazon/marketplace reimbursements (not taxable)
- Seller Fees: referral fees and selling fees charged by marketplace
- FBA Fees: fulfilment, pick and pack, delivery fees
- Storage Fees: warehouse and inventory storage fees
- Advertising Costs: Sponsored Products, PPC advertising fees
- Other Fees: miscellaneous marketplace charges and adjustments
${perRailPromptSection}

Return JSON with this structure:
{
  "Sales": "code",
  "Shipping": "code",
  "Promotional Discounts": "code",
  "Refunds": "code",
  "Reimbursements": "code",
  "Seller Fees": "code",
  "FBA Fees": "code",
  "Storage Fees": "code",
  "Advertising Costs": "code",
  "Other Fees": "code",
  "marketplace_overrides": { "Sales:Amazon AU": "code", "Sales:Shopify": "code" },
  "confidence": "high" | "medium" | "low",
  "notes": "brief explanation of key decisions and any categories where you couldn't find a good match"
}`

    // Build tool schema with marketplace overrides
    const toolProperties: Record<string, any> = {
      Sales: { type: 'string' },
      Shipping: { type: 'string' },
      'Promotional Discounts': { type: 'string' },
      Refunds: { type: 'string' },
      Reimbursements: { type: 'string' },
      'Seller Fees': { type: 'string' },
      'FBA Fees': { type: 'string' },
      'Storage Fees': { type: 'string' },
      'Advertising Costs': { type: 'string' },
      'Other Fees': { type: 'string' },
      marketplace_overrides: {
        type: 'object',
        description: 'Per-marketplace account overrides keyed as "Category:Marketplace Name"',
        additionalProperties: { type: 'string' },
      },
      confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
      notes: { type: 'string' },
    }

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'map_accounts',
              description: 'Map ecommerce settlement categories to Xero account codes',
              parameters: {
                type: 'object',
                properties: toolProperties,
                required: ['Sales', 'Shipping', 'Promotional Discounts', 'Refunds', 'Reimbursements', 'Seller Fees', 'FBA Fees', 'Storage Fees', 'Advertising Costs', 'Other Fees', 'confidence', 'notes'],
                additionalProperties: false,
              },
            },
          },
        ],
        tool_choice: { type: 'function', function: { name: 'map_accounts' } },
      }),
    })

    if (!aiResponse.ok) {
      if (aiResponse.status === 429) {
        return new Response(JSON.stringify({ error: 'AI rate limit exceeded. Please try again shortly.' }), {
          status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      if (aiResponse.status === 402) {
        return new Response(JSON.stringify({ error: 'AI credits exhausted. Please top up in Settings.' }), {
          status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      const errText = await aiResponse.text()
      console.error('AI gateway error:', aiResponse.status, errText)
      return new Response(JSON.stringify({ error: 'AI matching failed' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const aiResult = await aiResponse.json()

    // Extract mapping from tool call response
    let mapping: Record<string, string> = {}
    let marketplaceOverrides: Record<string, string> = {}
    let confidence = 'medium'
    let notes = ''

    const toolCall = aiResult.choices?.[0]?.message?.tool_calls?.[0]
    if (toolCall?.function?.arguments) {
      try {
        const args = typeof toolCall.function.arguments === 'string'
          ? JSON.parse(toolCall.function.arguments)
          : toolCall.function.arguments
        confidence = args.confidence || 'medium'
        notes = args.notes || ''
        marketplaceOverrides = args.marketplace_overrides || {}
        const categories = ['Sales', 'Shipping', 'Promotional Discounts', 'Refunds', 'Reimbursements', 'Seller Fees', 'FBA Fees', 'Storage Fees', 'Advertising Costs', 'Other Fees']
        for (const cat of categories) {
          if (args[cat]) mapping[cat] = args[cat]
        }
      } catch (e) {
        console.error('Failed to parse AI tool call response:', e)
      }
    }

    // Fallback: try parsing from content if tool call failed
    if (Object.keys(mapping).length === 0) {
      const content = aiResult.choices?.[0]?.message?.content || ''
      try {
        const jsonMatch = content.match(/\{[\s\S]*\}/)
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0])
          confidence = parsed.confidence || 'medium'
          notes = parsed.notes || ''
          marketplaceOverrides = parsed.marketplace_overrides || {}
          const categories = ['Sales', 'Shipping', 'Promotional Discounts', 'Refunds', 'Reimbursements', 'Seller Fees', 'FBA Fees', 'Storage Fees', 'Advertising Costs', 'Other Fees']
          for (const cat of categories) {
            if (parsed[cat]) mapping[cat] = parsed[cat]
          }
        }
      } catch (e) {
        console.error('Failed to parse AI content response:', e)
      }
    }

    // Validate — DON'T fall back to hardcoded defaults; leave unmapped for user
    const existingCodes = new Set(xeroAccounts.map((a: any) => a.code || a.Code));

    // Remove any AI-suggested codes that don't exist in the user's COA
    for (const [cat, code] of Object.entries(mapping)) {
      if (!existingCodes.has(code)) {
        logger.warn(`[ai-account-mapper] Removing invalid code for ${cat}: ${code}`)
        delete mapping[cat]
        confidence = 'low'
      }
    }

    // Validate marketplace overrides too
    for (const [key, code] of Object.entries(marketplaceOverrides)) {
      if (!existingCodes.has(code)) {
        logger.warn(`[ai-account-mapper] Removing invalid override ${key}: ${code}`)
        delete marketplaceOverrides[key]
      }
    }

    // Merge deterministic overrides INTO marketplace overrides (deterministic wins)
    // This ensures accounts found by keyword scan are always included
    for (const [key, code] of Object.entries(deterministicOverrides)) {
      if (existingCodes.has(code) && !marketplaceOverrides[key]) {
        marketplaceOverrides[key] = code
        logger.debug(`[ai-account-mapper] Applied deterministic override: ${key} → ${code}`)
      }
    }

    let mapperStatus = 'suggested'
    const unmappedCategories = ['Sales', 'Shipping', 'Promotional Discounts', 'Refunds', 'Reimbursements', 'Seller Fees', 'FBA Fees', 'Storage Fees', 'Advertising Costs', 'Other Fees']
      .filter(cat => !mapping[cat])
    if (unmappedCategories.length > 0) {
      console.warn('[ai-account-mapper] Categories without valid mapping:', unmappedCategories)
      await supabase.from('system_events').insert({
        user_id: userId,
        event_type: 'ai_mapper_unmapped_categories',
        severity: 'warning',
        details: {
          unmapped_categories: unmappedCategories,
          total_unmapped: unmappedCategories.length,
          total_accounts_scanned: xeroAccounts.length,
        },
      })
      mapperStatus = 'needs_review'
    }

    // Build enriched response with account names
    const accountLookup = new Map(xeroAccounts.map((a: any) => [a.code || a.Code, a.name || a.Name]))
    const enrichedMapping: Record<string, { code: string; name: string }> = {}
    for (const [cat, code] of Object.entries(mapping)) {
      enrichedMapping[cat] = {
        code,
        name: (accountLookup.get(code) as string) || `Account ${code}`,
      }
    }

    // Add marketplace overrides to enriched mapping
    for (const [key, code] of Object.entries(marketplaceOverrides)) {
      enrichedMapping[key] = {
        code,
        name: (accountLookup.get(code) as string) || `Account ${code}`,
      }
    }

    // If auto-trigger, save as suggested (not confirmed)
    if (body.autoTrigger) {
      await supabase.from('app_settings').upsert({
        user_id: userId,
        key: 'ai_mapper_status',
        value: mapperStatus,
      }, { onConflict: 'user_id,key' })

      await supabase.from('app_settings').upsert({
        user_id: userId,
        key: 'ai_mapper_suggested_mapping',
        value: JSON.stringify({ mapping: enrichedMapping, confidence, notes }),
      }, { onConflict: 'user_id,key' })
    }

    console.log('[ai-account-mapper] Mapping complete:', { userId, confidence, categoriesMapped: Object.keys(mapping).length })

    return new Response(JSON.stringify({
      success: true,
      mapping: enrichedMapping,
      confidence,
      notes,
      accounts: xeroAccounts,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error: any) {
    console.error('[ai-account-mapper] Error:', error.message)
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
