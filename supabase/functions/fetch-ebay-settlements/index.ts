import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-action, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const EBAY_API_BASE = 'https://apiz.ebay.com'
const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token'
const EBAY_SCOPES = 'https://api.ebay.com/oauth/api_scope/sell.finances https://api.ebay.com/oauth/api_scope/sell.fulfillment'

function round2(n: number): number { return Math.round(n * 100) / 100 }

// ─── Token Refresh ─────────────────────────────────────────────────────

async function getEbayAccessToken(
  supabase: any,
  tokenRow: any,
): Promise<{ access_token: string; error?: string }> {
  // If token is still valid (60s buffer), return it
  if (tokenRow.access_token && tokenRow.expires_at &&
    new Date(tokenRow.expires_at) > new Date(Date.now() + 60_000)) {
    return { access_token: tokenRow.access_token }
  }

  const EBAY_CLIENT_ID = Deno.env.get('EBAY_CLIENT_ID')
  const EBAY_CERT_ID = Deno.env.get('EBAY_CERT_ID')
  if (!EBAY_CLIENT_ID || !EBAY_CERT_ID) {
    return { access_token: '', error: 'eBay API credentials not configured' }
  }

  // Optimistic locking: re-read token to prevent race condition
  const { data: freshToken } = await supabase
    .from('ebay_tokens')
    .select('access_token, expires_at, refresh_token')
    .eq('id', tokenRow.id)
    .single()

  const effectiveToken = freshToken || tokenRow
  if (effectiveToken.access_token && effectiveToken.expires_at &&
    new Date(effectiveToken.expires_at) > new Date(Date.now() + 60_000)) {
    return { access_token: effectiveToken.access_token }
  }

  const basicAuth = btoa(`${EBAY_CLIENT_ID}:${EBAY_CERT_ID}`)

  const refreshResponse = await fetch(EBAY_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${basicAuth}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: effectiveToken.refresh_token,
      scope: EBAY_SCOPES,
    }),
  })

  const refreshData = await refreshResponse.json()
  if (!refreshResponse.ok || !refreshData.access_token) {
    console.error('[fetch-ebay-settlements] Token refresh failed:', refreshData)
    return { access_token: '', error: 'Token refresh failed' }
  }

  const newExpiresAt = new Date(Date.now() + (refreshData.expires_in || 7200) * 1000).toISOString()

  await supabase
    .from('ebay_tokens')
    .update({ access_token: refreshData.access_token, expires_at: newExpiresAt })
    .eq('id', tokenRow.id)

  return { access_token: refreshData.access_token }
}

// ─── eBay API Helpers ──────────────────────────────────────────────────

interface EbayPayout {
  payoutId: string
  payoutDate: string
  payoutStatus: string
  amount: { value: string; currency: string }
  transactionCount?: number
  payoutMemo?: string
}

interface EbayTransaction {
  transactionId: string
  transactionType: string
  transactionDate: string
  amount: { value: string; currency: string }
  totalFeeBasisAmount?: { value: string; currency: string }
  totalFeeAmount?: { value: string; currency: string }
  orderId?: string
  orderLineItems?: any[]
  references?: any[]
  payin?: any
  buyer?: { username: string }
}

async function fetchPayouts(
  accessToken: string,
  syncFrom: string,
  syncTo: string,
): Promise<{ payouts: EbayPayout[]; error?: string }> {
  const allPayouts: EbayPayout[] = []
  let offset = 0
  const limit = 50
  const maxPages = 10

  for (let page = 0; page < maxPages; page++) {
    const filter = `payoutDate:[${syncFrom}T00:00:00.000Z..${syncTo}T23:59:59.999Z]`
    const url = `${EBAY_API_BASE}/sell/finances/v1/payout?limit=${limit}&offset=${offset}&filter=${encodeURIComponent(filter)}&sort=payoutDate`

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    })

    if (!res.ok) {
      const text = await res.text()
      console.error(`[fetch-ebay-settlements] getPayouts failed (${res.status}):`, text)
      if (res.status === 429) return { payouts: allPayouts, error: 'rate_limited' }
      return { payouts: allPayouts, error: `API error ${res.status}` }
    }

    const data = await res.json()
    const payouts: EbayPayout[] = data.payouts || []
    allPayouts.push(...payouts)

    if (payouts.length < limit || !data.next) break
    offset += limit
  }

  return { payouts: allPayouts }
}

