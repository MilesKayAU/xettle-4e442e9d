/**
 * Generic CSV-to-Settlement Parser
 * 
 * A mapping-driven parser that converts any CSV/XLSX file into StandardSettlement[]
 * using a ColumnMapping. No marketplace-specific code needed.
 * 
 * This unlocks all new marketplaces without writing custom parsers.
 */

import type { StandardSettlement } from './settlement-engine';
import { TOL_BUNNINGS_PDF } from '@/constants/reconciliation-tolerance';
import type { ColumnMapping } from './file-fingerprint-engine';
import { findHeaderRow } from './file-fingerprint-engine';
import { parseDateOrEmpty, detectDateColumn } from './date-parser';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface GenericParseOptions {
  marketplace: string;
  mapping: ColumnMapping;
  gstModel: 'seller' | 'marketplace'; // seller = GST in amounts, marketplace = GST collected by marketplace
  gstRate: number; // percentage, e.g. 10 for 10%
  /** If true, group rows by settlement_id column. If false, treat entire file as one settlement */
  groupBySettlement: boolean;
  /** Fallback settlement ID if no column mapped */
  fallbackSettlementId?: string;
}

export interface GenericParseResult {
  success: boolean;
  settlements: StandardSettlement[];
  error?: string;
  rowCount: number;
  warnings: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseAmount(raw: string | number | undefined | null): number {
  if (raw === null || raw === undefined) return 0;
  if (typeof raw === 'number') return raw;
  const cleaned = String(raw).replace(/[^0-9.\-,]/g, '').replace(/,/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

/**
 * Lightweight sanity check on aggregated settlement values.
 * Returns true if sanity failed, false if OK.
 */
function checkParserSanity(grossSales: number, fees: number, netPayout: number, groupId: string, warnings: string[]): boolean {
  const absSales = Math.abs(grossSales);
  const absFees = Math.abs(fees);

  if (absSales === 0 && absFees === 0 && netPayout === 0) {
    warnings.push(`Settlement ${groupId}: All values are $0 — likely incorrect column mapping`);
    return true;
  }
  if (absSales > 10_000_000) {
    warnings.push(`Settlement ${groupId}: Sales of $${absSales.toLocaleString()} is implausibly large — likely incorrect column mapping`);
    return true;
  }
  if (netPayout === 0 && absSales > 1000) {
    warnings.push(`Settlement ${groupId}: Net payout is $0 but sales are $${absSales.toLocaleString()} — likely incorrect column mapping`);
    return true;
  }
  if (absFees > absSales * 5 && absFees > 500) {
    warnings.push(`Settlement ${groupId}: Fees ($${absFees.toLocaleString()}) exceed sales ($${absSales.toLocaleString()}) by 5× — likely incorrect column mapping`);
    return true;
  }
  return false;
}

/** @deprecated Use parseDateOrEmpty from date-parser.ts */
const normaliseDate = (raw: string | undefined) => parseDateOrEmpty(raw);

// ─── CSV Row Parser ─────────────────────────────────────────────────────────

function parseCSVRow(line: string, delimiter: string): string[] {
  if (delimiter === '\t') return line.split('\t').map(s => s.trim());
  
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
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// ─── Main Parser ────────────────────────────────────────────────────────────

/**
 * Parse a CSV/TSV string using a column mapping and return StandardSettlement[].
 */
export function parseGenericCSV(content: string, options: GenericParseOptions): GenericParseResult {
  const warnings: string[] = [];
  const { mapping, marketplace, gstModel, gstRate } = options;
  const gstDivisor = 1 + (gstRate / 100); // 10% → 1.1

  // Detect delimiter
  const lines = content.split('\n').filter(l => l.trim());
  if (lines.length < 2) {
    return { success: false, settlements: [], error: 'File must have at least a header and one data row.', rowCount: 0, warnings };
  }

  const firstLine = lines[0];
  const tabCount = (firstLine.match(/\t/g) || []).length;
  const commaCount = (firstLine.match(/,/g) || []).length;
  const delimiter = tabCount > commaCount ? '\t' : ',';

  // Smart header detection — skip metadata preambles
  const { headerIndex } = findHeaderRow(lines, delimiter);

  const headers = parseCSVRow(lines[headerIndex], delimiter);
  const headerMap: Record<string, number> = {};
  headers.forEach((h, i) => { headerMap[h.toLowerCase().trim()] = i; });

  // Resolve column indices from mapping
  const getColIdx = (mappedName: string | undefined): number => {
    if (!mappedName) return -1;
    // Try exact match first
    const exactIdx = headerMap[mappedName.toLowerCase().trim()];
    if (exactIdx !== undefined) return exactIdx;
    // Try partial match
    const norm = mappedName.toLowerCase().trim();
    for (const [h, idx] of Object.entries(headerMap)) {
      if (h.includes(norm) || norm.includes(h)) return idx;
    }
    return -1;
  };

  const salesIdx = getColIdx(mapping.gross_sales);
  const feesIdx = getColIdx(mapping.fees);
  const refundsIdx = getColIdx(mapping.refunds);
  const netIdx = getColIdx(mapping.net_payout);
  const settIdIdx = getColIdx(mapping.settlement_id);
  const startIdx = getColIdx(mapping.period_start);
  const endIdx = getColIdx(mapping.period_end);
  const gstIdx = getColIdx(mapping.gst);
  const currencyIdx = getColIdx(mapping.currency);

  if (salesIdx === -1 && netIdx === -1) {
    return { success: false, settlements: [], error: 'Could not find sales or net payout columns in the file.', rowCount: 0, warnings };
  }

  // Parse all data rows
  interface RowData {
    sales: number;
    fees: number;
    refunds: number;
    net: number;
    gst: number;
    settlementId: string;
    periodStart: string;
    periodEnd: string;
    currency: string;
  }

  const rows: RowData[] = [];
  const dataStart = headerIndex + 1;
  for (let i = dataStart; i < lines.length; i++) {
    const fields = parseCSVRow(lines[i], delimiter);
    if (fields.length < 2) continue;

    rows.push({
      sales: salesIdx >= 0 ? parseAmount(fields[salesIdx]) : 0,
      fees: feesIdx >= 0 ? parseAmount(fields[feesIdx]) : 0,
      refunds: refundsIdx >= 0 ? parseAmount(fields[refundsIdx]) : 0,
      net: netIdx >= 0 ? parseAmount(fields[netIdx]) : 0,
      gst: gstIdx >= 0 ? parseAmount(fields[gstIdx]) : 0,
      settlementId: settIdIdx >= 0 ? (fields[settIdIdx] || '').trim() : '',
      periodStart: startIdx >= 0 ? normaliseDate(fields[startIdx]) : '',
      periodEnd: endIdx >= 0 ? normaliseDate(fields[endIdx]) : '',
      currency: currencyIdx >= 0 ? (fields[currencyIdx] || 'AUD').trim().toUpperCase() : 'AUD',
    });
  }

  if (rows.length === 0) {
    return { success: false, settlements: [], error: 'No valid data rows found.', rowCount: 0, warnings };
  }

  // Group by settlement ID if requested
  const groups = new Map<string, RowData[]>();
  if (options.groupBySettlement && settIdIdx >= 0) {
    for (const row of rows) {
      const key = row.settlementId || 'ungrouped';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(row);
    }
  } else {
    // Treat entire file as one settlement
    const fallbackId = options.fallbackSettlementId || `generic-${marketplace}-${Date.now()}`;
    groups.set(fallbackId, rows);
  }

  // Build settlements
  const settlements: StandardSettlement[] = [];
  let idx = 0;
  for (const [groupId, groupRows] of groups) {
    let totalSales = 0;
    let totalFees = 0;
    let totalRefunds = 0;
    let totalNet = 0;
    let totalGst = 0;
    let minDate = '';
    let maxDate = '';

    for (const row of groupRows) {
      totalSales += row.sales;
      totalFees += row.fees;
      totalRefunds += row.refunds;
      totalNet += row.net;
      totalGst += row.gst;

      if (row.periodStart) {
        if (!minDate || row.periodStart < minDate) minDate = row.periodStart;
      }
      if (row.periodEnd) {
        if (!maxDate || row.periodEnd > maxDate) maxDate = row.periodEnd;
      }
      // If no period_end, use start as fallback
      if (row.periodStart && !row.periodEnd) {
        if (!maxDate || row.periodStart > maxDate) maxDate = row.periodStart;
      }
    }

    // Normalise signs: sales positive, fees negative, refunds negative
    const grossSales = Math.abs(round2(totalSales));
    const fees = round2(totalFees) > 0 ? round2(-totalFees) : round2(totalFees);
    const refunds = round2(totalRefunds) > 0 ? round2(-totalRefunds) : round2(totalRefunds);

    // GST calculation
    let salesExGst: number;
    let gstOnSales: number;
    let feesExGst: number;
    let gstOnFees: number;

    if (totalGst !== 0) {
      // GST column present — use it
      gstOnSales = round2(Math.abs(totalGst));
      salesExGst = round2(grossSales - gstOnSales);
      gstOnFees = round2(Math.abs(fees) / gstDivisor);
      feesExGst = round2(fees + gstOnFees);
    } else if (gstModel === 'seller') {
      // GST included in amounts
      gstOnSales = round2(grossSales / gstDivisor);
      salesExGst = round2(grossSales - gstOnSales);
      gstOnFees = round2(Math.abs(fees) / gstDivisor);
      feesExGst = round2(fees + gstOnFees);
    } else {
      // Marketplace collects GST — amounts are ex-GST
      salesExGst = grossSales;
      gstOnSales = 0;
      feesExGst = fees;
      gstOnFees = 0;
    }

    const netPayout = netIdx >= 0 ? round2(totalNet) : round2(grossSales + fees + refunds);

    // Reconciliation
    const calculatedNet = round2(grossSales + fees + refunds);
    const reconciles = netIdx >= 0 ? Math.abs(calculatedNet - netPayout) <= TOL_BUNNINGS_PDF : true;

    if (!reconciles) {
      warnings.push(`Settlement ${groupId}: calculated net ($${calculatedNet}) differs from reported net ($${netPayout}) by $${round2(Math.abs(calculatedNet - netPayout))}`);
    }

    // ── Pre-save sanity check ──
    const sanityFailed = checkParserSanity(grossSales, fees, netPayout, groupId, warnings);

    // Use today as fallback date
    const now = new Date();
    const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;

    settlements.push({
      marketplace,
      settlement_id: groupId,
      period_start: minDate || today,
      period_end: maxDate || minDate || today,
      sales_ex_gst: salesExGst,
      gst_on_sales: gstOnSales,
      fees_ex_gst: feesExGst,
      gst_on_fees: gstOnFees,
      net_payout: netPayout,
      source: 'csv_upload',
      reconciles,
      metadata: {
        grossSalesInclGst: grossSales,
        refundsInclGst: refunds,
        refundsExGst: round2(refunds - (refunds / gstDivisor)),
        feesInclGst: fees,
        calculatedNet,
        reconciliationDiff: round2(calculatedNet - netPayout),
        rowCount: groupRows.length,
        currency: groupRows[0]?.currency || 'AUD',
        csvFormat: 'generic',
        parserVersion: 'generic-v1.0.0',
        ...(sanityFailed ? { sanity_failed: true } : {}),
      },
    });
    idx++;
  }

  // Sort by period end descending
  settlements.sort((a, b) => (b.period_end || '').localeCompare(a.period_end || ''));

  return {
    success: true,
    settlements,
    rowCount: rows.length,
    warnings,
  };
}

/**
 * Parse an XLSX file using a column mapping.
 */
export async function parseGenericXLSX(file: File, options: GenericParseOptions): Promise<GenericParseResult> {
  try {
    const XLSX = await import('xlsx');
    const buffer = await file.arrayBuffer();
    const wb = XLSX.read(buffer, { type: 'array' });
    const ws = wb.Sheets[wb.SheetNames[0]];
    
    // Convert to CSV and use the CSV parser
    const csv = XLSX.utils.sheet_to_csv(ws);
    return parseGenericCSV(csv, options);
  } catch (err: any) {
    return {
      success: false,
      settlements: [],
      error: `XLSX parsing failed: ${err.message}`,
      rowCount: 0,
      warnings: [],
    };
  }
}
