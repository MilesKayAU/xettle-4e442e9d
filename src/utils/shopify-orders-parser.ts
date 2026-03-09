/**
 * Shopify Orders CSV Parser
 * 
 * Parses Shopify's Orders export CSV and groups by payment gateway
 * to create $0.00 clearing invoices for each non-Shopify-Payments gateway.
 * 
 * Fingerprint: columns contain 'Payment Method' AND 'Financial Status' AND 'Paid at'
 * marketplace_code: 'shopify_orders'
 * source: 'csv_upload'
 * 
 * FLOW:
 * 1. Filter rows where Financial Status = 'paid'
 * 2. Group by Payment Method
 * 3. Skip 'shopify_payments' (handled by Shopify Payments payout CSV)
 * 4. Per gateway: create one $0.00 clearing invoice with 3 lines:
 *    - Shopify Sales (Subtotal / 1.1, GST on Income)
 *    - Shopify Shipping Revenue (Shipping / 1.1, GST on Income)
 *    - Gateway Clearing (-Total, BAS Excluded)
 */

import type { StandardSettlement } from './settlement-engine';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ShopifyOrderRow {
  name: string;           // Order name (#1001)
  financialStatus: string;
  paymentMethod: string;
  paidAt: string;
  subtotal: number;       // Incl GST
  shipping: number;       // Incl GST
  total: number;          // Full order total
  currency: string;
}

export interface GatewayGroup {
  gateway: string;
  gatewayLabel: string;
  orders: ShopifyOrderRow[];
  totalSubtotal: number;
  totalShipping: number;
  totalAmount: number;
  orderCount: number;
  periodStart: string;
  periodEnd: string;
  skipped: boolean;       // true for shopify_payments
}

export interface ShopifyOrdersParseResult {
  success: true;
  gateways: GatewayGroup[];
  skippedGateways: GatewayGroup[];
  unpaidCount: number;
  totalOrderCount: number;
  settlements: StandardSettlement[];
}

export interface ShopifyOrdersParseError {
  success: false;
  error: string;
}

export type ShopifyOrdersResult = ShopifyOrdersParseResult | ShopifyOrdersParseError;

// ─── Helpers ────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function parseAmount(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^0-9.\-,]/g, '').replace(/,/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

function normaliseDate(raw: string): string {
  if (!raw) return '';
  const trimmed = raw.trim();

  // ISO: 2026-01-15T10:30:00+1100 or 2026-01-15
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.substring(0, 10);
  }

  // DD/MM/YYYY or MM/DD/YYYY
  const slashParts = trimmed.split(/[\/ ]/)[0]?.split('/');
  if (slashParts && slashParts.length === 3) {
    const [a, b, c] = slashParts;
    // Assume DD/MM/YYYY for AU
    if (parseInt(c) > 100) {
      return `${c}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`;
    }
  }

  try {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d.toISOString().substring(0, 10);
  } catch { /* fall through */ }

  return trimmed;
}

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

const SHOPIFY_PAYMENTS_ALIASES = new Set([
  'shopify_payments',
  'shopify payments',
  'shopify',
]);

function normaliseGateway(raw: string): string {
  return raw.trim().toLowerCase().replace(/\s+/g, '_');
}

