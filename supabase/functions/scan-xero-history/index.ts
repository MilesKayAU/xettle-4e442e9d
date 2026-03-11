import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const MARKETPLACE_CONTACT_PATTERNS = [
  'amazon', 'amazon au', 'amazon australia', 'amazon.com.au',
  'kogan', 'big w', 'bigw', 'bunnings',
  'mydeal', 'everyday market', 'everydaymarket',
  'mirakl', 'shopify', 'shopify payments',
  'catch', 'ebay', 'paypal', 'woolworths',
  'the iconic', 'etsy',
]

const REFERENCE_PATTERNS = [
  'xettle-', 'settlement', 'payout',
  'amazon', 'kogan', 'big w', 'mirakl',
  'bunnings', 'shopify', 'catch', 'ebay',
  'mydeal', 'woolworths', 'everyday market',
]

const MARKETPLACE_NAMES: Record<string, string> = {
  amazon_au: 'Amazon Australia',
  kogan: 'Kogan',
  bigw: 'Big W',
  bunnings: 'Bunnings',
  mydeal: 'MyDeal',
  woolworths: 'Woolworths Everyday Market',
  mirakl: 'Mirakl',
  shopify_payments: 'Shopify Payments',
  catch: 'Catch',
  ebay_au: 'eBay Australia',
  paypal: 'PayPal',
  theiconic: 'The Iconic',
  etsy: 'Etsy',
}

function matchesMarketplace(name: string): string | null {
  const lower = name.toLowerCase().trim()
  for (const pattern of MARKETPLACE_CONTACT_PATTERNS) {
    if (lower.includes(pattern)) {
      if (lower.includes('amazon')) return 'amazon_au'
      if (lower.includes('kogan')) return 'kogan'
      if (lower.includes('big w') || lower.includes('bigw')) return 'bigw'
      if (lower.includes('bunnings')) return 'bunnings'
      if (lower.includes('mydeal')) return 'mydeal'
      if (lower.includes('everyday') || lower.includes('woolworths')) return 'woolworths'
      if (lower.includes('mirakl')) return 'mirakl'
      if (lower.includes('shopify')) return 'shopify_payments'
      if (lower.includes('catch')) return 'catch'
      if (lower.includes('ebay')) return 'ebay_au'
      if (lower.includes('paypal')) return 'paypal'
      if (lower.includes('iconic')) return 'theiconic'
      if (lower.includes('etsy')) return 'etsy'
      return pattern.replace(/\s+/g, '_')
    }
  }
  return null
}

function referenceMatchesMarketplace(ref: string): boolean {
  const lower = (ref || '').toLowerCase()
  return REFERENCE_PATTERNS.some(p => lower.includes(p))
}

async function refreshXeroToken(supabase: any, userId: string, clientId: string, clientSecret: string) {
  const { data: tokenRow, error } = await supabase
    .from('xero_tokens')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error || !tokenRow) return null

  const expiresAt = new Date(tokenRow.expires_at)
  if (expiresAt > new Date(Date.now() + 60000)) {
    return tokenRow
  }

  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: tokenRow.refresh_token,
    }),
  })

  if (!res.ok) return null

  const tokens = await res.json()
  const newExpiry = new Date(Date.now() + (tokens.expires_in || 1800) * 1000).toISOString()

  await supabase
    .from('xero_tokens')
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || tokenRow.refresh_token,
      expires_at: newExpiry,
    })
    .eq('user_id', userId)

  return { ...tokenRow, access_token: tokens.access_token, tenant_id: tokenRow.tenant_id }
}

