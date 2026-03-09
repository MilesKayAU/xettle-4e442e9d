/**
 * Universal Settlement Reconciliation Engine
 * Works with StandardSettlement (all marketplaces), not just Amazon.
 * Runs validation checks before Xero sync.
 */

import type { StandardSettlement } from './settlement-engine';

export interface UniversalReconCheck {
  id: string;
  label: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  severity: 'critical' | 'warning' | 'info';
}

export interface UniversalReconciliationResult {
  checks: UniversalReconCheck[];
  overallStatus: 'pass' | 'warn' | 'fail';
  canSync: boolean;
}

const fmt = (n: number): string => {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-$${formatted}` : `$${formatted}`;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Run reconciliation checks on any StandardSettlement (Bunnings, Catch, MyDeal, etc.)
 */
export function runUniversalReconciliation(
  settlement: StandardSettlement,
  historicalStats?: { avgFeeRate: number; count: number }
): UniversalReconciliationResult {
  const checks: UniversalReconCheck[] = [];
  const meta = settlement.metadata || {};

  // ─── 1. Balance Check ────────────────────────────────────────────
  // Reconstruct what the payout should be from components
  const salesInclGst = round2(settlement.sales_ex_gst + settlement.gst_on_sales);
  const feesInclGst = round2(settlement.fees_ex_gst - settlement.gst_on_fees); // fees_ex_gst is negative, gst_on_fees is positive absolute
  const refundsInclGst = meta.refundsInclGst || 0;
  const refundCommInclGst = meta.refundCommissionInclGst || 0;
  const shippingInclGst = meta.shippingInclGst || 0;
  const subscriptionAmount = meta.subscriptionAmount || 0;
  const manualCreditInclGst = meta.manualCreditInclGst || 0;
  const manualDebitInclGst = meta.manualDebitInclGst || 0;
  const otherChargesInclGst = meta.otherChargesInclGst || 0;

  const calculatedTotal = round2(
    salesInclGst +
    feesInclGst +
    refundsInclGst +
    refundCommInclGst +
    shippingInclGst +
    subscriptionAmount +
    manualCreditInclGst +
    manualDebitInclGst +
    otherChargesInclGst
  );

  const balanceDiff = round2(Math.abs(calculatedTotal - settlement.net_payout));

  checks.push({
    id: 'balance',
    label: 'Balance Check',
    status: balanceDiff <= 0.10 ? 'pass' : balanceDiff <= 1.00 ? 'warn' : 'fail',
    detail: balanceDiff <= 0.10
      ? `Balanced — calculated ${fmt(calculatedTotal)}, payout ${fmt(settlement.net_payout)}`
      : `Imbalance of ${fmt(balanceDiff)} — calculated ${fmt(calculatedTotal)}, payout ${fmt(settlement.net_payout)}`,
    severity: balanceDiff > 1.00 ? 'critical' : balanceDiff > 0.10 ? 'warning' : 'info',
  });

  // ─── 2. GST Consistency ──────────────────────────────────────────
  const expectedGst = round2(settlement.sales_ex_gst / 10);
  const gstDiff = round2(Math.abs(settlement.gst_on_sales - expectedGst));

  checks.push({
    id: 'gst_consistency',
    label: 'GST Consistency',
    status: gstDiff <= 0.50 ? 'pass' : gstDiff <= 2.00 ? 'warn' : 'fail',
    detail: gstDiff <= 0.50
      ? `GST ${fmt(settlement.gst_on_sales)} ≈ expected ${fmt(expectedGst)} (sales ÷ 10)`
      : `GST mismatch — parsed ${fmt(settlement.gst_on_sales)} vs expected ${fmt(expectedGst)} (diff ${fmt(gstDiff)})`,
    severity: gstDiff > 2.00 ? 'critical' : gstDiff > 0.50 ? 'warning' : 'info',
  });

  // ─── 3. Refund Completeness Check ───────────────────────────────
  // If refunds exist, refund commission should also exist (and vice versa)
  const hasRefunds = refundsInclGst !== 0;
  const hasRefundComm = refundCommInclGst !== 0;

  if (hasRefunds && !hasRefundComm) {
    checks.push({
      id: 'refund_completeness',
      label: 'Refund Completeness',
      status: 'warn',
      detail: `Refunds of ${fmt(refundsInclGst)} found but no commission refund — marketplace should return commission on refunded orders`,
      severity: 'warning',
    });
  } else if (!hasRefunds && hasRefundComm) {
    checks.push({
      id: 'refund_completeness',
      label: 'Refund Completeness',
      status: 'warn',
      detail: `Commission refund of ${fmt(refundCommInclGst)} found but no refunded orders — unexpected`,
      severity: 'warning',
    });
  } else {
    checks.push({
      id: 'refund_completeness',
      label: 'Refund Completeness',
      status: 'pass',
      detail: hasRefunds
        ? `Refunds ${fmt(refundsInclGst)} with commission return ${fmt(refundCommInclGst)} — both present`
        : 'No refunds in this period',
      severity: 'info',
    });
  }

  // ─── 4. Sanity Checks ───────────────────────────────────────────
  const sanityIssues: string[] = [];

  if (settlement.sales_ex_gst < 0) {
    sanityIssues.push('Negative sales detected');
  }
  if (settlement.net_payout === 0 && settlement.sales_ex_gst > 0) {
    sanityIssues.push('Net payout is $0 but sales exist');
  }
  const feeRate = settlement.sales_ex_gst > 0
    ? Math.abs(settlement.fees_ex_gst) / settlement.sales_ex_gst
    : 0;
  if (feeRate > 0.50) {
    sanityIssues.push(`Fee rate is ${(feeRate * 100).toFixed(1)}% — unusually high`);
  }
  if (settlement.net_payout > salesInclGst && salesInclGst > 0) {
    sanityIssues.push(`Payout ${fmt(settlement.net_payout)} exceeds gross sales ${fmt(salesInclGst)}`);
  }

  // Refund ratio check
  if (hasRefunds && settlement.sales_ex_gst > 0) {
    const refundRatio = Math.abs(refundsInclGst) / salesInclGst;
    if (refundRatio > 0.30) {
      sanityIssues.push(`Refund rate is ${(refundRatio * 100).toFixed(1)}% of sales — very high`);
    }
  }

  checks.push({
    id: 'sanity',
    label: 'Sanity Checks',
    status: sanityIssues.length === 0 ? 'pass' : 'warn',
    detail: sanityIssues.length === 0
      ? 'All sanity checks passed'
      : sanityIssues.join('; '),
    severity: sanityIssues.length > 0 ? 'warning' : 'info',
  });

  // ─── 5. Historical Fee Rate Deviation ───────────────────────────
  if (historicalStats && historicalStats.count >= 2 && settlement.sales_ex_gst > 0) {
    const deviation = Math.abs(feeRate - historicalStats.avgFeeRate);
    const deviationPct = historicalStats.avgFeeRate > 0
      ? (deviation / historicalStats.avgFeeRate) * 100
      : 0;

    checks.push({
      id: 'historical',
      label: 'Historical Deviation',
      status: deviationPct <= 15 ? 'pass' : deviationPct <= 30 ? 'warn' : 'fail',
      detail: deviationPct <= 15
        ? `Fee rate ${(feeRate * 100).toFixed(1)}% is within normal range (avg ${(historicalStats.avgFeeRate * 100).toFixed(1)}%)`
        : `Fee rate ${(feeRate * 100).toFixed(1)}% deviates ${deviationPct.toFixed(0)}% from average ${(historicalStats.avgFeeRate * 100).toFixed(1)}%`,
      severity: deviationPct > 30 ? 'critical' : deviationPct > 15 ? 'warning' : 'info',
    });
  }

  // ─── 6. Xero Invoice Accuracy ───────────────────────────────────
  // Check if the 2-line invoice model (sales + fees) will match the payout
  const simpleInvoiceTotal = round2(settlement.sales_ex_gst + settlement.gst_on_sales + settlement.fees_ex_gst - settlement.gst_on_fees);
  const invoiceDiff = round2(Math.abs(simpleInvoiceTotal - settlement.net_payout));

  if (invoiceDiff > 0.10) {
    checks.push({
      id: 'invoice_accuracy',
      label: 'Xero Invoice Accuracy',
      status: 'warn',
      detail: `Simple 2-line invoice would total ${fmt(simpleInvoiceTotal)} but payout is ${fmt(settlement.net_payout)} (diff ${fmt(invoiceDiff)}). Additional line items (refunds, shipping, etc.) are needed for an accurate invoice.`,
      severity: 'warning',
    });
  } else {
    checks.push({
      id: 'invoice_accuracy',
      label: 'Xero Invoice Accuracy',
      status: 'pass',
      detail: `Invoice total ${fmt(simpleInvoiceTotal)} matches payout ${fmt(settlement.net_payout)}`,
      severity: 'info',
    });
  }

  // ─── Determine overall status ───────────────────────────────────
  const hasFail = checks.some(c => c.status === 'fail');
  const hasWarn = checks.some(c => c.status === 'warn');
  const overallStatus = hasFail ? 'fail' : hasWarn ? 'warn' : 'pass';
  const canSync = !checks.some(c => c.status === 'fail' && c.severity === 'critical');

  return { checks, overallStatus, canSync };
}
