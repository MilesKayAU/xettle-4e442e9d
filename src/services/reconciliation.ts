/**
 * Reconciliation Service
 * 
 * THE single source of truth for the reconciliation formula, GST treatment,
 * tolerance gates, and computed-net calculations across all of Xettle.
 * 
 * Every location that computes a reconciliation gap MUST import from here.
 * No hardcoded formulas in UI components, actions, or edge functions.
 * 
 * Edge functions (Deno) cannot import this directly — they should replicate
 * the constants from this file and reference this as the canonical spec.
 * 
 * @module services/reconciliation
 */

import {
  RECONCILIATION_PUSH_TOLERANCE,
  TOL_LINE_SUM,
} from '@/constants/reconciliation-tolerance';

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Marketplaces where bank_deposit includes GST.
 * For these, gst_on_income and gst_on_expenses are factored into the reconciliation formula.
 * For all others, GST fields are informational only (BAS reporting).
 */
export const GST_INCLUSIVE_MARKETPLACES = [
  'shopify_payments',
  'everyday_market',
  'bigw',
  'woolworths_marketplus',
  'woolworths_everyday',
  'woolworths_bigw',
  'bunnings',
] as const;

/**
 * The maximum acceptable difference between computed net and bank_deposit
 * before a settlement is blocked from pushing to Xero.
 */
export const RECONCILIATION_TOLERANCE = 1.00;

/**
 * Threshold below which formula gaps are classified as rounding residuals
 * rather than data issues requiring investigation.
 */
export const ROUNDING_RESIDUAL_THRESHOLD = 10.00;

// ─── Types ──────────────────────────────────────────────────────────────────

/** Minimal settlement fields needed to compute reconciliation. */
export interface ReconciliationInput {
  marketplace: string;
  sales_principal: number;
  sales_shipping: number;
  seller_fees: number;
  other_fees: number;
  refunds: number;
  reimbursements: number;
  fba_fees?: number;
  storage_fees?: number;
  advertising_costs?: number;
  gst_on_income?: number;
  gst_on_expenses?: number;
  bank_deposit: number;
}

export interface ReconciliationResult {
  /** The formula-computed net payout */
  computedNet: number;
  /** bank_deposit - computedNet (positive = bank got more, negative = bank got less) */
  gap: number;
  /** Absolute value of gap */
  absGap: number;
  /** Whether the gap is within the $1.00 tolerance */
  withinTolerance: boolean;
  /** Whether GST was included in the calculation */
  gstInclusive: boolean;
  /** Whether the gap is a minor rounding residual (<$10) */
  isRoundingResidual: boolean;
}

// ─── Core Functions ─────────────────────────────────────────────────────────

/**
 * Determines whether a marketplace's bank deposits include GST.
 */
export function isGstInclusive(marketplace: string): boolean {
  return (GST_INCLUSIVE_MARKETPLACES as readonly string[]).includes(marketplace);
}

/**
 * The canonical reconciliation formula.
 * 
 * For GST-inclusive marketplaces:
 *   sales_principal + sales_shipping + gst_on_income - |gst_on_expenses|
 *   + reimbursements - |seller_fees| - |other_fees| - |refunds|
 *   - |advertising_costs| - |fba_fees| - |storage_fees|
 *   = bank_deposit
 * 
 * For ex-GST marketplaces:
 *   Same formula but WITHOUT gst_on_income and gst_on_expenses.
 * 
 * This is THE formula. If you need to change it, change it HERE and
 * update the edge function equivalent in run-system-audit/index.ts.
 */
export function computeReconciliation(input: ReconciliationInput): ReconciliationResult {
  const sp = Number(input.sales_principal) || 0;
  const ss = Number(input.sales_shipping) || 0;
  const sf = Math.abs(Number(input.seller_fees) || 0);
  const of_ = Math.abs(Number(input.other_fees) || 0);
  const rf = Math.abs(Number(input.refunds) || 0);
  const ac = Math.abs(Number(input.advertising_costs) || 0);
  const rb = Number(input.reimbursements) || 0;
  const gi = Number(input.gst_on_income) || 0;
  const ge = Math.abs(Number(input.gst_on_expenses) || 0);
  const bd = Number(input.bank_deposit) || 0;
  const fba = Math.abs(Number(input.fba_fees) || 0);
  const stg = Math.abs(Number(input.storage_fees) || 0);

  const gstInclusive = isGstInclusive(input.marketplace);

  const computedNet = sp + ss
    + (gstInclusive ? gi - ge : 0)
    + rb
    - sf - of_ - rf - ac - fba - stg;

  const gap = bd - computedNet;
  const absGap = Math.abs(gap);

  return {
    computedNet: +computedNet.toFixed(2),
    gap: +gap.toFixed(2),
    absGap: +absGap.toFixed(2),
    withinTolerance: absGap <= RECONCILIATION_TOLERANCE,
    gstInclusive,
    isRoundingResidual: absGap > RECONCILIATION_TOLERANCE && absGap <= ROUNDING_RESIDUAL_THRESHOLD,
  };
}

/**
 * Quick boolean check: is this settlement safe to push to Xero?
 * Uses the canonical formula + tolerance gate.
 */
export function isPushSafe(input: ReconciliationInput): boolean {
  return computeReconciliation(input).withinTolerance;
}

/**
 * Classify the severity of a reconciliation gap for audit/display purposes.
 */
export function classifyGap(absGap: number): 'matched' | 'rounding' | 'warning' | 'critical' {
  if (absGap <= RECONCILIATION_TOLERANCE) return 'matched';
  if (absGap <= ROUNDING_RESIDUAL_THRESHOLD) return 'rounding';
  if (absGap <= 50) return 'warning';
  return 'critical';
}
