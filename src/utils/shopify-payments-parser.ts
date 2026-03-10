/**
 * Shopify Payments Transaction-Level CSV Parser
 * 
 * Parses Shopify's "payment_transactions_export" CSV where each row is a
 * transaction (charge, refund, etc.) grouped by Payout ID.
 * 
 * Expected columns:
 *   Transaction Date, Type, Order, Card Brand, Card Source, Payout Status,
 *   Payout Date, Payout ID, Available On, Amount, Fee, Net, Currency, GST
 * 
 * Grouping: rows are aggregated by Payout ID → one StandardSettlement per payout.
 * 
 * Mapping:
 *   settlement_id  = Payout ID
 *   period_start   = earliest Transaction Date in that payout
 *   period_end     = latest Transaction Date in that payout
 *   gross_sales    = sum(Amount) for charges
 *   refunds        = sum(Amount) for refunds (stored negative)
 *   fees           = sum(Fee) across all rows (stored negative)
 *   bank_deposit   = sum(Net) — reconciliation target
 *   GST            = sum(GST column) if present
 */

import type { StandardSettlement } from './settlement-engine';
import { parseDateOrEmpty } from './date-parser';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ShopifyTransactionRow {
  transactionDate: string;  // raw date string
  type: string;             // 'charge', 'refund', 'adjustment', 'payout', etc.
  order: string;
  payoutStatus: string;
  payoutDate: string;
  payoutId: string;
  amount: number;
  fee: number;
  net: number;
  currency: string;
  gst: number;
}

export interface ShopifyPayoutGroup {
  payoutId: string;
  payoutDate: string;
  transactionDates: string[];
  charges: number;        // sum of Amount for type=charge (positive)
  refunds: number;        // sum of Amount for type=refund (negative)
  fees: number;           // sum of Fee (negative)
  gstTotal: number;       // sum of GST column
  netTotal: number;       // sum of Net = bank deposit
  adjustments: number;    // sum of Amount for other types
  rowCount: number;
  currency: string;
}

export interface ShopifyParseExtra {
  rowCount: number;
  currency: string;
  rawHeaders: string[];
  adjustments: number;
  payoutCount: number;
}

export type ShopifyParseResult =
  | { success: true; settlements: StandardSettlement[]; extra: ShopifyParseExtra; rawRows?: ShopifyTransactionRow[]; rowsByPayout?: Map<string, ShopifyTransactionRow[]> }
  | { success: false; error: string };

// Keep single-settlement type for backward compat
export type ShopifyParseSingleResult =
  | { success: true; settlement: StandardSettlement; extra: ShopifyParseExtra }
  | { success: false; error: string };

// ─── Helpers ────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** @deprecated Use parseDateOrEmpty from date-parser.ts */
const normaliseDate = parseDateOrEmpty;

