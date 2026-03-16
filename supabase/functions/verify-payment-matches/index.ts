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
//
// ARCHITECTURE: This function reads ONLY from the local
// bank_transactions cache. It NEVER calls Xero BankTransactions
// directly. The cache is seeded by fetch-xero-bank-transactions.
// ══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders, handleCorsPreflightResponse } from '../_shared/cors.ts'

const GATEWAY_DETECTION: Record<string, string[]> = {
  paypal: ['paypal', 'pypl'],
  shopify_payments: ['shopify', 'stripe'],
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
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
  const corsHeaders = getCorsHeaders(req)
  const preflightResponse = handleCorsPreflightResponse(req)
  if (preflightResponse) return preflightResponse

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

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

    const supabase = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const userId = user.id
    const adminSupabase = createClient(supabaseUrl, serviceRoleKey)

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
        diagnostics: { gateways_enabled: 0, bank_cache_used: false },
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // ─── 2. Read from local bank_transactions cache (NEVER call Xero directly) ──
    // The cache is seeded by fetch-xero-bank-transactions.
    const thirtyDaysAgo = addDays(new Date().toISOString().split('T')[0], -30)

    // Check if cache has ANY rows for this user
    const { count: bankCacheCount } = await adminSupabase
      .from('bank_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)

    if (!bankCacheCount || bankCacheCount === 0) {
      // ── EARLY EXIT: Cache empty — do NOT attempt verification ──
      console.log(`[verify-payment-matches] Bank cache empty for ${userId} — exiting early. Run fetch-xero-bank-transactions first.`)
      return new Response(JSON.stringify({
        candidates: {},
        gateways_checked: enabledGateways.map(g => g.code),
        bank_feed_empty: true,
        message: 'Bank feed not seeded yet. Sync bank feed before running payment verification.',
        diagnostics: {
          bank_cache_rows: 0,
          gateways_enabled: enabledGateways.length,
          xero_api_calls_made: 0,
          verification_attempted: false,
          action_required: 'Run "Sync bank feed" to populate the bank_transactions cache first.',
        },
      }), {
        status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Nothing is marked as matched until user explicitly confirms.
    // Auto-detection is always a SUGGESTION.
    const allCandidates: Record<string, PaymentCandidate[]> = {}
    const diagnostics = {
      bank_cache_rows: bankCacheCount,
      gateways_enabled: enabledGateways.length,
      xero_api_calls_made: 0,
      verification_attempted: true,
      accounts_checked: 0,
      transactions_checked: 0,
    }

    for (const gateway of enabledGateways) {
      try {
        // Query local cache for this gateway's bank account
        const { data: cachedTxns, error: cacheErr } = await adminSupabase
          .from('bank_transactions')
          .select('*')
          .eq('user_id', userId)
          .eq('bank_account_id', gateway.accountId)
          .eq('transaction_type', 'RECEIVE')
          .gte('date', thirtyDaysAgo)
          .order('date', { ascending: false })
          .limit(100)

        if (cacheErr) {
          console.error(`[verify-payment-matches] Cache query error for ${gateway.code}:`, cacheErr.message)
          continue
        }

        const transactions = cachedTxns || []
        diagnostics.accounts_checked++
        diagnostics.transactions_checked += transactions.length

        console.log(`[verify-payment-matches] ${gateway.code}: ${transactions.length} cached RECEIVE txns from account ${gateway.accountId}`)

        if (transactions.length === 0) continue

        // ─── 3. For each cached transaction, find matching Shopify orders ──
        for (const txn of transactions) {
          const txnDate = txn.date
          const txnAmount = Math.abs(txn.amount || 0)
          const txnId = txn.xero_transaction_id || ''
          const narration = txn.description || txn.reference || ''
          const bankAccountName = txn.bank_account_name || ''

          if (!txnDate) continue

          // Find Shopify orders within ±5 day window with matching gateway
          const windowStart = addDays(txnDate, -5)
          const windowEnd = addDays(txnDate, 5)

          const gatewayFilter = gateway.code === 'paypal' ? 'paypal' : 'shopify_payments'

          const { data: orders } = await adminSupabase
            .from('shopify_orders')
            .select('total_price, gateway, processed_at')
            .eq('user_id', userId)
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
        console.error(`[verify-payment-matches] Error processing ${gateway.code}:`, err)
      }
    }

    // ─── 4. Return suggestions (never write to DB) ──────────────
    // Nothing is marked as matched until user explicitly confirms.
    // Auto-detection is always a SUGGESTION.

    return new Response(JSON.stringify({
      candidates: allCandidates,
      gateways_checked: enabledGateways.map(g => g.code),
      bank_feed_empty: false,
      diagnostics,
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
