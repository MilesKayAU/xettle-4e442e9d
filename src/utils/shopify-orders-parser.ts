/**
 * Shopify Orders CSV Parser — Registry-based marketplace splitter
 * 
 * Parses Shopify's Orders export CSV, detects marketplace per row using
 * the central marketplace registry (Note Attributes → Tags → Payment Method),
 * groups by marketplace + currency, and creates $0.00 clearing invoices.
 * 
 * Fingerprint: columns contain Name, Financial Status, Paid at, Subtotal,
 * Shipping, Taxes, Total, Payment Method, Note Attributes, Tags
 * 
 * marketplace_code per group: 'shopify_orders_{registry_key}'
 * source: 'csv_upload'
 */

import type { StandardSettlement } from './settlement-engine';
import {
  MARKETPLACE_REGISTRY,
  detectMarketplaceFromRow,
  getRegistryEntry,
  type MarketplaceRegistryEntry,
} from './marketplace-registry';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ShopifyOrderRow {
  name: string;
  financialStatus: string;
  paymentMethod: string;
  paidAt: string;
  subtotal: number;
  shipping: number;
  taxes: number;
  total: number;
  discountAmount: number;
  currency: string;
  noteAttributes: string;
  tags: string;
  detectedMarketplace: string; // registry key
  /** Line item SKU (normalised: uppercase, no spaces/hyphens) */
  lineitemSku: string;
  /** Line item quantity */
  lineitemQuantity: number;
  /** Line item price */
  lineitemPrice: number;
}

export interface MarketplaceGroup {
  marketplaceKey: string;        // registry key (e.g. 'mydeal', 'paypal')
  registryEntry: MarketplaceRegistryEntry;
  orders: ShopifyOrderRow[];
  orderCount: number;
  totalSubtotal: number;
  totalShipping: number;
  totalTaxes: number;
  totalAmount: number;
  totalDiscounts: number;
  periodStart: string;
  periodEnd: string;
  currency: string;
  skipped: boolean;
  skipReason?: string;
  /** Status for review UI */
  status: 'ready' | 'skipped' | 'needs_review' | 'unknown';
  /** Sample note attributes for unknown groups */
  sampleNoteAttributes?: string[];
  /** Sample tags for unknown groups */
  sampleTags?: string[];
}

export interface ShopifyOrdersParseResult {
  success: true;
  groups: MarketplaceGroup[];
  skippedGroups: MarketplaceGroup[];
  unknownGroups: MarketplaceGroup[];
  unpaidCount: number;
  totalOrderCount: number;
  paidCount: number;
  duplicateLineItemCount: number;
  settlements: StandardSettlement[];
  periodStart: string;
  periodEnd: string;
  /** True if period_end is within last 3 days — may be a partial import */
  partialPeriodWarning: boolean;
}

export interface ShopifyOrdersParseError {
  success: false;
  error: string;
}

export type ShopifyOrdersResult = ShopifyOrdersParseResult | ShopifyOrdersParseError;

// Keep old types for backward compat
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
  skipped: boolean;
}

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
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.substring(0, 10);
  const slashParts = trimmed.split(/[\/ ]/)[0]?.split('/');
  if (slashParts && slashParts.length === 3) {
    const [a, b, c] = slashParts;
    if (parseInt(c) > 100) return `${c}-${b.padStart(2, '0')}-${a.padStart(2, '0')}`;
  }
  try {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d.toISOString().substring(0, 10);
  } catch { /* fall through */ }
  return trimmed;
}

/**
 * Normalise a SKU for consistent matching:
 * trim, uppercase, remove hyphens and spaces.
 */
export function normaliseSku(raw: string): string {
  if (!raw) return '';
  return raw.trim().toUpperCase().replace(/[-\s]/g, '');
}

/**
 * Split CSV content into logical rows, correctly handling multi-line quoted fields.
 * Shopify Note Attributes for Bunnings/Mirakl orders can span 7+ physical lines.
 */
