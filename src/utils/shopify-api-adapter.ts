/**
 * Shopify API-to-Parser Adapter
 * 
 * Converts Shopify REST API order objects into the ShopifyOrderRow format
 * used by the existing shopify-orders-parser.ts, enabling the same
 * marketplace detection + settlement building pipeline for API-fetched orders.
 */

import type { ShopifyOrderRow } from './shopify-orders-parser';
import { detectMarketplaceFromRow } from './marketplace-registry';

// ─── Shopify API Order Shape (subset we use) ────────────────────────────────

export interface ShopifyApiOrder {
  id: number;
  name: string;
  created_at: string;
  processed_at: string;
  financial_status: string;
  gateway: string;
  note_attributes: Array<{ name: string; value: string }>;
  tags: string;
  subtotal_price: string;
  total_shipping_price_set?: {
    shop_money?: { amount: string; currency_code: string };
  };
  total_tax: string;
  total_price: string;
  total_discounts?: string;
  line_items: Array<{
    sku?: string;
    quantity: number;
    price: string;
  }>;
  payment_gateway_names: string[];
  currency?: string;
  source_name?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseAmount(raw: string | undefined | null): number {
  if (!raw) return 0;
  const val = parseFloat(raw);
  return isNaN(val) ? 0 : val;
}

function normaliseSku(raw: string): string {
  if (!raw) return '';
  return raw.trim().toUpperCase().replace(/[-\s]/g, '');
}

function formatDate(iso: string): string {
  if (!iso) return '';
  return iso.substring(0, 10); // YYYY-MM-DD
}

/**
 * Serialize note_attributes array into the same string format
 * that appears in Shopify CSV exports, so the registry detection
 * patterns can match against it.
 */
function serializeNoteAttributes(attrs: Array<{ name: string; value: string }>): string {
  if (!attrs || attrs.length === 0) return '';
  return attrs.map(a => `${a.name}: ${a.value}`).join('\n');
}

// ─── Main Adapter ───────────────────────────────────────────────────────────

/**
 * Convert an array of Shopify API orders into ShopifyOrderRow[].
 * 
 * Handles:
 * - Order dedup by name (multi-line-item orders → single row with first line item)
 * - Financial status filtering (paid + partially_refunded only)
 * - Note attributes serialization for registry matching
 * - Payment method extraction from gateway names
 * - Marketplace detection via registry
 */
export function convertApiOrdersToRows(
  apiOrders: ShopifyApiOrder[]
): {
  rows: ShopifyOrderRow[];
  unpaidCount: number;
  duplicateCount: number;
} {
  const seenOrders = new Set<string>();
  const rows: ShopifyOrderRow[] = [];
  let unpaidCount = 0;
  let duplicateCount = 0;

  const includedStatuses = ['paid', 'partially_refunded'];

  for (const order of apiOrders) {
    const financialStatus = (order.financial_status || '').toLowerCase();

    // Filter to paid + partially_refunded only
    if (!includedStatuses.includes(financialStatus)) {
      unpaidCount++;
      continue;
    }

    // Dedup by order name
    const orderName = order.name || `#${order.id}`;
    if (seenOrders.has(orderName)) {
      duplicateCount++;
      continue;
    }
    seenOrders.add(orderName);

    // Extract payment method (first gateway name)
    const paymentMethod = order.payment_gateway_names?.[0] || order.gateway || '';

    // Serialize note attributes
    const noteAttributes = serializeNoteAttributes(order.note_attributes || []);

    // Tags come as a comma-separated string from the API
    const tags = order.tags || '';

    // Detect marketplace using registry
    const detectedMarketplace = detectMarketplaceFromRow(noteAttributes, tags, paymentMethod);

    // Extract first line item for SKU data
    const firstItem = order.line_items?.[0];
    const rawSku = firstItem?.sku || '';
    const lineitemQuantity = firstItem?.quantity || 0;
    const lineitemPrice = parseAmount(firstItem?.price);

    // Shipping amount
    const shipping = parseAmount(
      order.total_shipping_price_set?.shop_money?.amount
    );

    // Currency
    const currency = order.total_shipping_price_set?.shop_money?.currency_code ||
      order.currency || 'AUD';

    rows.push({
      name: orderName,
      financialStatus,
      paymentMethod,
      paidAt: formatDate(order.processed_at || order.created_at),
      subtotal: parseAmount(order.subtotal_price),
      shipping,
      taxes: parseAmount(order.total_tax),
      total: parseAmount(order.total_price),
      discountAmount: parseAmount(order.total_discounts),
      currency: currency.toUpperCase(),
      noteAttributes,
      tags,
      detectedMarketplace,
      lineitemSku: normaliseSku(rawSku),
      lineitemQuantity,
      lineitemPrice,
    });
  }

  return { rows, unpaidCount, duplicateCount };
}

/**
 * Full pipeline: fetch orders via edge function → convert → group → build settlements.
 * 
 * This is the API equivalent of parseShopifyOrdersCSV() but for API-fetched orders.
 */
export async function fetchAndParseShopifyOrders(
  supabase: any,
  shopDomain: string,
  options?: {
    dateFrom?: string;
    dateTo?: string;
    limit?: number;
  }
): Promise<{
  success: boolean;
  orders?: ShopifyApiOrder[];
  rows?: ShopifyOrderRow[];
  count?: number;
  error?: string;
}> {
  try {
    const { data, error } = await supabase.functions.invoke('fetch-shopify-orders', {
      body: {
        shopDomain,
        dateFrom: options?.dateFrom,
        dateTo: options?.dateTo,
        limit: options?.limit || 250,
      },
    });

    if (error) {
      return { success: false, error: error.message || 'Failed to fetch orders' };
    }

    if (!data?.success) {
      return { success: false, error: data?.error || 'Unknown error from Shopify API' };
    }

    const apiOrders: ShopifyApiOrder[] = data.orders || [];
    const { rows, unpaidCount, duplicateCount } = convertApiOrdersToRows(apiOrders);

    return {
      success: true,
      orders: apiOrders,
      rows,
      count: data.count,
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'Network error' };
  }
}
