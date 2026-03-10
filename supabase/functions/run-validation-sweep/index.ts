import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

function monthKey(date: string): string {
  return date.substring(0, 7)
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-')
  return `${y}-${m}-01 → ${y}-${m}-28`
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

async function xeroGet(url: string, accessToken: string, tenantId: string) {
  const res = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Xero-Tenant-Id': tenantId,
      'Accept': 'application/json',
    },
  })
  if (!res.ok) return null
  return res.json()
}

function parseXeroDate(dateField: string | null | undefined): string | null {
  if (!dateField) return null
  const raw = dateField.replace('/Date(', '').replace(')/', '').split('+')[0]
  const ts = parseInt(raw)
  if (!isNaN(ts)) return new Date(ts).toISOString().split('T')[0]
  return raw.split('T')[0]
}

async function logEvent(adminSupabase: any, userId: string, eventType: string, details: any = {}, severity = 'info', marketplaceCode?: string, settlementId?: string, periodLabel?: string) {
  try {
    await adminSupabase.from('system_events').insert({
      user_id: userId,
      event_type: eventType,
      marketplace_code: marketplaceCode || null,
      settlement_id: settlementId || null,
      period_label: periodLabel || null,
      details,
      severity,
    })
  } catch (e) {
    console.error('Failed to log event:', e)
  }
}

// ─── Parser version drift detection (Addition 1) ───────────────────
const CLIENT_PARSER_VERSION = 'v1.7.1';
const EDGE_PARSER_VERSION = 'v1.7.1'; // MUST match CLIENT_PARSER_VERSION above

async function checkParserVersionDrift(adminSupabase: any, userId: string) {
  if (CLIENT_PARSER_VERSION !== EDGE_PARSER_VERSION) {
    await logEvent(adminSupabase, userId, 'parser_version_drift', {
      client: CLIENT_PARSER_VERSION,
      edge: EDGE_PARSER_VERSION,
      message: 'Parser versions have drifted — settlements parsed by different paths may produce different accounting results.',
    }, 'warning');
  }
}

