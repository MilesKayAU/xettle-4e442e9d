import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-action, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
}

const SP_API_ENDPOINTS: Record<string, string> = {
  na: 'https://sellingpartnerapi-na.amazon.com',
  eu: 'https://sellingpartnerapi-eu.amazon.com',
  fe: 'https://sellingpartnerapi-fe.amazon.com',
}

// ═══════════════════════════════════════════════════════════════
// EMBEDDED SETTLEMENT PARSER (mirrors src/utils/settlement-parser.ts)
// ═══════════════════════════════════════════════════════════════

const PARSER_VERSION = 'v1.7.0';

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
  'FBA Fees': -1, 'Storage Fees': -1, 'Refunds': -1,
  'Reimbursements': 1, 'Tax Collected by Amazon': 1,
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
  const gstDivisor = 1 + (100 / gstRate);
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
  const refunds = normaliseAggregate(round2(totals['Refunds'] || 0), 'Refunds');
  const reimbursements = normaliseAggregate(round2(totals['Reimbursements'] || 0), 'Reimbursements');
  const taxCollectedByAmazon = round2(totals['Tax Collected by Amazon'] || 0);
  const unmappedTotal = round2(unmapped.reduce((s: number, u: any) => s + u.amount, 0));

  const grossTotal = round2(totalSales + promotionalDiscounts + sellerFees + fbaFees + storageFees + refunds + reimbursements + taxCollectedByAmazon + unmappedTotal);
  const auIncome = round2(auSalesGstBaseTotal);
  const expenseTotal = round2(sellerFees + fbaFees + storageFees);
  const gstOnIncome = round2(auIncome / gstDivisor);
  const gstOnExpenses = round2(expenseTotal / gstDivisor);
  const netExGst = round2(grossTotal - gstOnIncome - gstOnExpenses);
  const reconciliationDiff = round2(header.totalAmount - grossTotal);
  const reconciliationMatch = Math.abs(reconciliationDiff) < 0.01;

  const summary = {
    salesPrincipal: round2(salesPrincipal), salesShipping: round2(salesShipping), totalSales,
    promotionalDiscounts, sellerFees, fbaFees, storageFees, refunds, reimbursements,
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
    let sp = 0, ss = 0, pd = 0, sf = 0, ff = 0, stf = 0, ref = 0, reim = 0, oth = 0;
    for (const line of monthLines) {
      const cat = line.accountingCategory, amt = line.amount;
      if (cat === 'Sales' && line.amountDescription === 'Principal') sp += amt;
      else if (cat === 'Sales' && line.amountDescription === 'Shipping') ss += amt;
      else if (cat === 'Sales') sp += amt;
      else if (cat === 'Promotional Discounts') pd += amt;
      else if (cat === 'Seller Fees') sf += amt;
      else if (cat === 'FBA Fees') ff += amt;
      else if (cat === 'Storage Fees') stf += amt;
      else if (cat === 'Refunds') ref += amt;
      else if (cat === 'Reimbursements') reim += amt;
      else oth += amt;
    }
    const ts = round2(sp + ss), gross = round2(ts + pd + sf + ff + stf + ref + reim + oth);
    const expTotal = round2(sf + ff + stf);
    const gstInc = round2(round2(sp + ss) / gstDivisor), gstExp = round2(expTotal / gstDivisor);
    const net = round2(gross - gstInc - gstExp);
    return { salesPrincipal: round2(sp), salesShipping: round2(ss), totalSales: ts, promotionalDiscounts: round2(pd), sellerFees: round2(sf), fbaFees: round2(ff), storageFees: round2(stf), refunds: round2(ref), reimbursements: round2(reim), otherFees: round2(oth), grossTotal: gross, netExGst: net, gstOnIncome: gstInc, gstOnExpenses: gstExp };
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
async function downloadReport(baseUrl: string, accessToken: string, reportDocumentId: string): Promise<string> {
  const docUrl = `${baseUrl}/reports/2021-06-30/documents/${reportDocumentId}`;
  let docResponse: Response | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) {
      const delay = Math.min(2000 * Math.pow(2, attempt), 30000);
      console.log(`Rate limited, retrying in ${delay}ms (attempt ${attempt + 1})`);
      await new Promise(r => setTimeout(r, delay));
    }
    docResponse = await fetch(docUrl, { headers: { 'x-amz-access-token': accessToken } });
    if (docResponse.status !== 429) break;
    console.warn('SP-API 429 rate limited');
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
async function handleSync(supabaseAdmin: any): Promise<{ users: number; imported: number; skipped: number; errors: number; details: string[] }> {
  const details: string[] = [];
  let totalImported = 0, totalSkipped = 0, totalErrors = 0;

  const { data: amazonTokens, error: tokensError } = await supabaseAdmin
    .from('amazon_tokens')
    .select('*');

  if (tokensError || !amazonTokens?.length) {
    details.push(`No Amazon tokens found: ${tokensError?.message || 'none'}`);
    return { users: 0, imported: 0, skipped: 0, errors: 0, details };
  }

  console.log(`[Sync] Processing ${amazonTokens.length} user(s) with Amazon tokens`);

  for (const amazonToken of amazonTokens) {
    const userId = amazonToken.user_id;
    const region = amazonToken.region || 'fe';
    const baseUrl = SP_API_ENDPOINTS[region] || SP_API_ENDPOINTS.fe;

    try {
      const accessToken = await refreshAccessToken(amazonToken);
      console.log(`[Sync] Got access token for user ${userId}`);

      const { data: settingsData } = await supabaseAdmin
        .from('app_settings')
        .select('key, value')
        .eq('user_id', userId)
        .in('key', ['accounting_gst_rate', 'sync_cutoff_date']);

      const settingsMap: Record<string, string> = {};
      (settingsData || []).forEach((s: any) => { settingsMap[s.key] = s.value; });
      const gstRate = parseFloat(settingsMap['accounting_gst_rate'] || '10');
      const syncCutoffDate = settingsMap['sync_cutoff_date'] || null;

      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 90);
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

        if (i > 0) await new Promise(r => setTimeout(r, 3000));

        try {
          const content = await downloadReport(baseUrl, accessToken, report.reportDocumentId);
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

          const isBeforeCutoff = syncCutoffDate && parsed.header.periodEnd && parsed.header.periodEnd <= syncCutoffDate;
          const { header, summary, lines, unmapped, splitMonth } = parsed;

          const { error: settError } = await supabaseAdmin.from('settlements').insert({
            user_id: userId,
            settlement_id: header.settlementId,
            marketplace: 'amazon_au',
            period_start: header.periodStart,
            period_end: header.periodEnd,
            deposit_date: header.depositDate,
            sales_principal: summary.salesPrincipal,
            sales_shipping: summary.salesShipping,
            promotional_discounts: summary.promotionalDiscounts,
            seller_fees: Math.abs(summary.sellerFees),
            fba_fees: summary.fbaFees,
            storage_fees: summary.storageFees,
            refunds: summary.refunds,
            reimbursements: summary.reimbursements,
            other_fees: summary.otherFees,
            net_ex_gst: summary.netExGst,
            gst_on_income: summary.gstOnIncome,
            gst_on_expenses: summary.gstOnExpenses,
            bank_deposit: summary.bankDeposit,
            reconciliation_status: summary.reconciliationMatch ? 'matched' : 'failed',
            status: isBeforeCutoff ? 'synced_external' : 'saved',
            source: 'api',
            is_split_month: splitMonth.isSplitMonth,
            split_month_1_data: splitMonth.month1 ? JSON.stringify(splitMonth.month1) : null,
            split_month_2_data: splitMonth.month2 ? JSON.stringify(splitMonth.month2) : null,
            parser_version: PARSER_VERSION,
          });

          if (settError) {
            userErrors++;
            continue;
          }

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
    } catch (userErr: any) {
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
async function handleSmartSync(supabase: any, userId: string): Promise<Response> {
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
          message: `Last sync was ${Math.round((Date.now() - lastSync.getTime()) / 60000)} minutes ago. Please wait at least 1 hour between syncs.`,
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

  // ─── List settlement reports (last 90 days) ────────────────────
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 90);
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

  for (let i = 0; i < sorted.length; i++) {
    const report = sorted[i];
    if (!report.reportDocumentId) continue;

    // Rate-limit delay
    if (i > 0) await new Promise(r => setTimeout(r, 3000));

    try {
      const content = await downloadReport(baseUrl, accessToken, report.reportDocumentId);
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

      // Determine status based on accounting boundary
      const isBeforeBoundary = accountingBoundary && parsed.header.periodEnd && parsed.header.periodEnd <= accountingBoundary;
      const settlementStatus = isBeforeBoundary ? 'already_recorded' : 'ready_to_push';

      const { header, summary, lines, unmapped, splitMonth } = parsed;

      // Insert settlement
      const { error: settError } = await supabase.from('settlements').insert({
        user_id: userId,
        settlement_id: header.settlementId,
        marketplace: 'amazon_au',
        period_start: header.periodStart,
        period_end: header.periodEnd,
        deposit_date: header.depositDate,
        sales_principal: summary.salesPrincipal,
        sales_shipping: summary.salesShipping,
        promotional_discounts: summary.promotionalDiscounts,
        seller_fees: Math.abs(summary.sellerFees),
        fba_fees: summary.fbaFees,
        storage_fees: summary.storageFees,
        refunds: summary.refunds,
        reimbursements: summary.reimbursements,
        other_fees: summary.otherFees,
        net_ex_gst: summary.netExGst,
        gst_on_income: summary.gstOnIncome,
        gst_on_expenses: summary.gstOnExpenses,
        bank_deposit: summary.bankDeposit,
        reconciliation_status: summary.reconciliationMatch ? 'matched' : 'failed',
        status: settlementStatus,
        source: 'api',
        is_split_month: splitMonth.isSplitMonth,
        split_month_1_data: splitMonth.month1 ? JSON.stringify(splitMonth.month1) : null,
        split_month_2_data: splitMonth.month2 ? JSON.stringify(splitMonth.month2) : null,
        parser_version: PARSER_VERSION,
      } as any);

      if (settError) {
        // Handle unique constraint violation gracefully
        if (settError.code === '23505') {
          continue; // Already exists — skip
        }
        errors.push(`Settlement ${header.settlementId}: ${settError.message}`);
        continue;
      }

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
        .eq('marketplace_code', 'amazon_au')
        .eq('period_start', monthStart)
        .maybeSingle();

      if (existingVal) {
        await supabase
          .from('marketplace_validation')
          .update({
            settlement_uploaded: true,
            settlement_uploaded_at: new Date().toISOString(),
            settlement_id: header.settlementId,
            settlement_net: (existingVal.settlement_net || 0) + summary.bankDeposit,
            overall_status: isBeforeBoundary ? 'already_recorded' : 'ready_to_push',
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
          settlement_net: summary.bankDeposit,
          overall_status: isBeforeBoundary ? 'already_recorded' : 'ready_to_push',
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
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const action = req.headers.get('x-action') || 'list';

    // ─── SYNC: Server-side full sync (cron) ──────────────────────
    if (action === 'sync') {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

      const result = await handleSync(supabaseAdmin);
      console.log(`[Sync Complete]`, result);

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

    const token = authHeader.replace('Bearer ', '')
    const { data: claimsData, error: claimsError } = await supabase.auth.getClaims(token)
    if (claimsError || !claimsData?.claims) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: corsHeaders })
    }
    const userId = claimsData.claims.sub as string

    // ─── SMART-SYNC: User-triggered smart sync ──────────────────
    if (action === 'smart-sync') {
      return await handleSmartSync(supabase, userId);
    }

    // First, get a fresh access token via the amazon-auth function
    const { data: authData, error: authError } = await supabase.functions.invoke('amazon-auth', {
      headers: { 'x-action': 'refresh' },
    })

    if (authError || !authData?.access_token) {
      return new Response(JSON.stringify({
        error: 'Failed to get Amazon access token. Please reconnect your Amazon account.',
        details: authData?.error || authError?.message,
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
