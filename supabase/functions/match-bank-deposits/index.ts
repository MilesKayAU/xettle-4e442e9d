import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const MARKETPLACE_NAMES: Record<string, string[]> = {
  amazon_au: ['amazon', 'amzn', 'a]zn'],
  kogan: ['kogan'],
  bigw: ['big w', 'bigw'],
  bunnings: ['bunnings'],
  mydeal: ['mydeal', 'my deal'],
  catch: ['catch'],
  shopify: ['shopify'],
  ebay: ['ebay'],
  woolworths: ['woolworths', 'woolies'],
  iconic: ['iconic', 'the iconic'],
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().split('T')[0]
}

function parseXeroDate(dateField: string | null | undefined): string | null {
  if (!dateField) return null
  const raw = dateField.replace('/Date(', '').replace(')/', '').split('+')[0]
  const ts = parseInt(raw)
  if (!isNaN(ts)) return new Date(ts).toISOString().split('T')[0]
  return raw.split('T')[0]
}

async function refreshXeroToken(supabase: any, userId: string, clientId: string, clientSecret: string) {
  const { data: tokenRow, error } = await supabase
    .from('xero_tokens')
    .select('*')
    .eq('user_id', userId)
    .single()

  if (error || !tokenRow) return null

  const expiresAt = new Date(tokenRow.expires_at)
  if (expiresAt > new Date(Date.now() + 60000)) return tokenRow

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

  await supabase.from('xero_tokens').update({
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token || tokenRow.refresh_token,
    expires_at: newExpiry,
  }).eq('user_id', userId)

  return { ...tokenRow, access_token: tokens.access_token }
}

