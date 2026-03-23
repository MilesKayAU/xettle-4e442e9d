/**
 * settlementPolicy — Canonical server-side settlement policy helpers.
 *
 * isReconciliationOnly: Shopify-derived marketplace settlements are treated as
 * reconciliation aids only — they must NEVER be pushed to Xero.
 * The authoritative accounting record is always the marketplace CSV upload.
 *
 * IMPORTANT: This file MUST stay identical to the client-side copy
 * at src/utils/settlement-policy.ts.
 */

export function isReconciliationOnly(
  source?: string | null,
  marketplace?: string | null,
  settlementId?: string | null,
): boolean {
  if (!source) return false;

  // Original rule: Shopify sub-channel order aggregations (shopify_orders_*)
  if (source === 'api_sync' && marketplace?.startsWith('shopify_orders_')) return true;

  // Extended rule: Shopify-derived auto-generated settlements (shopify_auto_*)
  if (source === 'api_sync' && settlementId?.startsWith('shopify_auto_')) return true;

  return false;
}
