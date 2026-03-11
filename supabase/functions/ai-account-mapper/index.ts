import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.4'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
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

    // If action is scan_only, just return the accounts
    if (action === 'scan_only') {
      return new Response(JSON.stringify({ success: true, accounts: xeroAccounts }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ─── STEP 2: AI Matching via Lovable AI ──────────────────────────
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY')
    if (!LOVABLE_API_KEY) {
      return new Response(JSON.stringify({ error: 'AI service not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const systemPrompt = `You are an Australian ecommerce accounting assistant. 
You will be given a list of Xero account codes from an Australian business and must match each of 9 ecommerce settlement categories to the most appropriate account.
Always prefer existing accounts over creating new ones.
Australian GST applies — revenue accounts use OUTPUT tax, expense/fee accounts use INPUT tax, reimbursements use NONE.
Advertising Costs (Sponsored Products, PPC ads) MUST be separated from Other Fees for BAS accuracy.
Return only valid JSON, no explanation.`

    const userPrompt = `Here are the Xero accounts for this business:
${JSON.stringify(xeroAccounts, null, 2)}

Match each category to the best account code:
- Sales: gross product sales and shipping revenue
- Promotional Discounts: vouchers and promotions reducing sale price  
- Refunds: product and shipping refunds to customers
- Reimbursements: Amazon/marketplace reimbursements (not taxable)
- Seller Fees: referral fees and selling fees charged by marketplace
- FBA Fees: fulfilment, pick and pack, delivery fees
- Storage Fees: warehouse and inventory storage fees
- Advertising Costs: Sponsored Products, PPC advertising fees (INPUT tax, GST on purchases)
- Other Fees: miscellaneous marketplace charges and adjustments

Return JSON only with this exact structure:
{
  "Sales": "XXXX",
  "Promotional Discounts": "XXXX",
  "Refunds": "XXXX",
  "Reimbursements": "XXXX",
  "Seller Fees": "XXXX",
  "FBA Fees": "XXXX",
  "Storage Fees": "XXXX",
  "Advertising Costs": "XXXX",
  "Other Fees": "XXXX",
  "confidence": "high" | "medium" | "low",
  "notes": "brief plain English explanation of key decisions"
}`

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
                properties: {
                  Sales: { type: 'string' },
                  'Promotional Discounts': { type: 'string' },
                  Refunds: { type: 'string' },
                  Reimbursements: { type: 'string' },
                  'Seller Fees': { type: 'string' },
                  'FBA Fees': { type: 'string' },
                  'Storage Fees': { type: 'string' },
                  'Advertising Costs': { type: 'string' },
                  'Other Fees': { type: 'string' },
                  confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
                  notes: { type: 'string' },
                },
                required: ['Sales', 'Promotional Discounts', 'Refunds', 'Reimbursements', 'Seller Fees', 'FBA Fees', 'Storage Fees', 'Advertising Costs', 'Other Fees', 'confidence', 'notes'],
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
        // Extract just the 8 category mappings
        const categories = ['Sales', 'Promotional Discounts', 'Refunds', 'Reimbursements', 'Seller Fees', 'FBA Fees', 'Storage Fees', 'Other Fees']
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
          const categories = ['Sales', 'Promotional Discounts', 'Refunds', 'Reimbursements', 'Seller Fees', 'FBA Fees', 'Storage Fees', 'Other Fees']
          for (const cat of categories) {
            if (parsed[cat]) mapping[cat] = parsed[cat]
          }
        }
      } catch (e) {
        console.error('Failed to parse AI content response:', e)
      }
    }

    // Validate — ensure all 8 categories have a code
    const DEFAULT_CODES: Record<string, string> = {
      'Sales': '200', 'Promotional Discounts': '200', 'Refunds': '205',
      'Reimbursements': '271', 'Seller Fees': '407', 'FBA Fees': '408',
      'Storage Fees': '409', 'Other Fees': '405',
    }
    for (const [cat, def] of Object.entries(DEFAULT_CODES)) {
      if (!mapping[cat]) {
        mapping[cat] = def
        confidence = 'low' // Downgrade confidence if we had to fill gaps
      }
    }

    // Build enriched response with account names
    const accountLookup = new Map(xeroAccounts.map((a: any) => [a.code, a.name]))
    const enrichedMapping: Record<string, { code: string; name: string }> = {}
    for (const [cat, code] of Object.entries(mapping)) {
      enrichedMapping[cat] = {
        code,
        name: (accountLookup.get(code) as string) || `Account ${code}`,
      }
    }

    // If auto-trigger, save as suggested (not confirmed)
    if (body.autoTrigger) {
      await supabase.from('app_settings').upsert({
        user_id: userId,
        key: 'ai_mapper_status',
        value: 'suggested',
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
