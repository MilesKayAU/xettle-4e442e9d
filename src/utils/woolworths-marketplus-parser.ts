/**
 * Woolworths MarketPlus CSV Parser
 * 
 * Parses the combined Woolworths Group settlement CSV that contains orders from
 * Big W, Everyday Market, and MyDeal — all paid together in one bank transfer.
 * 
 * The file is split by "Order Source" column into separate marketplace groups,
 * each producing a $0.00 clearing invoice.
 * 
 * Fingerprint: has both "Order Source" AND "Bank Payment Ref" columns.
 * Key columns: Order ID, Ordered Date, SKU, Product, Name, Quantity,
 * Price (Per Unit), Total Shipping, Total Sale Price, Commission Fee,
 * Net Amount, GST on Net Amount, Original Order ID, Bank Payment Ref, Bank Payment Date
 */

import type { StandardSettlement } from './settlement-engine';
import { parseDateOrEmpty } from './date-parser';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WoolworthsOrderRow {
  orderId: string;
  orderedDate: string;
  sku: string;
  product: string;
  customerName: string;
  quantity: number;
  pricePerUnit: number;
  totalShipping: number;
  totalSalePrice: number;
  commissionFee: number;
  netAmount: number;
  gstOnNetAmount: number;
  netShippingAmount: number;   // Net Shipping Amount (ex-GST shipping income)
  gstOnShipping: number;       // GST on Shipping
  originalOrderId: string;
  invoiceRef: string;
  orderSource: string;      // 'BigW' | 'EverydayMarket' | 'MyDeal'
  bankPaymentRef: string;   // settlement ID (e.g. '290994')
  bankPaymentDate: string;
}

export interface WoolworthsMarketplaceGroup {
  orderSource: string;
  marketplaceCode: string;
  displayName: string;
  contactName: string;
  orders: WoolworthsOrderRow[];
  orderCount: number;
  grossSales: number;       // Total Sale Price where > 0
  refunds: number;          // Total Sale Price where < 0
  commission: number;       // Sum of Commission Fee
  netAmount: number;        // Sum of Net Amount
  gst: number;              // Sum of GST on Net Amount
  shipping: number;         // Sum of Net Shipping Amount (ex-GST)
  shippingGst: number;      // Sum of GST on Shipping
  /** GST on Net Amount from sale rows only (totalSalePrice > 0) */
  gstSales: number;
  /** GST on Net Amount from refund rows only (totalSalePrice < 0) */
  gstRefunds: number;
  periodStart: string;
  periodEnd: string;
}

export interface WoolworthsParseResult {
  success: true;
  groups: WoolworthsMarketplaceGroup[];
  bankPaymentRef: string;
  bankPaymentDate: string;
  totalNet: number;         // Combined net across all groups = bank deposit
  totalRowCount: number;
  settlements: StandardSettlement[];
  /** All raw rows for drill-down */
  allRows: WoolworthsOrderRow[];
}

export interface WoolworthsParseError {
  success: false;
  error: string;
}

export type WoolworthsResult = WoolworthsParseResult | WoolworthsParseError;

// ─── Helpers ────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Detect platform-level transaction fee rows by product name.
 * These rows have `Product` matching "Transaction fee for DD/MM/YYYY" and are
 * platform-wide fees that Woolworths incorrectly attributes to a single Order Source.
 */
export const isTransactionFee = (row: WoolworthsOrderRow): boolean =>
  /transaction fee for/i.test(row.product);

