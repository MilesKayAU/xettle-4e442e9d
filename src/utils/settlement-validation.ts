/**
 * Settlement Ingestion Validation Layer
 * 
 * Enforces accounting sign conventions and catches data anomalies
 * BEFORE data reaches the database. Every settlement write path must
 * call validateAndNormaliseSettlement() before persisting.
 * 
 * Sign conventions (Australian accounting standard):
 *   - sales_principal, sales_shipping, reimbursements → zero or POSITIVE
 *   - seller_fees, other_fees, fba_fees, storage_fees, advertising_costs, refunds → zero or NEGATIVE
 *   - gst_on_income → zero or POSITIVE
 *   - gst_on_expenses → zero or NEGATIVE
 *   - bank_deposit → can be positive or negative (refund-heavy periods)
 * 
 * Referenced by: settlement-engine.ts, fetch-ebay-settlements, fetch-mirakl-settlements, fetch-amazon-settlements
 */

import { computeReconciliation } from '@/services/reconciliation';


export interface SettlementFieldsForValidation {
  settlement_id: string;
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

export interface ValidationResult {
  valid: boolean;
  warnings: string[];
  normalised: SettlementFieldsForValidation;
}

/**
 * Validate and normalise settlement financial fields before database write.
 * Corrects sign inversions in-place and returns warnings for audit logging.
 * 
 * This is the architectural fix that prevents sign-inversion bugs from
 * ever reaching the database. Called at every ingestion entry point.
 */
export function validateAndNormaliseSettlement(
  settlement: SettlementFieldsForValidation,
  source: string
): ValidationResult {
  const warnings: string[] = [];
  // Work on a copy to avoid mutating the original unexpectedly
  const s = { ...settlement };

  // ── Rule 1: Fees must be zero or negative ──
  if (s.seller_fees > 0) {
    warnings.push(`seller_fees is positive (${s.seller_fees}) — sign inverted`);
    s.seller_fees = -Math.abs(s.seller_fees);
  }
  if (s.other_fees > 0) {
    warnings.push(`other_fees is positive (${s.other_fees}) — sign inverted`);
    s.other_fees = -Math.abs(s.other_fees);
  }
  if ((s.fba_fees ?? 0) > 0) {
    warnings.push(`fba_fees is positive (${s.fba_fees}) — sign inverted`);
    s.fba_fees = -Math.abs(s.fba_fees!);
  }
  if ((s.storage_fees ?? 0) > 0) {
    warnings.push(`storage_fees is positive (${s.storage_fees}) — sign inverted`);
    s.storage_fees = -Math.abs(s.storage_fees!);
  }
  if ((s.advertising_costs ?? 0) > 0) {
    warnings.push(`advertising_costs is positive (${s.advertising_costs}) — sign inverted`);
    s.advertising_costs = -Math.abs(s.advertising_costs!);
  }

  // ── Rule 2: Refunds must be zero or negative ──
  if (s.refunds > 0) {
    warnings.push(`refunds is positive (${s.refunds}) — sign inverted`);
    s.refunds = -Math.abs(s.refunds);
  }

  // ── Rule 3: Sales must be zero or positive ──
  if (s.sales_principal < 0) {
    warnings.push(`sales_principal is negative (${s.sales_principal}) — sign inverted`);
    s.sales_principal = Math.abs(s.sales_principal);
  }
  if (s.sales_shipping < 0) {
    warnings.push(`sales_shipping is negative (${s.sales_shipping}) — sign inverted`);
    s.sales_shipping = Math.abs(s.sales_shipping);
  }

  // ── Rule 4: Reimbursements must be zero or positive ──
  if (s.reimbursements < 0) {
    warnings.push(`reimbursements is negative (${s.reimbursements}) — sign inverted`);
    s.reimbursements = Math.abs(s.reimbursements);
  }

  // ── Rule 5: GST sign conventions ──
  if ((s.gst_on_income ?? 0) < 0) {
    warnings.push(`gst_on_income is negative (${s.gst_on_income}) — sign inverted`);
    s.gst_on_income = Math.abs(s.gst_on_income!);
  }
  if ((s.gst_on_expenses ?? 0) > 0) {
    warnings.push(`gst_on_expenses is positive (${s.gst_on_expenses}) — sign inverted`);
    s.gst_on_expenses = -Math.abs(s.gst_on_expenses!);
  }

  // ── Rule 6: Computed net vs bank_deposit variance check ──
  // Uses the canonical reconciliation formula from the service layer
  if (s.bank_deposit !== 0 && s.bank_deposit != null) {
    const recon = computeReconciliation(s);
    const recon = computeReconciliation(s);
    const variance = recon.absGap;
    const variancePct = Math.abs(variance / s.bank_deposit);

    if (variancePct > 0.20 && variance > 10) {
      warnings.push(
        `Large variance at ingestion: computed_net=${recon.computedNet.toFixed(2)} ` +
        `vs bank_deposit=${s.bank_deposit} (${(variancePct * 100).toFixed(1)}%) [source=${source}]`
      );
    }
  }

  return {
    valid: warnings.length === 0,
    warnings,
    normalised: s,
  };
}
