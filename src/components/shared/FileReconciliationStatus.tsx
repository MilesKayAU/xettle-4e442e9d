/**
 * FileReconciliationStatus — Self-reconciliation for CSV-only marketplaces.
 * Compares settlement internal figures (sales, refunds, fees → net) instead
 * of cross-referencing Shopify order data.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, AlertTriangle, FileCheck } from 'lucide-react';

interface SettlementSummary {
  settlement_id: string;
  period_start: string;
  period_end: string;
  sales_principal: number | null;
  seller_fees: number | null;
  bank_deposit: number | null;
  refunds: number | null;
  gst_on_income: number | null;
  gst_on_expenses: number | null;
}

interface FileReconciliationStatusProps {
  settlements: SettlementSummary[];
}

const fmt = (n: number): string => {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-$${formatted}` : `$${formatted}`;
};

export default function FileReconciliationStatus({ settlements }: FileReconciliationStatusProps) {
  if (settlements.length === 0) return null;

  const results = settlements.map(s => {
    const sales = Number(s.sales_principal) || 0;
    const fees = Number(s.seller_fees) || 0;
    const refunds = Number(s.refunds) || 0;
    const gstIncome = Number(s.gst_on_income) || 0;
    const gstExpenses = Number(s.gst_on_expenses) || 0;
    const bankDeposit = Number(s.bank_deposit) || 0;

    // Reconstruct: sales + gst_income - fees - gst_expenses + refunds ≈ bank_deposit
    const calculatedNet = Math.round((sales + gstIncome - fees - gstExpenses + refunds) * 100) / 100;
    const diff = Math.round(Math.abs(calculatedNet - bankDeposit) * 100) / 100;
    const reconciles = diff <= 1.00;

    return {
      settlement_id: s.settlement_id,
      period: `${s.period_start} → ${s.period_end}`,
      sales,
      fees,
      refunds,
      gstIncome,
      gstExpenses,
      bankDeposit,
      calculatedNet,
      diff,
      reconciles,
    };
  });

  const allReconcile = results.every(r => r.reconciles);
  const failCount = results.filter(r => !r.reconciles).length;

  return (
    <Card className={allReconcile ? 'border-emerald-200 dark:border-emerald-800' : 'border-amber-200 dark:border-amber-800'}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <FileCheck className="h-4 w-4 text-primary" />
          File Reconciliation
          {allReconcile ? (
            <span className="ml-auto text-xs font-normal text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              Figures reconcile internally
            </span>
          ) : (
            <span className="ml-auto text-xs font-normal text-amber-600 dark:text-amber-400 flex items-center gap-1">
              <AlertTriangle className="h-3.5 w-3.5" />
              {failCount} settlement{failCount > 1 ? 's' : ''} — internal figures don't balance
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {results.map(r => (
          <div
            key={r.settlement_id}
            className={`rounded-md px-3 py-2 text-xs flex flex-wrap items-center gap-x-3 gap-y-1 ${
              r.reconciles
                ? 'bg-emerald-50 dark:bg-emerald-900/20'
                : 'bg-amber-50 dark:bg-amber-900/20'
            }`}
          >
            <span className="font-medium text-foreground">{r.settlement_id}</span>
            <span className="text-muted-foreground">Sales: {fmt(r.sales)}</span>
            {r.refunds !== 0 && (
              <span className="text-muted-foreground">Refunds: {fmt(r.refunds)}</span>
            )}
            <span className="text-muted-foreground">Fees: -{fmt(r.fees)}</span>
            {(r.gstIncome !== 0 || r.gstExpenses !== 0) && (
              <span className="text-muted-foreground">GST: {fmt(r.gstIncome - r.gstExpenses)}</span>
            )}
            <span className="text-muted-foreground">Net: {fmt(r.bankDeposit)}</span>
            <span className={r.reconciles ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
              {r.reconciles ? '✅' : `⚠️ diff ${fmt(r.diff)}`}
            </span>
          </div>
        ))}
        <p className="text-[10px] text-muted-foreground pt-1">
          File reconciliation checks whether the settlement file's internal maths balance. For cross-marketplace order verification, connect Shopify.
        </p>
      </CardContent>
    </Card>
  );
}
