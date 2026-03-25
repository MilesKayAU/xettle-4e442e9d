/**
 * RECONCILIATION TOLERANCES — Canonical constant file
 *
 * All reconciliation / mismatch tolerance thresholds live here.
 * Import from this file instead of hardcoding numeric literals.
 *
 * Three named tolerances for different risk profiles:
 *
 * 1. TOL_LINE_SUM  — strict; validates line-item sums vs totals
 * 2. TOL_PARSER_TOTAL — strict; validates parser-derived totals within parsing layer
 * 3. TOL_PAYOUT_MATCH — slightly flexible; compares invoice total to bank deposit
 *
 * See: ARCHITECTURE.md for context on reconciliation layers.
 */

/** Used when validating line items sum to invoice total / builder totals. */
export const TOL_LINE_SUM = 0.01;

/** Used when validating parser-derived totals within the settlement parsing layer. */
export const TOL_PARSER_TOTAL = 0.01;

/**
 * Used only when comparing invoice total to payout / bank_deposit.
 * Slightly more flexible to account for rounding drift and bank-side adjustments.
 */
export const TOL_PAYOUT_MATCH = 0.05;

/**
 * Column totals pass/warn threshold (reconciliation engine diagnostics).
 * Line sum vs summary gross — slightly looser than strict line-sum.
 */
export const TOL_COLUMN_TOTALS = 0.02;

/**
 * GST consistency threshold — GST on income vs expected (sales ÷ 11).
 * GST calculations have more rounding surface area.
 */
export const TOL_GST_CONSISTENCY = 0.50;

/**
 * Bunnings PDF reconciliation tolerance — PDFs have more extraction noise.
 */
export const TOL_BUNNINGS_PDF = 0.10;

/**
 * Generic parser reconciliation tolerance — used when comparing calculated net
 * vs reported net for any CSV/XLSX parsed through the generic parser.
 * Slightly looser than strict line-sum to account for rounding across rows.
 */
export const TOL_GENERIC_PARSER = 0.10;

/**
 * Reconciliation gap tolerance for push-to-Xero gating.
 * Settlements with |bank_deposit - computed_net| > this value are blocked from pushing.
 * Applied at: PushSafetyPreview (UI), xeroPush canonical action, sync-settlement-to-xero (server).
 */
export const RECONCILIATION_PUSH_TOLERANCE = 1.00;
