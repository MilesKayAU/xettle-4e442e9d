// ══════════════════════════════════════════════════════════════
// ACCOUNTING RULES (hardcoded, never configurable)
// Canonical source: src/constants/accounting-rules.ts
// 
// Rule #11 — Three-Layer Accounting Source Model:
//   Orders     → NEVER create accounting entries
//   Payments   → NEVER create accounting entries
//   Settlements → ONLY source of accounting entries
//
// PAYMENT VERIFICATION LAYER ONLY
// This function never creates accounting entries.
// No invoice. No journal. No Xero push.
// Settlements are the only accounting source.
//
// Nothing is marked as matched until user explicitly confirms.
// Auto-detection is always a SUGGESTION.
// ══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const GATEWAY_DETECTION: Record<string, string[]> = {
  paypal: ['paypal', 'pypl'],
  shopify_payments: ['shopify', 'stripe'],
}

function parseXeroDate(dateField: string | null | undefined): string | null {
  if (!dateField) return null
  const raw = dateField.replace('/Date(', '').replace(')/', '').split('+')[0]
  const ts = parseInt(raw)
  if (!isNaN(ts)) return new Date(ts).toISOString().split('T')[0]
  return raw.split('T')[0]
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

async function refreshXeroToken(supabase: any, userId: string, clientId: string, clientSecret: string) {
  // Re-read token from DB immediately before refresh to prevent race conditions
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

interface PaymentCandidate {
  transaction_id: string
  amount: number
  date: string
  narration: string
  bank_account_name: string
  gateway_code: string
  order_count: number
  confidence: 'high' | 'medium' | 'low'
  score: number
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  // PAYMENT VERIFICATION LAYER ONLY
  // This function never creates accounting entries.
  // No invoice. No journal. No Xero push.
  // Settlements are the only accounting source.
  // See: architecture rule #11

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
      return new Response(JSON.stringify({ error: 'No Xero connection' }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const { access_token: accessToken, tenant_id: tenantId } = tokenRow

    // ─── 1. Read user's verification settings ───────────────────
    const { data: settings } = await supabase
      .from('app_settings')
      .select('key, value')
      .in('key', [
        'paypal_verification_enabled',
        'shopify_payments_verification_enabled',
        'paypal_xero_account_id',
        'shopify_payments_xero_account_id',
      ])

    const settingsMap: Record<string, string> = {}
    for (const s of (settings || [])) {
      settingsMap[s.key] = s.value || ''
    }

    // Determine which gateways are enabled and have Xero accounts
    const enabledGateways: { code: string; accountId: string }[] = []

    if (settingsMap['paypal_verification_enabled'] === 'true' && settingsMap['paypal_xero_account_id']) {
      enabledGateways.push({ code: 'paypal', accountId: settingsMap['paypal_xero_account_id'] })
    }
    if (settingsMap['shopify_payments_verification_enabled'] === 'true' && settingsMap['shopify_payments_xero_account_id']) {
      enabledGateways.push({ code: 'shopify_payments', accountId: settingsMap['shopify_payments_xero_account_id'] })
    }

    if (enabledGateways.length === 0) {
      return new Response(JSON.stringify({
        candidates: [],
        message: 'No payment gateways enabled for verification',
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ─── 2. Fetch bank transactions for each gateway ────────────
    // Nothing is marked as matched until user explicitly confirms.
    // Auto-detection is always a SUGGESTION.
    const allCandidates: Record<string, PaymentCandidate[]> = {}
    const thirtyDaysAgo = addDays(new Date().toISOString().split('T')[0], -30)

    for (const gateway of enabledGateways) {
      try {
        const bankData = await xeroGet(
          `https://api.xero.com/api.xro/2.0/BankTransactions?where=BankAccount.AccountID=guid("${gateway.accountId}")&order=Date DESC&pageSize=100`,
          accessToken, tenantId
        )

        const transactions = (bankData.BankTransactions || []).filter((txn: any) => {
          if (txn.Type !== 'RECEIVE') return false
          const dateStr = parseXeroDate(txn.Date)
          return dateStr && dateStr >= thirtyDaysAgo
        })

        // ─── 3. For each transaction, find matching Shopify orders ──
        for (const txn of transactions) {
          const txnDate = parseXeroDate(txn.Date)!
          const txnAmount = txn.Total || 0
          const txnId = txn.BankTransactionID || ''
          const narration = txn.LineItems?.[0]?.Description || txn.Reference || ''
          const bankAccountName = txn.BankAccount?.Name || ''

          // Find Shopify orders within ±5 day window with matching gateway
          const windowStart = addDays(txnDate, -5)
          const windowEnd = addDays(txnDate, 5)

          const gatewayFilter = gateway.code === 'paypal' ? 'paypal' : 'shopify_payments'

          const { data: orders } = await supabase
            .from('shopify_orders')
            .select('total_price, gateway, processed_at')
            .ilike('gateway', `%${gatewayFilter}%`)
            .gte('processed_at', windowStart)
            .lte('processed_at', windowEnd)

          if (!orders || orders.length === 0) continue

          const orderTotal = orders.reduce((sum: number, o: any) => sum + (o.total_price || 0), 0)

          // Apply ±3% fee tolerance (PayPal deducts fees before deposit)
          const tolerance = orderTotal * 0.03
          const amountDiff = Math.abs(txnAmount - orderTotal)

          if (amountDiff > tolerance && amountDiff > 1.00) continue // Not a match

          // Score the candidate
          let score = 0

          // Amount proximity (strongest signal)
          const amountProximity = 1 - (amountDiff / Math.max(orderTotal, 1))
          score += amountProximity * 50

          // Narration match (second signal)
          const narrationLower = narration.toLowerCase()
          const detectionPatterns = GATEWAY_DETECTION[gateway.code] || []
          const narrationMatch = detectionPatterns.some(p => narrationLower.includes(p))
          if (narrationMatch) score += 30

          // Date proximity (third signal)
          const daysDiff = Math.abs(
            (new Date(txnDate).getTime() - new Date(orders[0].processed_at).getTime()) / 86400000
          )
          score += Math.max(0, 20 - daysDiff * 4)

          const confidence: 'high' | 'medium' | 'low' =
            score >= 80 ? 'high' :
            score >= 50 ? 'medium' : 'low'

          if (!allCandidates[gateway.code]) {
            allCandidates[gateway.code] = []
          }

          allCandidates[gateway.code].push({
            transaction_id: txnId,
            amount: txnAmount,
            date: txnDate,
            narration,
            bank_account_name: bankAccountName,
            gateway_code: gateway.code,
            order_count: orders.length,
            confidence,
            score,
          })
        }

        // Sort by score descending
        if (allCandidates[gateway.code]) {
          allCandidates[gateway.code].sort((a, b) => b.score - a.score)
        }
      } catch (err) {
        console.error(`[verify-payment-matches] Error fetching ${gateway.code} transactions:`, err)
      }
    }

    // ─── 4. Return suggestions (never write to DB) ──────────────
    // Nothing is marked as matched until user explicitly confirms.
    // Auto-detection is always a SUGGESTION.

    return new Response(JSON.stringify({
      candidates: allCandidates,
      gateways_checked: enabledGateways.map(g => g.code),
    }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('[verify-payment-matches] Error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error', detail: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
