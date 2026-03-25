/**
 * Canonical Reconciliation Status — Single source of truth for gap-derived status.
 *
 * EVERY UI component and action must use these functions instead of trusting
 * legacy `reconciliation_status` strings like 'matched' or 'reconciled'.
 *
 * Thresholds (from reconciliation-tolerance.ts):
 *   abs(diff) <= 0.05  → OK (exact match)
 *   0.05 < abs(diff) <= 1.00 → warn (rounding tolerance)
 *   abs(diff) > 1.00 → blocked (gap detected)
 */

import { RECONCILIATION_PUSH_TOLERANCE, TOL_LINE_SUM } from '@/constants/reconciliation-tolerance';

export type CanonicalReconStatus = 'ok' | 'warn' | 'gap_detected' | 'unknown';

/**
 * Derives the canonical reconciliation status from the numerical gap.
 * This is the ONLY function that should determine whether a settlement
 * is reconciled, has a tolerable rounding diff, or has a blocking gap.
 */
export function deriveReconStatus(reconciliationDifference: number | null | undefined): CanonicalReconStatus {
  if (reconciliationDifference == null) return 'unknown';
  const absGap = Math.abs(reconciliationDifference);
  if (absGap <= TOL_LINE_SUM) return 'ok';         // <= $0.01
  if (absGap <= RECONCILIATION_PUSH_TOLERANCE) return 'warn';  // <= $1.00
  return 'gap_detected';  // > $1.00
}

/**
 * Returns true if the gap blocks pushing to Xero.
 * Use this instead of checking `reconciliation_status === 'matched'`.
 */
export function isGapBlocking(reconciliationDifference: number | null | undefined): boolean {
  return deriveReconStatus(reconciliationDifference) === 'gap_detected';
}

/**
 * Returns true if the settlement is safe to push (no blocking gap).
 * Replaces legacy checks like `reconciliation_status === 'matched'` or `'reconciled'`.
 */
export function isReconSafeForPush(reconciliationDifference: number | null | undefined): boolean {
  const status = deriveReconStatus(reconciliationDifference);
  return status === 'ok' || status === 'warn' || status === 'unknown';
}
