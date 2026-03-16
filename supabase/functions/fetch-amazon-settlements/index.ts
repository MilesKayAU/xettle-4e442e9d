import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { getCorsHeaders } from '../_shared/cors.ts'
import { logger } from '../_shared/logger.ts'

const SP_API_ENDPOINTS: Record<string, string> = {
  na: 'https://sellingpartnerapi-na.amazon.com',
  eu: 'https://sellingpartnerapi-eu.amazon.com',
  fe: 'https://sellingpartnerapi-fe.amazon.com',
}

// ═══════════════════════════════════════════════════════════════
// EMBEDDED SETTLEMENT PARSER (mirrors src/utils/settlement-parser.ts)
// ═══════════════════════════════════════════════════════════════

// MUST match src/utils/settlement-parser.ts PARSER_VERSION
const PARSER_VERSION = 'v1.7.1';

const CATEGORY_MAP: Record<string, string> = {
  'Order|ItemPrice|Principal': 'Sales',
  'Order|ItemPrice|Shipping': 'Sales',
  'Order|Promotion|Principal': 'Promotional Discounts',
  'Order|Promotion|Shipping': 'Promotional Discounts',
  'Order|ItemFees|Commission': 'Seller Fees',
  'Order|ItemFees|FBAPerUnitFulfillmentFee': 'FBA Fees',
  'Order|ItemFees|ShippingChargeback': 'FBA Fees',
  'Order|ItemFees|RefundCommission': 'Seller Fees',
  'Refund|ItemPrice|Principal': 'Refunds',
  'Refund|ItemPrice|Shipping': 'Refunds',
  'Refund|Promotion|Principal': 'Promotional Discounts',
  'Refund|Promotion|Shipping': 'Promotional Discounts',
  'Refund|ItemFees|Commission': 'Seller Fees',
  'Refund|ItemFees|ShippingChargeback': 'FBA Fees',
  'Refund|ItemFees|RefundCommission': 'Seller Fees',
  'other-transaction|FBA Inventory Reimbursement|REVERSAL_REIMBURSEMENT': 'Reimbursements',
  'other-transaction|FBA Inventory Reimbursement|WAREHOUSE_DAMAGE': 'Reimbursements',
  'other-transaction|other-transaction|RemovalComplete': 'FBA Fees',
  'other-transaction|other-transaction|DisposalComplete': 'FBA Fees',
  'other-transaction|other-transaction|StorageRenewalBilling': 'Storage Fees',
  'other-transaction|other-transaction|Storage Fee': 'Storage Fees',
  'other-transaction|other-transaction|CostOfAdvertising': 'Advertising Costs',
  'other-transaction|other-transaction|Subscription Fee': 'Seller Fees',
  'AmazonFees|Vine Enrollment Fee|Base fee': 'Seller Fees',
  'AmazonFees|Vine Enrollment Fee|Tax on fee': 'Seller Fees',
  'Order|ItemPrice|Tax': 'Tax Collected by Amazon',
  'Order|ItemPrice|ShippingTax': 'Tax Collected by Amazon',
  'Order|ItemWithheldTax|LowValueGoodsTax-Principal': 'Tax Collected by Amazon',
  'Order|ItemWithheldTax|LowValueGoodsTax-Shipping': 'Tax Collected by Amazon',
  'Order|Promotion|TaxDiscount': 'Tax Collected by Amazon',
};

const EXPECTED_SIGNS: Record<string, 1 | -1> = {
  'Sales': 1, 'Promotional Discounts': -1, 'Seller Fees': -1,
  'FBA Fees': -1, 'Storage Fees': -1, 'Advertising Costs': -1,
  'Refunds': -1, 'Reimbursements': 1, 'Tax Collected by Amazon': 1,
};

function round2(n: number): number { return Math.round(n * 100) / 100; }

function normaliseAggregate(total: number, category: string): number {
  const expectedSign = EXPECTED_SIGNS[category];
  if (!expectedSign || total === 0) return total;
  const actualSign = total > 0 ? 1 : -1;
  return actualSign !== expectedSign ? -total : total;
}

