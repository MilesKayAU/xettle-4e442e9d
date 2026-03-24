/**
 * settlementPolicy — Client-side settlement push gating.
 *
 * Uses an allowlist of pushable sources. Only explicitly approved payout
 * sources can be pushed to Xero. Everything else is automatically
 * reconciliation-only (order-level APIs, Shopify sub-channel syncs, etc.).
 *
 * IMPORTANT: This file's logic MUST stay in sync with the server-side copy
 * at supabase/functions/_shared/settlementPolicy.ts.
 */

import { PUSHABLE_SOURCES } from './settlementSources';

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

/**
 * Returns a user-facing reason why a settlement is blocked from Xero push,
 * or null if it's pushable.
 */
export function getPushBlockReason(
  source?: string | null,
  marketplace?: string | null,
  settlementId?: string | null,
): string | null {
  if (!source) return null;

  if (!(PUSHABLE_SOURCES as readonly string[]).includes(source)) {
    return 'This settlement contains order-level data only and cannot be pushed to Xero. Upload your payout CSV or export to create a pushable settlement.';
  }

  if (settlementId?.startsWith('shopify_auto_')) {
    return 'This is an order-derived reconciliation record — use the marketplace payout settlement for Xero push.';
  }

  return null;
}
