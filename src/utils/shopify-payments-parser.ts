/**
 * Shopify Payments Payout CSV Parser
 * 
 * Parses Shopify Payments payout export CSVs into StandardSettlement format.
 * 
 * Expected columns (Shopify Payments → Payouts → Export):
 *   Payout ID, Payout Date, Gross, Refunds, Charges (fees), Adjustments, Net
 * 
 * Column names may vary slightly; we match flexibly.
 */

import type { StandardSettlement } from './settlement-engine';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ShopifyPayoutRow {
  payoutId: string;
  payoutDate: string;       // YYYY-MM-DD
  gross: number;            // Positive
  refunds: number;          // Negative (money returned)
  charges: number;          // Negative (Shopify fees)
  adjustments: number;      // +/- adjustments
  net: number;              // Bank deposit
}

export interface ShopifyParseExtra {
  rowCount: number;
  currency: string;
  rawHeaders: string[];
  adjustments: number;
}

export type ShopifyParseResult =
  | { success: true; settlement: StandardSettlement; extra: ShopifyParseExtra }
  | { success: false; error: string };

// ─── Helpers ────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Parse a date that might be DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, or ISO.
 * Returns YYYY-MM-DD.
 */
function normaliseDate(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();

  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.substring(0, 10);
  }

  // DD/MM/YYYY or MM/DD/YYYY — assume DD/MM for AU locale
  const slashParts = trimmed.split('/');
  if (slashParts.length === 3) {
    const [a, b, c] = slashParts;
    // If first part > 12, it's DD/MM/YYYY
    if (parseInt(a) > 12) {
      return `${c}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`;
    }
    // Ambiguous — default to DD/MM/YYYY for AU
    return `${c}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`;
  }

  // ISO date
  try {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      return d.toISOString().substring(0, 10);
    }
  } catch { /* fall through */ }

  return trimmed;
}

