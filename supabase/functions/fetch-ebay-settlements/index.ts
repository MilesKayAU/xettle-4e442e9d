import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { getCorsHeaders } from '../_shared/cors.ts'
import { logger } from '../_shared/logger.ts'

const EBAY_API_BASE = 'https://apiz.ebay.com'
const EBAY_TOKEN_URL = 'https://api.ebay.com/identity/v1/oauth2/token'
const EBAY_SCOPES = 'https://api.ebay.com/oauth/api_scope/sell.finances https://api.ebay.com/oauth/api_scope/sell.fulfillment'
const MAX_LOOKBACK_DAYS = 180

function round2(n: number): number { return Math.round(n * 100) / 100 }

// ─── Token Refresh ─────────────────────────────────────────────────────

async function getEbayAccessToken(
  supabase: any,
  tokenRow: any,
): Promise<{ access_token: string; error?: string }> {
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
      logger.error(`[fetch-ebay-settlements] getPayouts failed (${res.status}):`, text)
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
      logger.error(`[fetch-ebay-settlements] getTransactions failed for payout ${payoutId} (${res.status}):`, text)
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

// ─── GST Extraction ────────────────────────────────────────────────────

/**
 * Extract GST from eBay-provided tax fields on a transaction.
 * Returns { taxAmount, mode } where mode indicates source.
 * Falls back to 1/11th estimate for AUD when no tax data present.
 */
function extractTransactionGst(
  tx: EbayTransaction,
  amount: number,
  currency: string,
): { taxAmount: number; mode: 'ebay_provided' | 'estimate_1_11th' | 'none' } {
  // Check orderLineItems for tax breakdown (eBay provides per-line tax)
  if (tx.orderLineItems && Array.isArray(tx.orderLineItems)) {
    let totalLineTax = 0
    let hasTaxData = false
    for (const li of tx.orderLineItems) {
      if (li.tax && li.tax.amount && li.tax.amount.value !== undefined) {
        totalLineTax += parseFloat(li.tax.amount.value || '0')
        hasTaxData = true
      }
      // Some eBay responses use taxes[] array
      if (li.taxes && Array.isArray(li.taxes)) {
        for (const t of li.taxes) {
          if (t.amount && t.amount.value !== undefined) {
            totalLineTax += parseFloat(t.amount.value || '0')
            hasTaxData = true
          }
        }
      }
    }
    if (hasTaxData) {
      return { taxAmount: round2(totalLineTax), mode: 'ebay_provided' }
    }
  }

  // Fallback: 1/11th estimate for AUD only
  if (currency === 'AUD' && amount > 0) {
    return { taxAmount: round2(amount / 11), mode: 'estimate_1_11th' }
  }

  return { taxAmount: 0, mode: 'none' }
}

// ─── Settlement Lines Persistence ────────────────────────────────────────
// Writes per-transaction rows to settlement_lines so the UI drilldown
// and Xero raw-source attachment have data.  Uses delete-before-insert
// for idempotency (same pattern as Amazon / Shopify).
//
// INTERNAL FINANCIAL CATEGORIES (canonical)
// Source: src/constants/financial-categories.ts
//   revenue, marketplace_fee, payment_fee, shipping_income, shipping_cost,
//   refund, gst_income, gst_expense, promotion, adjustment, fba_fee,
//   storage_fee, advertising

function mapEbayTxType(type: string): { transaction_type: string; amount_type: string; accounting_category: string } {
  switch (type) {
    case 'SALE':
      return { transaction_type: 'Order', amount_type: 'ItemPrice', accounting_category: 'revenue' }
    case 'REFUND':
      return { transaction_type: 'Refund', amount_type: 'ItemPrice', accounting_category: 'refund' }
    case 'CREDIT':
      return { transaction_type: 'Order', amount_type: 'ItemPrice', accounting_category: 'revenue' }
    case 'SHIPPING_LABEL':
      return { transaction_type: 'Fee', amount_type: 'ShippingLabel', accounting_category: 'shipping_cost' }
    case 'DISPUTE':
      return { transaction_type: 'Adjustment', amount_type: 'Dispute', accounting_category: 'adjustment' }
    case 'TRANSFER':
      return { transaction_type: 'Adjustment', amount_type: 'Transfer', accounting_category: 'adjustment' }
    case 'NON_SALE_CHARGE':
      return { transaction_type: 'Fee', amount_type: 'NonSaleCharge', accounting_category: 'marketplace_fee' }
    default:
      return { transaction_type: 'Other', amount_type: 'Other', accounting_category: 'adjustment' }
  }
}

async function persistSettlementLines(
  supabase: any,
  userId: string,
  settlementId: string,
  transactions: EbayTransaction[],
  payoutDate: string,
): Promise<{ count: number; error?: string }> {
  try {
    // 1. Delete existing lines (idempotent)
    await supabase
      .from('settlement_lines')
      .delete()
      .eq('user_id', userId)
      .eq('settlement_id', settlementId)

    if (transactions.length === 0) return { count: 0 }

    // 2. Map transactions to settlement_lines rows
    const lineRows: any[] = []

    for (const tx of transactions) {
      const amount = parseFloat(tx.amount?.value || '0')
      const feeAmount = parseFloat(tx.totalFeeAmount?.value || '0')
      const txDate = (tx.transactionDate || payoutDate || '').split('T')[0]
      const txType = tx.transactionType || 'UNKNOWN'
      const mapped = mapEbayTxType(txType)

      // Primary transaction row (sale/refund/credit amount)
      lineRows.push({
        user_id: userId,
        settlement_id: settlementId,
        order_id: tx.orderId || null,
        sku: tx.orderLineItems?.[0]?.sku || null,
        amount: round2(amount),
        amount_description: txType,
        transaction_type: mapped.transaction_type,
        amount_type: mapped.amount_type,
        accounting_category: mapped.accounting_category,
        marketplace_name: 'eBay AU',
        posted_date: txDate,
      })

      // Separate fee row if fees exist on this transaction
      if (feeAmount !== 0) {
        lineRows.push({
          user_id: userId,
          settlement_id: settlementId,
          order_id: tx.orderId || null,
          sku: null,
          amount: round2(-Math.abs(feeAmount)),
          amount_description: `${txType}_FEE`,
          transaction_type: 'Fee',
          amount_type: 'Commission',
          accounting_category: 'marketplace_fee',
          marketplace_name: 'eBay AU',
          posted_date: txDate,
        })
      }
    }

    // 3. Batch insert in chunks of 500
    for (let i = 0; i < lineRows.length; i += 500) {
      const chunk = lineRows.slice(i, i + 500)
      const { error: insertErr } = await supabase
        .from('settlement_lines')
        .insert(chunk)
      if (insertErr) {
        logger.error(`[fetch-ebay-settlements] settlement_lines insert chunk failed:`, insertErr)
        return { count: i, error: insertErr.message }
      }
    }

    return { count: lineRows.length }
  } catch (err: any) {
    logger.error(`[fetch-ebay-settlements] settlement_lines write failed:`, err)
    return { count: 0, error: err.message || 'unknown' }
  }
}

// ─── Settlement Builder ─────────────────────────────────────────────────

function buildSettlementFromPayout(
  payout: EbayPayout,
  transactions: EbayTransaction[],
  userId: string,
): { settlement: any; gst_mode: string } {
  let salesTotal = 0
  let refundsTotal = 0
  let feesTotal = 0
  let shippingTotal = 0
  let gstOnIncomeTotal = 0
  let gstOnExpensesTotal = 0
  let gstModeSet = new Set<string>()

  const currency = payout.amount?.currency || 'AUD'

  for (const tx of transactions) {
    const amount = parseFloat(tx.amount?.value || '0')
    const feeAmount = parseFloat(tx.totalFeeAmount?.value || '0')
    const type = tx.transactionType || ''

    switch (type) {
      case 'SALE': {
        salesTotal += amount
        feesTotal -= Math.abs(feeAmount)
        // Extract GST from eBay-provided fields or estimate
        const gst = extractTransactionGst(tx, amount, currency)
        gstOnIncomeTotal += gst.taxAmount
        gstModeSet.add(gst.mode)
        // GST on fees (estimate only — eBay doesn't break out fee GST per-line)
        if (currency === 'AUD' && feeAmount > 0) {
          gstOnExpensesTotal += round2(Math.abs(feeAmount) / 11)
        }
        break
      }
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
        feesTotal += amount
        break
    }
  }

  const payoutAmount = parseFloat(payout.amount?.value || '0')

  // Determine dominant GST mode for metadata
  const gstMode = gstModeSet.has('ebay_provided') ? 'ebay_provided'
    : gstModeSet.has('estimate_1_11th') ? 'estimate_1_11th'
    : 'none'

  // Derive period from payout date
  const payoutDate = payout.payoutDate?.split('T')[0] || new Date().toISOString().split('T')[0]

  let periodStart = payoutDate
  let periodEnd = payoutDate
  for (const tx of transactions) {
    const txDate = (tx.transactionDate || '').split('T')[0]
    if (txDate && txDate < periodStart) periodStart = txDate
    if (txDate && txDate > periodEnd) periodEnd = txDate
  }

  return {
    settlement: {
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
      reimbursements: 0,
      fba_fees: 0,
      storage_fees: 0,
      advertising_costs: 0,
      promotional_discounts: 0,
      other_fees: 0,
      gst_on_income: round2(gstOnIncomeTotal),
      gst_on_expenses: round2(-gstOnExpensesTotal),
      bank_deposit: round2(payoutAmount),
      net_ex_gst: round2(payoutAmount - gstOnIncomeTotal),
      holdback_amount: 0,
      source: 'api',
      source_reference: 'ebay_finances_api_v1',
      sync_origin: 'scheduled',
      status: 'saved',
      parser_version: 'ebay_finances_v1',
      is_hidden: false,
      is_pre_boundary: false,
    },
    gst_mode: gstMode,
  }
}

// ─── Sync window cap helper ────────────────────────────────────────────

function clampSyncFrom(syncFrom: string): string {
  const cap = new Date()
  cap.setDate(cap.getDate() - MAX_LOOKBACK_DAYS)
  const capStr = cap.toISOString().split('T')[0]
  return syncFrom < capStr ? capStr : syncFrom
}

// ─── Main Handler ──────────────────────────────────────────────────────

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin") ?? ""
  const corsHeaders = getCorsHeaders(origin)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const adminClient = createClient(supabaseUrl, supabaseServiceKey)

    const authHeader = req.headers.get('Authorization') || ''
    const isServiceRole = authHeader.includes(supabaseServiceKey)

    let body: any = {}
    try { body = await req.json() } catch { /* empty body ok */ }

    let syncFrom = body.sync_from || (() => {
      const d = new Date(); d.setMonth(d.getMonth() - 2)
      return d.toISOString().split('T')[0]
    })()
    const syncTo = body.sync_to || new Date().toISOString().split('T')[0]

    // Apply 180-day hard cap
    syncFrom = clampSyncFrom(syncFrom)

    // Collect eBay users to process
    let userTokens: any[] = []

    if (isServiceRole) {
      const { data } = await adminClient.from('ebay_tokens').select('*')
      userTokens = data || []
    } else {
      // User mode: acquire mutex to prevent concurrent manual + cron
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

      // Acquire sync lock for manual mode
      const { data: lockResult } = await adminClient.rpc('acquire_sync_lock', {
        p_user_id: user.id,
        p_integration: 'ebay',
        p_lock_key: 'settlement_sync',
        p_ttl_seconds: 300,
      })
      if (lockResult && !lockResult.acquired) {
        return new Response(JSON.stringify({
          error: 'eBay sync already in progress. Please wait and try again.',
          locked: true,
          retry_after: lockResult.expires_at,
        }), {
          status: 409, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const { data } = await userClient.from('ebay_tokens').select('*').eq('user_id', user.id).limit(1)
      userTokens = data || []

      // Store user id for lock release in finally block
      ;(req as any)._manualUserId = user.id
      ;(req as any)._manualLockAcquired = lockResult?.acquired
    }

    if (userTokens.length === 0) {
      // Release lock if acquired
      if ((req as any)._manualLockAcquired) {
        await adminClient.rpc('release_sync_lock', {
          p_user_id: (req as any)._manualUserId,
          p_integration: 'ebay',
          p_lock_key: 'settlement_sync',
        })
      }
      return new Response(JSON.stringify({ skipped: true, reason: 'no_ebay_tokens' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const results: any[] = []
    let isFirstImportThisRun = true

    for (const tokenRow of userTokens) {
      const userId = tokenRow.user_id
      logger.debug(`[fetch-ebay-settlements] Processing user ${userId}, sync_from=${syncFrom}`)

      const userAdminClient = adminClient

      // 1. Get valid access token
      const { access_token, error: tokenError } = await getEbayAccessToken(
        isServiceRole ? adminClient : createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
          global: { headers: { Authorization: authHeader } },
        }),
        tokenRow,
      )

      if (tokenError || !access_token) {
        logger.error(`[fetch-ebay-settlements] Token error for ${userId}:`, tokenError)
        results.push({ user_id: userId, error: tokenError || 'No access token', imported: 0 })
        continue
      }

      // 2. Fetch payouts in date range
      const { payouts, error: payoutsError } = await fetchPayouts(access_token, syncFrom, syncTo)

      if (payoutsError === 'rate_limited') {
        // Set cooldown + log system event
        await userAdminClient.from('app_settings').upsert({
          user_id: userId,
          key: 'ebay_rate_limit_until',
          value: new Date(Date.now() + 3600_000).toISOString(),
        }, { onConflict: 'user_id,key' })

        await userAdminClient.from('system_events').insert({
          user_id: userId,
          event_type: 'ebay_sync_rate_limited',
          severity: 'warning',
          marketplace_code: 'ebay_au',
          details: {
            retry_after: new Date(Date.now() + 3600_000).toISOString(),
            sync_from: syncFrom,
            sync_to: syncTo,
          },
        })

        results.push({ user_id: userId, error: 'rate_limited', imported: 0 })
        continue
      }

      if (payoutsError) {
        results.push({ user_id: userId, error: payoutsError, imported: 0 })
        continue
      }

      logger.debug(`[fetch-ebay-settlements] Found ${payouts.length} payouts for user ${userId}`)

      // 3. Filter to SUCCEEDED payouts only
      const succeededPayouts = payouts.filter(p => p.payoutStatus === 'SUCCEEDED')
      let imported = 0
      let updated = 0
      let skipped = 0

      for (const payout of succeededPayouts) {
        const settlementId = `ebay_payout_${payout.payoutId}`

        // 4. Fetch transactions for this payout
        const transactions = await fetchTransactionsForPayout(access_token, payout.payoutId)

        // 5. Build settlement
        const { settlement, gst_mode } = buildSettlementFromPayout(payout, transactions, userId)

        // 6. Upsert — handles both new inserts and payout adjustments/corrections
        // Check if exists first to determine if this is an insert or update
        const { data: existing } = await userAdminClient
          .from('settlements')
          .select('id, bank_deposit, sales_principal')
          .eq('user_id', userId)
          .eq('settlement_id', settlementId)
          .limit(1)

        const isUpdate = existing && existing.length > 0

        const { error: upsertError } = await userAdminClient
          .from('settlements')
          .upsert(settlement, { onConflict: 'user_id,marketplace,settlement_id' })

        if (upsertError) {
          logger.error(`[fetch-ebay-settlements] Upsert failed for payout ${payout.payoutId}:`, upsertError)
          continue
        }

        // ─── Persist settlement_lines (non-fatal) ────────────────
        const payoutDateStr = (payout.payoutDate || '').split('T')[0]
        const linesResult = await persistSettlementLines(
          userAdminClient, userId, settlementId, transactions, payoutDateStr,
        )
        if (linesResult.error) {
          logger.warn(`[fetch-ebay-settlements] settlement_lines partial/failed for ${settlementId}: ${linesResult.error}`)
          await userAdminClient.from('system_events').insert({
            user_id: userId,
            event_type: 'settlement_lines_write_failed',
            severity: 'warning',
            marketplace_code: 'ebay_au',
            settlement_id: settlementId,
            details: { error: linesResult.error, lines_written: linesResult.count },
          })
        } else {
          console.log(`[fetch-ebay-settlements] Wrote ${linesResult.count} settlement_lines for ${settlementId}`)
        }

        if (isUpdate) {
          const prev = existing[0]
          const changed = prev.bank_deposit !== settlement.bank_deposit || prev.sales_principal !== settlement.sales_principal
          if (changed) {
            updated++
            await userAdminClient.from('system_events').insert({
              user_id: userId,
              event_type: 'ebay_settlement_updated',
              severity: 'info',
              marketplace_code: 'ebay_au',
              settlement_id: settlementId,
              details: {
                payout_id: payout.payoutId,
                prev_deposit: prev.bank_deposit,
                new_deposit: settlement.bank_deposit,
                prev_sales: prev.sales_principal,
                new_sales: settlement.sales_principal,
                gst_mode,
              },
            })
          } else {
            skipped++
          }
        } else {
          imported++

          // Log import event
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
              gst_mode,
              source: 'ebay_finances_api_v1',
            },
          })

          // Debug artefact: log full settlement object for first import per run
          if (isFirstImportThisRun) {
            isFirstImportThisRun = false
            await userAdminClient.from('system_events').insert({
              user_id: userId,
              event_type: 'ebay_sync_debug',
              severity: 'info',
              marketplace_code: 'ebay_au',
              settlement_id: settlementId,
              details: {
                settlement_object: settlement,
                gst_mode,
                dedupe_key: settlementId,
                payout_raw: {
                  payoutId: payout.payoutId,
                  payoutDate: payout.payoutDate,
                  amount: payout.amount,
                  transactionCount: payout.transactionCount,
                },
                transaction_count: transactions.length,
                sync_from: syncFrom,
                sync_to: syncTo,
              },
            })
          }
        }
      }

      // Reset rate limit cooldown on successful sync
      await userAdminClient.from('app_settings')
        .delete()
        .eq('user_id', userId)
        .eq('key', 'ebay_rate_limit_until')

      console.log(`[fetch-ebay-settlements] User ${userId}: imported=${imported}, updated=${updated}, skipped=${skipped}, total_payouts=${succeededPayouts.length}`)
      results.push({
        user_id: userId,
        imported,
        updated,
        skipped,
        total_payouts: succeededPayouts.length,
        sync_from: syncFrom,
        sync_to: syncTo,
      })
    }

    // Release manual lock if acquired
    if ((req as any)._manualLockAcquired) {
      await adminClient.rpc('release_sync_lock', {
        p_user_id: (req as any)._manualUserId,
        p_integration: 'ebay',
        p_lock_key: 'settlement_sync',
      })
    }

    const totalImported = results.reduce((sum, r) => sum + (r.imported || 0), 0)
    const totalUpdated = results.reduce((sum, r) => sum + (r.updated || 0), 0)

    return new Response(JSON.stringify({
      success: true,
      total_synced: totalImported + totalUpdated,
      total_imported: totalImported,
      total_updated: totalUpdated,
      users_processed: results.length,
      results,
    }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  } catch (err) {
    // Release manual lock on error
    try {
      if ((req as any)._manualLockAcquired) {
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!
        const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
        const adminClient = createClient(supabaseUrl, serviceRoleKey)
        await adminClient.rpc('release_sync_lock', {
          p_user_id: (req as any)._manualUserId,
          p_integration: 'ebay',
          p_lock_key: 'settlement_sync',
        })
      }
    } catch { /* best effort */ }

    console.error('[fetch-ebay-settlements] error:', err)
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : 'Unknown error' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