function parseAmount(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^0-9.\-,]/g, '').replace(/,/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

// ─── Column Matching — Transaction-Level ────────────────────────────────────

interface ColumnMap {
  transactionDate: number;
  type: number;
  order: number;
  payoutStatus: number;
  payoutDate: number;
  payoutId: number;
  amount: number;
  fee: number;
  net: number;
  currency: number;
  gst: number;
}

const COLUMN_PATTERNS: Record<keyof ColumnMap, RegExp[]> = {
  transactionDate: [/^transaction\s*date$/i, /^date$/i, /^trans.*date/i],
  type:            [/^type$/i],
  order:           [/^order$/i, /^order\s*#/i, /^order\s*id/i],
  payoutStatus:    [/^payout\s*status$/i],
  payoutDate:      [/^payout\s*date$/i],
  payoutId:        [/^payout\s*id$/i, /^payout\s*#/i],
  amount:          [/^amount$/i],
  fee:             [/^fee$/i, /^fees$/i],
  net:             [/^net$/i],
  currency:        [/^currency$/i],
  gst:             [/^gst$/i, /^tax$/i],
};

function matchColumns(headers: string[]): ColumnMap | null {
  const lower = headers.map(h => h.toLowerCase().trim());
  const map: Partial<ColumnMap> = {};

  for (const [key, patterns] of Object.entries(COLUMN_PATTERNS)) {
    for (const pattern of patterns) {
      const idx = lower.findIndex(h => pattern.test(h));
      if (idx !== -1 && !(key in map)) {
        map[key as keyof ColumnMap] = idx;
        break;
      }
    }
  }

  // Require minimum: payoutId, amount, net
  if (map.payoutId === undefined || map.amount === undefined || map.net === undefined) {
    return null;
  }

  return {
    transactionDate: map.transactionDate ?? -1,
    type:            map.type ?? -1,
    order:           map.order ?? -1,
    payoutStatus:    map.payoutStatus ?? -1,
    payoutDate:      map.payoutDate ?? -1,
    payoutId:        map.payoutId!,
    amount:          map.amount!,
    fee:             map.fee ?? -1,
    net:             map.net!,
    currency:        map.currency ?? -1,
    gst:             map.gst ?? -1,
  };
}

// ─── Column Matching — Payout-Level ─────────────────────────────────────────

interface PayoutLevelColumnMap {
  payoutDate: number;
  status: number;
  charges: number;
  refunds: number;
  adjustments: number;
  fees: number;
  total: number;
  currency: number;
  bankReference: number;
  reservedFunds: number;
  advances: number;
  retriedAmount: number;
  marketplaceSalesTax: number;
}

const PAYOUT_LEVEL_PATTERNS: Record<keyof PayoutLevelColumnMap, RegExp[]> = {
  payoutDate:         [/^payout\s*date$/i],
  status:             [/^status$/i],
  charges:            [/^charges$/i, /^gross\s*sales$/i],
  refunds:            [/^refunds$/i],
  adjustments:        [/^adjustments$/i],
  fees:               [/^fees$/i],
  total:              [/^total$/i, /^net\s*payout$/i],
  currency:           [/^currency$/i],
  bankReference:      [/^bank\s*reference$/i, /^bank\s*ref$/i],
  reservedFunds:      [/^reserved\s*funds$/i],
  advances:           [/^advances$/i],
  retriedAmount:      [/^retried\s*amount$/i],
  marketplaceSalesTax:[/^marketplace\s*sales\s*tax$/i],
};

function matchPayoutLevelColumns(headers: string[]): PayoutLevelColumnMap | null {
  const lower = headers.map(h => h.toLowerCase().trim());
  const map: Partial<PayoutLevelColumnMap> = {};

  for (const [key, patterns] of Object.entries(PAYOUT_LEVEL_PATTERNS)) {
    for (const pattern of patterns) {
      const idx = lower.findIndex(h => pattern.test(h));
      if (idx !== -1 && !(key in map)) {
        map[key as keyof PayoutLevelColumnMap] = idx;
        break;
      }
    }
  }

  // Require minimum: charges, total (or fees)
  if (map.charges === undefined || map.total === undefined) {
    return null;
  }

  return {
    payoutDate:          map.payoutDate ?? -1,
    status:              map.status ?? -1,
    charges:             map.charges!,
    refunds:             map.refunds ?? -1,
    adjustments:         map.adjustments ?? -1,
    fees:                map.fees ?? -1,
    total:               map.total!,
    currency:            map.currency ?? -1,
    bankReference:       map.bankReference ?? -1,
    reservedFunds:       map.reservedFunds ?? -1,
    advances:            map.advances ?? -1,
    retriedAmount:       map.retriedAmount ?? -1,
    marketplaceSalesTax: map.marketplaceSalesTax ?? -1,
  };
}

/** Detect CSV format: 'payout_level' (one row per payout) or 'transaction_level' */
function detectFormat(headers: string[]): 'payout_level' | 'transaction_level' {
  const lower = headers.map(h => h.toLowerCase().trim());
  // Payout-level has "Charges" and "Total" columns without "Payout ID"
  const hasCharges = lower.some(h => /^charges$/i.test(h));
  const hasTotal = lower.some(h => /^total$/i.test(h));
  const hasBankRef = lower.some(h => /bank\s*reference/i.test(h));
  const hasPayoutId = lower.some(h => /payout\s*id/i.test(h));

  if ((hasCharges && hasTotal) || hasBankRef) {
    if (!hasPayoutId) return 'payout_level';
  }
  return 'transaction_level';
}

// ─── CSV Row Parser ─────────────────────────────────────────────────────────

function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

// ─── Main Parser ────────────────────────────────────────────────────────────

/**
 * Parse a Shopify Payments CSV — auto-detects format:
 *   1. Payout-level (payouts_export): one row per payout with Charges/Refunds/Fees/Total
 *   2. Transaction-level (payment_transactions_export): one row per transaction, grouped by Payout ID
 */
export function parseShopifyPayoutCSV(csvContent: string): ShopifyParseResult {
  try {
    const lines = csvContent.split('\n').filter(l => l.trim().length > 0);
    if (lines.length < 2) {
      return { success: false, error: 'CSV must have at least a header row and one data row.' };
    }

    const headers = parseCSVRow(lines[0]);
    const format = detectFormat(headers);

    if (format === 'payout_level') {
      return parsePayoutLevelCSV(headers, lines);
    } else {
      return parseTransactionLevelCSV(headers, lines);
    }
  } catch (err: any) {
    return { success: false, error: `CSV parsing failed: ${err.message || 'Unknown error'}` };
  }
}

// ─── Payout-Level Parser ────────────────────────────────────────────────────

function parsePayoutLevelCSV(headers: string[], lines: string[]): ShopifyParseResult {
  const colMap = matchPayoutLevelColumns(headers);
  if (!colMap) {
    return {
      success: false,
      error: `Could not identify required columns. Found: ${headers.join(', ')}. Need: Charges, Total.`,
    };
  }

  const settlements: StandardSettlement[] = [];

  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVRow(lines[i]);
    if (fields.length < 3) continue;

    const payoutDate = colMap.payoutDate >= 0 ? normaliseDate(fields[colMap.payoutDate]?.trim() || '') : '';
    if (!payoutDate) continue;

    const charges     = colMap.charges >= 0 ? parseAmount(fields[colMap.charges] || '') : 0;
    const refundsRaw  = colMap.refunds >= 0 ? parseAmount(fields[colMap.refunds] || '') : 0;
    const adjustments = colMap.adjustments >= 0 ? parseAmount(fields[colMap.adjustments] || '') : 0;
    const feesRaw     = colMap.fees >= 0 ? parseAmount(fields[colMap.fees] || '') : 0;
    const total       = parseAmount(fields[colMap.total] || '');
    const currency    = colMap.currency >= 0 ? fields[colMap.currency]?.trim().toUpperCase() || 'AUD' : 'AUD';
    const bankRef     = colMap.bankReference >= 0 ? fields[colMap.bankReference]?.trim() || '' : '';
    const reservedFunds = colMap.reservedFunds >= 0 ? parseAmount(fields[colMap.reservedFunds] || '') : 0;
    const advances    = colMap.advances >= 0 ? parseAmount(fields[colMap.advances] || '') : 0;
    const retriedAmt  = colMap.retriedAmount >= 0 ? parseAmount(fields[colMap.retriedAmount] || '') : 0;

    // Use Bank Reference as settlement_id (unique per payout), fallback to date
    const settlementId = bankRef || `shopify-payout-${payoutDate}`;

    // Normalise signs
    const grossSales = Math.abs(charges);
    const refunds = refundsRaw > 0 ? -refundsRaw : refundsRaw;  // ensure negative
    const fees = feesRaw > 0 ? -feesRaw : feesRaw;              // ensure negative
    const bankDeposit = round2(total);

    // All other amounts that affect the total
    const otherAdjustments = round2(adjustments + reservedFunds + advances + retriedAmt);

    // GST (AU 10% = 1/11th of inclusive)
    const GST_DIVISOR = 11;
    const gstOnSales = round2(grossSales / GST_DIVISOR);
    const salesExGst = round2(grossSales - gstOnSales);
    const feesExGst = round2(fees - (fees / GST_DIVISOR));
    const gstOnFees = round2(Math.abs(fees / GST_DIVISOR));

    // Reconciliation: charges + refunds + adjustments + fees = total
    const calculatedNet = round2(grossSales + refunds + fees + otherAdjustments);
    const reconciles = Math.abs(calculatedNet - bankDeposit) <= 0.05;

    // For payout-level, period_start = period_end = payout date
    settlements.push({
      marketplace: 'shopify_payments',
      settlement_id: settlementId,
      period_start: payoutDate,
      period_end: payoutDate,
      sales_ex_gst: salesExGst,
      gst_on_sales: gstOnSales,
      fees_ex_gst: feesExGst,
      gst_on_fees: gstOnFees,
      net_payout: bankDeposit,
      source: 'csv_upload',
      reconciles,
      metadata: {
        grossSalesInclGst: grossSales,
        refundsInclGst: refunds,
        refundsExGst: round2(refunds - (refunds / GST_DIVISOR)),
        chargesInclGst: fees,
        adjustments: otherAdjustments,
        calculatedNet,
        reconciliationDiff: round2(calculatedNet - bankDeposit),
        payoutDate,
        bankReference: bankRef,
        transactionCount: 1,
        currency,
        csvFormat: 'payout_level',
      },
    });
  }

  if (settlements.length === 0) {
    return { success: false, error: 'No valid payout rows found in CSV.' };
  }

  // Sort by payout date descending
  settlements.sort((a, b) => (b.period_end || '').localeCompare(a.period_end || ''));

  return {
    success: true,
    settlements,
    extra: {
      rowCount: settlements.length,
      currency: settlements[0]?.metadata?.currency || 'AUD',
      rawHeaders: headers,
      adjustments: 0,
      payoutCount: settlements.length,
    },
  };
}

// ─── Transaction-Level Parser ───────────────────────────────────────────────

function parseTransactionLevelCSV(headers: string[], lines: string[]): ShopifyParseResult {
  const colMap = matchColumns(headers);
  if (!colMap) {
    return {
      success: false,
      error: `Could not identify required columns. Found: ${headers.join(', ')}. Need: Payout ID, Amount, Net.`,
    };
  }

  // Parse all rows
  const rows: ShopifyTransactionRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const fields = parseCSVRow(lines[i]);
    if (fields.length < 3) continue;

    const payoutId = colMap.payoutId >= 0 ? fields[colMap.payoutId]?.trim() : '';
    if (!payoutId) continue;

    rows.push({
      transactionDate: colMap.transactionDate >= 0 ? fields[colMap.transactionDate]?.trim() || '' : '',
      type:            colMap.type >= 0 ? fields[colMap.type]?.trim().toLowerCase() || '' : '',
      order:           colMap.order >= 0 ? fields[colMap.order]?.trim() || '' : '',
      payoutStatus:    colMap.payoutStatus >= 0 ? fields[colMap.payoutStatus]?.trim() || '' : '',
      payoutDate:      colMap.payoutDate >= 0 ? fields[colMap.payoutDate]?.trim() || '' : '',
      payoutId,
      amount:          colMap.amount >= 0 ? parseAmount(fields[colMap.amount] || '') : 0,
      fee:             colMap.fee >= 0 ? parseAmount(fields[colMap.fee] || '') : 0,
      net:             colMap.net >= 0 ? parseAmount(fields[colMap.net] || '') : 0,
      currency:        colMap.currency >= 0 ? fields[colMap.currency]?.trim().toUpperCase() || 'AUD' : 'AUD',
      gst:             colMap.gst >= 0 ? parseAmount(fields[colMap.gst] || '') : 0,
    });
  }

  if (rows.length === 0) {
    return { success: false, error: 'No valid transaction rows found in CSV.' };
  }

  // ── Group by Payout ID ──
  const groups = new Map<string, ShopifyPayoutGroup>();
  for (const row of rows) {
    let group = groups.get(row.payoutId);
    if (!group) {
      group = {
        payoutId: row.payoutId,
        payoutDate: row.payoutDate,
        transactionDates: [],
        charges: 0,
        refunds: 0,
        fees: 0,
        gstTotal: 0,
        netTotal: 0,
        adjustments: 0,
        rowCount: 0,
        currency: row.currency || 'AUD',
      };
      groups.set(row.payoutId, group);
    }

    group.rowCount++;
    if (row.transactionDate) {
      group.transactionDates.push(normaliseDate(row.transactionDate));
    }

    const type = row.type;
    if (type === 'charge' || type === 'sale' || type === '') {
      group.charges += row.amount;
    } else if (type === 'refund' || type === 'return') {
      group.refunds += row.amount;
    } else if (type === 'adjustment' || type === 'chargeback' || type === 'reserve') {
      group.adjustments += row.amount;
    } else {
      group.adjustments += row.amount;
    }

    group.fees += row.fee;
    group.netTotal += row.net;
    group.gstTotal += row.gst;
  }

  // ── Convert each group to StandardSettlement ──
  const settlements: StandardSettlement[] = [];

  for (const group of groups.values()) {
    const sortedDates = group.transactionDates.filter(d => d).sort();
    const periodStart = sortedDates[0] || normaliseDate(group.payoutDate) || new Date().toISOString().substring(0, 10);
    const periodEnd = sortedDates[sortedDates.length - 1] || periodStart;

    const grossSales = Math.abs(group.charges);
    const refunds = group.refunds > 0 ? -group.refunds : group.refunds;
    const fees = group.fees > 0 ? -group.fees : group.fees;
    const adjustments = group.adjustments;
    const bankDeposit = round2(group.netTotal);

    const GST_DIVISOR = 11;
    const hasGstColumn = group.gstTotal !== 0;
    const gstOnSales = hasGstColumn
      ? round2(Math.abs(group.gstTotal))
      : round2(grossSales / GST_DIVISOR);
    const salesExGst = round2(grossSales - gstOnSales);

    const feesInclGst = fees;
    const feesExGst = round2(feesInclGst - (feesInclGst / GST_DIVISOR));
    const gstOnFees = round2(Math.abs(feesInclGst / GST_DIVISOR));

    const calculatedNet = round2(grossSales + refunds + fees + adjustments);
    const reconciles = Math.abs(calculatedNet - bankDeposit) <= 0.05;

    settlements.push({
      marketplace: 'shopify_payments',
      settlement_id: group.payoutId,
      period_start: periodStart,
      period_end: periodEnd,
      sales_ex_gst: salesExGst,
      gst_on_sales: gstOnSales,
      fees_ex_gst: feesExGst,
      gst_on_fees: gstOnFees,
      net_payout: bankDeposit,
      source: 'csv_upload',
      reconciles,
      metadata: {
        grossSalesInclGst: grossSales,
        refundsInclGst: refunds,
        refundsExGst: round2(refunds - (refunds / GST_DIVISOR)),
        chargesInclGst: fees,
        adjustments,
        calculatedNet,
        reconciliationDiff: round2(calculatedNet - bankDeposit),
        payoutDate: normaliseDate(group.payoutDate),
        transactionCount: group.rowCount,
        currency: group.currency,
        csvFormat: 'transaction_level',
      },
    });
  }

  settlements.sort((a, b) => (b.metadata?.payoutDate || '').localeCompare(a.metadata?.payoutDate || ''));

  // Build per-payout row mapping for settlement_lines saving
  const rowsByPayout = new Map<string, ShopifyTransactionRow[]>();
  for (const row of rows) {
    if (!rowsByPayout.has(row.payoutId)) rowsByPayout.set(row.payoutId, []);
    rowsByPayout.get(row.payoutId)!.push(row);
  }

  return {
    success: true,
    settlements,
    rawRows: rows,
    rowsByPayout,
    extra: {
      rowCount: rows.length,
      currency: rows[0]?.currency || 'AUD',
      rawHeaders: headers,
      adjustments: 0,
      payoutCount: settlements.length,
    },
  };
}

// ─── Xero Invoice Line Builder ──────────────────────────────────────────────

/**
 * Build Xero invoice lines for a Shopify Payments settlement.
 * 
 * Account mapping:
 *   Sales:   200 (GST on Income)
 *   Refunds: 200 (GST on Income, negative amount)
 *   Fees:    404 Shopify Fees (GST on Expenses)
 */
export function buildShopifyInvoiceLines(settlement: StandardSettlement) {
  const meta = settlement.metadata || {};
  const lines: Array<{
    Description: string;
    AccountCode: string;
    TaxType: string;
    UnitAmount: number;
    Quantity: number;
  }> = [];

  // Sales (ex GST, positive)
  lines.push({
    Description: 'Shopify Sales',
    AccountCode: '200',
    TaxType: 'OUTPUT',
    UnitAmount: round2(settlement.sales_ex_gst),
    Quantity: 1,
  });

  // Refunds (ex GST, negative)
  if (meta.refundsExGst && meta.refundsExGst !== 0) {
    lines.push({
      Description: 'Customer Refunds',
      AccountCode: '200',
      TaxType: 'OUTPUT',
      UnitAmount: round2(meta.refundsExGst < 0 ? meta.refundsExGst : -meta.refundsExGst),
      Quantity: 1,
    });
  }

  // Fees (ex GST, negative) — Account 404 Shopify Fees
  lines.push({
    Description: 'Shopify Fees',
    AccountCode: '404',
    TaxType: 'INPUT',
    UnitAmount: round2(settlement.fees_ex_gst),
    Quantity: 1,
  });

  // Adjustments if present
  if (meta.adjustments && meta.adjustments !== 0) {
    lines.push({
      Description: 'Payout Adjustments',
      AccountCode: '200',
      TaxType: 'OUTPUT',
      UnitAmount: round2(meta.adjustments / 1.1),
      Quantity: 1,
    });
  }

  return lines;
}
