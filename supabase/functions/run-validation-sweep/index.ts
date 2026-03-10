import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

/**
 * run-validation-sweep
 * 
 * Checks all 5 steps (orders → settlement → reconciliation → xero → bank)
 * for every marketplace period. Runs daily via cron or manually per-user.
 */

function monthKey(date: string): string {
  return date.substring(0, 7) // YYYY-MM
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

  await supabase
    .from('xero_tokens')
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token || tokenRow.refresh_token,
      expires_at: newExpiry,
    })
    .eq('user_id', userId)

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

async function sweepUser(adminSupabase: any, userId: string) {
  const summary = {
    marketplaces_checked: 0,
    complete: 0,
    settlement_needed: 0,
    ready_to_push: 0,
    pushed_to_xero: 0,
    gap_detected: 0,
    missing: 0,
    already_recorded: 0,
  }

  // 1. Get boundary date
  const { data: boundarySetting } = await adminSupabase
    .from('app_settings')
    .select('value')
    .eq('key', 'accounting_boundary_date')
    .eq('user_id', userId)
    .maybeSingle()

  const boundaryDate = boundarySetting?.value || new Date().toISOString().split('T')[0]

  // 2. Get marketplace connections
  const { data: connections } = await adminSupabase
    .from('marketplace_connections')
    .select('marketplace_code, marketplace_name')
    .eq('user_id', userId)

  if (!connections || connections.length === 0) return summary

  // 3. Get all settlements for user
  const { data: settlements } = await adminSupabase
    .from('settlements')
    .select('settlement_id, marketplace, period_start, period_end, bank_deposit, status, xero_journal_id, xero_status, bank_verified, bank_verified_amount')
    .eq('user_id', userId)
    .gte('period_end', boundaryDate)

  // 4. Get reconciliation checks
  const { data: reconChecks } = await adminSupabase
    .from('reconciliation_checks')
    .select('marketplace_code, period_label, status, difference')
    .eq('user_id', userId)

  // 5. Get settlement lines (orders) grouped by marketplace + month
  const { data: orderLines } = await adminSupabase
    .from('settlement_lines')
    .select('marketplace_name, posted_date, amount, order_id')
    .eq('user_id', userId)
    .gte('posted_date', boundaryDate)

  // Build order aggregation by marketplace + month
  const orderAgg = new Map<string, { count: number; total: number; fetchedAt: string }>()
  for (const line of (orderLines || [])) {
    if (!line.posted_date || !line.marketplace_name) continue
    const mk = monthKey(line.posted_date)
    const key = `${line.marketplace_name}|${mk}`
    const existing = orderAgg.get(key)
    if (existing) {
      existing.count++
      existing.total += Math.abs(Number(line.amount) || 0)
    } else {
      orderAgg.set(key, { count: 1, total: Math.abs(Number(line.amount) || 0), fetchedAt: new Date().toISOString() })
    }
  }

  // Build settlement lookup by marketplace + period
  const settlementMap = new Map<string, any>()
  for (const s of (settlements || [])) {
    const pl = `${s.period_start} → ${s.period_end}`
    const key = `${s.marketplace}|${pl}`
    settlementMap.set(key, s)
  }

  // Build recon lookup
  const reconMap = new Map<string, any>()
  for (const r of (reconChecks || [])) {
    const key = `${r.marketplace_code}|${r.period_label}`
    reconMap.set(key, r)
  }

  // 6. Check Xero if connected
  let xeroToken: any = null
  const clientId = Deno.env.get('XERO_CLIENT_ID')
  const clientSecret = Deno.env.get('XERO_CLIENT_SECRET')
  if (clientId && clientSecret) {
    xeroToken = await refreshXeroToken(adminSupabase, userId, clientId, clientSecret)
  }

  // Xero invoice lookup by reference
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
          const settlementId = ref.replace('Xettle-', '')
          xeroInvoiceMap.set(settlementId, {
            id: inv.InvoiceID,
            number: inv.InvoiceNumber || '',
            status: inv.Status || '',
          })
        }
      }
    } catch (e) {
      console.error('Xero invoice scan error:', e)
    }
  }

  // Xero bank transactions for matching
  const xeroBankTxns: any[] = []
  if (xeroToken) {
    try {
      const bankData = await xeroGet(
        `https://api.xero.com/api.xro/2.0/BankTransactions?order=Date DESC&pageSize=100`,
        xeroToken.access_token, xeroToken.tenant_id
      )
      for (const txn of (bankData?.BankTransactions || [])) {
        if (txn.Type === 'RECEIVE') {
          const dateStr = parseXeroDate(txn.Date)
          xeroBankTxns.push({
            amount: txn.Total || 0,
            date: dateStr,
            reference: txn.Reference || txn.Contact?.Name || '',
          })
        }
      }
    } catch (e) {
      console.error('Xero bank scan error:', e)
    }
  }

  // 7. Process each marketplace connection
  for (const conn of connections) {
    const mc = conn.marketplace_code
    summary.marketplaces_checked++

    // Find all periods for this marketplace (from settlements + order aggregation)
    const periodKeys = new Set<string>()

    for (const s of (settlements || [])) {
      if (s.marketplace === mc) {
        periodKeys.add(`${s.period_start} → ${s.period_end}`)
      }
    }

    for (const [aggKey] of orderAgg) {
      const [mName, mk] = aggKey.split('|')
      // Simple marketplace name matching
      if (mName?.toLowerCase().includes(mc.replace('_', ' ').toLowerCase()) ||
          mName?.toLowerCase().includes(mc.split('_')[0])) {
        const pl = monthLabel(mk)
        periodKeys.add(pl)
      }
    }

    // If no periods found, create a single "current month" entry
    if (periodKeys.size === 0) {
      const now = new Date()
      const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
      periodKeys.add(monthLabel(ym))
    }

    for (const pl of periodKeys) {
      const sKey = `${mc}|${pl}`
      const settlement = settlementMap.get(sKey)
      const recon = reconMap.get(sKey)

      // Build validation record
      const record: any = {
        user_id: userId,
        marketplace_code: mc,
        period_label: pl,
        period_start: pl.split(' → ')[0] || boundaryDate,
        period_end: pl.split(' → ')[1] || new Date().toISOString().split('T')[0],
      }

      // Step 1: Orders
      // Check order aggregation for matching marketplace
      let orderData: { count: number; total: number } | null = null
      for (const [aggKey, agg] of orderAgg) {
        const [mName] = aggKey.split('|')
        if (mName?.toLowerCase().includes(mc.replace('_', ' ').toLowerCase()) ||
            mName?.toLowerCase().includes(mc.split('_')[0])) {
          if (!orderData) orderData = { count: 0, total: 0 }
          orderData.count += agg.count
          orderData.total += agg.total
        }
      }
      if (orderData) {
        record.orders_found = true
        record.orders_count = orderData.count
        record.orders_total = orderData.total
        record.orders_fetched_at = new Date().toISOString()
      }

      // Step 2: Settlement
      if (settlement) {
        record.settlement_uploaded = true
        record.settlement_id = settlement.settlement_id
        record.settlement_net = settlement.bank_deposit || 0
        record.settlement_uploaded_at = settlement.created_at || new Date().toISOString()

        if (settlement.status === 'already_recorded') {
          // Don't count — just skip or mark appropriately
          // The trigger will handle status
        }
      }

      // Step 3: Reconciliation
      if (recon) {
        record.reconciliation_status = recon.status || 'pending'
        record.reconciliation_difference = recon.difference || 0
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

        // Also check DB bank_verified flag
        if (!record.bank_matched && settlement.bank_verified) {
          record.bank_matched = true
          record.bank_amount = settlement.bank_verified_amount || settlement.bank_deposit
          record.bank_matched_at = new Date().toISOString()
        }
      }

      // Upsert — trigger will calculate overall_status
      const { error: upsertErr } = await adminSupabase
        .from('marketplace_validation')
        .upsert(record, { onConflict: 'user_id,marketplace_code,period_label' })

      if (upsertErr) {
        console.error(`[validation-sweep] upsert error for ${mc}/${pl}:`, upsertErr)
      }
    }
  }

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

    // Check if called with user JWT (manual trigger) or service role (cron)
    const authHeader = req.headers.get('Authorization')
    let targetUserIds: string[] = []

    if (authHeader?.startsWith('Bearer ')) {
      // Validate JWT to get user
      const userSupabase = createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: authHeader } },
      })
      const token = authHeader.replace('Bearer ', '')
      const { data: claimsData, error: claimsError } = await userSupabase.auth.getClaims(token)

      if (!claimsError && claimsData?.claims?.sub) {
        targetUserIds = [claimsData.claims.sub as string]
      }
    }

    // Use service role client for data access
    const adminSupabase = createClient(supabaseUrl, serviceRoleKey)

    // If no specific user, get all Pro/Paid users for cron sweep
    if (targetUserIds.length === 0) {
      const { data: proUsers } = await adminSupabase
        .from('user_roles')
        .select('user_id')
        .in('role', ['pro', 'paid', 'admin'])

      targetUserIds = (proUsers || []).map((r: any) => r.user_id)
      // Deduplicate
      targetUserIds = [...new Set(targetUserIds)]
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
      }
    }

    // Aggregate
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
