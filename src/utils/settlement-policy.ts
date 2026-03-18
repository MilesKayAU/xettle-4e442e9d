/**
 * settlementPolicy — Client-side mirror of supabase/functions/_shared/settlementPolicy.ts.
 *
 * isReconciliationOnly: Shopify-derived marketplace settlements (api_sync + shopify_orders_*)
 * are treated as reconciliation aids only — they must NEVER be pushed to Xero.
 * The authoritative accounting record is always the marketplace CSV upload.
 */

export function isReconciliationOnly(source: string | null | undefined, marketplace: string | null | undefined): boolean {
  if (!source || !marketplace) return false;
  return source === 'api_sync' && marketplace.startsWith('shopify_orders_');
}