function parseAmount(raw: string): number {
  if (!raw) return 0;
  // Remove currency symbols, spaces, and parse
  const cleaned = raw.replace(/[^0-9.\-,]/g, '').replace(/,/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

// ─── Column Matching ────────────────────────────────────────────────────────

interface ColumnMap {
  payoutId: number;
  payoutDate: number;
  gross: number;
  refunds: number;
  charges: number;
  adjustments: number;
  net: number;
}

const COLUMN_PATTERNS: Record<keyof ColumnMap, RegExp[]> = {
  payoutId:     [/payout\s*id/i, /payout\s*#/i, /id/i],
  payoutDate:   [/payout\s*date/i, /date/i, /paid\s*on/i],
  gross:        [/gross/i, /total\s*sales/i, /gross\s*sales/i],
  refunds:      [/refund/i, /return/i],
  charges:      [/charge/i, /fee/i, /shopify\s*fee/i],
  adjustments:  [/adjust/i, /other/i],
  net:          [/net/i, /payout\s*amount/i, /deposit/i],
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

  // Require at minimum: payoutId, gross, net
  if (map.payoutId === undefined || map.gross === undefined || map.net === undefined) {
    return null;
  }

  // Default missing columns to -1 (will return 0)
  return {
    payoutId:    map.payoutId!,
    payoutDate:  map.payoutDate ?? -1,
    gross:       map.gross!,
    refunds:     map.refunds ?? -1,
    charges:     map.charges ?? -1,
    adjustments: map.adjustments ?? -1,
    net:         map.net!,
  };
}

// ─── Main Parser ────────────────────────────────────────────────────────────

/**
 * Parse a Shopify Payments payout CSV.
 * 
 * Supports both single-row (one payout) and multi-row (batch) CSVs.
 * For multi-row, each row becomes a separate payout — but typically
 * users export one payout at a time.
 */
export function parseShopifyPayoutCSV(csvContent: string): ShopifyParseResult {
  try {
    const lines = csvContent.split('\n').filter(l => l.trim().length > 0);
    if (lines.length < 2) {
      return { success: false, error: 'CSV must have at least a header row and one data row.' };
    }

    // Parse header
    const headers = parseCSVRow(lines[0]);
    const colMap = matchColumns(headers);
    if (!colMap) {
      return {
        success: false,
        error: `Could not identify required columns. Found: ${headers.join(', ')}. Expected: Payout ID, Gross, Net (minimum).`,
      };
    }

    // Parse data rows
    const rows: ShopifyPayoutRow[] = [];
    for (let i = 1; i < lines.length; i++) {
      const fields = parseCSVRow(lines[i]);
      if (fields.length < 3) continue; // skip empty/malformed rows

      const payoutId = colMap.payoutId >= 0 ? fields[colMap.payoutId]?.trim() : '';
      if (!payoutId) continue; // skip rows without ID

      rows.push({
        payoutId,
        payoutDate:  colMap.payoutDate >= 0 ? normaliseDate(fields[colMap.payoutDate] || '') : '',
        gross:       colMap.gross >= 0 ? parseAmount(fields[colMap.gross] || '') : 0,
        refunds:     colMap.refunds >= 0 ? parseAmount(fields[colMap.refunds] || '') : 0,
        charges:     colMap.charges >= 0 ? parseAmount(fields[colMap.charges] || '') : 0,
        adjustments: colMap.adjustments >= 0 ? parseAmount(fields[colMap.adjustments] || '') : 0,
        net:         colMap.net >= 0 ? parseAmount(fields[colMap.net] || '') : 0,
      });
    }

    if (rows.length === 0) {
      return { success: false, error: 'No valid payout rows found in CSV.' };
    }

    // For now: use the first row as the settlement
    // Future: support batch processing of multiple payouts
    const row = rows[0];

    // Ensure refunds and charges are negative
    const refunds = row.refunds > 0 ? -row.refunds : row.refunds;
    const charges = row.charges > 0 ? -row.charges : row.charges;
    const adjustments = row.adjustments;
    const grossSales = Math.abs(row.gross);
    const bankDeposit = row.net;

    // GST calculations (Australian GST = 10%)
    const GST_DIVISOR = 11; // inclGST / 11 = GST component
    const salesInclGst = grossSales;
    const salesExGst = round2(salesInclGst - (salesInclGst / GST_DIVISOR));
    const gstOnSales = round2(salesInclGst / GST_DIVISOR);

    const feesInclGst = charges; // negative
    const feesExGst = round2(feesInclGst - (feesInclGst / GST_DIVISOR));
    const gstOnFees = round2(Math.abs(feesInclGst / GST_DIVISOR));

    // Reconciliation: gross + refunds + charges + adjustments ≈ net
    const calculatedNet = round2(grossSales + refunds + charges + adjustments);
    const reconciles = Math.abs(calculatedNet - bankDeposit) <= 0.05;

    const settlement: StandardSettlement = {
      marketplace: 'shopify_payments',
      settlement_id: row.payoutId,
      period_start: row.payoutDate || new Date().toISOString().substring(0, 10),
      period_end: row.payoutDate || new Date().toISOString().substring(0, 10),
      sales_ex_gst: salesExGst,
      gst_on_sales: gstOnSales,
      fees_ex_gst: feesExGst,
      gst_on_fees: gstOnFees,
      net_payout: bankDeposit,
      source: 'manual',
      reconciles,
      metadata: {
        grossSalesInclGst: grossSales,
        refundsInclGst: refunds,
        refundsExGst: round2(refunds - (refunds / GST_DIVISOR)),
        chargesInclGst: charges,
        adjustments,
        calculatedNet,
        reconciliationDiff: round2(calculatedNet - bankDeposit),
      },
    };

    return {
      success: true,
      settlement,
      extra: {
        rowCount: rows.length,
        currency: 'AUD',
        rawHeaders: headers,
        adjustments,
      },
    };
  } catch (err: any) {
    return { success: false, error: `CSV parsing failed: ${err.message || 'Unknown error'}` };
  }
}

/**
 * Parse a CSV row handling quoted fields with commas inside.
 */
function parseCSVRow(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++; // skip escaped quote
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

/**
 * Build Xero invoice lines for Shopify Payments settlement.
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
      UnitAmount: round2(meta.adjustments / 1.1), // Convert incl → ex GST
      Quantity: 1,
    });
  }

  return lines;
}