async function fetchTransactionsForPayout(
  accessToken: string,
  payoutId: string,
): Promise<EbayTransaction[]> {
  const allTx: EbayTransaction[] = []
  let offset = 0
  const limit = 100
  const maxPages = 5

  for (let page = 0; page < maxPages; page++) {
    const filter = `payoutReference:{${payoutId}}`
    const url = `${EBAY_API_BASE}/sell/finances/v1/transaction?limit=${limit}&offset=${offset}&filter=${encodeURIComponent(filter)}`

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    })

    if (!res.ok) {
      const text = await res.text()
      console.error(`[fetch-ebay-settlements] getTransactions failed for payout ${payoutId} (${res.status}):`, text)
      break
    }

    const data = await res.json()
    const txns: EbayTransaction[] = data.transactions || []
    allTx.push(...txns)

    if (txns.length < limit || !data.next) break
    offset += limit
  }

  return allTx
}

// ─── Settlement Builder ─────────────────────────────────────────────────

function buildSettlementFromPayout(
  payout: EbayPayout,
  transactions: EbayTransaction[],
  userId: string,
): any {
  // Aggregate transaction amounts by type
  let salesTotal = 0
  let refundsTotal = 0
  let feesTotal = 0
  let shippingTotal = 0

  for (const tx of transactions) {
    const amount = parseFloat(tx.amount?.value || '0')
    const feeAmount = parseFloat(tx.totalFeeAmount?.value || '0')
    const type = tx.transactionType || ''

    switch (type) {
      case 'SALE':
        salesTotal += amount
        feesTotal -= Math.abs(feeAmount)
        break
      case 'REFUND':
        refundsTotal += amount // already negative from eBay
        break
      case 'CREDIT':
        salesTotal += amount
        break
      case 'DISPUTE':
      case 'SHIPPING_LABEL':
      case 'TRANSFER':
      case 'NON_SALE_CHARGE':
        feesTotal += amount
        break
      default:
        // Other transaction types go to other_fees
        feesTotal += amount
        break
    }
  }

  const payoutAmount = parseFloat(payout.amount?.value || '0')
  const currency = payout.amount?.currency || 'AUD'

  // eBay AU GST model: seller-collected (1/11th estimate for AUD)
  const gstRate = currency === 'AUD' ? 10 : 0
  const gstOnIncome = gstRate > 0 ? round2(salesTotal / 11) : 0
  const gstOnExpenses = gstRate > 0 ? round2(Math.abs(feesTotal) / 11) : 0

  // Derive period from payout date
  const payoutDate = payout.payoutDate?.split('T')[0] || new Date().toISOString().split('T')[0]

  // Find earliest and latest transaction dates for period range
  let periodStart = payoutDate
  let periodEnd = payoutDate
  for (const tx of transactions) {
    const txDate = (tx.transactionDate || '').split('T')[0]
    if (txDate && txDate < periodStart) periodStart = txDate
    if (txDate && txDate > periodEnd) periodEnd = txDate
  }

  return {
    user_id: userId,
    settlement_id: `ebay_payout_${payout.payoutId}`,
    marketplace: 'ebay_au',
    period_start: periodStart,
    period_end: periodEnd,
    deposit_date: payoutDate,
    sales_principal: round2(salesTotal),
    sales_shipping: round2(shippingTotal),
    seller_fees: round2(feesTotal),
    refunds: round2(refundsTotal),
    gst_on_income: round2(gstOnIncome),
    gst_on_expenses: round2(-gstOnExpenses),
    bank_deposit: round2(payoutAmount),
    net_ex_gst: round2(payoutAmount - gstOnIncome),
    source: 'api',
    source_reference: `ebay_finances_api`,
    sync_origin: 'scheduled',
    status: 'saved',
    parser_version: 'ebay_finances_v1',
  }
}