async function xeroGet(url: string, accessToken: string, tenantId: string) {
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Xero-Tenant-Id': tenantId,
      'Accept': 'application/json',
    },
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Xero API ${res.status}: ${body}`)
  }
  return res.json()
}

function parseXeroDate(dateField: string | null | undefined): string | null {
  if (!dateField) return null
  const raw = dateField.replace('/Date(', '').replace(')/', '').split('+')[0]
  const ts = parseInt(raw)
  if (!isNaN(ts)) return new Date(ts).toISOString().split('T')[0]
  return raw.split('T')[0]
}

interface DetectedSettlement {
  marketplace: string
  last_recorded_date: string
  last_amount: number
  source: 'invoice' | 'bank_transaction' | 'journal'
  reference: string
  xero_id: string
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const userId = user.id

    const clientId = Deno.env.get('XERO_CLIENT_ID')!
    const clientSecret = Deno.env.get('XERO_CLIENT_SECRET')!
    const tokenRow = await refreshXeroToken(supabase, userId, clientId, clientSecret)

    if (!tokenRow) {
      return new Response(JSON.stringify({ hasXero: false }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { access_token: accessToken, tenant_id: tenantId } = tokenRow

    const detectedMap = new Map<string, DetectedSettlement>()
    let hasXettlePrefix = false
    let hasMarketplaceContacts = false
    let hasBankPatterns = false

    // 1. Scan Invoices
    try {
      const invoiceData = await xeroGet(
        `https://api.xero.com/api.xro/2.0/Invoices?Statuses=AUTHORISED,PAID&order=Date DESC&pageSize=100`,
        accessToken, tenantId
      )

      for (const inv of (invoiceData.Invoices || [])) {
        const contactName = inv.Contact?.Name || ''
        const reference = inv.Reference || ''
        const invoiceNumber = inv.InvoiceNumber || ''
        const invoiceId = inv.InvoiceID || ''

        if (reference.toLowerCase().startsWith('xettle-')) {
          hasXettlePrefix = true
        }

        const marketplace = matchesMarketplace(contactName)
        const refMatches = referenceMatchesMarketplace(reference)

        if (marketplace || refMatches) {
          if (marketplace) hasMarketplaceContacts = true
          const key = marketplace || 'unknown'
          const dateStr = parseXeroDate(inv.Date)
          const amount = inv.Total || 0

          if (dateStr) {
            const existing = detectedMap.get(key)
            if (!existing || dateStr > existing.last_recorded_date) {
              detectedMap.set(key, {
                marketplace: key,
                last_recorded_date: dateStr,
                last_amount: amount,
                source: 'invoice',
                reference: invoiceNumber || reference || '',
                xero_id: invoiceId,
              })
            }
          }
        }
      }
    } catch (e) {
      console.error('Invoice scan error:', e)
    }

    // 2. Scan Bank Transactions
    try {
      const bankData = await xeroGet(
        `https://api.xero.com/api.xro/2.0/BankTransactions?order=Date DESC&pageSize=100`,
        accessToken, tenantId
      )

      for (const txn of (bankData.BankTransactions || [])) {
        if (txn.Type !== 'RECEIVE') continue

        const contactName = txn.Contact?.Name || ''
        const reference = txn.Reference || ''
        const narration = txn.LineItems?.[0]?.Description || ''
        const txnId = txn.BankTransactionID || ''
        const amount = txn.Total || 0

        const marketplace = matchesMarketplace(contactName) || matchesMarketplace(narration) || matchesMarketplace(reference)

        if (marketplace) {
          hasBankPatterns = true
          const dateStr = parseXeroDate(txn.Date)

          if (dateStr) {
            const existing = detectedMap.get(marketplace)
            if (!existing || dateStr > existing.last_recorded_date) {
              detectedMap.set(marketplace, {
                marketplace,
                last_recorded_date: dateStr,
                last_amount: amount,
                source: existing?.source === 'invoice' && existing.last_recorded_date >= dateStr
                  ? 'invoice' : 'bank_transaction',
                reference: reference || narration || contactName,
                xero_id: txnId,
              })
            }
          }
        }
      }
    } catch (e) {
      console.error('Bank transaction scan error:', e)
    }

    // 3. Determine boundary
    const detected_settlements = Array.from(detectedMap.values())
    let accounting_boundary_date: string | null = null

    if (detected_settlements.length > 0) {
      const latestDate = detected_settlements.reduce((latest, s) =>
        s.last_recorded_date > latest ? s.last_recorded_date : latest,
        detected_settlements[0].last_recorded_date
      )
      const d = new Date(latestDate)
      d.setDate(d.getDate() + 1)
      accounting_boundary_date = d.toISOString().split('T')[0]
    }

    // 4. Confidence
    let confidence: 'high' | 'medium' | 'low' = 'low'
    let confidence_reason = ''

    if (hasXettlePrefix) {
      confidence = 'high'
      confidence_reason = 'Found Xettle-prefixed invoices — previous Xettle usage detected.'
    } else if (hasMarketplaceContacts) {
      confidence = 'medium'
      confidence_reason = 'Found marketplace-named contacts in Xero invoices.'
    } else if (hasBankPatterns) {
      confidence = 'low'
      confidence_reason = 'Found bank transaction patterns only — no invoices matched.'
    } else {
      confidence_reason = 'No marketplace history found in Xero.'
    }

    // ─── 5. PERSIST detected marketplaces as marketplace_connections ───
    let marketplaces_created = 0
    for (const det of detected_settlements) {
      if (det.marketplace === 'unknown') continue

      // Check if already exists
      const { data: existing } = await supabase
        .from('marketplace_connections')
        .select('id')
        .eq('marketplace_code', det.marketplace)
        .maybeSingle()

      if (!existing) {
        const displayName = MARKETPLACE_NAMES[det.marketplace] || det.marketplace.replace(/_/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase())
        const { error: insertErr } = await supabase
          .from('marketplace_connections')
          .insert({
            user_id: userId,
            marketplace_code: det.marketplace,
            marketplace_name: displayName,
            country_code: 'AU',
            connection_type: 'auto_detected',
            connection_status: 'active',
            settings: {
              detected_from: 'xero_scan',
              last_xero_date: det.last_recorded_date,
              last_xero_amount: det.last_amount,
              xero_source: det.source,
              xero_reference: det.reference,
            },
          })
        if (!insertErr) marketplaces_created++
        else console.error(`Failed to create marketplace_connection for ${det.marketplace}:`, insertErr)
      }
    }

    // ─── 6. PERSIST accounting boundary date ───────────────────────────
    if (accounting_boundary_date) {
      const { data: existingBoundary } = await supabase
        .from('app_settings')
        .select('id')
        .eq('key', 'accounting_boundary_date')
        .maybeSingle()

      if (existingBoundary) {
        await supabase.from('app_settings')
          .update({ value: accounting_boundary_date })
          .eq('id', existingBoundary.id)
      } else {
        await supabase.from('app_settings')
          .insert({
            user_id: userId,
            key: 'accounting_boundary_date',
            value: accounting_boundary_date,
          })
      }
    }

    // ─── 7. Mark scan as completed ────────────────────────────────────
    const { data: existingScanFlag } = await supabase
      .from('app_settings')
      .select('id')
      .eq('key', 'xero_scan_completed')
      .maybeSingle()

    if (existingScanFlag) {
      await supabase.from('app_settings')
        .update({ value: new Date().toISOString() })
        .eq('id', existingScanFlag.id)
    } else {
      await supabase.from('app_settings')
        .insert({
          user_id: userId,
          key: 'xero_scan_completed',
          value: new Date().toISOString(),
        })
    }

    // ─── 8. Log system event ──────────────────────────────────────────
    await supabase.from('system_events').insert({
      user_id: userId,
      event_type: 'xero_scan_completed',
      severity: 'info',
      details: {
        marketplaces_detected: detected_settlements.length,
        marketplaces_created,
        accounting_boundary_date,
        confidence,
        confidence_reason,
      },
    })

    console.log(`[scan-xero-history] User ${userId}: detected ${detected_settlements.length} marketplaces, created ${marketplaces_created} connections, boundary: ${accounting_boundary_date}`)

    // ─── 9. Trigger validation sweep server-side as backup ────────────
    try {
      const sweepUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/run-validation-sweep`
      await fetch(sweepUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({}),
      })
      console.log(`[scan-xero-history] Validation sweep triggered for user ${userId}`)
    } catch (sweepErr) {
      console.warn('[scan-xero-history] Validation sweep failed (non-blocking):', sweepErr)
    }

    return new Response(JSON.stringify({
      hasXero: true,
      accounting_boundary_date,
      detected_settlements,
      marketplaces_created,
      confidence,
      confidence_reason,
    }), {
      status: 200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('scan-xero-history error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error', detail: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})