function gatewayLabel(raw: string): string {
  const normalised = normaliseGateway(raw);
  const labels: Record<string, string> = {
    paypal: 'PayPal',
    afterpay: 'Afterpay',
    afterpay_v2: 'Afterpay',
    stripe: 'Stripe',
    shopify_payments: 'Shopify Payments',
    zip: 'Zip Pay',
    klarna: 'Klarna',
    manual: 'Manual Payment',
    bank_deposit: 'Bank Deposit',
    cash: 'Cash',
  };
  return labels[normalised] || raw.trim().split(/[\s_]+/).map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

function monthYear(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

// ─── Column Matching ────────────────────────────────────────────────────────

interface ColumnMap {
  name: number;
  financialStatus: number;
  paymentMethod: number;
  paidAt: number;
  subtotal: number;
  shipping: number;
  total: number;
  currency: number;
}

const COLUMN_PATTERNS: Record<keyof ColumnMap, RegExp[]> = {
  name:            [/^name$/i, /^order$/i, /^order\s*name$/i],
  financialStatus: [/^financial\s*status$/i],
  paymentMethod:   [/^payment\s*method$/i, /^payment\s*gateway$/i, /^gateway$/i],
  paidAt:          [/^paid\s*at$/i, /^paid\s*date$/i],
  subtotal:        [/^subtotal$/i, /^sub\s*total$/i],
  shipping:        [/^shipping$/i, /^shipping\s*amount$/i],
  total:           [/^total$/i],
  currency:        [/^currency$/i],
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

  // Require minimum: financialStatus, paymentMethod, total
  if (map.financialStatus === undefined || map.paymentMethod === undefined || map.total === undefined) {
    return null;
  }

  return {
    name:            map.name ?? -1,
    financialStatus: map.financialStatus!,
    paymentMethod:   map.paymentMethod!,
    paidAt:          map.paidAt ?? -1,
    subtotal:        map.subtotal ?? -1,
    shipping:        map.shipping ?? -1,
    total:           map.total!,
    currency:        map.currency ?? -1,
  };
}

// ─── Main Parser ────────────────────────────────────────────────────────────

export function parseShopifyOrdersCSV(csvContent: string): ShopifyOrdersResult {
  try {
    const lines = csvContent.split('\n').filter(l => l.trim().length > 0);
    if (lines.length < 2) {
      return { success: false, error: 'CSV must have at least a header row and one data row.' };
    }

    const headers = parseCSVRow(lines[0]);
    const colMap = matchColumns(headers);
    if (!colMap) {
      return {
        success: false,
        error: `Could not identify required columns. Found: ${headers.slice(0, 10).join(', ')}. Need: Financial Status, Payment Method, Total.`,
      };
    }

    // Parse all rows
    const allOrders: ShopifyOrderRow[] = [];
    let unpaidCount = 0;

    for (let i = 1; i < lines.length; i++) {
      const fields = parseCSVRow(lines[i]);
      if (fields.length < 3) continue;

      const financialStatus = colMap.financialStatus >= 0 ? fields[colMap.financialStatus]?.trim().toLowerCase() : '';
      const paymentMethod = colMap.paymentMethod >= 0 ? fields[colMap.paymentMethod]?.trim() : '';

      if (!paymentMethod) continue;

      // Only include paid orders
      if (financialStatus !== 'paid') {
        unpaidCount++;
        continue;
      }

      allOrders.push({
        name: colMap.name >= 0 ? fields[colMap.name]?.trim() || '' : '',
        financialStatus,
        paymentMethod,
        paidAt: colMap.paidAt >= 0 ? normaliseDate(fields[colMap.paidAt]?.trim() || '') : '',
        subtotal: colMap.subtotal >= 0 ? parseAmount(fields[colMap.subtotal] || '') : 0,
        shipping: colMap.shipping >= 0 ? parseAmount(fields[colMap.shipping] || '') : 0,
        total: parseAmount(fields[colMap.total] || ''),
        currency: colMap.currency >= 0 ? fields[colMap.currency]?.trim().toUpperCase() || 'AUD' : 'AUD',
      });
    }

    if (allOrders.length === 0) {
      return { success: false, error: 'No paid orders found in the CSV.' };
    }

    // ── Group by payment method ──
    const groupMap = new Map<string, ShopifyOrderRow[]>();
    for (const order of allOrders) {
      const key = normaliseGateway(order.paymentMethod);
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(order);
    }

    const gateways: GatewayGroup[] = [];
    const skippedGateways: GatewayGroup[] = [];

    for (const [key, orders] of groupMap) {
      const isShopifyPayments = SHOPIFY_PAYMENTS_ALIASES.has(key);
      const dates = orders.map(o => o.paidAt).filter(Boolean).sort();
      
      const group: GatewayGroup = {
        gateway: key,
        gatewayLabel: gatewayLabel(orders[0].paymentMethod),
        orders,
        totalSubtotal: round2(orders.reduce((s, o) => s + o.subtotal, 0)),
        totalShipping: round2(orders.reduce((s, o) => s + o.shipping, 0)),
        totalAmount: round2(orders.reduce((s, o) => s + o.total, 0)),
        orderCount: orders.length,
        periodStart: dates[0] || '',
        periodEnd: dates[dates.length - 1] || '',
        skipped: isShopifyPayments,
      };

      if (isShopifyPayments) {
        skippedGateways.push(group);
      } else {
        gateways.push(group);
      }
    }

    // Sort gateways by order count descending
    gateways.sort((a, b) => b.orderCount - a.orderCount);

    // ── Build StandardSettlements for each non-skipped gateway ──
    const settlements: StandardSettlement[] = gateways.map(g => {
      const GST_DIVISOR = 1.1;
      const salesInclGst = g.totalSubtotal;
      const shippingInclGst = g.totalShipping;
      const clearingAmount = -g.totalAmount; // negative to zero out

      const salesExGst = round2(salesInclGst / GST_DIVISOR);
      const shippingExGst = round2(shippingInclGst / GST_DIVISOR);
      const gstOnSales = round2(salesInclGst - salesExGst);
      const gstOnShipping = round2(shippingInclGst - shippingExGst);

      const settlementId = `shopify_${g.gateway}_${g.periodStart}_${g.periodEnd}`;
      const label = g.gatewayLabel;
      const period = monthYear(g.periodStart);

      return {
        marketplace: 'shopify_orders',
        settlement_id: settlementId,
        period_start: g.periodStart,
        period_end: g.periodEnd,
        sales_ex_gst: salesExGst,
        gst_on_sales: round2(gstOnSales + gstOnShipping),
        fees_ex_gst: 0, // No fees — clearing invoice
        gst_on_fees: 0,
        net_payout: 0,   // $0.00 invoice
        source: 'csv_upload',
        reconciles: true, // Always reconciles because it's $0.00
        metadata: {
          gateway: g.gateway,
          gatewayLabel: label,
          orderCount: g.orderCount,
          salesInclGst,
          shippingInclGst,
          shippingExGst,
          gstOnShipping,
          clearingAmount,
          reference: `Shopify ${label} ${period}`,
          contactName: label,
          invoiceType: 'clearing',
          // Account codes (defaults, user-configurable)
          salesAccountCode: '201',
          shippingAccountCode: '206',
          clearingAccountCode: '613',
        },
      };
    });

    return {
      success: true,
      gateways,
      skippedGateways,
      unpaidCount,
      totalOrderCount: allOrders.length + unpaidCount,
      settlements,
    };
  } catch (err: any) {
    return { success: false, error: `CSV parsing failed: ${err.message || 'Unknown error'}` };
  }
}

// ─── Xero Invoice Line Builder ──────────────────────────────────────────────

export interface XeroLineItem {
  Description: string;
  AccountCode: string;
  TaxType: string;
  UnitAmount: number;
  Quantity: number;
}

export function buildShopifyOrdersInvoiceLines(
  settlement: StandardSettlement,
  accountCodes?: { sales?: string; shipping?: string; clearing?: string }
): XeroLineItem[] {
  const meta = settlement.metadata || {};
  const salesCode = accountCodes?.sales || meta.salesAccountCode || '201';
  const shippingCode = accountCodes?.shipping || meta.shippingAccountCode || '206';
  const clearingCode = accountCodes?.clearing || meta.clearingAccountCode || '613';

  const lines: XeroLineItem[] = [];

  // Line 1: Shopify Sales - Principal (ex GST)
  if (settlement.sales_ex_gst !== 0) {
    lines.push({
      Description: `Shopify Sales - ${meta.gatewayLabel || 'Gateway'}`,
      AccountCode: salesCode,
      TaxType: 'OUTPUT', // GST on Income
      UnitAmount: round2(settlement.sales_ex_gst),
      Quantity: 1,
    });
  }

  // Line 2: Shopify Shipping Revenue (ex GST)
  if (meta.shippingExGst && meta.shippingExGst !== 0) {
    lines.push({
      Description: `Shopify Shipping Revenue - ${meta.gatewayLabel || 'Gateway'}`,
      AccountCode: shippingCode,
      TaxType: 'OUTPUT', // GST on Income
      UnitAmount: round2(meta.shippingExGst),
      Quantity: 1,
    });
  }

  // Line 3: Gateway Clearing (negative, BAS Excluded)
  if (meta.clearingAmount && meta.clearingAmount !== 0) {
    lines.push({
      Description: `${meta.gatewayLabel || 'Gateway'} Clearing`,
      AccountCode: clearingCode,
      TaxType: 'BASEXCLUDED', // BAS Excluded
      UnitAmount: round2(meta.clearingAmount),
      Quantity: 1,
    });
  }

  return lines;
}

// ─── Fingerprint Check ──────────────────────────────────────────────────────

/** Quick check: does this CSV look like a Shopify Orders export? */
export function isShopifyOrdersCSV(headers: string[]): boolean {
  const lower = headers.map(h => h.toLowerCase().trim());
  const hasPaymentMethod = lower.some(h => /^payment\s*method$/i.test(h));
  const hasFinancialStatus = lower.some(h => /^financial\s*status$/i.test(h));
  const hasPaidAt = lower.some(h => /^paid\s*at$/i.test(h));
  return hasPaymentMethod && hasFinancialStatus && hasPaidAt;
}
