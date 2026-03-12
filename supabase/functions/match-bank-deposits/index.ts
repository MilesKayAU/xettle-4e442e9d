// ══════════════════════════════════════════════════════════════
// ACCOUNTING RULES (hardcoded, never configurable)
// Canonical source: src/constants/accounting-rules.ts
// 
// Rule #11 — Three-Layer Accounting Source Model:
//   Orders     → NEVER create accounting entries
//   Payments   → NEVER create accounting entries
//   Settlements → ONLY source of accounting entries
//
// This function matches bank deposits to settlements for VERIFICATION.
// Nothing is marked as matched until user explicitly confirms.
// Auto-detection is always a SUGGESTION.
//
// v2: Now reads from local bank_transactions cache instead of
//     calling Xero API per settlement. Much faster and cheaper.
// ══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const MARKETPLACE_NAMES: Record<string, string[]> = {
  amazon_au: ['amazon', 'amzn', 'amazon payments', 'amzn mktplace pmts', 'amazon au'],
  kogan: ['kogan'],
  bigw: ['big w', 'bigw'],
  bunnings: ['bunnings', 'mirakl'],
  mydeal: ['mydeal', 'my deal'],
  catch: ['catch'],
  shopify: ['shopify', 'shopify payments'],
  ebay: ['ebay'],
  woolworths: ['woolworths', 'woolies'],
  iconic: ['iconic', 'the iconic'],
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

function narrationMatchesMarketplace(description: string, contactName: string, marketplace: string): boolean {
  const text = `${description} ${contactName}`.toLowerCase()
  const patterns = MARKETPLACE_NAMES[marketplace] || [marketplace.replace('_', ' ')]
  return patterns.some(p => text.includes(p))
}

interface MatchResult {
  matched: boolean
  settlement_id: string
  marketplace: string
  possible_match?: {
    date: string | null
    amount: number
    reference: string
    narration: string
    transaction_id: string
  }
  confidence?: number
  confidence_score?: number
  difference?: number
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    // Auth
    const authHeader = req.headers.get('Authorization')
    let userId: string | null = null