function parseSettlementDate(dateStr: string): string {
  if (!dateStr) return '';
  const parts = dateStr.trim().split(' ')[0].split('.');
  if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`;
  return dateStr;
}

interface ParsedSettlement {
  header: { settlementId: string; periodStart: string; periodEnd: string; depositDate: string; totalAmount: number; currency: string };
  lines: any[];
  unmapped: any[];
  summary: any;
  splitMonth: any;
}

function parseSettlementTSV(tsvContent: string, gstRate = 10): ParsedSettlement {
  const gstDivisor = 1 + (100 / gstRate); // 10% GST-inclusive → divide by 11 to extract GST component
  const rawLines = tsvContent.split('\n').filter(line => line.trim().length > 0);
  if (rawLines.length < 2) throw new Error('Settlement file must have at least a header row and one data row');

  const columnHeaders = rawLines[0].split('\t').map(h => h.trim().toLowerCase());
  const colIdx: Record<string, number> = {};
  columnHeaders.forEach((h, i) => { colIdx[h] = i; });

  const getField = (row: string[], col: string): string => {
    const idx = colIdx[col.toLowerCase()];
    return idx !== undefined && idx < row.length ? (row[idx] || '').trim() : '';
  };

  let header: ParsedSettlement['header'] | null = null;
  const lines: any[] = [];
  const unmapped: any[] = [];
  let salesPrincipal = 0, salesShipping = 0;

  const AU_MARKETPLACE = 'Amazon.com.au';
  let auSalesGstBaseTotal = 0;
  const INCOME_CATEGORIES = new Set(['Sales', 'Promotional Discounts', 'Refunds', 'Reimbursements']);

  const normaliseOrderId = (value: string): string => value.trim().replace(/\s+/g, '').toLowerCase();
  const getOrderIdentifiers = (row: string[]): string[] => {
    const candidates = [getField(row, 'order-id'), getField(row, 'merchant-order-id'), getField(row, 'amazon-order-id'), getField(row, 'original-order-id')];
    const unique = new Set<string>();
    for (const c of candidates) { if (c) { const n = normaliseOrderId(c); if (n) unique.add(n); } }
    return [...unique];
  };

  // Pass 1: detect international order IDs
  const LVGT_DESCRIPTIONS = new Set(['Tax', 'ShippingTax', 'LowValueGoodsTax-Principal', 'LowValueGoodsTax-Shipping', 'TaxDiscount']);
  const intlOrderIds = new Set<string>();
  for (let i = 1; i < rawLines.length; i++) {
    const fields = rawLines[i].split('\t');
    const marketplaceName = getField(fields, 'marketplace-name');
    const amountDescription = getField(fields, 'amount-description');
    const isExplicitNonAu = !!marketplaceName && marketplaceName !== AU_MARKETPLACE;
    const isLvgtLine = LVGT_DESCRIPTIONS.has(amountDescription);
    if (!isExplicitNonAu && !isLvgtLine) continue;
    for (const orderKey of getOrderIdentifiers(fields)) intlOrderIds.add(orderKey);
  }

  // Pass 2: classify
  for (let i = 1; i < rawLines.length; i++) {
    const fields = rawLines[i].split('\t');
    const transactionType = getField(fields, 'transaction-type');
    const orderId = getField(fields, 'order-id');

    // Header row detection
    if (!transactionType && !orderId) {
      const totalAmount = parseFloat(getField(fields, 'total-amount'));
      if (!isNaN(totalAmount) && !header) {
        header = {
          settlementId: getField(fields, 'settlement-id'),
          periodStart: parseSettlementDate(getField(fields, 'settlement-start-date')),
          periodEnd: parseSettlementDate(getField(fields, 'settlement-end-date')),
          depositDate: parseSettlementDate(getField(fields, 'deposit-date')),
          totalAmount, currency: getField(fields, 'currency') || 'AUD',
        };
      }
      continue;
    }

    if (!transactionType) continue;

    const amountType = getField(fields, 'amount-type');
    const amountDescription = getField(fields, 'amount-description');
    const amount = parseFloat(getField(fields, 'amount')) || 0;
    const sku = getField(fields, 'sku');
    const postedDate = parseSettlementDate(getField(fields, 'posted-date'));
    const marketplaceName = getField(fields, 'marketplace-name');
    const orderIdentifiers = getOrderIdentifiers(fields);
    const isExplicitNonAu = !!marketplaceName && marketplaceName !== AU_MARKETPLACE;
    const hasIntlOrderMatch = orderIdentifiers.some(id => intlOrderIds.has(id));
    const isIntlOrder = isExplicitNonAu || hasIntlOrderMatch;

    const mapKey = `${transactionType}|${amountType}|${amountDescription}`;
    const category = CATEGORY_MAP[mapKey];

    if (category) {
      lines.push({ transactionType, amountType, amountDescription, accountingCategory: category, amount, orderId, sku, postedDate, marketplaceName, isAuMarketplace: marketplaceName === AU_MARKETPLACE && !hasIntlOrderMatch });
      if (category === 'Sales' && amountDescription === 'Principal') salesPrincipal += amount;
      else if (category === 'Sales' && amountDescription === 'Shipping') salesShipping += amount;
      if ((category === 'Sales' || category === 'Promotional Discounts') && marketplaceName === AU_MARKETPLACE && !isIntlOrder) {
        auSalesGstBaseTotal += amount;
      }
    } else {
      const rawRow: Record<string, string> = {};
      columnHeaders.forEach((h, idx) => { rawRow[h] = idx < fields.length ? fields[idx] : ''; });
      unmapped.push({ transactionType, amountType, amountDescription, amount, rawRow });
    }
  }

  if (!header) throw new Error('No settlement header row found');

  // Aggregation
  const totals: Record<string, number> = {};
  for (const line of lines) totals[line.accountingCategory] = (totals[line.accountingCategory] || 0) + line.amount;

  const totalSales = normaliseAggregate(round2(totals['Sales'] || 0), 'Sales');
  const promotionalDiscounts = normaliseAggregate(round2(totals['Promotional Discounts'] || 0), 'Promotional Discounts');
  const sellerFees = normaliseAggregate(round2(totals['Seller Fees'] || 0), 'Seller Fees');
  const fbaFees = normaliseAggregate(round2(totals['FBA Fees'] || 0), 'FBA Fees');
  const storageFees = normaliseAggregate(round2(totals['Storage Fees'] || 0), 'Storage Fees');
  const advertisingCosts = normaliseAggregate(round2(totals['Advertising Costs'] || 0), 'Advertising Costs');
  const refunds = normaliseAggregate(round2(totals['Refunds'] || 0), 'Refunds');
  const reimbursements = normaliseAggregate(round2(totals['Reimbursements'] || 0), 'Reimbursements');
  const taxCollectedByAmazon = round2(totals['Tax Collected by Amazon'] || 0);
  const unmappedTotal = round2(unmapped.reduce((s: number, u: any) => s + u.amount, 0));

  const grossTotal = round2(totalSales + promotionalDiscounts + sellerFees + fbaFees + storageFees + advertisingCosts + refunds + reimbursements + taxCollectedByAmazon + unmappedTotal);
  const auIncome = round2(auSalesGstBaseTotal);
  const expenseTotal = round2(sellerFees + fbaFees + storageFees + advertisingCosts);
  const gstOnIncome = round2(auIncome / gstDivisor);
  const gstOnExpenses = round2(expenseTotal / gstDivisor);
  const netExGst = round2(grossTotal - gstOnIncome - gstOnExpenses);
  const reconciliationDiff = round2(header.totalAmount - grossTotal);
  const reconciliationMatch = Math.abs(reconciliationDiff) < 0.01;

  const summary = {
    salesPrincipal: round2(salesPrincipal), salesShipping: round2(salesShipping), totalSales,
    promotionalDiscounts, sellerFees, fbaFees, storageFees, advertisingCosts, refunds, reimbursements,
    otherFees: unmappedTotal, grossTotal, netExGst, gstOnIncome, gstOnExpenses,
    bankDeposit: header.totalAmount, reconciliationMatch, reconciliationDiff,
  };

  // Split month detection
  const splitMonth = detectSplitMonth(header, lines, gstDivisor);

  return { header, lines, unmapped, summary, splitMonth };
}

function detectSplitMonth(header: any, allLines: any[], gstDivisor: number): any {
  if (!header.periodStart || !header.periodEnd) return { isSplitMonth: false, month1: null, month2: null, rolloverAmount: 0 };
  const [startY, startM] = header.periodStart.split('-').map(Number);
  const [endY, endM] = header.periodEnd.split('-').map(Number);
  if (startY === endY && startM === endM) return { isSplitMonth: false, month1: null, month2: null, rolloverAmount: 0 };

  const startDate = new Date(Date.UTC(startY, startM - 1, parseInt(header.periodStart.split('-')[2])));
  const endDate = new Date(Date.UTC(endY, endM - 1, parseInt(header.periodEnd.split('-')[2])));
  const lastDayMonth1 = new Date(Date.UTC(startY, startM, 0));
  const firstDayMonth2 = new Date(Date.UTC(endY, endM - 1, 1));
  const daysMonth1 = Math.round((lastDayMonth1.getTime() - startDate.getTime()) / 86400000) + 1;
  const daysMonth2 = Math.round((endDate.getTime() - firstDayMonth2.getTime()) / 86400000) + 1;
  const totalDays = daysMonth1 + daysMonth2;
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const formatDateStr = (d: Date) => d.toISOString().split('T')[0];
  const lastDayMonth1Str = formatDateStr(lastDayMonth1);

  const aggregateLines = (monthLines: any[]) => {
    let sp = 0, ss = 0, pd = 0, sf = 0, ff = 0, stf = 0, ad = 0, ref = 0, reim = 0, oth = 0;
    for (const line of monthLines) {
      const cat = line.accountingCategory, amt = line.amount;
      if (cat === 'Sales' && line.amountDescription === 'Principal') sp += amt;
      else if (cat === 'Sales' && line.amountDescription === 'Shipping') ss += amt;
      else if (cat === 'Sales') sp += amt;
      else if (cat === 'Promotional Discounts') pd += amt;
      else if (cat === 'Seller Fees') sf += amt;
      else if (cat === 'FBA Fees') ff += amt;
      else if (cat === 'Storage Fees') stf += amt;
      else if (cat === 'Advertising Costs') ad += amt;
      else if (cat === 'Refunds') ref += amt;
      else if (cat === 'Reimbursements') reim += amt;
      else oth += amt;
    }
    const ts = round2(sp + ss), gross = round2(ts + pd + sf + ff + stf + ad + ref + reim + oth);
    const expTotal = round2(sf + ff + stf + ad);
    const gstInc = round2(round2(sp + ss + pd) / gstDivisor), gstExp = round2(expTotal / gstDivisor);
    const net = round2(gross - gstInc - gstExp);
    return { salesPrincipal: round2(sp), salesShipping: round2(ss), totalSales: ts, promotionalDiscounts: round2(pd), sellerFees: round2(sf), fbaFees: round2(ff), storageFees: round2(stf), advertisingCosts: round2(ad), refunds: round2(ref), reimbursements: round2(reim), otherFees: round2(oth), grossTotal: gross, netExGst: net, gstOnIncome: gstInc, gstOnExpenses: gstExp };
  };

  const month1Lines = allLines.filter((l: any) => !l.postedDate || l.postedDate <= lastDayMonth1Str);
  const month2Lines = allLines.filter((l: any) => l.postedDate && l.postedDate > lastDayMonth1Str);
  const m1Agg = aggregateLines(month1Lines), m2Agg = aggregateLines(month2Lines);

  return {
    isSplitMonth: true,
    month1: { start: header.periodStart, end: formatDateStr(lastDayMonth1), ratio: round2((daysMonth1 / totalDays) * 100) / 100, days: daysMonth1, monthLabel: MONTH_NAMES[startM - 1], ...m1Agg },
    month2: { start: formatDateStr(firstDayMonth2), end: header.periodEnd, ratio: round2((daysMonth2 / totalDays) * 100) / 100, days: daysMonth2, monthLabel: MONTH_NAMES[endM - 1], ...m2Agg },
    rolloverAmount: m1Agg.grossTotal,
  };
}

// ═══════════════════════════════════════════════════════════════
// Helper: get fresh SP-API access token for a given user
// ═══════════════════════════════════════════════════════════════
async function refreshAccessToken(amazonToken: any): Promise<string> {
  const clientId = Deno.env.get('AMAZON_SP_CLIENT_ID')!;
  const clientSecret = Deno.env.get('AMAZON_SP_CLIENT_SECRET')!;

  const tokenResponse = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: amazonToken.refresh_token,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!tokenResponse.ok) {
    const errText = await tokenResponse.text();
    throw new Error(`Token refresh failed: ${tokenResponse.status} ${errText}`);
  }

  const tokenData = await tokenResponse.json();
  return tokenData.access_token;
}

// ═══════════════════════════════════════════════════════════════
// Helper: download a single report with retry on 429
// ═══════════════════════════════════════════════════════════════
async function downloadReport(baseUrl: string, accessToken: string, reportDocumentId: string, supabase?: any, userId?: string): Promise<string> {
  const docUrl = `${baseUrl}/reports/2021-06-30/documents/${reportDocumentId}`;
  let docResponse: Response | null = null;
  // Fail-fast: only 2 retries before setting cooldown (was 5)
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) {
      const delay = 5000; // Fixed 5s backoff
      logger.debug(`Rate limited, retrying in ${delay}ms (attempt ${attempt + 1})`);
      await new Promise(r => setTimeout(r, delay));
    }
    docResponse = await fetch(docUrl, { headers: { 'x-amz-access-token': accessToken } });
    if (docResponse.status !== 429) break;
    logger.warn('SP-API 429 rate limited');
  }

  if (docResponse?.status === 429) {
    // Fail-fast: set 15-minute cooldown immediately so no other caller retries
    if (supabase && userId) {
      const retryAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await upsertSetting(supabase, userId, 'amazon_rate_limit_until', retryAt);
      logger.warn(`[downloadReport] 429 fail-fast: cooldown set until ${retryAt} for user ${userId}`);
    }
    throw new Error('RATE_LIMITED: Amazon API rate limited — cooldown set');
  }

  if (!docResponse || !docResponse.ok) {
    throw new Error(`Failed to get report document: ${docResponse?.status}`);
  }

  const docData = await docResponse.json();
  if (!docData.url) throw new Error('No download URL in report document');

  const reportResponse = await fetch(docData.url);
  if (!reportResponse.ok) throw new Error(`Failed to download report: ${reportResponse.status}`);

  if (docData.compressionAlgorithm === 'GZIP') {
    const buffer = await reportResponse.arrayBuffer();
    const ds = new DecompressionStream('gzip');
    const decompressed = new Response(new Blob([buffer]).stream().pipeThrough(ds));
    return await decompressed.text();
  }
  return await reportResponse.text();
}

// ═══════════════════════════════════════════════════════════════
// Helper: upsert app_settings
// ═══════════════════════════════════════════════════════════════
async function upsertSetting(supabase: any, userId: string, key: string, value: string) {
  const { data: existing } = await supabase
    .from('app_settings')
    .select('id')
    .eq('user_id', userId)
    .eq('key', key)
    .maybeSingle();

  if (existing) {
    await supabase.from('app_settings').update({ value }).eq('id', existing.id);
  } else {
    await supabase.from('app_settings').insert({ user_id: userId, key, value } as any);
  }
}

// ═══════════════════════════════════════════════════════════════
// SYNC ACTION: Full server-side fetch-parse-save loop (cron)
// ═══════════════════════════════════════════════════════════════
async function handleSync(supabaseAdmin: any, syncFromParam?: string): Promise<{ users: number; imported: number; skipped: number; errors: number; details: string[] }> {
  const details: string[] = [];
  let totalImported = 0, totalSkipped = 0, totalErrors = 0;

  const { data: amazonTokens, error: tokensError } = await supabaseAdmin
    .from('amazon_tokens')
    .select('*');

  if (tokensError || !amazonTokens?.length) {
    details.push(`No Amazon tokens found: ${tokensError?.message || 'none'}`);
    return { users: 0, imported: 0, skipped: 0, errors: 0, details };
  }

  logger.debug(`[Sync] Processing ${amazonTokens.length} user(s) with Amazon tokens`);

  for (const amazonToken of amazonTokens) {
    const userId = amazonToken.user_id;

    // ─── Atomic lock check: skip if manual sync holds the lock ────
    const { data: lockResult } = await supabaseAdmin.rpc('acquire_sync_lock', {
      p_user_id: userId,
      p_integration: 'amazon',
      p_lock_key: 'settlement_sync',
      p_ttl_seconds: 600,
    });

    if (!lockResult?.acquired) {
      details.push(`User ${userId}: Skipped — sync lock held until ${lockResult?.expires_at}`);
      logger.debug(`[Sync] Amazon sync skipped for ${userId} — lock held`);
      continue;
    }

    // ─── Check rate limit cooldown (atomic RPC) ─────────────────
    const { data: cooldownResult } = await supabaseAdmin.rpc('check_sync_cooldown', {
      p_user_id: userId,
      p_key: 'amazon_rate_limit_until',
      p_window_seconds: 0, // Rate limit uses absolute expiry, not relative window
    });

    if (cooldownResult && !cooldownResult.ok) {
      // Release lock since we're skipping
      await supabaseAdmin.rpc('release_sync_lock', { p_user_id: userId, p_integration: 'amazon', p_lock_key: 'settlement_sync' });
      details.push(`User ${userId}: Skipped — Amazon rate limit cooldown active`);
      logger.debug(`[Sync] Amazon rate limited for ${userId} — cooldown active`);
      continue;
    }

    const region = amazonToken.region || 'fe';
    const baseUrl = SP_API_ENDPOINTS[region] || SP_API_ENDPOINTS.fe;

    try {
      const accessToken = await refreshAccessToken(amazonToken);
      logger.debug(`[Sync] Got access token for user ${userId}`);

      const { data: settingsData } = await supabaseAdmin
        .from('app_settings')
        .select('key, value')
        .eq('user_id', userId)
        .in('key', ['accounting_gst_rate', 'accounting_boundary_date']);

      const settingsMap: Record<string, string> = {};
      (settingsData || []).forEach((s: any) => { settingsMap[s.key] = s.value; });
      const gstRate = parseFloat(settingsMap['accounting_gst_rate'] || '10');
      const accountingBoundary = settingsMap['accounting_boundary_date'] || null;

      // Smart sync window: use sync_from for createdSince if provided, otherwise default to 90 days
      const startDate = syncFromParam
        ? new Date(syncFromParam)
        : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      // Clamp: never go further back than 90 days (Amazon API limit)
      const maxLookback = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
      if (startDate < maxLookback) startDate.setTime(maxLookback.getTime());
      logger.debug(`[Sync] Report listing window: ${startDate.toISOString()} (sync_from: ${syncFromParam || 'none'})`);
      const params = new URLSearchParams({
        reportTypes: 'GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2',
        processingStatuses: 'DONE',
        pageSize: '50',
        createdSince: startDate.toISOString(),
      });

      const reportsUrl = `${baseUrl}/reports/2021-06-30/reports?${params.toString()}`;
      const reportsResponse = await fetch(reportsUrl, {
        headers: { 'x-amz-access-token': accessToken, 'Content-Type': 'application/json' },
      });

      if (!reportsResponse.ok) {
        const errBody = await reportsResponse.text();
        details.push(`User ${userId}: SP-API list failed: ${reportsResponse.status} ${errBody}`);
        totalErrors++;
        continue;
      }

      const reportsData = await reportsResponse.json();
      const allReports = reportsData.reports || [];

      if (allReports.length === 0) {
        details.push(`User ${userId}: No reports found`);
        continue;
      }

      const { data: existingData } = await supabaseAdmin
        .from('settlements')
        .select('settlement_id, period_start, period_end, bank_deposit')
        .eq('user_id', userId)
        .eq('marketplace', 'amazon_au');
      const existingIds = new Set((existingData || []).map((s: any) => s.settlement_id));
      const existingFingerprints = new Set(
        (existingData || []).map((s: any) => `${s.period_start}|${s.period_end}|${round2(s.bank_deposit)}`)
      );

      const sorted = [...allReports].sort((a: any, b: any) => {
        return new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime();
      });
      let userImported = 0, userSkipped = 0, userErrors = 0;

      for (let i = 0; i < sorted.length; i++) {
        const report = sorted[i];
        if (!report.reportDocumentId) continue;

        // Smart sync window: skip reports that ended before sync_from
        if (syncFromParam && report.dataEndTime) {
          const reportEnd = report.dataEndTime.split('T')[0];
          if (reportEnd < syncFromParam) {
            logger.debug(`[Sync] Skipping report ${report.reportDocumentId} — ends ${reportEnd} before sync_from ${syncFromParam}`);
            userSkipped++;
            continue;
          }
        }

        if (i > 0) await new Promise(r => setTimeout(r, 3000));

        try {
          const content = await downloadReport(baseUrl, accessToken, report.reportDocumentId, supabaseAdmin, userId);
          const parsed = parseSettlementTSV(content, gstRate);

          if (existingIds.has(parsed.header.settlementId)) {
            userSkipped++;
            continue;
          }

          const fingerprint = `${parsed.header.periodStart}|${parsed.header.periodEnd}|${round2(parsed.header.totalAmount)}`;
          if (existingFingerprints.has(fingerprint)) {
            userSkipped++;
            continue;
          }

          const isBeforeCutoff = accountingBoundary && parsed.header.periodEnd && parsed.header.periodEnd <= accountingBoundary;
          const { header, summary, lines, unmapped, splitMonth } = parsed;

          const { error: settError } = await supabaseAdmin.from('settlements').upsert({
            user_id: userId,
            settlement_id: header.settlementId,
            marketplace: 'amazon_au',
            period_start: header.periodStart,
            period_end: header.periodEnd,
            deposit_date: header.depositDate,
            sales_principal: summary.salesPrincipal,
            sales_shipping: summary.salesShipping,
            promotional_discounts: summary.promotionalDiscounts,
            seller_fees: summary.sellerFees,
            fba_fees: summary.fbaFees,
            storage_fees: summary.storageFees,
            refunds: summary.refunds,
            reimbursements: summary.reimbursements,
            advertising_costs: summary.advertisingCosts,
            other_fees: summary.otherFees,
            net_ex_gst: summary.netExGst,
            gst_on_income: summary.gstOnIncome,
            gst_on_expenses: summary.gstOnExpenses,
            bank_deposit: summary.bankDeposit,
            reconciliation_status: summary.reconciliationMatch ? 'matched' : 'failed',
            status: 'ingested',
            is_pre_boundary: !!isBeforeCutoff,
            source: 'api',
            is_split_month: splitMonth.isSplitMonth,
            split_month_1_data: splitMonth.month1 ? JSON.stringify(splitMonth.month1) : null,
            split_month_2_data: splitMonth.month2 ? JSON.stringify(splitMonth.month2) : null,
            parser_version: PARSER_VERSION,
          }, { onConflict: 'marketplace,settlement_id,user_id', ignoreDuplicates: true });

          if (settError) {
            userErrors++;
            continue;
          }

          // ─── Compute and persist settlement_components ───
          {
            const payoutTotal = round2(summary.bankDeposit);
            const commerceGrossTotal = round2(payoutTotal + Math.abs(summary.gstOnIncome) + summary.gstOnExpenses);
            await supabaseAdmin.from('settlement_components').upsert({
              user_id: userId,
              settlement_id: header.settlementId,
              marketplace_code: 'amazon_au',
              currency: 'AUD',
              period_start: header.periodStart,
              period_end: header.periodEnd,
              sales_ex_tax: round2(Math.abs(summary.salesPrincipal) + Math.abs(summary.salesShipping) - Math.abs(summary.gstOnIncome)),
              sales_tax: round2(Math.abs(summary.gstOnIncome)),
              fees_ex_tax: round2(-(Math.abs(summary.sellerFees) + Math.abs(summary.fbaFees) - Math.abs(summary.gstOnExpenses))),
              fees_tax: round2(-Math.abs(summary.gstOnExpenses)),
              refunds_ex_tax: round2(-Math.abs(summary.refunds) + Math.abs(summary.refunds) / 11),
              refunds_tax: round2(-Math.abs(summary.refunds) / 11),
              reimbursements: summary.reimbursements,
              other_adjustments: summary.otherFees,
              promotional_discounts: summary.promotionalDiscounts,
              advertising_costs: summary.advertisingCosts,
              storage_fees: summary.storageFees,
              payout_total: payoutTotal,
              payout_gst_inclusive: commerceGrossTotal,
              commerce_gross_total: commerceGrossTotal,
              gst_rate: 10,
              reconciled: true,
              source: 'api',
            } as any, { onConflict: 'user_id,settlement_id,marketplace_code' });
          }

          // ─── Auto-link to pre-cached Xero invoice (ONLY Xettle-created) ───
          // External invoices (AMZN-, LMB-, A2X-) are stored as external_candidate
          // and require explicit user review — they are NEVER auto-linked.
          const { data: preMatch } = await supabaseAdmin
            .from('xero_accounting_matches')
            .select('xero_invoice_id, xero_invoice_number, xero_status, xero_type, matched_reference, match_method')
            .eq('settlement_id', header.settlementId)
            .eq('user_id', userId)
            .maybeSingle();

          if (preMatch?.xero_invoice_id && preMatch.match_method !== 'external_candidate') {
            const isXettleFormat = (preMatch.matched_reference || '').startsWith('Xettle-');
            // Only auto-link if this is a Xettle-created invoice
            if (isXettleFormat) {
              let derivedSt = 'pushed_to_xero';
              if (preMatch.xero_status === 'PAID') derivedSt = 'reconciled_in_xero';

              await supabaseAdmin.from('settlements').update({
                xero_journal_id: preMatch.xero_invoice_id,
                xero_invoice_id: preMatch.xero_invoice_id,
                xero_invoice_number: preMatch.xero_invoice_number,
                xero_status: preMatch.xero_status,
                status: derivedSt,
                sync_origin: 'xettle',
                posted_at: new Date().toISOString(),
              } as any).eq('settlement_id', header.settlementId).eq('user_id', userId);
              logger.debug(`[fetch-amazon] Auto-linked settlement ${header.settlementId} to Xettle invoice ${preMatch.xero_invoice_number}`);
            } else {
              logger.debug(`[fetch-amazon] External invoice ${preMatch.xero_invoice_number} found for ${header.settlementId} — NOT auto-linking (requires user review)`);
            }
          }

          // Delete existing lines/unmapped before re-insert (idempotency on retry)
          await supabaseAdmin.from('settlement_lines')
            .delete()
            .eq('user_id', userId)
            .eq('settlement_id', header.settlementId);
          await supabaseAdmin.from('settlement_unmapped')
            .delete()
            .eq('user_id', userId)
            .eq('settlement_id', header.settlementId);

          if (lines.length > 0) {
            const lineRows = lines.map((l: any) => ({
              user_id: userId,
              settlement_id: header.settlementId,
              transaction_type: l.transactionType,
              amount_type: l.amountType,
              amount_description: l.amountDescription,
              accounting_category: l.accountingCategory,
              amount: l.amount,
              order_id: l.orderId || null,
              sku: l.sku || null,
              posted_date: l.postedDate || null,
              marketplace_name: l.marketplaceName || null,
            }));
            for (let j = 0; j < lineRows.length; j += 500) {
              await supabaseAdmin.from('settlement_lines').insert(lineRows.slice(j, j + 500));
            }
          }

          if (unmapped.length > 0) {
            await supabaseAdmin.from('settlement_unmapped').insert(unmapped.map((u: any) => ({
              user_id: userId,
              settlement_id: header.settlementId,
              transaction_type: u.transactionType,
              amount_type: u.amountType,
              amount_description: u.amountDescription,
              amount: u.amount,
              raw_row: u.rawRow,
            })));
          }

          existingIds.add(parsed.header.settlementId);
          userImported++;
        } catch (dlErr: any) {
          userErrors++;
        }
      }

      details.push(`User ${userId}: ${userImported} imported, ${userSkipped} skipped, ${userErrors} errors`);
      totalImported += userImported;
      totalSkipped += userSkipped;
      totalErrors += userErrors;
      // Release lock after processing
      await supabaseAdmin.rpc('release_sync_lock', { p_user_id: userId, p_integration: 'amazon', p_lock_key: 'settlement_sync' });
    } catch (userErr: any) {
      // Release lock on error too
      await supabaseAdmin.rpc('release_sync_lock', { p_user_id: userId, p_integration: 'amazon', p_lock_key: 'settlement_sync' });
      details.push(`User ${userId}: FAILED — ${userErr.message}`);
      totalErrors++;
    }
  }

  return { users: amazonTokens.length, imported: totalImported, skipped: totalSkipped, errors: totalErrors, details };
}

// ═══════════════════════════════════════════════════════════════
// SMART-SYNC: User-authenticated sync (like Shopify payouts)
// - 1-hour cooldown
// - Respects accounting boundary
// - Deduplicates by settlement_id and fingerprint
// - Returns summary with totals for UI
// ═══════════════════════════════════════════════════════════════
async function handleSmartSync(supabase: any, userId: string, syncFrom?: string): Promise<Response> {
  // ─── Check rate limit cooldown (atomic RPC) ────────────────────
  const { data: cooldownResult } = await supabase.rpc('check_sync_cooldown', {
    p_user_id: userId,
    p_key: 'amazon_rate_limit_until',
    p_window_seconds: 0,
  });

  if (cooldownResult && !cooldownResult.ok) {
    const retryAfter = cooldownResult.retry_after;
    const minutesLeft = Math.ceil((new Date(retryAfter).getTime() - Date.now()) / 60000);
    return new Response(
      JSON.stringify({
        error: 'rate_limited',
        error_type: 'rate_limit',
        message: `Amazon API rate limited — this is temporary. Will retry automatically in ${minutesLeft} minutes.`,
        retry_after: retryAfter,
      }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ─── Atomic lock acquisition (10 minute TTL) ──────────────────
  const { data: lockResult } = await supabase.rpc('acquire_sync_lock', {
    p_user_id: userId,
    p_integration: 'amazon',
    p_lock_key: 'settlement_sync',
    p_ttl_seconds: 600,
  });

  if (!lockResult?.acquired) {
    return new Response(
      JSON.stringify({
        error: 'sync_in_progress',
        error_type: 'mutex',
        message: 'Amazon sync already running. Please wait for it to complete.',
        retry_after: lockResult?.expires_at,
      }),
      { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  try {
    return await _executeSmartSync(supabase, userId, syncFrom);
  } finally {
    // ─── Always release lock when done ────────────────────────────
    await supabase.rpc('release_sync_lock', {
      p_user_id: userId,
      p_integration: 'amazon',
      p_lock_key: 'settlement_sync',
    });
  }
}

async function _executeSmartSync(supabase: any, userId: string, smartSyncFrom?: string): Promise<Response> {
  // ─── Check cooldown (1 hour minimum between syncs) ────────────
  const { data: cooldownSetting } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'amazon_settlement_last_sync')
    .eq('user_id', userId)
    .maybeSingle();

  if (cooldownSetting?.value) {
    const lastSync = new Date(cooldownSetting.value);
    const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
    if (lastSync > hourAgo) {
      return new Response(
        JSON.stringify({
          error: 'Sync cooldown active',
          error_type: 'cooldown',
          message: `Amazon synced ${Math.round((Date.now() - lastSync.getTime()) / 60000)} minutes ago. Will retry automatically in 1 hour.`,
          last_sync: cooldownSetting.value,
        }),
        { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
  }

  // ─── Get Amazon token ──────────────────────────────────────────
  const { data: amazonToken, error: tokenError } = await supabase
    .from('amazon_tokens')
    .select('*')
    .eq('user_id', userId)
    .limit(1)
    .single();

  if (tokenError || !amazonToken) {
    return new Response(
      JSON.stringify({ error: 'No Amazon connection found. Connect your Amazon account first.' }),
      { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ─── Get settings ──────────────────────────────────────────────
  const { data: settingsData } = await supabase
    .from('app_settings')
    .select('key, value')
    .eq('user_id', userId)
    .in('key', ['accounting_gst_rate', 'accounting_boundary_date']);

  const settingsMap: Record<string, string> = {};
  (settingsData || []).forEach((s: any) => { settingsMap[s.key] = s.value; });
  const gstRate = parseFloat(settingsMap['accounting_gst_rate'] || '10');
  const accountingBoundary = settingsMap['accounting_boundary_date'] || null;

  // ─── Refresh SP-API access token ───────────────────────────────
  const region = amazonToken.region || 'fe';
  const baseUrl = SP_API_ENDPOINTS[region] || SP_API_ENDPOINTS.fe;
  let accessToken: string;
  try {
    accessToken = await refreshAccessToken(amazonToken);
  } catch (err: any) {
    return new Response(
      JSON.stringify({ error: 'Failed to refresh Amazon token. Please reconnect your Amazon account.', details: err.message }),
      { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ─── Read sync_from from request body (stored in closure by handleSmartSync caller) ───
  // Smart-sync respects the Xero-derived boundary; clamp to max 90 days
  let syncFromForSmartSync: string | undefined;
  try {
    // The body was already consumed by the main handler, so we read from the closure
    // We'll pass it through handleSmartSync instead
  } catch { /* no body */ }

  // Use boundary-aware window: sync_from if available, else 90 days
  const listStartDate = smartSyncFrom
    ? new Date(Math.max(new Date(smartSyncFrom).getTime(), Date.now() - 90 * 24 * 60 * 60 * 1000))
    : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  logger.debug(`[smart-sync] Report listing window: ${listStartDate.toISOString()} (sync_from: ${smartSyncFrom || 'none'})`);
  const params = new URLSearchParams({
    reportTypes: 'GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2',
    processingStatuses: 'DONE',
    pageSize: '50',
    createdSince: listStartDate.toISOString(),
  });

  const reportsUrl = `${baseUrl}/reports/2021-06-30/reports?${params.toString()}`;
  const reportsResponse = await fetch(reportsUrl, {
    headers: { 'x-amz-access-token': accessToken, 'Content-Type': 'application/json' },
  });

  if (!reportsResponse.ok) {
    const errBody = await reportsResponse.text();
    return new Response(
      JSON.stringify({ error: `Amazon API error: ${reportsResponse.status}`, details: errBody }),
      { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  const reportsData = await reportsResponse.json();
  const allReports = reportsData.reports || [];

  if (allReports.length === 0) {
    await upsertSetting(supabase, userId, 'amazon_settlement_last_sync', new Date().toISOString());
    return new Response(
      JSON.stringify({ success: true, synced: 0, skipped: 0, message: 'No settlement reports found on Amazon' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  // ─── Get existing settlements for dedup ─────────────────────────
  const { data: existingData } = await supabase
    .from('settlements')
    .select('settlement_id, period_start, period_end, bank_deposit')
    .eq('user_id', userId)
    .eq('marketplace', 'amazon_au');

  const existingIds = new Set((existingData || []).map((s: any) => s.settlement_id));
  const existingFingerprints = new Set(
    (existingData || []).map((s: any) => `${s.period_start}|${s.period_end}|${round2(s.bank_deposit)}`)
  );

  // ─── Process reports newest-first ──────────────────────────────
  const sorted = [...allReports].sort((a: any, b: any) =>
    new Date(b.createdTime).getTime() - new Date(a.createdTime).getTime()
  );

  let synced = 0;
  let totalDeposit = 0;
  const syncedSettlements: Array<{ settlement_id: string; period_start: string; period_end: string; deposit: number }> = [];
  const errors: string[] = [];

    let earlyRateLimitCount = 0;
    for (let i = 0; i < sorted.length; i++) {
    const report = sorted[i];
    if (!report.reportDocumentId) continue;

    // Skip reports outside sync window (boundary-aware)
    if (smartSyncFrom && report.dataEndTime) {
      const reportEnd = report.dataEndTime.split('T')[0];
      if (reportEnd < smartSyncFrom) {
        logger.debug(`[smart-sync] Skipping report ${report.reportDocumentId} — ends ${reportEnd} before sync_from ${smartSyncFrom}`);
        continue;
      }
    }

    // Rate-limit delay
    if (i > 0) await new Promise(r => setTimeout(r, 3000));

    try {
      const content = await downloadReport(baseUrl, accessToken, report.reportDocumentId, supabase, userId);
      const parsed = parseSettlementTSV(content, gstRate);

      // Dedup check 1: exact settlement ID
      if (existingIds.has(parsed.header.settlementId)) {
        continue;
      }

      // Dedup check 2: fingerprint (dates + deposit)
      const fingerprint = `${parsed.header.periodStart}|${parsed.header.periodEnd}|${round2(parsed.header.totalAmount)}`;
      if (existingFingerprints.has(fingerprint)) {
        continue;
      }

      // Determine status and metadata based on accounting boundary
      // See: src/constants/settlement-status.ts for canonical state machine
      const isBeforeBoundary = accountingBoundary && parsed.header.periodEnd && parsed.header.periodEnd <= accountingBoundary;
      const settlementStatus = 'ingested';
      const isPreBoundary = !!isBeforeBoundary;

      const { header, summary, lines, unmapped, splitMonth } = parsed;

      // Insert settlement
      const { error: settError } = await supabase.from('settlements').upsert({
        user_id: userId,
        settlement_id: header.settlementId,
        marketplace: 'amazon_au',
        period_start: header.periodStart,
        period_end: header.periodEnd,
        deposit_date: header.depositDate,
        sales_principal: summary.salesPrincipal,
        sales_shipping: summary.salesShipping,
        promotional_discounts: summary.promotionalDiscounts,
        seller_fees: summary.sellerFees,
        fba_fees: summary.fbaFees,
        storage_fees: summary.storageFees,
        refunds: summary.refunds,
        reimbursements: summary.reimbursements,
        advertising_costs: summary.advertisingCosts,
        other_fees: summary.otherFees,
        net_ex_gst: summary.netExGst,
        gst_on_income: summary.gstOnIncome,
        gst_on_expenses: summary.gstOnExpenses,
        bank_deposit: summary.bankDeposit,
        reconciliation_status: summary.reconciliationMatch ? 'matched' : 'failed',
        status: settlementStatus,
        is_pre_boundary: isPreBoundary,
        source: 'api',
        is_split_month: splitMonth.isSplitMonth,
        split_month_1_data: splitMonth.month1 ? JSON.stringify(splitMonth.month1) : null,
        split_month_2_data: splitMonth.month2 ? JSON.stringify(splitMonth.month2) : null,
        parser_version: PARSER_VERSION,
      } as any, { onConflict: 'marketplace,settlement_id,user_id', ignoreDuplicates: true });

      if (settError) {
        if (settError.code === '23505') continue;
        errors.push(`Settlement ${header.settlementId}: ${settError.message}`);
        continue;
      }

      // ─── Compute and persist settlement_components (deterministic anchors) ───
      {
        const gstDivisor = 11; // AU 10%
        const salesGross = Math.abs(summary.salesPrincipal) + Math.abs(summary.salesShipping);
        const salesExTax = round2(salesGross - Math.abs(summary.gstOnIncome));
        const salesTax = round2(Math.abs(summary.gstOnIncome));
        const feesGross = Math.abs(summary.sellerFees) + Math.abs(summary.fbaFees);
        const feesExTax = round2(feesGross - Math.abs(summary.gstOnExpenses));
        const feesTax = round2(Math.abs(summary.gstOnExpenses));
        const refundsGross = Math.abs(summary.refunds);
        const refundsExTax = round2(refundsGross - refundsGross / gstDivisor);
        const refundsTax = round2(refundsGross / gstDivisor);
        const payoutTotal = round2(summary.bankDeposit);
        // commerce_gross_total = payout + output GST + input GST credits
        const commerceGrossTotal = round2(payoutTotal + Math.abs(summary.gstOnIncome) + summary.gstOnExpenses);

        await supabase.from('settlement_components').upsert({
          user_id: userId,
          settlement_id: header.settlementId,
          marketplace_code: 'amazon_au',
          currency: 'AUD',
          period_start: header.periodStart,
          period_end: header.periodEnd,
          sales_ex_tax: salesExTax,
          sales_tax: salesTax,
          refunds_ex_tax: -refundsExTax,
          refunds_tax: -refundsTax,
          fees_ex_tax: -feesExTax,
          fees_tax: -feesTax,
          reimbursements: summary.reimbursements,
          other_adjustments: summary.otherFees,
          promotional_discounts: summary.promotionalDiscounts,
          advertising_costs: summary.advertisingCosts,
          storage_fees: summary.storageFees,
          tax_collected_by_platform: 0,
          payout_total: payoutTotal,
          payout_gst_inclusive: commerceGrossTotal,
          commerce_gross_total: commerceGrossTotal,
          gst_rate: 10,
          payout_vs_deposit_diff: 0,
          reconciled: true,
          source: 'api',
        } as any, { onConflict: 'user_id,settlement_id,marketplace_code' });
      }

      // ─── Auto-link to pre-cached Xero invoice (ONLY Xettle-created) ───
      const { data: preMatch } = await supabase
        .from('xero_accounting_matches')
        .select('xero_invoice_id, xero_invoice_number, xero_status, xero_type, matched_reference, match_method')
        .eq('settlement_id', header.settlementId)
        .eq('user_id', userId)
        .maybeSingle();

      if (preMatch?.xero_invoice_id && preMatch.match_method !== 'external_candidate') {
        const isXettleFormat = (preMatch.matched_reference || '').startsWith('Xettle-');
        if (isXettleFormat) {
          let derivedSt = 'pushed_to_xero';
          if (preMatch.xero_status === 'PAID') derivedSt = 'reconciled_in_xero';

          await supabase.from('settlements').update({
            xero_journal_id: preMatch.xero_invoice_id,
            xero_invoice_id: preMatch.xero_invoice_id,
            xero_invoice_number: preMatch.xero_invoice_number,
            xero_status: preMatch.xero_status,
            status: derivedSt,
            sync_origin: 'xettle',
            posted_at: new Date().toISOString(),
          } as any).eq('settlement_id', header.settlementId).eq('user_id', userId);
          logger.debug(`[fetch-amazon] Auto-linked settlement ${header.settlementId} to Xettle invoice ${preMatch.xero_invoice_number}`);
        } else {
          logger.debug(`[fetch-amazon] External invoice ${preMatch.xero_invoice_number} found for ${header.settlementId} — NOT auto-linking`);
        }
      }

      // Delete existing lines/unmapped before re-insert (idempotency on retry)
      await supabase.from('settlement_lines')
        .delete()
        .eq('user_id', userId)
        .eq('settlement_id', header.settlementId);
      await supabase.from('settlement_unmapped')
        .delete()
        .eq('user_id', userId)
        .eq('settlement_id', header.settlementId);

      // Insert lines in batches
      if (lines.length > 0) {
        const lineRows = lines.map((l: any) => ({
          user_id: userId,
          settlement_id: header.settlementId,
          transaction_type: l.transactionType,
          amount_type: l.amountType,
          amount_description: l.amountDescription,
          accounting_category: l.accountingCategory,
          amount: l.amount,
          order_id: l.orderId || null,
          sku: l.sku || null,
          posted_date: l.postedDate || null,
          marketplace_name: l.marketplaceName || null,
        }));
        for (let j = 0; j < lineRows.length; j += 500) {
          await supabase.from('settlement_lines').insert(lineRows.slice(j, j + 500));
        }
      }

      // Insert unmapped
      if (unmapped.length > 0) {
        await supabase.from('settlement_unmapped').insert(unmapped.map((u: any) => ({
          user_id: userId,
          settlement_id: header.settlementId,
          transaction_type: u.transactionType,
          amount_type: u.amountType,
          amount_description: u.amountDescription,
          amount: u.amount,
          raw_row: u.rawRow,
        })));
      }

      // Upsert marketplace_validation
      const periodMonth = header.periodEnd.substring(0, 7);
      const monthStart = `${periodMonth}-01`;
      const monthEnd = new Date(
        parseInt(periodMonth.split('-')[0]),
        parseInt(periodMonth.split('-')[1]),
        0
      ).toISOString().split('T')[0];
      const periodLabel = new Date(header.periodEnd + 'T00:00:00').toLocaleDateString('en-AU', {
        month: 'short',
        year: 'numeric',
      });

      const { data: existingVal } = await supabase
        .from('marketplace_validation')
        .select('id, settlement_net')
        .eq('user_id', userId)
        .eq('marketplace_code', 'amazon_au')
        .eq('period_start', monthStart)
        .maybeSingle();

      // Derive settlement_net from settlements table (never accumulate additively)
      const { data: monthSettlements } = await supabase
        .from('settlements')
        .select('bank_deposit')
        .eq('user_id', userId)
        .eq('marketplace', 'amazon_au')
        .gte('period_end', monthStart)
        .lte('period_end', monthEnd);
      const derivedSettlementNet = round2((monthSettlements || []).reduce((sum: number, s: any) => sum + (s.bank_deposit || 0), 0));

      if (existingVal) {
        await supabase
          .from('marketplace_validation')
          .update({
            settlement_uploaded: true,
            settlement_uploaded_at: new Date().toISOString(),
            settlement_id: header.settlementId,
            settlement_net: derivedSettlementNet,
            overall_status: isBeforeBoundary ? 'pre_boundary' : 'ready_to_push',
          })
          .eq('id', existingVal.id);
      } else {
        await supabase.from('marketplace_validation').insert({
          user_id: userId,
          marketplace_code: 'amazon_au',
          period_label: periodLabel,
          period_start: monthStart,
          period_end: monthEnd,
          settlement_uploaded: true,
          settlement_uploaded_at: new Date().toISOString(),
          settlement_id: header.settlementId,
          settlement_net: derivedSettlementNet,
          overall_status: isBeforeBoundary ? 'pre_boundary' : 'ready_to_push',
        } as any);
      }

      // Log system event
      await supabase.from('system_events').insert({
        user_id: userId,
        event_type: 'amazon_settlement_synced',
        marketplace_code: 'amazon_au',
        period_label: periodLabel,
        settlement_id: header.settlementId,
        severity: 'info',
        details: { net: summary.bankDeposit, source: 'api', lines_count: lines.length },
      } as any);

      existingIds.add(header.settlementId);
      existingFingerprints.add(fingerprint);

      if (!isBeforeBoundary) {
        synced++;
        totalDeposit += summary.bankDeposit;
        syncedSettlements.push({
          settlement_id: header.settlementId,
          period_start: header.periodStart,
          period_end: header.periodEnd,
          deposit: summary.bankDeposit,
        });
      }
    } catch (dlErr: any) {
      errors.push(`Report ${report.reportDocumentId}: ${dlErr.message}`);
      // Fail-fast on rate limit: stop processing remaining reports
      if (dlErr.message?.includes('RATE_LIMITED')) {
        earlyRateLimitCount++;
        logger.warn(`[smart-sync] Rate limited — aborting remaining ${sorted.length - i - 1} reports`);
        break;
      }
    }
  }

  // ─── Update cooldown timestamp ─────────────────────────────────
  await upsertSetting(supabase, userId, 'amazon_settlement_last_sync', new Date().toISOString());

  // ─── Log sync history ──────────────────────────────────────────
  await supabase.from('sync_history').insert({
    user_id: userId,
    event_type: 'amazon_smart_sync',
    status: errors.length > 0 ? 'partial' : 'success',
    settlements_affected: synced,
    details: { synced, totalDeposit: round2(totalDeposit), settlements: syncedSettlements, errors },
  } as any);

  return new Response(
    JSON.stringify({
      success: true,
      synced,
      total_deposit: round2(totalDeposit),
      settlements: syncedSettlements,
      skipped: allReports.length - synced - errors.length,
      errors: errors.length > 0 ? errors : undefined,
      total_reports: allReports.length,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN HANDLER
// ═══════════════════════════════════════════════════════════════
serve(async (req) => {
  const origin = req.headers.get("Origin") ?? ""
  const corsHeaders = getCorsHeaders(origin)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

  try {
    const action = req.headers.get('x-action') || 'list';

    // ─── SYNC: Server-side full sync (cron/scheduled only) ─────
    // GUARDRAIL A: Block global sync from public client calls.
    // Only service-role (internal cron) may trigger this path.
    if (action === 'sync') {
      const authHeader = req.headers.get('Authorization') || '';
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const isServiceRole = authHeader === `Bearer ${serviceRoleKey}`;

      if (!isServiceRole) {
        logger.warn(`[fetch-amazon] Blocked global sync attempt from non-service-role caller`);
        return new Response(JSON.stringify({
          error: 'forbidden',
          message: 'Global sync is only available to internal scheduled jobs. Use smart-sync instead.',
        }), { status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

      // Accept optional sync_from from request body (Xero-first smart sync window)
      let syncFromParam: string | undefined;
      try {
        const body = await req.json();
        syncFromParam = body?.sync_from;
      } catch { /* no body */ }

      const result = await handleSync(supabaseAdmin, syncFromParam);
      logger.debug(`[Sync Complete]`, result);

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ─── All other actions require user auth ─────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader?.startsWith('Bearer ')) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')!
    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } }
    })

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }
    const userId = user.id

    // ─── SMART-SYNC: User-triggered smart sync ──────────────────
    if (action === 'smart-sync') {
      let syncFrom: string | undefined;
      try {
        const body = await req.json();
        syncFrom = body?.sync_from;
        // Support lookback_days as alternative to sync_from
        if (!syncFrom && body?.lookback_days && typeof body.lookback_days === 'number') {
          const lookbackDate = new Date(Date.now() - body.lookback_days * 24 * 60 * 60 * 1000);
          syncFrom = lookbackDate.toISOString().split('T')[0];
          logger.debug(`[smart-sync] lookback_days=${body.lookback_days} → sync_from=${syncFrom}`);
        }
      } catch { /* no body */ }
      return await handleSmartSync(supabase, userId, syncFrom);
    }

    // ─── BACKFILL: Evidence-triggered bounded backfill ─────────────
    // Accepts missing_settlement_ids from fetch-outstanding.
    // Widens the SP-API window in 90-day chunks (max 3 chunks = 270 days)
    // to find specific settlement reports that are outside the normal window.
    if (action === 'backfill') {
      let missingIds: string[] = [];
      try {
        const body = await req.json();
        missingIds = (body?.missing_settlement_ids || []).slice(0, 20); // Cap at 20
      } catch { /* no body */ }

      if (missingIds.length === 0) {
        return new Response(JSON.stringify({ success: true, message: 'No missing IDs provided', backfilled: 0 }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      // Check if we already have these settlements
      const { data: existing } = await supabase
        .from('settlements')
        .select('settlement_id')
        .eq('user_id', userId)
        .in('settlement_id', missingIds);
      const existingSet = new Set((existing || []).map((s: any) => s.settlement_id));
      const stillMissing = missingIds.filter(id => !existingSet.has(id));

      if (stillMissing.length === 0) {
        return new Response(JSON.stringify({ success: true, message: 'All requested settlements already exist', backfilled: 0 }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      logger.debug(`[backfill] Looking for ${stillMissing.length} missing settlement IDs: ${stillMissing.join(', ')}`);

      // Use the smart-sync infrastructure but with wider window chunks
      // Each chunk goes back 90 days further. Max 3 chunks = 270 days total.
      const MAX_CHUNKS = 3;
      let backfilled = 0;
      const foundIds: string[] = [];

      for (let chunk = 0; chunk < MAX_CHUNKS; chunk++) {
        const chunkEnd = new Date(Date.now() - chunk * 90 * 24 * 60 * 60 * 1000);
        const chunkStart = new Date(chunkEnd.getTime() - 90 * 24 * 60 * 60 * 1000);
        
        // Check if all missing IDs found
        const remainingMissing = stillMissing.filter(id => !foundIds.includes(id));
        if (remainingMissing.length === 0) break;

        logger.debug(`[backfill] Chunk ${chunk + 1}/${MAX_CHUNKS}: ${chunkStart.toISOString()} to ${chunkEnd.toISOString()}`);

        try {
          // Get fresh token
          const { data: authData } = await supabase.functions.invoke('amazon-auth', {
            headers: { 'x-action': 'refresh' },
          });
          if (!authData?.access_token) {
            console.error('[backfill] Failed to get access token');
            break;
          }

          const region = authData.region || 'fe';
          const baseUrl = SP_API_ENDPOINTS[region] || SP_API_ENDPOINTS.fe;
          const params = new URLSearchParams({
            reportTypes: 'GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2',
            processingStatuses: 'DONE',
            pageSize: '50',
            createdSince: chunkStart.toISOString(),
            createdUntil: chunkEnd.toISOString(),
          });

          const reportsUrl = `${baseUrl}/reports/2021-06-30/reports?${params.toString()}`;
          const reportsResponse = await fetch(reportsUrl, {
            headers: { 'x-amz-access-token': authData.access_token, 'Content-Type': 'application/json' },
          });

          if (!reportsResponse.ok) {
            console.error(`[backfill] SP-API error: ${reportsResponse.status}`);
            if (reportsResponse.status === 429) break; // Stop on rate limit
            continue;
          }

          const reportsData = await reportsResponse.json();
          const reports = reportsData.reports || [];
          logger.debug(`[backfill] Chunk ${chunk + 1}: ${reports.length} reports found`);

          // Get settings for parsing
          const { data: settingsData } = await supabase
            .from('app_settings')
            .select('key, value')
            .eq('user_id', userId)
            .in('key', ['accounting_gst_rate', 'accounting_boundary_date']);
          const settingsMap: Record<string, string> = {};
          (settingsData || []).forEach((s: any) => { settingsMap[s.key] = s.value; });
          const gstRate = parseFloat(settingsMap['accounting_gst_rate'] || '10');
          const accountingBoundary = settingsMap['accounting_boundary_date'] || null;

          for (let i = 0; i < reports.length; i++) {
            const report = reports[i];
            if (!report.reportDocumentId) continue;

            // Rate limit delay between downloads
            if (i > 0) await new Promise(r => setTimeout(r, 3000));

            try {
              const content = await downloadReport(baseUrl, authData.access_token, report.reportDocumentId, supabase, userId);
              const parsed = parseSettlementTSV(content, gstRate);

              // Only process if this is one of our missing IDs
              if (!remainingMissing.includes(parsed.header.settlementId)) continue;

              // Check not already ingested
              if (existingSet.has(parsed.header.settlementId)) continue;

              const isBeforeBoundary = accountingBoundary && parsed.header.periodEnd && parsed.header.periodEnd <= accountingBoundary;
              const { header, summary, lines, unmapped, splitMonth } = parsed;

              const { error: settError } = await supabase.from('settlements').upsert({
                user_id: userId,
                settlement_id: header.settlementId,
                marketplace: 'amazon_au',
                period_start: header.periodStart,
                period_end: header.periodEnd,
                deposit_date: header.depositDate,
                sales_principal: summary.salesPrincipal,
                sales_shipping: summary.salesShipping,
                promotional_discounts: summary.promotionalDiscounts,
                seller_fees: summary.sellerFees,
                fba_fees: summary.fbaFees,
                storage_fees: summary.storageFees,
                refunds: summary.refunds,
                reimbursements: summary.reimbursements,
                advertising_costs: summary.advertisingCosts,
                other_fees: summary.otherFees,
                net_ex_gst: summary.netExGst,
                gst_on_income: summary.gstOnIncome,
                gst_on_expenses: summary.gstOnExpenses,
                bank_deposit: summary.bankDeposit,
                reconciliation_status: summary.reconciliationMatch ? 'matched' : 'failed',
                status: 'ingested',
                is_pre_boundary: !!isBeforeBoundary,
                source: 'api',
                is_split_month: splitMonth.isSplitMonth,
                split_month_1_data: splitMonth.month1 ? JSON.stringify(splitMonth.month1) : null,
                split_month_2_data: splitMonth.month2 ? JSON.stringify(splitMonth.month2) : null,
                parser_version: PARSER_VERSION,
              } as any, { onConflict: 'marketplace,settlement_id,user_id', ignoreDuplicates: true });

              if (!settError) {
                foundIds.push(header.settlementId);
                existingSet.add(header.settlementId);
                backfilled++;
                logger.debug(`[backfill] ✓ Found and ingested settlement ${header.settlementId}`);

                // ─── Compute and persist settlement_components ───
                const payoutTotal = round2(summary.bankDeposit);
                const commerceGrossTotal = round2(payoutTotal + Math.abs(summary.gstOnIncome) + summary.gstOnExpenses);
                await supabase.from('settlement_components').upsert({
                  user_id: userId,
                  settlement_id: header.settlementId,
                  marketplace_code: 'amazon_au',
                  currency: 'AUD',
                  period_start: header.periodStart,
                  period_end: header.periodEnd,
                  sales_ex_tax: round2(Math.abs(summary.salesPrincipal) + Math.abs(summary.salesShipping) - Math.abs(summary.gstOnIncome)),
                  sales_tax: round2(Math.abs(summary.gstOnIncome)),
                  fees_ex_tax: round2(-(Math.abs(summary.sellerFees) + Math.abs(summary.fbaFees) - Math.abs(summary.gstOnExpenses))),
                  fees_tax: round2(-Math.abs(summary.gstOnExpenses)),
                  payout_total: payoutTotal,
                  payout_gst_inclusive: commerceGrossTotal,
                  commerce_gross_total: commerceGrossTotal,
                  gst_rate: 10,
                  reconciled: true,
                  source: 'api_backfill',
                } as any, { onConflict: 'user_id,settlement_id,marketplace_code' });

                // Auto-link to pre-cached Xero invoice (ONLY Xettle-created)
                const { data: preMatch } = await supabase
                  .from('xero_accounting_matches')
                  .select('xero_invoice_id, xero_invoice_number, xero_status, matched_reference, match_method')
                  .eq('settlement_id', header.settlementId)
                  .eq('user_id', userId)
                  .maybeSingle();

                if (preMatch?.xero_invoice_id && preMatch.match_method !== 'external_candidate') {
                  const isXettleFormat = (preMatch.matched_reference || '').startsWith('Xettle-');
                  if (isXettleFormat) {
                    let derivedSt = 'pushed_to_xero';
                    if (preMatch.xero_status === 'PAID') derivedSt = 'reconciled_in_xero';

                    await supabase.from('settlements').update({
                      xero_journal_id: preMatch.xero_invoice_id,
                      xero_invoice_id: preMatch.xero_invoice_id,
                      xero_invoice_number: preMatch.xero_invoice_number,
                      xero_status: preMatch.xero_status,
                      status: derivedSt,
                      sync_origin: 'xettle',
                      posted_at: new Date().toISOString(),
                    } as any).eq('settlement_id', header.settlementId).eq('user_id', userId);
                  }
                }

                // Insert settlement lines
                if (lines.length > 0) {
                  await supabase.from('settlement_lines').delete().eq('user_id', userId).eq('settlement_id', header.settlementId);
                  const lineRows = lines.map((l: any) => ({
                    user_id: userId, settlement_id: header.settlementId,
                    transaction_type: l.transactionType, amount_type: l.amountType,
                    amount_description: l.amountDescription, accounting_category: l.accountingCategory,
                    amount: l.amount, order_id: l.orderId || null, sku: l.sku || null,
                    posted_date: l.postedDate || null, marketplace_name: l.marketplaceName || null,
                  }));
                  for (let j = 0; j < lineRows.length; j += 500) {
                    await supabase.from('settlement_lines').insert(lineRows.slice(j, j + 500));
                  }
                }
              }
            } catch (dlErr: any) {
              if (dlErr.message?.includes('RATE_LIMITED')) {
                logger.warn('[backfill] Rate limited — stopping');
                break;
              }
              console.error(`[backfill] Download error: ${dlErr.message}`);
            }
          }
        } catch (chunkErr: any) {
          console.error(`[backfill] Chunk ${chunk + 1} error: ${chunkErr.message}`);
        }

        // Brief pause between chunks to avoid rate limits
        if (chunk < MAX_CHUNKS - 1) await new Promise(r => setTimeout(r, 2000));
      }

      // Log the backfill event
      await supabase.from('sync_history').insert({
        user_id: userId,
        event_type: 'amazon_backfill',
        status: backfilled > 0 ? 'success' : 'no_match',
        settlements_affected: backfilled,
        details: { requested: stillMissing, found: foundIds, chunks_searched: Math.min(MAX_CHUNKS, stillMissing.length > 0 ? MAX_CHUNKS : 1) },
      } as any);

      return new Response(JSON.stringify({
        success: true,
        backfilled,
        found_ids: foundIds,
        still_missing: stillMissing.filter(id => !foundIds.includes(id)),
        message: backfilled > 0
          ? `Found and imported ${backfilled} missing settlement${backfilled > 1 ? 's' : ''}`
          : 'Settlement reports not found in Amazon API — they may be older than 270 days',
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // First, get a fresh access token via the amazon-auth function
    const { data: authData, error: tokenError } = await supabase.functions.invoke('amazon-auth', {
      headers: { 'x-action': 'refresh' },
    })

    if (tokenError || !authData?.access_token) {
      return new Response(JSON.stringify({
        error: 'Failed to get Amazon access token. Please reconnect your Amazon account.',
        details: authData?.error || tokenError?.message,
      }), { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    const { access_token, selling_partner_id, marketplace_id, region } = authData
    const baseUrl = SP_API_ENDPOINTS[region] || SP_API_ENDPOINTS.fe

    // ─── LIST: Get available settlement reports ──────────────────
    if (action === 'list') {
      const body = await req.json().catch(() => ({}))
      const { startDate, endDate } = body as { startDate?: string; endDate?: string }

      const params = new URLSearchParams({
        reportTypes: 'GET_V2_SETTLEMENT_REPORT_DATA_FLAT_FILE_V2',
        processingStatuses: 'DONE',
        pageSize: '50',
      })

      if (startDate) params.set('createdSince', new Date(startDate).toISOString())
      if (endDate) params.set('createdUntil', new Date(endDate).toISOString())

      const reportsUrl = `${baseUrl}/reports/2021-06-30/reports?${params.toString()}`
      const reportsResponse = await fetch(reportsUrl, {
        headers: { 'x-amz-access-token': access_token, 'Content-Type': 'application/json' },
      })

      if (!reportsResponse.ok) {
        const errBody = await reportsResponse.text()
        return new Response(JSON.stringify({ error: `SP-API error: ${reportsResponse.status}`, details: errBody }), {
          status: reportsResponse.status, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const reportsData = await reportsResponse.json()
      return new Response(JSON.stringify({ reports: reportsData.reports || [], nextToken: reportsData.nextToken || null }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    // ─── DOWNLOAD: Fetch a specific settlement report ────────────
    if (action === 'download') {
      const body = await req.json()
      const { reportDocumentId } = body

      if (!reportDocumentId) {
        return new Response(JSON.stringify({ error: 'Missing reportDocumentId' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        })
      }

      const content = await downloadReport(baseUrl, access_token, reportDocumentId);

      return new Response(JSON.stringify({ content, reportDocumentId }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      })
    }

    return new Response(JSON.stringify({ error: 'Unknown action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  } catch (err) {
    console.error('fetch-amazon-settlements error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    })
  }
})
