/**
 * Bookkeeper Minimum Data Validator
 * 
 * Validates that a settlement has enough data for a bookkeeper to review.
 * Used by SmartUploadFlow (pre-save preview) and saveSettlement() (defense-in-depth).
 * 
 * Hard-block: missing dates, missing net payout, all totals zero
 * Warn-only: missing line items, reconciliation mismatch
 */

import type { StandardSettlement } from './settlement-engine';

export interface BookkeeperReadinessCheck {
  key: string;
  label: string;
  status: 'pass' | 'fail' | 'warn';
  message?: string;
}

export interface BookkeeperReadinessResult {
  canSave: boolean;
  blockingReasons: string[];
  errorMessage?: string;
  checks: BookkeeperReadinessCheck[];
}

export function validateBookkeeperMinimumData(params: {
  settlement: StandardSettlement;
  hasLineItems: boolean;
  lineItemsExplicitlyNone?: boolean;
  reconciles?: boolean | null;
}): BookkeeperReadinessResult {
  const { settlement, hasLineItems, lineItemsExplicitlyNone, reconciles } = params;
  const checks: BookkeeperReadinessCheck[] = [];
  const blockingReasons: string[] = [];

  // 1. Dates present (hard-block)
  const datesOk = !!settlement.period_start && !!settlement.period_end;
  checks.push({
    key: 'dates_present',
    label: 'Dates detected',
    status: datesOk ? 'pass' : 'fail',
    message: datesOk ? undefined : 'Map a date column or enter dates manually.',
  });
  if (!datesOk) blockingReasons.push('dates_present');

  // 2. Net payout present (hard-block)
  const netOk = settlement.net_payout != null && isFinite(settlement.net_payout);
  checks.push({
    key: 'net_payout_present',
    label: 'Net payout detected',
    status: netOk ? 'pass' : 'fail',
    message: netOk ? undefined : 'Map the net payout / bank deposit column.',
  });
  if (!netOk) blockingReasons.push('net_payout_present');

  // 3. Meaningful totals present (hard-block)
  const meta = settlement.metadata || {};
  const hasMeaningful = [
    Math.abs(settlement.sales_ex_gst),
    Math.abs(settlement.fees_ex_gst),
    Math.abs(meta.refundsExGst || 0),
    Math.abs(meta.reimbursements || 0),
    Math.abs(meta.shippingExGst || 0),
    Math.abs(meta.subscriptionAmount || 0),
    Math.abs(meta.otherChargesInclGst || 0),
  ].some(v => v > 0.0001);

  checks.push({
    key: 'meaningful_totals_present',
    label: 'Sales or fees present',
    status: hasMeaningful ? 'pass' : 'fail',
    message: hasMeaningful ? undefined : 'All financial totals are zero — check column mapping.',
  });
  if (!hasMeaningful) blockingReasons.push('meaningful_totals_present');

  // 4. Line items available (warn only)
  if (hasLineItems) {
    checks.push({ key: 'line_items_available', label: 'Transaction lines', status: 'pass' });
  } else if (lineItemsExplicitlyNone) {
    checks.push({
      key: 'line_items_available',
      label: 'Transaction lines',
      status: 'warn',
      message: 'No transaction drilldown — pushing will still work but order-level detail won\'t be visible.',
    });
  } else {
    checks.push({
      key: 'line_items_available',
      label: 'Transaction lines',
      status: 'warn',
      message: 'Upload the detailed export to enable drilldown lines.',
    });
  }

  // 5. Reconciliation sanity (warn only)
  if (reconciles === false) {
    checks.push({
      key: 'reconciliation_sanity',
      label: 'Reconciliation',
      status: 'warn',
      message: 'Totals don\'t reconcile — review before pushing to Xero.',
    });
  } else if (reconciles === true) {
    checks.push({ key: 'reconciliation_sanity', label: 'Reconciliation', status: 'pass' });
  }
  // If null/undefined, skip the check entirely

  const canSave = blockingReasons.length === 0;
  const errorMessage = canSave
    ? undefined
    : `Cannot save: ${blockingReasons.map(r => {
        const c = checks.find(ch => ch.key === r);
        return c?.message || r;
      }).join('; ')}`;

  return { canSave, blockingReasons, errorMessage, checks };
}
