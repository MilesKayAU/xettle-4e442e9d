/**
 * Settlement Reconciliation Engine
 * Runs validation checks after parsing, before Xero sync.
 * Analytics-only — never modifies accounting data.
 */

import type { ParsedSettlement } from './settlement-parser';
import { TOL_PARSER_TOTAL, TOL_COLUMN_TOTALS, TOL_GST_CONSISTENCY } from '@/constants/reconciliation-tolerance';

export interface ReconCheck {
  id: string;
  label: string;
  description: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  severity: 'critical' | 'warning' | 'info';
}

export interface ReconciliationResult {
  checks: ReconCheck[];
  overallStatus: 'pass' | 'warn' | 'fail';
  canSync: boolean;
}

interface HistoricalStats {
  avgFeeRate: number;
  avgReturnRatio: number;
  count: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Run all reconciliation checks on a parsed settlement.
 */
export function runReconciliation(
  parsed: ParsedSettlement,
  historicalStats?: HistoricalStats
): ReconciliationResult {
  const checks: ReconCheck[] = [];
  const { summary, header, lines } = parsed;

  // ─── 1. Balance Check ────────────────────────────────────────────
  const expectedPayout = round2(
    summary.totalSales +
    summary.promotionalDiscounts +
    summary.sellerFees +
    summary.fbaFees +
    summary.storageFees +
    summary.advertisingCosts +
    summary.refunds +
    summary.reimbursements +
    summary.otherFees
  );
  const balanceDiff = round2(Math.abs(summary.bankDeposit - expectedPayout));

  checks.push({
    id: 'balance',
    label: 'Balance Check',
    description: 'Verify settlement math balances against bank deposit',
    status: balanceDiff <= TOL_PARSER_TOTAL ? 'pass' : balanceDiff <= TOL_GST_CONSISTENCY ? 'warn' : 'fail',
    detail: balanceDiff <= TOL_PARSER_TOTAL
      ? `Balanced — expected ${fmt(expectedPayout)}, deposit ${fmt(summary.bankDeposit)}`
      : `Imbalance of ${fmt(balanceDiff)} — expected ${fmt(expectedPayout)}, deposit ${fmt(summary.bankDeposit)}`,
    severity: balanceDiff > TOL_GST_CONSISTENCY ? 'critical' : balanceDiff > TOL_PARSER_TOTAL ? 'warning' : 'info',
  });

  // ─── 2. Column Totals Check ──────────────────────────────────────
  const lineSum = round2(lines.reduce((s, l) => s + l.amount, 0));
  const summaryGross = round2(summary.grossTotal);
  const colDiff = round2(Math.abs(lineSum - summaryGross));

  checks.push({
    id: 'column_totals',
    label: 'Column Totals',
    description: 'Sum of all line items matches summary totals',
    status: colDiff <= 0.02 ? 'pass' : colDiff <= 1.00 ? 'warn' : 'fail',
    detail: colDiff <= 0.02
      ? `Line sum ${fmt(lineSum)} matches summary ${fmt(summaryGross)}`
      : `Line sum ${fmt(lineSum)} vs summary ${fmt(summaryGross)} — diff ${fmt(colDiff)}`,
    severity: colDiff > 1.00 ? 'critical' : colDiff > 0.02 ? 'warning' : 'info',
  });

  // ─── 3. GST Consistency ──────────────────────────────────────────
  const expectedGstIncome = round2(
    (summary.salesPrincipal + summary.salesShipping + summary.promotionalDiscounts + summary.refunds) / 11
  );
  const gstDiff = round2(Math.abs(summary.gstOnIncome - expectedGstIncome));

  checks.push({
    id: 'gst_consistency',
    label: 'GST Consistency',
    description: 'GST on income aligns with sales ÷ 11',
    status: gstDiff <= 0.50 ? 'pass' : gstDiff <= 2.00 ? 'warn' : 'fail',
    detail: gstDiff <= 0.50
      ? `GST on income ${fmt(summary.gstOnIncome)} ≈ expected ${fmt(expectedGstIncome)}`
      : `GST mismatch — parsed ${fmt(summary.gstOnIncome)} vs expected ${fmt(expectedGstIncome)} (diff ${fmt(gstDiff)})`,
    severity: gstDiff > 2.00 ? 'critical' : gstDiff > 0.50 ? 'warning' : 'info',
  });

  // ─── 4. Sanity Checks ───────────────────────────────────────────
  const sanityIssues: string[] = [];

  // Return per $1 > 1.0
  const totalSales = summary.totalSales;
  if (totalSales > 0) {
    const returnRatio = summary.bankDeposit / totalSales;
    if (returnRatio > 1.0) {
      sanityIssues.push(`Return per $1 is ${returnRatio.toFixed(2)} (>1.0) — bank deposit exceeds gross sales`);
    }
  }

  // Fees > 90% of sales
  const totalFees = Math.abs(summary.sellerFees + summary.fbaFees + summary.storageFees);
  if (totalSales > 0 && totalFees / totalSales > 0.90) {
    sanityIssues.push(`Total fees are ${((totalFees / totalSales) * 100).toFixed(1)}% of sales — unusually high`);
  }

  // Negative revenue
  if (totalSales < 0) {
    sanityIssues.push('Negative total sales detected');
  }

  // Missing payout
  if (summary.bankDeposit === 0 && totalSales > 0) {
    sanityIssues.push('Bank deposit is $0 but sales exist');
  }

  // Missing dates
  if (!header.periodStart || !header.periodEnd) {
    sanityIssues.push('Missing settlement period dates');
  }

  checks.push({
    id: 'sanity',
    label: 'Sanity Checks',
    description: 'Flag obvious anomalies (negative revenue, extreme fees, missing data)',
    status: sanityIssues.length === 0 ? 'pass' : 'warn',
    detail: sanityIssues.length === 0
      ? 'All sanity checks passed'
      : sanityIssues.join('; '),
    severity: sanityIssues.length > 0 ? 'warning' : 'info',
  });

  // ─── 5. Historical Deviation Check ──────────────────────────────
  if (historicalStats && historicalStats.count >= 2 && totalSales > 0) {
    const currentFeeRate = totalFees / totalSales;
    const deviation = Math.abs(currentFeeRate - historicalStats.avgFeeRate);
    const deviationPct = historicalStats.avgFeeRate > 0
      ? (deviation / historicalStats.avgFeeRate) * 100
      : 0;

    checks.push({
      id: 'historical',
      label: 'Historical Deviation',
      description: 'Compare fee rate to past settlements',
      status: deviationPct <= 15 ? 'pass' : deviationPct <= 30 ? 'warn' : 'fail',
      detail: deviationPct <= 15
        ? `Fee rate ${(currentFeeRate * 100).toFixed(1)}% is within normal range (avg ${(historicalStats.avgFeeRate * 100).toFixed(1)}%)`
        : `Fee rate ${(currentFeeRate * 100).toFixed(1)}% deviates ${deviationPct.toFixed(0)}% from average ${(historicalStats.avgFeeRate * 100).toFixed(1)}%`,
      severity: deviationPct > 30 ? 'critical' : deviationPct > 15 ? 'warning' : 'info',
    });
  } else {
    checks.push({
      id: 'historical',
      label: 'Historical Deviation',
      description: 'Compare fee rate to past settlements',
      status: 'pass',
      detail: historicalStats && historicalStats.count < 2
        ? `Not enough history (${historicalStats.count} settlement${historicalStats.count === 1 ? '' : 's'}) — need ≥2 for comparison`
        : 'No historical data available — skipping',
      severity: 'info',
    });
  }

  // ─── Determine overall status ───────────────────────────────────
  const hasFail = checks.some(c => c.status === 'fail');
  const hasWarn = checks.some(c => c.status === 'warn');
  const overallStatus = hasFail ? 'fail' : hasWarn ? 'warn' : 'pass';

  // Only critical failures block sync (balance check fail)
  const canSync = !checks.some(c => c.status === 'fail' && c.severity === 'critical');

  return { checks, overallStatus, canSync };
}

function fmt(n: number): string {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-$${formatted}` : `$${formatted}`;
}