function splitCSVIntoRows(content: string): string[] {
  const rows: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const ch = content[i];

    if (ch === '"') {
      // Handle escaped quotes ""
      if (inQuotes && i + 1 < content.length && content[i + 1] === '"') {
        current += '""';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      current += ch;
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      // End of logical row
      if (ch === '\r' && i + 1 < content.length && content[i + 1] === '\n') {
        i++; // skip \r\n pair
      }
      if (current.trim().length > 0) {
        rows.push(current);
      }
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim().length > 0) {
    rows.push(current);
  }
  return rows;
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
  taxes: number;
  total: number;
  discountAmount: number;
  currency: number;
  noteAttributes: number;
  tags: number;
  lineitemSku: number;
  lineitemQuantity: number;
  lineitemPrice: number;
}

const COLUMN_PATTERNS: Record<keyof ColumnMap, RegExp[]> = {
  name:              [/^name$/i, /^order$/i, /^order\s*name$/i],
  financialStatus:   [/^financial\s*status$/i],
  paymentMethod:     [/^payment\s*method$/i, /^payment\s*gateway$/i, /^gateway$/i],
  paidAt:            [/^paid\s*at$/i, /^paid\s*date$/i],
  subtotal:          [/^subtotal$/i, /^sub\s*total$/i],
  shipping:          [/^shipping$/i, /^shipping\s*amount$/i],
  taxes:             [/^taxes$/i, /^tax$/i, /^tax\s*amount$/i],
  total:             [/^total$/i],
  discountAmount:    [/^discount\s*amount$/i, /^discounts?$/i, /^discount\s*code$/i],
  currency:          [/^currency$/i],
  noteAttributes:    [/^note\s*attributes$/i, /^notes?\s*attributes?$/i, /^note$/i],
  tags:              [/^tags$/i],
  lineitemSku:       [/^lineitem\s*sku$/i, /^line\s*item\s*sku$/i],
  lineitemQuantity:  [/^lineitem\s*quantity$/i, /^line\s*item\s*quantity$/i],
  lineitemPrice:     [/^lineitem\s*price$/i, /^line\s*item\s*price$/i],
};

function matchColumns(headers: string[]): ColumnMap | null {
  const map: Partial<ColumnMap> = {};
  for (const [key, patterns] of Object.entries(COLUMN_PATTERNS)) {
    for (const pattern of patterns) {
      const idx = headers.findIndex(h => pattern.test(h.trim()));
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
    name:             map.name ?? -1,
    financialStatus:  map.financialStatus!,
    paymentMethod:    map.paymentMethod!,
    paidAt:           map.paidAt ?? -1,
    subtotal:         map.subtotal ?? -1,
    shipping:         map.shipping ?? -1,
    taxes:            map.taxes ?? -1,
    total:            map.total!,
    discountAmount:   map.discountAmount ?? -1,
    currency:         map.currency ?? -1,
    noteAttributes:   map.noteAttributes ?? -1,
    tags:             map.tags ?? -1,
    lineitemSku:      map.lineitemSku ?? -1,
    lineitemQuantity: map.lineitemQuantity ?? -1,
    lineitemPrice:    map.lineitemPrice ?? -1,
  };
}

// ─── Main Parser ────────────────────────────────────────────────────────────

export function parseShopifyOrdersCSV(
  csvContent: string,
  options?: { taxRate?: number }
): ShopifyOrdersResult {
  const taxRate = options?.taxRate ?? 0.10;

  try {
    // Use multi-line-aware CSV splitter (handles Bunnings Note Attributes spanning 7+ lines)
    const lines = splitCSVIntoRows(csvContent);
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

    // Parse all rows — deduplicate by order Name (multi-line-item orders have
    // order-level totals only on the first row; continuation rows have empty
    // Financial Status, so the 'paid' filter already excludes them. This Map
    // is a safety net in case a CSV ever duplicates the header row for the
    // same order.)
    const seenOrders = new Set<string>();
    const allOrders: ShopifyOrderRow[] = [];
    let unpaidCount = 0;
    let duplicateLineItemCount = 0;

    for (let i = 1; i < lines.length; i++) {
      const fields = parseCSVRow(lines[i]);
      if (fields.length < 3) continue;

      const financialStatus = colMap.financialStatus >= 0 ? fields[colMap.financialStatus]?.trim().toLowerCase() : '';
      const paymentMethod = colMap.paymentMethod >= 0 ? fields[colMap.paymentMethod]?.trim() : '';

      if (!paymentMethod && !financialStatus) continue;

      // Only include paid orders
      if (financialStatus !== 'paid') {
        unpaidCount++;
        continue;
      }

      // Order-level dedup: Shopify exports one row per line item.
      // Order-level totals (Subtotal, Shipping, Total) live on the first row only.
      // If we've already seen this order Name, skip it.
      const orderName = colMap.name >= 0 ? fields[colMap.name]?.trim() || '' : '';
      if (orderName && seenOrders.has(orderName)) {
        duplicateLineItemCount++;
        continue;
      }
      if (orderName) seenOrders.add(orderName);

      const noteAttributes = colMap.noteAttributes >= 0 ? fields[colMap.noteAttributes]?.trim() || '' : '';
      const tags = colMap.tags >= 0 ? fields[colMap.tags]?.trim() || '' : '';

      // Detect marketplace using registry
      const detectedMarketplace = detectMarketplaceFromRow(noteAttributes, tags, paymentMethod);

      // Extract line item data for profit engine
      const rawSku = colMap.lineitemSku >= 0 ? fields[colMap.lineitemSku]?.trim() || '' : '';
      const lineitemQuantity = colMap.lineitemQuantity >= 0 ? parseAmount(fields[colMap.lineitemQuantity] || '') : 0;
      const lineitemPrice = colMap.lineitemPrice >= 0 ? parseAmount(fields[colMap.lineitemPrice] || '') : 0;

      allOrders.push({
        name: orderName,
        financialStatus,
        paymentMethod,
        paidAt: colMap.paidAt >= 0 ? normaliseDate(fields[colMap.paidAt]?.trim() || '') : '',
        subtotal: colMap.subtotal >= 0 ? parseAmount(fields[colMap.subtotal] || '') : 0,
        shipping: colMap.shipping >= 0 ? parseAmount(fields[colMap.shipping] || '') : 0,
        taxes: colMap.taxes >= 0 ? parseAmount(fields[colMap.taxes] || '') : 0,
        total: parseAmount(fields[colMap.total] || ''),
        discountAmount: colMap.discountAmount >= 0 ? parseAmount(fields[colMap.discountAmount] || '') : 0,
        currency: colMap.currency >= 0 ? fields[colMap.currency]?.trim().toUpperCase() || 'AUD' : 'AUD',
        noteAttributes,
        tags,
        detectedMarketplace,
        lineitemSku: normaliseSku(rawSku),
        lineitemQuantity,
        lineitemPrice,
      });
    }

    if (allOrders.length === 0) {
      return { success: false, error: 'No paid orders found in the CSV.' };
    }

    // ── Group by marketplace_key + currency using JSON.stringify for safety ──
    // This prevents splitting bugs for keys like "everyday_market" + "AUD"
    const makeGroupKey = (order: ShopifyOrderRow) =>
      JSON.stringify({ m: order.detectedMarketplace, c: order.currency });

    const groupMap = new Map<string, ShopifyOrderRow[]>();
    for (const order of allOrders) {
      const key = makeGroupKey(order);
      if (!groupMap.has(key)) groupMap.set(key, []);
      groupMap.get(key)!.push(order);
    }

    const readyGroups: MarketplaceGroup[] = [];
    const skippedGroups: MarketplaceGroup[] = [];
    const unknownGroups: MarketplaceGroup[] = [];

    for (const [key, orders] of groupMap) {
      const { m: actualMktKey, c: currency } = JSON.parse(key);

      const entry = getRegistryEntry(actualMktKey);
      const dates = orders.map(o => o.paidAt).filter(Boolean).sort();

      // Unique order count (safety — already deduped above, but belt-and-braces)
      const uniqueOrderNames = new Set(orders.map(o => o.name).filter(Boolean));
      const orderCount = uniqueOrderNames.size > 0 ? uniqueOrderNames.size : orders.length;

      // Sample data for unknown groups
      const uniqueNotes = [...new Set(orders.map(o => o.noteAttributes).filter(Boolean))].slice(0, 3);
      const uniqueTags = [...new Set(orders.map(o => o.tags).filter(Boolean))].slice(0, 3);

      const group: MarketplaceGroup = {
        marketplaceKey: actualMktKey,
        registryEntry: entry,
        orders,
        orderCount,
        totalSubtotal: round2(orders.reduce((s, o) => s + o.subtotal, 0)),
        totalShipping: round2(orders.reduce((s, o) => s + o.shipping, 0)),
        totalTaxes: round2(orders.reduce((s, o) => s + o.taxes, 0)),
        totalAmount: round2(orders.reduce((s, o) => s + o.total, 0)),
        totalDiscounts: round2(orders.reduce((s, o) => s + o.discountAmount, 0)),
        periodStart: dates[0] || '',
        periodEnd: dates[dates.length - 1] || '',
        currency,
        skipped: !!entry.skip,
        skipReason: entry.skip_reason || entry.reason,
        status: entry.skip ? 'skipped' : (actualMktKey === 'unknown' ? 'unknown' : 'ready'),
        sampleNoteAttributes: uniqueNotes,
        sampleTags: uniqueTags,
      };

      if (entry.skip) {
        skippedGroups.push(group);
      } else if (actualMktKey === 'unknown') {
        unknownGroups.push(group);
      } else {
        readyGroups.push(group);
      }
    }

    // Sort by order count descending
    readyGroups.sort((a, b) => b.orderCount - a.orderCount);
    unknownGroups.sort((a, b) => b.orderCount - a.orderCount);

    // ── Build StandardSettlements for ready groups ──
    const settlements = buildSettlementsFromGroups(readyGroups, taxRate);

    // Overall period
    const allDates = allOrders.map(o => o.paidAt).filter(Boolean).sort();

    // Detect partial period: warn if period_end is within last 3 days
    const lastDate = allDates[allDates.length - 1] || '';
    let partialPeriodWarning = false;
    if (lastDate) {
      const endMs = new Date(lastDate + 'T23:59:59').getTime();
      const nowMs = Date.now();
      const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
      partialPeriodWarning = (nowMs - endMs) < threeDaysMs;
    }

    return {
      success: true,
      groups: readyGroups,
      skippedGroups,
      unknownGroups,
      unpaidCount,
      totalOrderCount: allOrders.length + unpaidCount + duplicateLineItemCount,
      paidCount: allOrders.length,
      duplicateLineItemCount,
      settlements,
      periodStart: allDates[0] || '',
      periodEnd: allDates[allDates.length - 1] || '',
      partialPeriodWarning,
    };
  } catch (err: any) {
    return { success: false, error: `CSV parsing failed: ${err.message || 'Unknown error'}` };
  }
}

// ─── Settlement Builder ─────────────────────────────────────────────────────

export function buildSettlementsFromGroups(
  groups: MarketplaceGroup[],
  taxRate: number = 0.10
): StandardSettlement[] {
  return groups.map(g => {
    const entry = g.registryEntry;
    const divisor = 1 + taxRate;

    const salesInclGst = g.totalSubtotal;
    const shippingInclGst = g.totalShipping;
    const salesExGst = round2(salesInclGst / divisor);
    const shippingExGst = round2(shippingInclGst / divisor);
    const gstOnSales = round2(salesInclGst - salesExGst);
    const gstOnShipping = round2(shippingInclGst - shippingExGst);
    const clearingAmount = -g.totalAmount;

    const marketplaceCode = `shopify_orders_${g.marketplaceKey}`;
    const settlementId = `shopify_orders_${g.marketplaceKey}_${g.currency}_${g.periodStart}_${g.periodEnd}`;
    const period = monthYear(g.periodStart);

    // Verify $0.00 balance
    const invoiceTotal = round2(salesInclGst + shippingInclGst + clearingAmount);
    const balances = Math.abs(invoiceTotal) < 0.02;

    return {
      marketplace: marketplaceCode,
      settlement_id: settlementId,
      period_start: g.periodStart,
      period_end: g.periodEnd,
      sales_ex_gst: salesExGst,
      gst_on_sales: round2(gstOnSales + gstOnShipping),
      fees_ex_gst: 0,
      gst_on_fees: 0,
      net_payout: 0,
      source: 'csv_upload' as const,
      reconciles: balances,
      metadata: {
        marketplaceKey: g.marketplaceKey,
        displayName: entry.display_name,
        contactName: entry.contact_name,
        orderCount: g.orderCount,
        currency: g.currency,
        salesInclGst,
        shippingInclGst,
        salesExGst,
        shippingExGst,
        gstOnSales,
        gstOnShipping,
        clearingAmount,
        invoiceTotal,
        reference: `${entry.display_name} Orders ${period}`,
        invoiceType: 'clearing',
        salesAccountCode: entry.default_sales_account,
        shippingAccountCode: entry.default_shipping_account,
        clearingAccountCode: entry.default_clearing_account,
        feesAccountCode: entry.default_fees_account,
        paymentType: entry.payment_type,
        taxRate,
      },
    };
  });
}

// ─── Xero Invoice Line Builder ──────────────────────────────────────────────

export interface XeroLineItem {
  Description: string;
  AccountCode: string;
  TaxType: string;
  UnitAmount: number;
  TaxAmount?: number;
  Quantity: number;
}

export function buildShopifyOrdersInvoiceLines(
  settlement: StandardSettlement,
  accountCodes?: { sales?: string; shipping?: string; clearing?: string; fees?: string }
): XeroLineItem[] {
  const meta = settlement.metadata || {};
  const salesCode = accountCodes?.sales || meta.salesAccountCode || '201';
  const shippingCode = accountCodes?.shipping || meta.shippingAccountCode || '206';
  const clearingCode = accountCodes?.clearing || meta.clearingAccountCode || '613';
  const displayName = meta.displayName || meta.contactName || 'Marketplace';

  const lines: XeroLineItem[] = [];

  // Line 1: Sales (ex GST + explicit tax amount)
  if (meta.salesExGst && meta.salesExGst !== 0) {
    lines.push({
      Description: `${displayName} Sales — ${meta.orderCount} orders ${settlement.period_start} to ${settlement.period_end}`,
      AccountCode: salesCode,
      TaxType: 'OUTPUT',
      UnitAmount: round2(meta.salesExGst),
      TaxAmount: round2(meta.gstOnSales || 0),
      Quantity: 1,
    });
  }

  // Line 2: Shipping Revenue (ex GST + explicit tax amount)
  if (meta.shippingExGst && meta.shippingExGst !== 0) {
    lines.push({
      Description: `${displayName} Shipping Revenue`,
      AccountCode: shippingCode,
      TaxType: 'OUTPUT',
      UnitAmount: round2(meta.shippingExGst),
      TaxAmount: round2(meta.gstOnShipping || 0),
      Quantity: 1,
    });
  }

  // Line 3: Clearing (negative total, BAS Excluded)
  if (meta.clearingAmount && meta.clearingAmount !== 0) {
    lines.push({
      Description: `Awaiting ${displayName} settlement payment — match to account ${clearingCode} when bank transfer received`,
      AccountCode: clearingCode,
      TaxType: 'BASEXCLUDED',
      UnitAmount: round2(meta.clearingAmount),
      TaxAmount: 0,
      Quantity: 1,
    });
  }

  return lines;
}

// ─── Fingerprint Check ──────────────────────────────────────────────────────

/**
 * Detect if a CSV is a Shopify Orders export.
 * Requires all 10 spec columns AND rejects payout files.
 */
export function isShopifyOrdersCSV(headers: string[]): boolean {
  const lower = headers.map(h => h.toLowerCase().trim());

  // REJECT: If payout-specific columns present, this is NOT an orders file
  const hasPayoutId = lower.some(h => /^payout\s*id$/i.test(h) || /^bank\s*reference$/i.test(h));
  if (hasPayoutId) return false;

  // REQUIRE: All 10 spec columns
  const requiredPatterns: RegExp[] = [
    /^name$/i,
    /^financial\s*status$/i,
    /^paid\s*at$/i,
    /^subtotal$/i,
    /^shipping$/i,
    /^taxes?$/i,
    /^total$/i,
    /^payment\s*(method|gateway)$/i,
    /^note\s*attributes?$/i,
    /^tags$/i,
  ];

  return requiredPatterns.every(pattern =>
    lower.some(h => pattern.test(h))
  );
}
