/**
 * settlementSources — Single source of truth for pushable settlement sources.
 *
 * Only sources in this list can create accounting entries in Xero.
 * Everything else (order-level APIs like Kogan, Shopify sub-channel syncs)
 * is automatically reconciliation-only.
 *
 * IMPORTANT: The client-side mirror at src/utils/settlementSources.ts
 * MUST stay identical. If you change one, change both.
 */

export const PUSHABLE_SOURCES = [
  'csv_upload',
  'manual',
  'api',
  'ebay_api',
  'mirakl_api',
  'amazon_api',
] as const;

export type PushableSource = typeof PUSHABLE_SOURCES[number];
