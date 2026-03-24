/**
 * settlementSources — Client-side mirror of supabase/functions/_shared/settlementSources.ts.
 *
 * Only sources in this list can create accounting entries in Xero.
 * Everything else (order-level APIs like Kogan, Shopify sub-channel syncs)
 * is automatically reconciliation-only.
 *
 * IMPORTANT: This file MUST stay identical to the server-side copy.
 * Edge functions cannot import from src/ — this is the only acceptable duplication.
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