    if (authHeader?.startsWith('Bearer ')) {
      const userSupabase = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      })
      const { data: { user }, error: authError } = await userSupabase.auth.getUser()
      if (!authError && user) userId = user.id
    }

    const body = await req.json().catch(() => ({}))
    if (!userId && body.userId) userId = body.userId

    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const adminSupabase = createClient(supabaseUrl, serviceRoleKey)
    const settlementId = body.settlementId as string | undefined

    // Get settlements to match
    let query = adminSupabase
      .from('settlements')
      .select('*')
      .eq('user_id', userId)
      .eq('bank_verified', false)

    if (settlementId) {
      query = query.eq('settlement_id', settlementId)
    } else {
      // Match pushed settlements that don't have a deposit match yet
      query = query.or('status.eq.synced,status.eq.pushed_to_xero,status.eq.awaiting_deposit,status.eq.draft_in_xero,status.eq.authorised_in_xero')
    }

    const { data: settlements, error: settErr } = await query
    if (settErr) throw settErr

    if (!settlements || settlements.length === 0) {
      return new Response(JSON.stringify({ success: true, results: [], message: 'No unmatched settlements' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const results: MatchResult[] = []

    for (const settlement of settlements) {
      const s = settlement as any
      const depositAmount = Math.abs(s.bank_deposit || s.net_ex_gst || 0)
      const marketplace = s.marketplace || 'unknown'
      const periodEnd = s.period_end

      if (depositAmount === 0) {
        results.push({ matched: false, settlement_id: s.settlement_id, marketplace })
        continue
      }

      // ── Query local bank_transactions cache (7-day window) ──
      const fromDate = periodEnd
      const toDate = addDays(periodEnd, 7)

      const { data: bankTxns, error: btErr } = await adminSupabase
        .from('bank_transactions')
        .select('*')
        .eq('user_id', userId)
        .gte('date', fromDate)
        .lte('date', toDate)
        .eq('transaction_type', 'RECEIVE')

      if (btErr) {
        console.error(`[bank-match] DB query error for ${s.settlement_id}:`, btErr.message)
      }

      const txns = bankTxns || []
      console.log(`[bank-match] ${marketplace} (${s.settlement_id}): ${txns.length} cached RECEIVE txns in ${fromDate} → ${toDate}, searching for ${depositAmount}`)

      // ══════════════════════════════════════════════════════════════
      // GOLDEN RULE: Nothing is marked as matched until user explicitly
      // confirms. Auto-detection is always a SUGGESTION, never a fact.
      // This function NEVER writes bank_verified or bank_match fields.
      // ══════════════════════════════════════════════════════════════
      const candidates: any[] = []

      for (const txn of txns) {
        const txnAmount = Math.abs(txn.amount || 0)
        const txnDate = txn.date
        const amountDiff = Math.abs(txnAmount - depositAmount)
        const description = txn.description || ''
        const contactName = txn.contact_name || ''
        const txnRef = txn.reference || ''
        const bankAccountName = txn.bank_account_name || ''

        // Score each candidate
        let score = 0
        const nameMatch = narrationMatchesMarketplace(description, contactName, marketplace) ||
          description.includes(s.settlement_id) || txnRef.includes(s.settlement_id)

        // Amount scoring
        if (amountDiff <= 0.05) score += 50
        else if (amountDiff <= 0.50) score += 40
        else if (amountDiff <= 1.00) score += 30
        else if (amountDiff <= 10) score += 15

        // Processor/narration match (+30)
        if (nameMatch) score += 30

        // Date proximity
        if (txnDate) {
          const daysDiff = Math.abs((new Date(txnDate).getTime() - new Date(periodEnd).getTime()) / (1000 * 60 * 60 * 24))
          if (daysDiff <= 2) score += 20
          else if (daysDiff <= 7) score += 10
        }

        if (score >= 15) {
          const confidence = score >= 90 ? 'high' : score >= 70 ? 'medium' : 'low'
          candidates.push({
            transaction_id: txn.xero_transaction_id,
            amount: txnAmount,
            date: txnDate,
            reference: txnRef,
            narration: description,
            bank_account_name: bankAccountName,
            confidence,
            score,
            amount_diff: amountDiff,
          })
        }
      }

      // Sort candidates by score descending
      candidates.sort((a: any, b: any) => b.score - a.score)

      if (candidates.length > 0) {
        const best = candidates[0]

        // ── Write high-confidence match to payment_verifications (suggestion only) ──
        if (best.score >= 90) {
          await adminSupabase.from('payment_verifications').upsert({
            user_id: userId,
            settlement_id: s.settlement_id,
            gateway_code: marketplace,
            xero_tx_id: best.transaction_id,
            match_amount: best.amount,
            match_method: 'auto_suggested',
            match_confidence: best.confidence,
            confidence_score: best.score,
            narration: best.narration,
            transaction_date: best.date,
            order_count: 0,
          }, { onConflict: 'settlement_id,gateway_code' } as any)

          // Update settlement status to deposit_matched (but NOT bank_verified)
          await adminSupabase.from('settlements').update({
            status: 'deposit_matched',
          }).eq('settlement_id', s.settlement_id).eq('user_id', userId)
            .in('status', ['awaiting_deposit', 'synced', 'pushed_to_xero', 'draft_in_xero', 'authorised_in_xero'])
        }

        results.push({
          matched: false, // GOLDEN RULE: never auto-confirmed
          settlement_id: s.settlement_id,
          marketplace,
          possible_match: {
            date: best.date,
            amount: best.amount,
            reference: best.reference,
            narration: best.narration,
            transaction_id: best.transaction_id,
          },
          confidence: best.score >= 90 ? 0.9 : best.score >= 70 ? 0.7 : 0.5,
          confidence_score: best.score,
          difference: best.amount_diff,
        })
      } else {
        // Log no match
        await adminSupabase.from('system_events').insert({
          user_id: userId,
          event_type: 'bank_match_failed',
          marketplace_code: marketplace,
          settlement_id: s.settlement_id,
          period_label: `${s.period_start} → ${s.period_end}`,
          details: { deposit_amount: depositAmount, searched_from: fromDate, searched_to: toDate, cached_txns_checked: txns.length },
          severity: 'warning',
        })

        results.push({ matched: false, settlement_id: s.settlement_id, marketplace, possible_match: undefined })
      }
    }

    const matched = results.filter(r => r.matched).length
    const fuzzy = results.filter(r => !r.matched && r.possible_match).length

    return new Response(JSON.stringify({
      success: true,
      matched,
      fuzzy,
      unmatched: results.length - matched - fuzzy,
      results,
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('match-bank-deposits error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error', detail: String(err) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})

// ══════════════════════════════════════════════════════════════
// GOLDEN RULE: The applyMatch function has been REMOVED.
// Nothing is marked as matched until user explicitly confirms.
// Auto-detection is always a SUGGESTION, never a fact.
// All bank match confirmations happen via the OutstandingTab UI
// where the user reviews and clicks "Confirm match".
// ══════════════════════════════════════════════════════════════