function narrationMatchesMarketplace(narration: string, contactName: string, marketplace: string): boolean {
  const text = `${narration} ${contactName}`.toLowerCase()
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
  difference?: number
  transaction?: any
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const clientId = Deno.env.get('XERO_CLIENT_ID')
    const clientSecret = Deno.env.get('XERO_CLIENT_SECRET')

    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: 'Xero credentials not configured' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Auth
    const authHeader = req.headers.get('Authorization')
    let userId: string | null = null

    if (authHeader?.startsWith('Bearer ')) {
      const userSupabase = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      })
      const { data: { user }, error: authError } = await userSupabase.auth.getUser()
      if (!authError && user) {
        userId = user.id
      }
    }

    const body = await req.json().catch(() => ({}))
    // Allow service-role calls to specify userId
    if (!userId && body.userId) userId = body.userId

    if (!userId) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const adminSupabase = createClient(supabaseUrl, serviceRoleKey)
    const settlementId = body.settlementId as string | undefined
    const forceMatch = body.force_match as boolean | undefined
    const forceTransactionId = body.transaction_id as string | undefined

    // Refresh Xero token
    const xeroToken = await refreshXeroToken(adminSupabase, userId, clientId, clientSecret)
    if (!xeroToken) {
      return new Response(JSON.stringify({ error: 'Xero not connected or token expired' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Get settlements to match
    let query = adminSupabase
      .from('settlements')
      .select('*')
      .eq('user_id', userId)
      .eq('bank_verified', false)

    if (settlementId) {
      query = query.eq('settlement_id', settlementId)
    } else {
      // Only match pushed settlements — check via xero_journal_id or status
      query = query.or('status.eq.synced,status.eq.pushed_to_xero')
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

      // Fetch bank transactions from Xero for the relevant date range
      const fromDate = addDays(periodEnd, -7)
      const toDate = addDays(periodEnd, 21)

      // Xero where clause format: DateTime(YYYY, MM, DD) with AND (not &&)
      // Docs: https://developer.xero.com/documentation/api/accounting/banktransactions
      const formatXeroDateTime = (d: string) => {
        const [y, m, dd] = d.split('-')
        return `DateTime(${y}, ${m}, ${dd})`
      }
      const whereClause = `Type=="RECEIVE" AND Date>=${formatXeroDateTime(fromDate)} AND Date<=${formatXeroDateTime(toDate)}`

      let bankTxns: any[] = []
      try {
        const url = `https://api.xero.com/api.xro/2.0/BankTransactions?where=${encodeURIComponent(whereClause)}`
        console.log(`[bank-match] Querying Xero: ${whereClause} for ${marketplace} (${s.settlement_id})`)
        const res = await fetch(url, {
          headers: {
            'Authorization': `Bearer ${xeroToken.access_token}`,
            'Xero-Tenant-Id': xeroToken.tenant_id,
            'Accept': 'application/json',
          },
        })
        if (res.ok) {
          const data = await res.json()
          bankTxns = data?.BankTransactions || []
          console.log(`[bank-match] Xero returned ${bankTxns.length} RECEIVE transactions. First:`, bankTxns.length > 0 ? JSON.stringify({ Total: bankTxns[0].Total, Date: bankTxns[0].Date, Reference: bankTxns[0].Reference, Contact: bankTxns[0].Contact?.Name, LineItem0: bankTxns[0].LineItems?.[0]?.Description }) : 'none')

          // Log diagnostic to system_events so it's visible from the dashboard
          await adminSupabase.from('system_events').insert({
            user_id: userId,
            event_type: 'bank_match_query',
            marketplace_code: marketplace,
            settlement_id: s.settlement_id,
            period_label: `${s.period_start} → ${s.period_end}`,
            details: {
              where_clause: whereClause,
              txns_returned: bankTxns.length,
              deposit_amount_searched: depositAmount,
              first_txn: bankTxns.length > 0 ? { total: bankTxns[0].Total, date: parseXeroDate(bankTxns[0].Date), reference: bankTxns[0].Reference, contact: bankTxns[0].Contact?.Name } : null,
            },
            severity: 'info',
          })
        } else {
          const errText = await res.text()
          console.error(`Xero bank API error [${res.status}]:`, errText)
          await adminSupabase.from('system_events').insert({
            user_id: userId,
            event_type: 'bank_match_query',
            marketplace_code: marketplace,
            settlement_id: s.settlement_id,
            details: { error: `Xero API ${res.status}`, response: errText.substring(0, 500) },
            severity: 'error',
          })
        }
      } catch (e) {
        console.error('Xero bank fetch error:', e)
      }

      let matchFound = false

      for (const txn of bankTxns) {
        const txnAmount = Math.abs(txn.Total || 0)
        const txnDate = parseXeroDate(txn.Date)
        const amountDiff = Math.abs(txnAmount - depositAmount)
        const narration = txn.LineItems?.[0]?.Description || ''
        const contactName = txn.Contact?.Name || ''
        const txnRef = txn.Reference || ''

        // Force match override
        if (forceMatch && forceTransactionId && txn.BankTransactionID === forceTransactionId) {
          await applyMatch(adminSupabase, userId, s, txn, txnAmount, txnDate, txnRef)
          results.push({ matched: true, settlement_id: s.settlement_id, marketplace, transaction: { amount: txnAmount, date: txnDate, reference: txnRef } })
          matchFound = true
          break
        }

        // EXACT MATCH: amount within $0.05 AND narration/contact matches
        if (amountDiff <= 0.05) {
          const nameMatch = narrationMatchesMarketplace(narration, contactName, marketplace) ||
            narration.includes(s.settlement_id) || txnRef.includes(s.settlement_id)

          if (nameMatch) {
            await applyMatch(adminSupabase, userId, s, txn, txnAmount, txnDate, txnRef)
            results.push({ matched: true, settlement_id: s.settlement_id, marketplace, transaction: { amount: txnAmount, date: txnDate, reference: txnRef } })
            matchFound = true
            break
          }
        }

        // FUZZY MATCH: amount within $10 AND date within 30 days
        if (!matchFound && amountDiff <= 10 && txnDate) {
          const daysDiff = Math.abs((new Date(txnDate).getTime() - new Date(periodEnd).getTime()) / (1000 * 60 * 60 * 24))
          if (daysDiff <= 30) {
            results.push({
              matched: false,
              settlement_id: s.settlement_id,
              marketplace,
              possible_match: {
                date: txnDate,
                amount: txnAmount,
                reference: txnRef,
                narration,
                transaction_id: txn.BankTransactionID,
              },
              confidence: amountDiff <= 1 ? 0.85 : 0.7,
              difference: amountDiff,
            })
            matchFound = true
            break
          }
        }
      }

      if (!matchFound) {
        // Log no match
        await adminSupabase.from('system_events').insert({
          user_id: userId,
          event_type: 'bank_match_failed',
          marketplace_code: marketplace,
          settlement_id: s.settlement_id,
          period_label: `${s.period_start} → ${s.period_end}`,
          details: { deposit_amount: depositAmount, searched_from: fromDate, searched_to: toDate, txns_checked: bankTxns.length },
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

async function applyMatch(
  adminSupabase: any, userId: string, settlement: any,
  txn: any, txnAmount: number, txnDate: string | null, txnRef: string,
) {
  const marketplace = settlement.marketplace || 'unknown'

  // Update settlements table
  await adminSupabase.from('settlements').update({
    bank_verified: true,
    bank_verified_amount: txnAmount,
    bank_verified_at: txnDate ? new Date(txnDate).toISOString() : new Date().toISOString(),
    bank_reference: txnRef || txn.BankTransactionID,
  }).eq('settlement_id', settlement.settlement_id).eq('user_id', userId)

  // Update marketplace_validation
  const periodLabel = `${settlement.period_start} → ${settlement.period_end}`
  await adminSupabase.from('marketplace_validation').upsert({
    user_id: userId,
    marketplace_code: marketplace,
    period_label: periodLabel,
    period_start: settlement.period_start,
    period_end: settlement.period_end,
    bank_matched: true,
    bank_amount: txnAmount,
    bank_reference: txnRef || txn.BankTransactionID,
    bank_matched_at: new Date().toISOString(),
  }, { onConflict: 'user_id,marketplace_code,period_label' })

  // Log event
  await adminSupabase.from('system_events').insert({
    user_id: userId,
    event_type: 'bank_match_confirmed',
    marketplace_code: marketplace,
    settlement_id: settlement.settlement_id,
    period_label: periodLabel,
    details: {
      amount: txnAmount,
      date: txnDate,
      reference: txnRef,
      deposit_expected: Math.abs(settlement.bank_deposit || 0),
    },
    severity: 'success',
  })
}
