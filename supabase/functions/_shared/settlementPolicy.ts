/**
 * settlementPolicy — Canonical server-side settlement policy helpers.
 *
 * Uses an allowlist of pushable sources. Only explicitly approved payout
 * sources can be pushed to Xero. Everything else is automatically
 * reconciliation-only (order-level APIs, Shopify sub-channel syncs, etc.).
 *
 * IMPORTANT: This file's logic MUST stay in sync with the client-side copy
 * at src/utils/settlement-policy.ts.
 */

import { PUSHABLE_SOURCES } from './settlementSources.ts';

export function isReconciliationOnly(
  source?: string | null,
  marketplace?: string | null,
  settlementId?: string | null,
): boolean {
  if (!source) return false;

  // Allowlist gate: only approved payout sources can push to Xero
  if (!(PUSHABLE_SOURCES as readonly string[]).includes(source)) return true;

  // Secondary safety net: Shopify-derived auto-settlements
  if (settlementId?.startsWith('shopify_auto_')) return true;

  return false;
}