// ─── P2: Duplicate detection pass ───────────────────────────────────
async function dedupPass(adminSupabase: any, userId: string) {
  const { data: allSettlements } = await adminSupabase
    .from('settlements')
    .select('id, settlement_id, marketplace, period_start, period_end, bank_deposit, status, source, created_at')
    .eq('user_id', userId)
    .neq('status', 'duplicate_suppressed');

  if (!allSettlements || allSettlements.length < 2) return 0;

  // Group by marketplace + period_start + period_end
  const groups = new Map<string, any[]>();
  for (const s of allSettlements) {
    const key = `${s.marketplace}|${s.period_start}|${s.period_end}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  let suppressed = 0;

  for (const [, group] of groups) {
    if (group.length < 2) continue;

    // Check for amount matches within ±$0.05
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i], b = group[j];
        if (a.status === 'duplicate_suppressed' || b.status === 'duplicate_suppressed') continue;

        const amountA = parseFloat(a.bank_deposit) || 0;
        const amountB = parseFloat(b.bank_deposit) || 0;
        if (Math.abs(amountA - amountB) > 0.05) continue;

        // Duplicate found — keep the one with numeric settlement_id, suppress the other
        const aIsNumeric = /^\d+$/.test(a.settlement_id);
        const bIsNumeric = /^\d+$/.test(b.settlement_id);
        const keep = aIsNumeric && !bIsNumeric ? a : !aIsNumeric && bIsNumeric ? b : (a.created_at < b.created_at ? a : b);
        const suppress = keep === a ? b : a;

        await adminSupabase.from('settlements')
          .update({ status: 'duplicate_suppressed' })
          .eq('id', suppress.id);

        // Register alias so future lookups resolve correctly
        await adminSupabase.from('settlement_id_aliases')
          .upsert({
            canonical_settlement_id: keep.settlement_id,
            alias_id: suppress.settlement_id,
            user_id: userId,
            source: 'dedup_sweep',
          }, { onConflict: 'alias_id,user_id' });

        await logEvent(adminSupabase, userId, 'duplicate_detected', {
          kept: { id: keep.id, settlement_id: keep.settlement_id, source: keep.source },
          suppressed: { id: suppress.id, settlement_id: suppress.settlement_id, source: suppress.source },
          amount_diff: Math.abs(amountA - amountB),
        }, 'warning', group[0].marketplace, suppress.settlement_id);

        suppressed++;
        suppress.status = 'duplicate_suppressed'; // prevent re-processing in inner loop
      }
    }
  }

  return suppressed;
}

async function sweepUser(adminSupabase: any, userId: string) {
  // Addition 1: Check parser version drift at start of every sweep
  await checkParserVersionDrift(adminSupabase, userId);

  const summary = {
    marketplaces_checked: 0,
    complete: 0,
    settlement_needed: 0,
    ready_to_push: 0,
    pushed_to_xero: 0,
    gap_detected: 0,
    missing: 0,
    already_recorded: 0,
    duplicates_suppressed: 0,
  }

  const { data: boundarySetting } = await adminSupabase
    .from('app_settings')
    .select('value')
    .eq('key', 'accounting_boundary_date')
    .eq('user_id', userId)
    .maybeSingle()

  const boundaryDate = boundarySetting?.value || new Date().toISOString().split('T')[0]

  const { data: connections } = await adminSupabase
    .from('marketplace_connections')
    .select('marketplace_code, marketplace_name')
    .eq('user_id', userId)

  if (!connections || connections.length === 0) return summary

  const { data: settlements } = await adminSupabase
    .from('settlements')
    .select('settlement_id, marketplace, period_start, period_end, bank_deposit, status, reconciliation_status, xero_journal_id, xero_status, bank_verified, bank_verified_amount, created_at')
    .eq('user_id', userId)
    .gte('period_end', boundaryDate)

  const { data: reconChecks } = await adminSupabase
    .from('reconciliation_checks')
    .select('marketplace_code, period_label, status, difference')
    .eq('user_id', userId)

  const { data: orderLines } = await adminSupabase
    .from('settlement_lines')
    .select('marketplace_name, posted_date, amount, order_id, amount_type')
    .eq('user_id', userId)
    .gte('posted_date', boundaryDate)

  // Order lines kept as flat array — we'll filter per-period below instead of pre-aggregating by month
  const allOrderLines = (orderLines || []) as Array<{ marketplace_name: string | null; posted_date: string | null; amount: number | null; order_id: string | null; amount_type: string | null }>

  const settlementMap = new Map<string, any>()
  for (const s of (settlements || [])) {
    const pl = `${s.period_start} → ${s.period_end}`
    settlementMap.set(`${s.marketplace}|${pl}`, s)
  }

  const reconMap = new Map<string, any>()
  for (const r of (reconChecks || [])) {
    reconMap.set(`${r.marketplace_code}|${r.period_label}`, r)
  }

  // Xero
  let xeroToken: any = null
  const clientId = Deno.env.get('XERO_CLIENT_ID')
  const clientSecret = Deno.env.get('XERO_CLIENT_SECRET')
  if (clientId && clientSecret) {
    xeroToken = await refreshXeroToken(adminSupabase, userId, clientId, clientSecret)
  }

  const xeroInvoiceMap = new Map<string, { id: string; number: string; status: string }>()
  if (xeroToken) {
    try {
      const invData = await xeroGet(
        `https://api.xero.com/api.xro/2.0/Invoices?Statuses=AUTHORISED,PAID&where=Reference.StartsWith("Xettle-")&pageSize=100`,
        xeroToken.access_token, xeroToken.tenant_id
      )
      for (const inv of (invData?.Invoices || [])) {
        const ref = inv.Reference || ''
        if (ref.startsWith('Xettle-')) {
          xeroInvoiceMap.set(ref.replace('Xettle-', ''), {
            id: inv.InvoiceID, number: inv.InvoiceNumber || '', status: inv.Status || '',
          })
        }
      }
    } catch (e) { console.error('Xero invoice scan error:', e) }
  }

  const xeroBankTxns: any[] = []
  if (xeroToken) {
    try {
      const bankData = await xeroGet(
        `https://api.xero.com/api.xro/2.0/BankTransactions?order=Date DESC&pageSize=100`,
        xeroToken.access_token, xeroToken.tenant_id
      )
      for (const txn of (bankData?.BankTransactions || [])) {
        if (txn.Type === 'RECEIVE') {
          xeroBankTxns.push({
            amount: txn.Total || 0,
            date: parseXeroDate(txn.Date),
            reference: txn.Reference || txn.Contact?.Name || '',
          })
        }
      }
    } catch (e) { console.error('Xero bank scan error:', e) }
  }

  // Process each marketplace
  for (const conn of connections) {
    const mc = conn.marketplace_code
    summary.marketplaces_checked++

    const periodKeys = new Set<string>()
    for (const s of (settlements || [])) {
      if (s.marketplace === mc) periodKeys.add(`${s.period_start} → ${s.period_end}`)
    }
    // Only create synthetic monthly periods if NO real settlement periods exist for this marketplace
    // This prevents phantom "full month" rows when actual settlements are fortnightly/weekly
    if (periodKeys.size === 0) {
      const mcLower = mc.replace('_', ' ').toLowerCase()
      const mcPrefix = mc.split('_')[0].toLowerCase()
      const orderMonths = new Set<string>()
      for (const line of allOrderLines) {
        if (!line.posted_date || !line.marketplace_name) continue
        const mLower = line.marketplace_name.toLowerCase()
        if (mLower.includes(mcLower) || mLower.includes(mcPrefix)) {
          orderMonths.add(monthKey(line.posted_date))
        }
      }
      for (const mk of orderMonths) {
        periodKeys.add(monthLabel(mk))
      }
    }
    if (periodKeys.size === 0) {
      const now = new Date()
      periodKeys.add(monthLabel(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`))
    }

    for (const pl of periodKeys) {
      // Check if row is currently being processed (skip if within 10 min)
      const { data: existingRow } = await adminSupabase
        .from('marketplace_validation')
        .select('processing_state, processing_started_at')
        .eq('user_id', userId)
        .eq('marketplace_code', mc)
        .eq('period_label', pl)
        .maybeSingle()

      if (existingRow?.processing_state === 'processing' && existingRow?.processing_started_at) {
        const startedAt = new Date(existingRow.processing_started_at)
        if (Date.now() - startedAt.getTime() < 10 * 60 * 1000) {
          continue // Skip — another sweep is processing this row
        }
      }

      // Mark as processing
      if (existingRow) {
        await adminSupabase.from('marketplace_validation')
          .update({ processing_state: 'processing', processing_started_at: new Date().toISOString(), processing_error: null })
          .eq('user_id', userId).eq('marketplace_code', mc).eq('period_label', pl)
      }

      try {
        const sKey = `${mc}|${pl}`
        const settlement = settlementMap.get(sKey)
        const recon = reconMap.get(sKey)

        const record: any = {
          user_id: userId,
          marketplace_code: mc,
          period_label: pl,
          period_start: pl.split(' → ')[0] || boundaryDate,
          period_end: pl.split(' → ')[1] || new Date().toISOString().split('T')[0],
          processing_state: 'processed',
          processing_completed_at: new Date().toISOString(),
          processing_error: null,
        }

        // Step 1: Orders — filter lines by this period's exact date range
        const periodStart = record.period_start
        const periodEnd = record.period_end
        const mcLowerInner = mc.replace('_', ' ').toLowerCase()
        const mcPrefixInner = mc.split('_')[0].toLowerCase()
        const uniqueOrders = new Set<string>()
        let orderTotal = 0
        for (const line of allOrderLines) {
          if (!line.posted_date || !line.marketplace_name) continue
          const mLower = line.marketplace_name.toLowerCase()
          if (!(mLower.includes(mcLowerInner) || mLower.includes(mcPrefixInner))) continue
          // Filter by period date range
          if (line.posted_date < periodStart || line.posted_date > periodEnd) continue
          // Only count ItemPrice lines as revenue (skip fees, promotions, chargebacks)
          const amt = Number(line.amount) || 0
          if (line.amount_type === 'ItemPrice' && amt > 0) {
            orderTotal += amt
          }
          if (line.order_id) uniqueOrders.add(line.order_id)
        }
        const orderCount = uniqueOrders.size || (orderTotal > 0 ? 1 : 0)
        if (orderTotal > 0) {
          record.orders_found = true
          record.orders_count = orderCount
          record.orders_total = orderTotal
          record.orders_fetched_at = new Date().toISOString()
        }

        // Step 2: Settlement
        if (settlement) {
          record.settlement_uploaded = true
          record.settlement_id = settlement.settlement_id
          record.settlement_net = settlement.bank_deposit || 0
          record.settlement_uploaded_at = settlement.created_at || new Date().toISOString()
        }

        // Step 3: Reconciliation — check reconciliation_checks first, then fall back to settlement's own status
        if (recon) {
          record.reconciliation_status = recon.status || 'pending'
          record.reconciliation_difference = recon.difference || 0
        } else if (settlement?.reconciliation_status === 'reconciled') {
          record.reconciliation_status = 'matched'
          record.reconciliation_difference = 0
          record.orders_found = true
        }

        // Step 4: Xero
        if (settlement && xeroInvoiceMap.has(settlement.settlement_id)) {
          const xeroInv = xeroInvoiceMap.get(settlement.settlement_id)!
          record.xero_pushed = true
          record.xero_invoice_id = xeroInv.id
          record.xero_pushed_at = new Date().toISOString()
        } else if (settlement?.xero_journal_id) {
          record.xero_pushed = true
          record.xero_invoice_id = settlement.xero_journal_id
        } else if (settlement?.status === 'synced_external' || settlement?.status === 'synced' || settlement?.status === 'pushed_to_xero') {
          // Treat synced_external / synced / pushed_to_xero as already in Xero
          record.xero_pushed = true
          record.xero_pushed_at = settlement.created_at || new Date().toISOString()
        }

        // Step 5: Bank matching
        if (record.xero_pushed && settlement) {
          const depositAmount = Math.abs(settlement.bank_deposit || 0)
          const periodEnd = new Date(settlement.period_end)
          for (const txn of xeroBankTxns) {
            if (!txn.date) continue
            const txnDate = new Date(txn.date)
            const daysDiff = Math.abs((txnDate.getTime() - periodEnd.getTime()) / (1000 * 60 * 60 * 24))
            const amountDiff = Math.abs(txn.amount - depositAmount)
            if (amountDiff <= 0.05 && daysDiff <= 14) {
              record.bank_matched = true
              record.bank_amount = txn.amount
              record.bank_matched_at = new Date().toISOString()
              record.bank_reference = txn.reference
              break
            }
          }
          if (!record.bank_matched && settlement.bank_verified) {
            record.bank_matched = true
            record.bank_amount = settlement.bank_verified_amount || settlement.bank_deposit
            record.bank_matched_at = new Date().toISOString()
          }
        }

        const { error: upsertErr } = await adminSupabase
          .from('marketplace_validation')
          .upsert(record, { onConflict: 'user_id,marketplace_code,period_label' })

        if (upsertErr) {
          console.error(`[validation-sweep] upsert error for ${mc}/${pl}:`, upsertErr)
          await logEvent(adminSupabase, userId, 'validation_sweep_error', { error: upsertErr.message, marketplace: mc, period: pl }, 'error', mc, null, pl)
        }
      } catch (rowErr: any) {
        // Mark as failed
        await adminSupabase.from('marketplace_validation')
          .update({ processing_state: 'processing_failed', processing_error: String(rowErr), processing_completed_at: new Date().toISOString() })
          .eq('user_id', userId).eq('marketplace_code', mc).eq('period_label', pl)
        
        await logEvent(adminSupabase, userId, 'validation_sweep_error', { error: String(rowErr), marketplace: mc, period: pl }, 'error', mc, null, pl)
      }
    }
  }

  // Bank matching for pushed but unmatched settlements (>3 days old)
  try {
    const { data: unmatchedPushed } = await adminSupabase
      .from('marketplace_validation')
      .select('settlement_id, marketplace_code, xero_pushed_at')
      .eq('user_id', userId)
      .eq('xero_pushed', true)
      .eq('bank_matched', false)
      .not('settlement_id', 'is', null)

    if (unmatchedPushed && unmatchedPushed.length > 0) {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000)
      const eligible = unmatchedPushed.filter((r: any) => {
        if (!r.xero_pushed_at) return true
        return new Date(r.xero_pushed_at) < threeDaysAgo
      })

      if (eligible.length > 0) {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

        for (const row of eligible) {
          try {
            await fetch(`${supabaseUrl}/functions/v1/match-bank-deposits`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${serviceRoleKey}`,
              },
              body: JSON.stringify({ userId, settlementId: row.settlement_id }),
            })
          } catch (e) {
            console.error(`Bank match call failed for ${row.settlement_id}:`, e)
          }
        }
      }
    }
  } catch (e) {
    console.error('Bank matching step error:', e)
  }

  // Log sweep completion
  await logEvent(adminSupabase, userId, 'validation_sweep_complete', summary, 'info')

  // Count final statuses
  const { data: finalRows } = await adminSupabase
    .from('marketplace_validation')
    .select('overall_status')
    .eq('user_id', userId)

  for (const row of (finalRows || [])) {
    const s = row.overall_status
    if (s === 'complete') summary.complete++
    else if (s === 'settlement_needed') summary.settlement_needed++
    else if (s === 'ready_to_push') summary.ready_to_push++
    else if (s === 'pushed_to_xero') summary.pushed_to_xero++
    else if (s === 'gap_detected') summary.gap_detected++
    else if (s === 'missing') summary.missing++
    else if (s === 'already_recorded') summary.already_recorded++
  }

  return summary
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

    const authHeader = req.headers.get('Authorization')
    let targetUserIds: string[] = []

    if (authHeader?.startsWith('Bearer ')) {
      const userSupabase = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      })
      const token = authHeader.replace('Bearer ', '')
      const { data: claimsData, error: claimsError } = await userSupabase.auth.getClaims(token)
      if (!claimsError && claimsData?.claims?.sub) {
        targetUserIds = [claimsData.claims.sub as string]
      }
    }

    const adminSupabase = createClient(supabaseUrl, serviceRoleKey)

    if (targetUserIds.length === 0) {
      const { data: proUsers } = await adminSupabase
        .from('user_roles')
        .select('user_id')
        .in('role', ['pro', 'paid', 'admin'])
      targetUserIds = [...new Set((proUsers || []).map((r: any) => r.user_id))]
    }

    if (targetUserIds.length === 0) {
      return new Response(JSON.stringify({ success: true, message: 'No users to sweep', users: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const results: any[] = []
    for (const uid of targetUserIds) {
      try {
        const summary = await sweepUser(adminSupabase, uid)
        results.push({ user_id: uid, ...summary })
      } catch (e) {
        console.error(`[validation-sweep] Error for user ${uid}:`, e)
        results.push({ user_id: uid, error: String(e) })
        await logEvent(adminSupabase, uid, 'validation_sweep_error', { error: String(e) }, 'error')
      }
    }

    const totals = {
      users_processed: results.length,
      total_marketplaces: results.reduce((s, r) => s + (r.marketplaces_checked || 0), 0),
      total_complete: results.reduce((s, r) => s + (r.complete || 0), 0),
      total_settlement_needed: results.reduce((s, r) => s + (r.settlement_needed || 0), 0),
      total_ready_to_push: results.reduce((s, r) => s + (r.ready_to_push || 0), 0),
      total_gap_detected: results.reduce((s, r) => s + (r.gap_detected || 0), 0),
    }

    return new Response(JSON.stringify({ success: true, ...totals, details: results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('run-validation-sweep error:', err)
    return new Response(JSON.stringify({ error: 'Internal server error', detail: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