// ─── Main Handler ──────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminClient = createClient(supabaseUrl, supabaseServiceKey)

    // Support both user-authenticated and service-role (cron) calls
    const authHeader = req.headers.get('Authorization') || ''
    const isServiceRole = authHeader.includes(supabaseServiceKey)

    let body: any = {}
    try { body = await req.json() } catch { /* empty body ok */ }

    const syncFrom = body.sync_from || (() => {
      const d = new Date(); d.setMonth(d.getMonth() - 2)
      return d.toISOString().split('T')[0]
    })()
    const syncTo = body.sync_to || new Date().toISOString().split('T')[0]

    // Collect eBay users to process
    let userTokens: any[] = []

    if (isServiceRole) {
      // Cron mode: process all users with eBay tokens
      const { data } = await adminClient.from('ebay_tokens').select('*')
      userTokens = data || []
    } else {
      // User mode: process only the authenticated user
      const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
      const userClient = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      })
      const { data: { user } } = await userClient.auth.getUser()
      if (!user) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data } = await userClient.from('ebay_tokens').select('*').eq('user_id', user.id).limit(1)
      userTokens = data || []
    }

    if (userTokens.length === 0) {
      return new Response(JSON.stringify({ skipped: true, reason: 'no_ebay_tokens' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const results: any[] = []

    for (const tokenRow of userTokens) {
      const userId = tokenRow.user_id
      console.log(`[fetch-ebay-settlements] Processing user ${userId}, sync_from=${syncFrom}`)

      // Use service-role client scoped to user for writes
      const userAdminClient = adminClient

      // 1. Get valid access token
      const { access_token, error: tokenError } = await getEbayAccessToken(
        isServiceRole ? adminClient : createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
          global: { headers: { Authorization: authHeader } },
        }),
        tokenRow,
      )

      if (tokenError || !access_token) {
        console.error(`[fetch-ebay-settlements] Token error for ${userId}:`, tokenError)
        results.push({ user_id: userId, error: tokenError || 'No access token', imported: 0 })
        continue
      }

      // 2. Fetch payouts in date range
      const { payouts, error: payoutsError } = await fetchPayouts(access_token, syncFrom, syncTo)

      if (payoutsError === 'rate_limited') {
        // Set cooldown
        await userAdminClient.from('app_settings').upsert({
          user_id: userId,
          key: 'ebay_rate_limit_until',
          value: new Date(Date.now() + 3600_000).toISOString(),
        }, { onConflict: 'user_id,key' })
        results.push({ user_id: userId, error: 'rate_limited', imported: 0 })
        continue
      }

      if (payoutsError) {
        results.push({ user_id: userId, error: payoutsError, imported: 0 })
        continue
      }

      console.log(`[fetch-ebay-settlements] Found ${payouts.length} payouts for user ${userId}`)

      // 3. Filter to SUCCEEDED payouts only, check for existing settlements
      const succeededPayouts = payouts.filter(p => p.payoutStatus === 'SUCCEEDED')
      let imported = 0
      let skipped = 0

      for (const payout of succeededPayouts) {
        const settlementId = `ebay_payout_${payout.payoutId}`

        // Check if already exists
        const { data: existing } = await userAdminClient
          .from('settlements')
          .select('id')
          .eq('user_id', userId)
          .eq('settlement_id', settlementId)
          .limit(1)

        if (existing && existing.length > 0) {
          skipped++
          continue
        }

        // 4. Fetch transactions for this payout
        const transactions = await fetchTransactionsForPayout(access_token, payout.payoutId)

        // 5. Build and insert settlement
        const settlement = buildSettlementFromPayout(payout, transactions, userId)

        const { error: insertError } = await userAdminClient
          .from('settlements')
          .insert(settlement)

        if (insertError) {
          console.error(`[fetch-ebay-settlements] Insert failed for payout ${payout.payoutId}:`, insertError)
          continue
        }

        imported++

        // 6. Log system event
        await userAdminClient.from('system_events').insert({
          user_id: userId,
          event_type: 'ebay_settlement_imported',
          severity: 'info',
          marketplace_code: 'ebay_au',
          settlement_id: settlementId,
          details: {
            payout_id: payout.payoutId,
            payout_date: payout.payoutDate,
            amount: payout.amount?.value,
            currency: payout.amount?.currency,
            transaction_count: transactions.length,
            source: 'ebay_finances_api',
          },
        })
      }

      console.log(`[fetch-ebay-settlements] User ${userId}: imported=${imported}, skipped=${skipped}, total_payouts=${succeededPayouts.length}`)
      results.push({
        user_id: userId,
        imported,
        skipped,
        total_payouts: succeededPayouts.length,
        sync_from: syncFrom,
        sync_to: syncTo,
      })
    }

    const totalImported = results.reduce((sum, r) => sum + (r.imported || 0), 0)

    return new Response(JSON.stringify({
      success: true,
      total_synced: totalImported,
      users_processed: results.length,
      results,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    console.error('[fetch-ebay-settlements] error:', err)
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