function parseAmount(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^0-9.\-,]/g, '').replace(/,/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

/** @deprecated Use parseDateOrEmpty from date-parser.ts */
const normaliseDate = parseDateOrEmpty;

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
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

// ─── Order Source → Marketplace Mapping ─────────────────────────────────────

const ORDER_SOURCE_MAP: Record<string, { code: string; display: string; contact: string }> = {
  bigw:            { code: 'bigw',             display: 'Big W Marketplace',  contact: 'Big W Marketplace' },
  everydaymarket:  { code: 'everyday_market',  display: 'Everyday Market',    contact: 'Everyday Market' },
  mydeal:          { code: 'mydeal',           display: 'MyDeal',             contact: 'MyDeal' },
};

function resolveOrderSource(raw: string): { code: string; display: string; contact: string } {
  const key = raw.toLowerCase().replace(/[\s_-]/g, '');
  return ORDER_SOURCE_MAP[key] || { code: raw.toLowerCase(), display: raw, contact: raw };
}

// ─── Column Matching ────────────────────────────────────────────────────────

interface ColumnMap {
  orderId: number;
  orderedDate: number;
  sku: number;
  product: number;
  customerName: number;
  quantity: number;
  pricePerUnit: number;
  totalShipping: number;
  totalSalePrice: number;
  commissionFee: number;
  netAmount: number;
  gstOnNetAmount: number;
  netShippingAmount: number;
  gstOnShipping: number;
  originalOrderId: number;
  invoiceRef: number;
  orderSource: number;
  bankPaymentRef: number;
  bankPaymentDate: number;
}

const COL_PATTERNS: Record<keyof ColumnMap, RegExp[]> = {
  orderId:         [/^order\s*id$/i],
  orderedDate:     [/^ordered\s*date$/i],
  sku:             [/^sku$/i],
  product:         [/^product$/i],
  customerName:    [/^name$/i],
  quantity:        [/^quantity$/i],
  pricePerUnit:    [/^price\s*\(per\s*unit\)$/i, /^price\s*per\s*unit$/i, /^unit\s*price$/i],
  totalShipping:   [/^total\s*shipping$/i],
  totalSalePrice:  [/^total\s*sale\s*price$/i],
  commissionFee:   [/^commission\s*fee$/i],
  netAmount:       [/^net\s*amount$/i],
  gstOnNetAmount:  [/^gst\s*on\s*net\s*amount$/i],
  originalOrderId: [/^original\s*order\s*id$/i],
  invoiceRef:      [/^invoiceref$/i, /^invoice\s*ref$/i],
  orderSource:     [/^order\s*source$/i],
  bankPaymentRef:  [/^bank\s*payment\s*ref$/i],
  bankPaymentDate: [/^bank\s*payment\s*date$/i],
};

function matchColumns(headers: string[]): ColumnMap | null {
  const map: Partial<ColumnMap> = {};
  for (const [key, patterns] of Object.entries(COL_PATTERNS)) {
    for (const pattern of patterns) {
      const idx = headers.findIndex(h => pattern.test(h.trim()));
      if (idx !== -1 && !(key in map)) {
        map[key as keyof ColumnMap] = idx;
        break;
      }
    }
  }
  // Require: orderSource, bankPaymentRef, totalSalePrice, commissionFee, netAmount
  if (map.orderSource === undefined || map.bankPaymentRef === undefined ||
      map.totalSalePrice === undefined || map.netAmount === undefined) {
    return null;
  }
  return {
    orderId:         map.orderId ?? -1,
    orderedDate:     map.orderedDate ?? -1,
    sku:             map.sku ?? -1,
    product:         map.product ?? -1,
    customerName:    map.customerName ?? -1,
    quantity:        map.quantity ?? -1,
    pricePerUnit:    map.pricePerUnit ?? -1,
    totalShipping:   map.totalShipping ?? -1,
    totalSalePrice:  map.totalSalePrice!,
    commissionFee:   map.commissionFee ?? -1,
    netAmount:       map.netAmount!,
    gstOnNetAmount:  map.gstOnNetAmount ?? -1,
    originalOrderId: map.originalOrderId ?? -1,
    invoiceRef:      map.invoiceRef ?? -1,
    orderSource:     map.orderSource!,
    bankPaymentRef:  map.bankPaymentRef!,
    bankPaymentDate: map.bankPaymentDate ?? -1,
  };
}

// ─── Main Parser ────────────────────────────────────────────────────────────

export function parseWoolworthsMarketPlusCSV(csvContent: string): WoolworthsResult {
  try {
    // Strip BOM
    const content = csvContent.replace(/^\uFEFF/, '');
    const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
    if (lines.length < 2) {
      return { success: false, error: 'CSV must have at least a header and one data row.' };
    }

    const headers = parseCSVRow(lines[0]);
    const colMap = matchColumns(headers);
    if (!colMap) {
      return {
        success: false,
        error: `Could not identify required columns. Need: Order Source, Bank Payment Ref, Total Sale Price, Net Amount.`,
      };
    }

    const allRows: WoolworthsOrderRow[] = [];

    for (let i = 1; i < lines.length; i++) {
      const fields = parseCSVRow(lines[i]);
      if (fields.length < 5) continue;

      let orderSource = (fields[colMap.orderSource] || '').trim();

      // Rows with empty Order Source — infer from InvoiceRef or other fields
      if (!orderSource) {
        const invoiceRef = colMap.invoiceRef >= 0 ? (fields[colMap.invoiceRef] || '').trim() : '';
        const orderId = colMap.orderId >= 0 ? (fields[colMap.orderId] || '').trim() : '';
        
        // MIL prefix on InvoiceRef = MyDeal
        if (/^MIL/i.test(invoiceRef)) {
          orderSource = 'MyDeal';
        }
        // BWM prefix = BigW
        else if (/^BWM/i.test(invoiceRef)) {
          orderSource = 'BigW';
        }
        // EDM or EM prefix = EverydayMarket
        else if (/^(EDM|EM)/i.test(invoiceRef)) {
          orderSource = 'EverydayMarket';
        }
        // If still empty, check if the row has any financial data — skip truly empty rows
        else {
          const netAmt = parseAmount(fields[colMap.netAmount] || '');
          const salePrice = parseAmount(fields[colMap.totalSalePrice] || '');
          if (netAmt === 0 && salePrice === 0) continue;
          // Default unattributable rows to MyDeal (most common for transaction fees)
          orderSource = 'MyDeal';
        }
      }

      allRows.push({
        orderId:         colMap.orderId >= 0 ? fields[colMap.orderId] || '' : '',
        orderedDate:     colMap.orderedDate >= 0 ? normaliseDate(fields[colMap.orderedDate] || '') : '',
        sku:             colMap.sku >= 0 ? fields[colMap.sku] || '' : '',
        product:         colMap.product >= 0 ? fields[colMap.product] || '' : '',
        customerName:    colMap.customerName >= 0 ? fields[colMap.customerName] || '' : '',
        quantity:        colMap.quantity >= 0 ? parseAmount(fields[colMap.quantity] || '') : 1,
        pricePerUnit:    colMap.pricePerUnit >= 0 ? parseAmount(fields[colMap.pricePerUnit] || '') : 0,
        totalShipping:   colMap.totalShipping >= 0 ? parseAmount(fields[colMap.totalShipping] || '') : 0,
        totalSalePrice:  parseAmount(fields[colMap.totalSalePrice] || ''),
        commissionFee:   colMap.commissionFee >= 0 ? parseAmount(fields[colMap.commissionFee] || '') : 0,
        netAmount:       parseAmount(fields[colMap.netAmount] || ''),
        gstOnNetAmount:  colMap.gstOnNetAmount >= 0 ? parseAmount(fields[colMap.gstOnNetAmount] || '') : 0,
        originalOrderId: colMap.originalOrderId >= 0 ? fields[colMap.originalOrderId] || '' : '',
        invoiceRef:      colMap.invoiceRef >= 0 ? fields[colMap.invoiceRef] || '' : '',
        orderSource:     orderSource,
        bankPaymentRef:  colMap.bankPaymentRef >= 0 ? fields[colMap.bankPaymentRef] || '' : '',
        bankPaymentDate: colMap.bankPaymentDate >= 0 ? normaliseDate(fields[colMap.bankPaymentDate] || '') : '',
      });
    }

    if (allRows.length === 0) {
      return { success: false, error: 'No data rows found in the CSV.' };
    }

    const bankPaymentRef = allRows[0].bankPaymentRef;
    const bankPaymentDate = allRows[0].bankPaymentDate;

    // Group by Order Source
    const groupMap = new Map<string, WoolworthsOrderRow[]>();
    for (const row of allRows) {
      const src = row.orderSource;
      if (!groupMap.has(src)) groupMap.set(src, []);
      groupMap.get(src)!.push(row);
    }

    // ─── Transaction Fee Redistribution Pass ──────────────────────────────
    redistributeTransactionFees(groupMap);

    const groups: WoolworthsMarketplaceGroup[] = [];
    for (const [source, rows] of groupMap) {
      if (rows.length === 0) continue;

      const resolved = resolveOrderSource(source);
      const dates = rows
        .map(r => r.orderedDate)
        .filter(d => d && d >= '2020-01-01')
        .sort();

      groups.push({
        orderSource: source,
        marketplaceCode: resolved.code,
        displayName: resolved.display,
        contactName: resolved.contact,
        orders: rows,
        orderCount: rows.length,
        grossSales: round2(rows.filter(r => r.totalSalePrice > 0).reduce((s, r) => s + r.totalSalePrice, 0)),
        refunds: round2(rows.filter(r => r.totalSalePrice < 0).reduce((s, r) => s + r.totalSalePrice, 0)),
        commission: round2(rows.reduce((s, r) => s + r.commissionFee, 0)),
        netAmount: round2(rows.reduce((s, r) => s + r.netAmount, 0)),
        gst: round2(rows.reduce((s, r) => s + r.gstOnNetAmount, 0)),
        periodStart: dates[0] || bankPaymentDate || '',
        periodEnd: dates[dates.length - 1] || bankPaymentDate || '',
      });
    }

    // Sort by order count descending
    groups.sort((a, b) => b.orderCount - a.orderCount);

    const totalNet = round2(groups.reduce((s, g) => s + g.netAmount, 0));

    const settlements = buildWoolworthsSettlements(groups, bankPaymentRef, totalNet);

    return {
      success: true,
      groups,
      bankPaymentRef,
      bankPaymentDate,
      totalNet,
      totalRowCount: allRows.length,
      settlements,
      allRows,
    };
  } catch (err: any) {
    return { success: false, error: `CSV parsing failed: ${err.message || 'Unknown error'}` };
  }
}

// ─── Transaction Fee Redistribution ─────────────────────────────────────────

function redistributeTransactionFees(groupMap: Map<string, WoolworthsOrderRow[]>): void {
  const txFeeRows: WoolworthsOrderRow[] = [];
  for (const [source, rows] of groupMap) {
    const kept: WoolworthsOrderRow[] = [];
    for (const row of rows) {
      if (isTransactionFee(row)) {
        txFeeRows.push(row);
      } else {
        kept.push(row);
      }
    }
    groupMap.set(source, kept);
  }

  if (txFeeRows.length === 0) return;

  const siblingEntries: Array<{ source: string; grossSales: number }> = [];
  let totalSiblingSales = 0;
  for (const [source, rows] of groupMap) {
    const gross = rows.filter(r => r.totalSalePrice > 0).reduce((s, r) => s + r.totalSalePrice, 0);
    if (gross > 0) {
      siblingEntries.push({ source, grossSales: gross });
      totalSiblingSales += gross;
    }
  }

  if (siblingEntries.length === 0 || totalSiblingSales <= 0) {
    console.warn('[woolworths-parser] Transaction fee rows found with no sales siblings — allocated to fallback channel');
    let largestSource = '';
    let largestCount = 0;
    for (const [source, rows] of groupMap) {
      if (rows.length > largestCount) {
        largestCount = rows.length;
        largestSource = source;
      }
    }
    if (largestSource) {
      const target = groupMap.get(largestSource)!;
      for (const feeRow of txFeeRows) {
        target.push({ ...feeRow, product: feeRow.product + ' (allocated from platform fees)' });
      }
    }
    return;
  }

  for (const feeRow of txFeeRows) {
    let remainingCommission = feeRow.commissionFee;
    let remainingNet = feeRow.netAmount;
    let remainingGst = feeRow.gstOnNetAmount;

    for (let i = 0; i < siblingEntries.length; i++) {
      const sibling = siblingEntries[i];
      const isLast = i === siblingEntries.length - 1;
      const share = sibling.grossSales / totalSiblingSales;

      const commShare = isLast ? remainingCommission : round2(feeRow.commissionFee * share);
      const netShare = isLast ? remainingNet : round2(feeRow.netAmount * share);
      const gstShare = isLast ? remainingGst : round2(feeRow.gstOnNetAmount * share);

      remainingCommission = round2(remainingCommission - commShare);
      remainingNet = round2(remainingNet - netShare);
      remainingGst = round2(remainingGst - gstShare);

      groupMap.get(sibling.source)!.push({
        ...feeRow,
        commissionFee: commShare,
        netAmount: netShare,
        gstOnNetAmount: gstShare,
        totalSalePrice: 0,
        product: feeRow.product + ' (allocated from platform fees)',
      });
    }
  }
}

// ─── Settlement Builder ─────────────────────────────────────────────────────

function buildWoolworthsSettlements(
  groups: WoolworthsMarketplaceGroup[],
  bankPaymentRef: string,
  totalBankDeposit: number,
): StandardSettlement[] {
  const taxRate = 0.10;
  const divisor = 1 + taxRate;

  return groups.map(g => {
    // Sales and refunds are GST-inclusive in the CSV
    const grossSalesExGst = round2(g.grossSales / divisor);
    const gstOnSales = round2(g.grossSales - grossSalesExGst);

    const refundsExGst = round2(g.refunds / divisor);
    const gstOnRefunds = round2(g.refunds - refundsExGst);

    // Commission is GST-inclusive
    const commissionExGst = round2(g.commission / divisor);
    const gstOnCommission = round2(g.commission - commissionExGst);

    // ─── CRITICAL: Woolworths pays Net Amount ONLY ──────────────────────
    // The bank deposit equals the sum of the "Net Amount" column.
    // "GST on Net Amount" appears on the RCTI for BAS purposes but is
    // NOT included in the cash payment. Confirmed from payment 293603:
    //   Sum of Net Amount     = $923.76 ✅ matches bank deposit
    //   Sum of Net Amount+GST = $1,007.80 ❌ does NOT match
    // ────────────────────────────────────────────────────────────────────
    const bankDeposit = round2(g.netAmount);
    const clearingAmount = -bankDeposit;

    const settlementId = `${bankPaymentRef}_${g.orderSource}`;
    const marketplaceCode = g.marketplaceCode;

    return {
      marketplace: marketplaceCode,
      settlement_id: settlementId,
      period_start: g.periodStart,
      period_end: g.periodEnd,
      sales_ex_gst: grossSalesExGst,
      gst_on_sales: round2(gstOnSales + gstOnRefunds),
      fees_ex_gst: -Math.abs(commissionExGst),
      gst_on_fees: Math.abs(gstOnCommission),
      net_payout: bankDeposit,
      source: 'csv_upload' as const,
      reconciles: true,
      metadata: {
        marketplaceCode: g.marketplaceCode,
        displayName: g.displayName,
        contactName: g.contactName,
        orderSource: g.orderSource,
        orderCount: g.orderCount,
        grossSalesInclGst: g.grossSales,
        grossSalesExGst,
        gstOnSales,
        refundsInclGst: g.refunds,
        refundsExGst,
        gstOnRefunds,
        commissionInclGst: g.commission,
        commissionExGst,
        gstOnCommission,
        netAmount: g.netAmount,
        gstOnNet: g.gst,
        clearingAmount,
        bankPaymentRef,
        totalBankDeposit,
        currency: 'AUD',
        reference: `${g.displayName} Settlement ${bankPaymentRef}`,
        invoiceType: 'clearing',
        paymentType: 'direct_bank_transfer',
      },
    };
  });
}


// ─── Fingerprint Check ──────────────────────────────────────────────────────

/**
 * Detect if a CSV is a Woolworths MarketPlus settlement file.
 * Key: has both 'Order Source' AND 'Bank Payment Ref' columns.
 */
export function isWoolworthsMarketPlusCSV(headers: string[]): boolean {
  const lower = headers.map(h => h.toLowerCase().trim());
  return lower.some(h => /^order\s*source$/i.test(h)) &&
         lower.some(h => /^bank\s*payment\s*ref$/i.test(h)) &&
         lower.some(h => /^total\s*sale\s*price$/i.test(h));
}
