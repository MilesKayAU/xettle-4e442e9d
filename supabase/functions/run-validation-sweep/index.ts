import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { XERO_TOKEN_URL, XERO_API_BASE, getXeroHeaders } from '../_shared/xero-api-policy.ts'
import { isReconciliationOnly } from '../_shared/settlementPolicy.ts'

function monthKey(date: string): string {
  return date.substring(0, 7)
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-')
  const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate()
  return `${y}-${m}-01 → ${y}-${m}-${String(lastDay).padStart(2, '0')}`
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

  const res = await fetch(XERO_TOKEN_URL, {
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

// ─── P3: Unmatched bank deposit detection ───────────────────────────
interface NarrationMatch {
  marketplace_code: string | null
  marketplace_name: string
  confidence: number
}

// Static base dictionary — augmented dynamically per user
const BASE_MARKETPLACE_KEYWORDS: Record<string, string> = {
  kogan: 'kogan',
  mydeal: 'mydeal',
  'my deal': 'mydeal',
  bunnings: 'bunnings',
  catch: 'catch',
  'big w': 'bigw',
  bigw: 'bigw',
  ebay: 'ebay',
  amazon: 'amazon_au',
  temu: 'temu',
  'tiktok': 'tiktok_shop',
  woolworths: 'woolworths',
  'everyday market': 'everyday_market',
}

// Bonus keywords that increase confidence
const SIGNAL_KEYWORDS = ['marketplace', 'pty ltd', 'seller', 'payment', 'settlement', 'remittance', 'payout']

function scoreNarrationMatch(
  narration: string,
  dynamicDict: Map<string, string>, // label → marketplace_code
): NarrationMatch {
  const lower = narration.toLowerCase().trim()
  if (!lower) return { marketplace_code: null, marketplace_name: '', confidence: 0 }

  let bestMatch: NarrationMatch = { marketplace_code: null, marketplace_name: '', confidence: 0 }

  for (const [label, code] of dynamicDict.entries()) {
    const labelLower = label.toLowerCase()
    let score = 0

    // Exact match in narration
    if (lower.includes(labelLower)) {
      // Base score by label length relative to narration — longer labels = more specific = higher confidence
      score = Math.min(70, 40 + (labelLower.length / lower.length) * 60)

      // Bonus: label appears at start of narration
      if (lower.startsWith(labelLower)) score += 10

      // Bonus: signal keywords present
      for (const kw of SIGNAL_KEYWORDS) {
        if (lower.includes(kw)) { score += 5; break }
      }
    } else {
      // Word overlap scoring for partial matches
      const narrationWords = lower.split(/\s+/)
      const labelWords = labelLower.split(/\s+/)
      let matchedWords = 0
      for (const lw of labelWords) {
        if (lw.length >= 3 && narrationWords.some(nw => nw.includes(lw) || lw.includes(nw))) {
          matchedWords++
        }
      }
      if (matchedWords > 0) {
        score = (matchedWords / labelWords.length) * 50
      }
    }

    score = Math.min(100, Math.round(score))
    if (score > bestMatch.confidence) {
      bestMatch = { marketplace_code: code, marketplace_name: label, confidence: score }
    }
  }

  return bestMatch
}

async function unmatchedDepositPass(
  adminSupabase: any,
  userId: string,
  xeroBankTxns: any[],
  settlements: any[],
  connections: any[],
) {
  if (xeroBankTxns.length === 0) return

  // Load user's threshold from app_settings (default $50)
  const { data: thresholdSetting } = await adminSupabase
    .from('app_settings')
    .select('value')
    .eq('user_id', userId)
    .eq('key', 'unmatched_deposit_threshold')
    .maybeSingle()
  const threshold = parseFloat(thresholdSetting?.value || '50')

  // Build dynamic dictionary
  const dict = new Map<string, string>()

  // 1. Base keywords
  for (const [label, code] of Object.entries(BASE_MARKETPLACE_KEYWORDS)) {
    dict.set(label, code)
  }

  // 2. User's sub-channels
  const { data: subChannels } = await adminSupabase
    .from('shopify_sub_channels')
    .select('marketplace_label, marketplace_code, source_name')
    .eq('user_id', userId)
    .eq('ignored', false)

  for (const sc of (subChannels || [])) {
    if (sc.marketplace_label) dict.set(sc.marketplace_label.toLowerCase(), sc.marketplace_code || sc.source_name)
    if (sc.source_name) dict.set(sc.source_name.toLowerCase(), sc.marketplace_code || sc.source_name)
  }

  // 3. Fingerprints (shared registry)
  const { data: fingerprints } = await adminSupabase
    .from('marketplace_file_fingerprints')
    .select('marketplace_code')

  for (const fp of (fingerprints || [])) {
    if (fp.marketplace_code && !dict.has(fp.marketplace_code.toLowerCase())) {
      dict.set(fp.marketplace_code.toLowerCase().replace(/_/g, ' '), fp.marketplace_code)
    }
  }

  // 4. Global marketplaces table
  const { data: marketplaces } = await adminSupabase
    .from('marketplaces')
    .select('marketplace_code, name')

  for (const mp of (marketplaces || [])) {
    if (mp.name) dict.set(mp.name.toLowerCase(), mp.marketplace_code)
  }

  // Known marketplace codes for this user
  const knownCodes = new Set((connections || []).map((c: any) => c.marketplace_code))

  // Build quick settlement matching lookup
  const settlementAmounts = (settlements || []).map((s: any) => ({
    amount: Math.abs(parseFloat(s.bank_deposit) || 0),
    periodEnd: s.period_end ? new Date(s.period_end) : null,
  }))

  for (const txn of xeroBankTxns) {
    const amount = Math.abs(txn.amount || 0)
    if (amount < threshold) continue

    // Check if this transaction matches any known settlement
    const txnDate = txn.date ? new Date(txn.date) : null
    let matchesSettlement = false
    for (const s of settlementAmounts) {
      if (Math.abs(s.amount - amount) <= 0.05 && s.periodEnd && txnDate) {
        const daysDiff = Math.abs((txnDate.getTime() - s.periodEnd.getTime()) / (1000 * 60 * 60 * 24))
        if (daysDiff <= 14) { matchesSettlement = true; break }
      }
    }
    if (matchesSettlement) continue

    // Score narration
    const narration = txn.reference || ''
    const match = scoreNarrationMatch(narration, dict)

    if (match.confidence > 60 && match.marketplace_code && !knownCodes.has(match.marketplace_code)) {
      // Unmatched deposit — known marketplace not set up
      await adminSupabase.from('channel_alerts').upsert({
        user_id: userId,
        source_name: match.marketplace_name || match.marketplace_code,
        alert_type: 'unmatched_deposit',
        status: 'pending',
        detected_label: match.marketplace_name,
        detection_method: 'bank_transaction',
        deposit_amount: amount,
        deposit_date: txn.date,
        deposit_description: narration,
        match_confidence: match.confidence,
        total_revenue: amount,
        order_count: 0,
      }, { onConflict: 'user_id,source_name' })
    }
    // Low-confidence matches are ignored — we don't create alerts for every unidentified bank transaction
  }
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
    .in('connection_status', ['active', 'connected'])

  if (!connections || connections.length === 0) return summary

  // Boundary note: validation sweep checks ALL settlements regardless of boundary.
  // Boundary only determines what gets pushed to Xero.
    const { data: settlements } = await adminSupabase
    .from('settlements')
    .select('settlement_id, marketplace, period_start, period_end, bank_deposit, status, reconciliation_status, xero_journal_id, xero_status, bank_verified, bank_verified_amount, created_at, source, sales_principal, sales_shipping, seller_fees, fba_fees, storage_fees, advertising_costs, other_fees, refunds, reimbursements')
    .eq('user_id', userId)

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

  // Store arrays of settlements per key, then pick the best one for each period
  const settlementArrayMap = new Map<string, any[]>()
  for (const s of (settlements || [])) {
    if (s.status === 'duplicate_suppressed') continue // skip suppressed duplicates
    if (isReconciliationOnly(s.source, s.marketplace, s.settlement_id)) continue // skip reconciliation-only
    const pl = `${s.period_start} → ${s.period_end}`
    const key = `${s.marketplace}|${pl}`
    if (!settlementArrayMap.has(key)) settlementArrayMap.set(key, [])
    settlementArrayMap.get(key)!.push(s)
  }

  // Pick the best settlement per key: prefer pushed_to_xero > ready_to_push > saved > ingested
  const STATUS_PRIORITY: Record<string, number> = { pushed_to_xero: 4, synced_external: 4, ready_to_push: 3, saved: 2, ingested: 1, already_recorded: 5 }
  const settlementMap = new Map<string, any>()
  for (const [key, arr] of settlementArrayMap) {
    arr.sort((a: any, b: any) => (STATUS_PRIORITY[b.status] || 0) - (STATUS_PRIORITY[a.status] || 0))
    settlementMap.set(key, arr[0])
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

  // ── Load xero_accounting_matches for external invoice detection (LMB, A2X, manual) ──
  const xamBySettlement = new Map<string, { xero_invoice_id: string; xero_status: string }>()
  try {
    const { data: xamRows } = await adminSupabase
      .from('xero_accounting_matches')
      .select('settlement_id, xero_invoice_id, xero_status')
      .eq('user_id', userId)
      .in('xero_status', ['PAID', 'AUTHORISED', 'DRAFT'])
    for (const row of (xamRows || [])) {
      if (row.settlement_id && row.xero_invoice_id) {
        xamBySettlement.set(row.settlement_id, { xero_invoice_id: row.xero_invoice_id, xero_status: row.xero_status })
      }
    }
    console.log(`[validation-sweep] Loaded ${xamBySettlement.size} xero_accounting_matches for external invoice fallback`)
  } catch (e) { console.error('[validation-sweep] XAM load error:', e) }

  // ── Read bank transactions from LOCAL CACHE only (never call Xero BankTransactions API) ──
  // The sole caller for Xero BankTransactions is fetch-xero-bank-transactions.
  const xeroBankTxns: any[] = []
  try {
    const { data: cachedTxns } = await adminSupabase
      .from('bank_transactions')
      .select('amount, date, reference, contact_name')
      .eq('user_id', userId)
      .order('date', { ascending: false })
      .limit(500)
    for (const txn of (cachedTxns || [])) {
      xeroBankTxns.push({
        amount: txn.amount || 0,
        date: txn.date,
        reference: txn.reference || txn.contact_name || '',
      })
    }
    console.log(`[validation-sweep] Loaded ${xeroBankTxns.length} bank txns from cache (invoker=validation-sweep)`)
  } catch (e) { console.error('[validation-sweep] Bank cache read error:', e) }

  // Process each marketplace
  for (const conn of connections) {
    const mc = conn.marketplace_code
    summary.marketplaces_checked++

    const periodKeys = new Set<string>()
    for (const s of (settlements || [])) {
      if (s.marketplace === mc && s.status !== 'duplicate_suppressed' && !isReconciliationOnly(s.source, s.marketplace, s.settlement_id)) periodKeys.add(`${s.period_start} → ${s.period_end}`)
    }

    // ── Recon-only awareness: auto-generated settlements should create
    // settlement_needed rows so the dashboard shows "Upload Needed" for these periods.
    // Applies to ALL marketplaces with recon-only data (Kogan, Shopify sub-channels, etc.)
    const autoOnlyPeriods = new Set<string>()
    for (const s of (settlements || [])) {
      if (s.marketplace === mc && s.status !== 'duplicate_suppressed' && isReconciliationOnly(s.source, s.marketplace, s.settlement_id)) {
        const pk = `${s.period_start} → ${s.period_end}`
        if (!periodKeys.has(pk)) {
          autoOnlyPeriods.add(pk)
          periodKeys.add(pk)
        }
      }
    }

    // ── Synthetic month creation: only if NO settlement periods exist AND no auto-only periods
    // This prevents duplicate rows where a real/auto period covers part of the month
    // and a synthetic "full month" row covers the same month.
    // Helper: check if any existing period overlaps the given month
    const currentMonthYM = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`
    const existingCoversMonth = (ym: string): boolean => {
      for (const pk of periodKeys) {
        const pkStart = pk.split(' → ')[0] || ''
        if (pkStart.startsWith(ym)) return true
      }
      return false
    }

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
    // Only add current month if nothing covers it yet
    if (periodKeys.size === 0 || !existingCoversMonth(currentMonthYM)) {
      // But ONLY if we truly have zero periods — avoid phantom rows
      if (periodKeys.size === 0) {
        periodKeys.add(monthLabel(currentMonthYM))
      }
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
          const revenueTypes = new Set(['ItemPrice', 'order', 'order_total'])
          if (revenueTypes.has(line.amount_type || '') && amt > 0) {
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
        // For Kogan auto-only periods, force settlement_needed since only recon-only data exists
        if (!settlement && autoOnlyPeriods.has(pl)) {
          record.settlement_uploaded = false
          record.overall_status = 'settlement_needed'
          record.reconciliation_status = 'pending'
          // Still process orders above, then upsert and skip remaining steps
          await adminSupabase
            .from('marketplace_validation')
            .upsert(record, { onConflict: 'user_id,marketplace_code,period_label' })
          summary.settlement_needed++
          // Mark processing done
          await adminSupabase.from('marketplace_validation')
            .update({ processing_state: 'processed', processing_completed_at: new Date().toISOString() })
            .eq('user_id', userId).eq('marketplace_code', mc).eq('period_label', pl)
          continue
        }

        if (settlement) {
          record.settlement_uploaded = true
          record.settlement_id = settlement.settlement_id
          record.settlement_net = settlement.bank_deposit || 0
          record.settlement_uploaded_at = settlement.created_at || new Date().toISOString()
          record.settlement_source = settlement.source || null

          // Guard: if settlement is already_recorded, also repair any legacy validation rows for the same settlement
          if (settlement.status === 'already_recorded') {
            const resolvedAt = new Date().toISOString()
            const xam = xamBySettlement.get(settlement.settlement_id)
            record.xero_pushed = true
            record.xero_invoice_id = settlement.xero_journal_id || xam?.xero_invoice_id || null
            record.xero_pushed_at = resolvedAt
            record.overall_status = 'already_recorded'
            record.processing_state = 'processed'
            record.processing_completed_at = resolvedAt

            await adminSupabase
              .from('marketplace_validation')
              .update({
                xero_pushed: true,
                xero_invoice_id: settlement.xero_journal_id || xam?.xero_invoice_id || null,
                xero_pushed_at: resolvedAt,
                overall_status: 'already_recorded',
                processing_state: 'processed',
                processing_completed_at: resolvedAt,
                processing_error: null,
                updated_at: resolvedAt,
                last_checked_at: resolvedAt,
              })
              .eq('user_id', userId)
              .eq('settlement_id', settlement.settlement_id)

            // Upsert and skip remaining steps for this period
            await adminSupabase
              .from('marketplace_validation')
              .upsert(record, { onConflict: 'user_id,marketplace_code,period_label' })
            summary.already_recorded++
            continue
          }
          if (settlement.status === 'pushed_to_xero') {
            record.xero_pushed = true
            record.xero_pushed_at = settlement.created_at || new Date().toISOString()
          }
          // Guard: don't promote ingested/saved settlements to ready_to_push
          if (settlement.status === 'ingested' || settlement.status === 'saved') {
            // Let the trigger compute overall_status naturally — don't force ready_to_push
            // The trigger will set settlement_needed since xero_pushed=false and reconciliation may not be matched
          }
        }

        // Step 3: Reconciliation — compute gap from settlement financial fields
        if (recon) {
          record.reconciliation_status = recon.status || 'pending'
          record.reconciliation_difference = recon.difference || 0
        } else if (settlement) {
          // Compute reconciliation gap from actual financial fields
          const bankDeposit = parseFloat(settlement.bank_deposit) || 0
          const computedNet = (parseFloat(settlement.sales_principal) || 0)
            + (parseFloat(settlement.sales_shipping) || 0)
            - Math.abs(parseFloat(settlement.seller_fees) || 0)
            - Math.abs(parseFloat(settlement.fba_fees) || 0)
            - Math.abs(parseFloat(settlement.storage_fees) || 0)
            - Math.abs(parseFloat(settlement.advertising_costs) || 0)
            - Math.abs(parseFloat(settlement.other_fees) || 0)
            + (parseFloat(settlement.refunds) || 0)
            + (parseFloat(settlement.reimbursements) || 0)
          const gap = Math.round((bankDeposit - computedNet) * 100) / 100
          record.reconciliation_difference = gap

          if (settlement.reconciliation_status === 'reconciled') {
            record.reconciliation_status = 'matched'
            record.orders_found = true
          } else if (Math.abs(gap) <= 1.00) {
            record.reconciliation_status = 'matched'
          } else {
            record.reconciliation_status = 'warning'
          }
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
        } else if (settlement?.status === 'pushed_to_xero') {
          // Treat pushed_to_xero as already in Xero
          record.xero_pushed = true
          record.xero_pushed_at = settlement.created_at || new Date().toISOString()
        }

        // Fallback: check xero_accounting_matches (covers LMB, A2X, manual external pushes)
        if (!record.xero_pushed && settlement && xamBySettlement.has(settlement.settlement_id)) {
          const resolvedAt = new Date().toISOString()
          const xam = xamBySettlement.get(settlement.settlement_id)!
          if (['PAID', 'AUTHORISED'].includes(xam.xero_status)) {
            record.xero_pushed = true
            record.xero_invoice_id = xam.xero_invoice_id
            record.xero_pushed_at = resolvedAt
            record.overall_status = 'already_recorded'

            await adminSupabase.from('settlements')
              .update({ status: 'already_recorded', sync_origin: 'external' })
              .eq('settlement_id', settlement.settlement_id)
              .eq('user_id', userId)

            await adminSupabase.from('marketplace_validation')
              .update({
                xero_pushed: true,
                xero_invoice_id: xam.xero_invoice_id,
                xero_pushed_at: resolvedAt,
                overall_status: 'already_recorded',
                updated_at: resolvedAt,
                last_checked_at: resolvedAt,
              })
              .eq('user_id', userId)
              .eq('settlement_id', settlement.settlement_id)
          }
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

  // Bank matching for pushed but unmatched settlements — uses LOCAL CACHE only.
  // No per-settlement match-bank-deposits calls (eliminates burst traffic).
  // If cache is empty, skip entirely.
  if (xeroBankTxns.length === 0) {
    console.log(`[validation-sweep] Bank cache empty — skipping bank matching step (invoker=validation-sweep)`)
  } else {
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

        // Match locally from cache instead of calling match-bank-deposits per settlement
        const { data: eligibleSettlements } = await adminSupabase
          .from('settlements')
          .select('settlement_id, bank_deposit, period_end')
          .eq('user_id', userId)
          .in('settlement_id', eligible.map((r: any) => r.settlement_id))

        let localMatches = 0
        for (const s of (eligibleSettlements || [])) {
          const depositAmount = Math.abs(s.bank_deposit || 0)
          const periodEnd = new Date(s.period_end)
          for (const txn of xeroBankTxns) {
            if (!txn.date) continue
            const txnDate = new Date(txn.date)
            const daysDiff = Math.abs((txnDate.getTime() - periodEnd.getTime()) / (1000 * 60 * 60 * 24))
            const amountDiff = Math.abs(txn.amount - depositAmount)
            if (amountDiff <= 0.50 && daysDiff <= 14) {
              await adminSupabase.from('marketplace_validation')
                .update({ bank_matched: true, bank_amount: txn.amount, bank_matched_at: new Date().toISOString(), bank_reference: txn.reference })
                .eq('user_id', userId)
                .eq('settlement_id', s.settlement_id)
              localMatches++
              break
            }
          }
        }
        console.log(`[validation-sweep] Local bank matching: ${localMatches}/${eligible.length} matched from cache (invoker=validation-sweep)`)
      }
    } catch (e) {
      console.error('[validation-sweep] Bank matching step error:', e)
    }
  }

  // P2: Run duplicate detection pass after main sweep
  try {
    summary.duplicates_suppressed = await dedupPass(adminSupabase, userId);
  } catch (e) {
    console.error('[validation-sweep] dedup pass error:', e);
    await logEvent(adminSupabase, userId, 'dedup_pass_error', { error: String(e) }, 'error');
  }

  // P3: Unmatched bank deposit detection
  try {
    await unmatchedDepositPass(adminSupabase, userId, xeroBankTxns, settlements || [], connections)
  } catch (e) {
    console.error('[validation-sweep] unmatched deposit pass error:', e)
    await logEvent(adminSupabase, userId, 'unmatched_deposit_pass_error', { error: String(e) }, 'error')
  }

  // P4: Clean orphaned validation rows (marketplaces with no active connection)
  try {
    const activeCodeSet = new Set((connections || []).map((c: any) => c.marketplace_code))
    const { data: allValidationRows } = await adminSupabase
      .from('marketplace_validation')
      .select('marketplace_code')
      .eq('user_id', userId)

    const orphanCodes = [...new Set(
      (allValidationRows || [])
        .map((r: any) => r.marketplace_code)
        .filter((c: string) => !activeCodeSet.has(c))
    )]

    if (orphanCodes.length > 0) {
      const { error: delErr } = await adminSupabase
        .from('marketplace_validation')
        .delete()
        .eq('user_id', userId)
        .in('marketplace_code', orphanCodes)

      if (!delErr) {
        console.log(`[validation-sweep] Cleaned ${orphanCodes.length} orphaned marketplace(s): ${orphanCodes.join(', ')}`)
        await logEvent(adminSupabase, userId, 'orphan_validation_cleanup', { removed_codes: orphanCodes }, 'info')
      }
    }
  } catch (e) {
    console.error('[validation-sweep] orphan cleanup error:', e)
  }

  // P5: Clean orphaned validation rows for shopify_auto settlements with stale period_labels
  try {
    const { data: autoValidationRows } = await adminSupabase
      .from('marketplace_validation')
      .select('id, settlement_id, period_label')
      .eq('user_id', userId)
      .like('settlement_id', 'shopify_auto_%')

    if (autoValidationRows && autoValidationRows.length > 0) {
      // Get current boundaries for all shopify_auto settlements
      const autoSettlementIds = [...new Set(autoValidationRows.map((r: any) => r.settlement_id))]
      const { data: autoSettlements } = await adminSupabase
        .from('settlements')
        .select('settlement_id, period_start, period_end')
        .eq('user_id', userId)
        .in('settlement_id', autoSettlementIds)

      const currentLabels = new Map<string, string>()
      for (const s of (autoSettlements || [])) {
        currentLabels.set(s.settlement_id, `${s.period_start} → ${s.period_end}`)
      }

      const orphanIds: string[] = []
      for (const row of autoValidationRows) {
        const expectedLabel = currentLabels.get(row.settlement_id)
        if (!expectedLabel) {
          // Settlement no longer exists — orphaned
          orphanIds.push(row.id)
        } else if (row.period_label !== expectedLabel) {
          // Period label doesn't match current settlement boundaries — stale
          orphanIds.push(row.id)
        }
      }

      if (orphanIds.length > 0) {
        await adminSupabase.from('marketplace_validation').delete().in('id', orphanIds)
        console.log(`[validation-sweep] Cleaned ${orphanIds.length} stale shopify_auto validation rows`)
        await logEvent(adminSupabase, userId, 'shopify_auto_orphan_cleanup', { removed_count: orphanIds.length }, 'info')
      }
    }
  } catch (e) {
    console.error('[validation-sweep] shopify_auto orphan cleanup error:', e)
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
  const origin = req.headers.get("Origin") ?? ""
  const corsHeaders = getCorsHeaders(origin)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
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
      const { data: { user }, error: authError } = await userSupabase.auth.getUser()
      if (!authError && user) {
        targetUserIds = [user.id]
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
