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
// v3: Currency safety, batch deposit matching for Amazon.
//     Removed awaiting_deposit status.
// ══════════════════════════════════════════════════════════════

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const MARKETPLACE_NAMES: Record<string, string[]> = {
  amazon_au: ['amazon', 'amzn', 'amazon payments', 'amzn mktplace pmts', 'amazon au'],
  amazon_us: ['amazon', 'amzn', 'amazon.com'],
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

// ── Currency derivation from marketplace code ──────────────────
const MARKETPLACE_CURRENCY: Record<string, string> = {
  amazon_au: 'AUD',
  amazon_us: 'USD',
  amazon_uk: 'GBP',
  amazon_ca: 'CAD',
  kogan: 'AUD',
  bigw: 'AUD',
  bunnings: 'AUD',
  mydeal: 'AUD',
  catch: 'AUD',
  shopify: 'AUD',
  ebay: 'AUD',
  woolworths: 'AUD',
  iconic: 'AUD',
}

function deriveCurrency(marketplace: string): string {
  return MARKETPLACE_CURRENCY[marketplace] || 'AUD'
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
  match_method?: string
  batch_settlement_ids?: string[]
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
      query = query.or('status.eq.synced,status.eq.pushed_to_xero,status.eq.draft_in_xero,status.eq.authorised_in_xero')
    }

    const { data: settlements, error: settErr } = await query
    if (settErr) throw settErr

    if (!settlements || settlements.length === 0) {
      return new Response(JSON.stringify({ success: true, results: [], message: 'No unmatched settlements' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const results: MatchResult[] = []
    // Track which settlements got matched in Pass 1 (for Pass 2 batch matching)
    const unmatchedSettlements: any[] = []

    // ══════════════════════════════════════════════════════════════
    // PASS 1: Individual settlement → single bank deposit matching
    // ══════════════════════════════════════════════════════════════
    for (const settlement of settlements) {
      try {
        const s = settlement as any
        const depositAmount = Math.abs(s.bank_deposit || s.net_ex_gst || 0)
        const marketplace = s.marketplace || 'unknown'
        const periodEnd = s.period_end
        const currency = deriveCurrency(marketplace)

        if (depositAmount === 0) {
          results.push({ matched: false, settlement_id: s.settlement_id, marketplace })
          continue
        }

        // ── Query local bank_transactions cache (7-day window) with currency filter ──
        const fromDate = periodEnd
        const toDate = addDays(periodEnd, 7)

        const { data: bankTxns, error: btErr } = await adminSupabase
          .from('bank_transactions')
          .select('*')
          .eq('user_id', userId)
          .eq('currency', currency)
          .gte('date', fromDate)
          .lte('date', toDate)
          .eq('transaction_type', 'RECEIVE')

        if (btErr) {
          console.error(`[bank-match] DB query error for ${s.settlement_id}:`, btErr.message)
        }

        const txns = bankTxns || []
        console.log(`[bank-match] ${marketplace} (${s.settlement_id}): ${txns.length} ${currency} RECEIVE txns in ${fromDate} → ${toDate}, searching for ${depositAmount}`)

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

        if (candidates.length > 0 && candidates[0].score >= 90) {
          const best = candidates[0]

          // ── Write high-confidence match to payment_verifications (suggestion only) ──
          const singleGroupId = crypto.randomUUID()
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
            deposit_group_id: singleGroupId,
          }, { onConflict: 'settlement_id,gateway_code' } as any)

          // Update settlement status to deposit_matched (but NOT bank_verified)
          await adminSupabase.from('settlements').update({
            status: 'deposit_matched',
          }).eq('settlement_id', s.settlement_id).eq('user_id', userId)
            .in('status', ['synced', 'pushed_to_xero', 'draft_in_xero', 'authorised_in_xero'])

          results.push({
            matched: false, // GOLDEN RULE: never auto-confirmed
            settlement_id: s.settlement_id,
            marketplace,
            match_method: 'individual',
            possible_match: {
              date: best.date,
              amount: best.amount,
              reference: best.reference,
              narration: best.narration,
              transaction_id: best.transaction_id,
            },
            confidence: 0.9,
            confidence_score: best.score,
            difference: best.amount_diff,
          })
        } else if (candidates.length > 0) {
          // Low/medium confidence — report but don't update status
          const best = candidates[0]
          results.push({
            matched: false,
            settlement_id: s.settlement_id,
            marketplace,
            match_method: 'individual',
            possible_match: {
              date: best.date,
              amount: best.amount,
              reference: best.reference,
              narration: best.narration,
              transaction_id: best.transaction_id,
            },
            confidence: best.score >= 70 ? 0.7 : 0.5,
            confidence_score: best.score,
            difference: best.amount_diff,
          })
          unmatchedSettlements.push(s)
        } else {
          unmatchedSettlements.push(s)
          results.push({ matched: false, settlement_id: s.settlement_id, marketplace })
        }
      } catch (perSettlementErr: any) {
        console.error(`[bank-match] Error matching ${(settlement as any).settlement_id}:`, perSettlementErr.message)
        results.push({ matched: false, settlement_id: (settlement as any).settlement_id, marketplace: (settlement as any).marketplace || 'unknown' })
        unmatchedSettlements.push(settlement)
      }
    }

    // ══════════════════════════════════════════════════════════════
    // PASS 2: Batch matching — Amazon frequently combines multiple
    //         settlements into one bank deposit.
    //
    //   Settlement A: $732.58  ┐
    //   Settlement B: $1,081.93├→ Bank deposit: $2,658.41
    //   Settlement C: $843.90  ┘
    //
    // Group unmatched settlements by marketplace + overlapping
    // date window, sum their bank_deposit values, and search for
    // a single bank transaction matching the sum.
    //
    // GOLDEN RULE preserved: batch matches are SUGGESTIONS only.
    // ══════════════════════════════════════════════════════════════
    if (unmatchedSettlements.length >= 2) {
      // Group by marketplace
      const byMarketplace: Record<string, any[]> = {}
      for (const s of unmatchedSettlements) {
        const mp = s.marketplace || 'unknown'
        if (!byMarketplace[mp]) byMarketplace[mp] = []
        byMarketplace[mp].push(s)
      }

      for (const [marketplace, mpSettlements] of Object.entries(byMarketplace)) {
        if (mpSettlements.length < 2) continue

        const currency = deriveCurrency(marketplace)

        // Sort by period_end ascending
        mpSettlements.sort((a: any, b: any) => a.period_end.localeCompare(b.period_end))

        // Group settlements with overlapping 7-day deposit windows
        const groups: any[][] = []
        let currentGroup: any[] = [mpSettlements[0]]

        for (let i = 1; i < mpSettlements.length; i++) {
          const prev = currentGroup[currentGroup.length - 1]
          const curr = mpSettlements[i]
          // If this settlement's period_end is within 7 days of the previous, group them
          const daysBetween = (new Date(curr.period_end).getTime() - new Date(prev.period_end).getTime()) / (1000 * 60 * 60 * 24)
          if (daysBetween <= 7) {
            currentGroup.push(curr)
          } else {
            if (currentGroup.length >= 2) groups.push(currentGroup)
            currentGroup = [curr]
          }
        }
        if (currentGroup.length >= 2) groups.push(currentGroup)

        for (const group of groups) {
          const batchSum = group.reduce((sum: number, s: any) => sum + Math.abs(s.bank_deposit || s.net_ex_gst || 0), 0)
          if (batchSum === 0) continue

          // Search window: earliest period_end → latest period_end + 7 days
          const earliestEnd = group[0].period_end
          const latestEnd = group[group.length - 1].period_end
          const fromDate = earliestEnd
          const toDate = addDays(latestEnd, 7)

          const { data: batchTxns } = await adminSupabase
            .from('bank_transactions')
            .select('*')
            .eq('user_id', userId)
            .eq('currency', currency)
            .gte('date', fromDate)
            .lte('date', toDate)
            .eq('transaction_type', 'RECEIVE')

          const txns = batchTxns || []
          console.log(`[bank-match] BATCH ${marketplace}: ${group.length} settlements, sum=${batchSum.toFixed(2)}, checking ${txns.length} ${currency} txns in ${fromDate} → ${toDate}`)

          // Find a transaction matching the batch sum
          let bestBatch: any = null
          let bestBatchDiff = Infinity

          for (const txn of txns) {
            const txnAmount = Math.abs(txn.amount || 0)
            const amountDiff = Math.abs(txnAmount - batchSum)

            if (amountDiff <= 1.00 && amountDiff < bestBatchDiff) {
              // Check narration matches the marketplace
              const description = txn.description || ''
              const contactName = txn.contact_name || ''
              const nameMatch = narrationMatchesMarketplace(description, contactName, marketplace)

              if (nameMatch || amountDiff <= 0.05) {
                bestBatch = txn
                bestBatchDiff = amountDiff
              }
            }
          }

          if (bestBatch) {
            const batchScore = bestBatchDiff <= 0.05 ? 92 : bestBatchDiff <= 0.50 ? 88 : 82
            const settlementIds = group.map((s: any) => s.settlement_id)
            const batchGroupId = crypto.randomUUID()

            console.log(`[bank-match] BATCH MATCH FOUND: ${marketplace} ${settlementIds.length} settlements → deposit ${Math.abs(bestBatch.amount).toFixed(2)} (diff: ${bestBatchDiff.toFixed(2)}, score: ${batchScore})`)

            // Write batch verification for each settlement in the group
            for (const s of group) {
              const individualAmount = Math.abs(s.bank_deposit || s.net_ex_gst || 0)

              await adminSupabase.from('payment_verifications').upsert({
                user_id: userId,
                settlement_id: s.settlement_id,
                gateway_code: marketplace,
                xero_tx_id: bestBatch.xero_transaction_id,
                match_amount: Math.abs(bestBatch.amount),
                match_method: 'batch_sum',
                match_confidence: batchScore >= 90 ? 'high' : 'medium',
                confidence_score: batchScore,
                narration: bestBatch.description || '',
                transaction_date: bestBatch.date,
                order_count: settlementIds.length,
              }, { onConflict: 'settlement_id,gateway_code' } as any)

              // Update settlement status if high confidence
              if (batchScore >= 90) {
                await adminSupabase.from('settlements').update({
                  status: 'deposit_matched',
                }).eq('settlement_id', s.settlement_id).eq('user_id', userId)
                  .in('status', ['synced', 'pushed_to_xero', 'draft_in_xero', 'authorised_in_xero'])
              }

              // Update the result entry for this settlement
              const existingIdx = results.findIndex(r => r.settlement_id === s.settlement_id)
              if (existingIdx >= 0) {
                results[existingIdx] = {
                  matched: false, // GOLDEN RULE
                  settlement_id: s.settlement_id,
                  marketplace,
                  match_method: 'batch_sum',
                  batch_settlement_ids: settlementIds,
                  possible_match: {
                    date: bestBatch.date,
                    amount: Math.abs(bestBatch.amount),
                    reference: bestBatch.reference || '',
                    narration: bestBatch.description || '',
                    transaction_id: bestBatch.xero_transaction_id,
                  },
                  confidence: batchScore >= 90 ? 0.9 : 0.7,
                  confidence_score: batchScore,
                  difference: bestBatchDiff,
                }
              }
            }

            // Log batch match to system_events
            await adminSupabase.from('system_events').insert({
              user_id: userId,
              event_type: 'bank_match_batch',
              marketplace_code: marketplace,
              severity: 'info',
              details: {
                settlement_ids: settlementIds,
                batch_sum: batchSum,
                deposit_amount: Math.abs(bestBatch.amount),
                difference: bestBatchDiff,
                score: batchScore,
                deposit_date: bestBatch.date,
                transaction_id: bestBatch.xero_transaction_id,
              },
            })
          }
        }
      }
    }

    // Log unmatched settlements (those still without any match)
    for (const r of results) {
      if (!r.possible_match) {
        const s = settlements.find((st: any) => st.settlement_id === r.settlement_id) as any
        if (s) {
          await adminSupabase.from('system_events').insert({
            user_id: userId,
            event_type: 'bank_match_failed',
            marketplace_code: r.marketplace,
            settlement_id: r.settlement_id,
            period_label: `${s.period_start} → ${s.period_end}`,
            details: {
              deposit_amount: Math.abs(s.bank_deposit || s.net_ex_gst || 0),
              currency: deriveCurrency(r.marketplace),
            },
            severity: 'warning',
          })
        }
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