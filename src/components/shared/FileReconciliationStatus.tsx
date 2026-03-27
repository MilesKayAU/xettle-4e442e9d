/**
 * FileReconciliationStatus — Status-first summary for CSV-only marketplaces.
 * 
 * Shows a scannable summary (e.g. "3 reconciled, 1 has a gap") with
 * expandable detail for each settlement's financial breakdown.
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2, AlertTriangle, FileCheck, ChevronRight, ChevronDown } from 'lucide-react';

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
  reconciliation_status: string | null;
}

interface FileReconciliationStatusProps {
  settlements: SettlementSummary[];
  onSettlementClick?: (settlementId: string) => void;
}

const fmt = (n: number): string => {
  const abs = Math.abs(n);
  const formatted = abs.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n < 0 ? `-$${formatted}` : `$${formatted}`;
};

export default function FileReconciliationStatus({ settlements, onSettlementClick }: FileReconciliationStatusProps) {
  const [showDetail, setShowDetail] = useState(false);

  if (settlements.length === 0) return null;

  const results = settlements.map(s => {
    const sales = Number(s.sales_principal) || 0;
    const fees = Number(s.seller_fees) || 0;
    const refunds = Number(s.refunds) || 0;
    const bankDeposit = Number(s.bank_deposit) || 0;
    const gstIncome = Number(s.gst_on_income) || 0;
    const gstExpenses = Number(s.gst_on_expenses) || 0;

    const dbStatus = (s.reconciliation_status || '').toLowerCase();
    const reconciles = dbStatus === 'reconciled' || dbStatus === 'matched';

    // Compute gap for display
    const computedNet = sales + fees + refunds;
    const gap = bankDeposit - computedNet;

    return {
      settlement_id: s.settlement_id,
      period: `${s.period_start} → ${s.period_end}`,
      sales,
      fees,
      refunds,
      gstIncome,
      gstExpenses,
      bankDeposit,
      reconciles,
      gap,
    };
  });

  const reconciledCount = results.filter(r => r.reconciles).length;
  const failCount = results.filter(r => !r.reconciles).length;
  const allReconcile = failCount === 0;

  return (
    <Card className={allReconcile ? 'border-emerald-200 dark:border-emerald-800' : 'border-amber-200 dark:border-amber-800'}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <FileCheck className="h-4 w-4 text-primary" />
          File Reconciliation
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 pt-0">
        {/* Status-first summary */}
        <div className="space-y-1.5">
          {reconciledCount > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                {reconciledCount} settlement{reconciledCount !== 1 ? 's' : ''} reconciled — figures balance
              </span>
            </div>
          )}
          {failCount > 0 && (
            <div className="flex items-center gap-2 text-xs">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400 shrink-0" />
              <span className="text-amber-700 dark:text-amber-400 font-medium">
                {failCount} settlement{failCount !== 1 ? 's' : ''} {failCount === 1 ? 'has' : 'have'} a gap — {failCount === 1 
                  ? `${fmt(Math.abs(results.find(r => !r.reconciles)?.gap || 0))} difference`
                  : 'click to review'
                }
              </span>
            </div>
          )}
        </div>

        {/* Expandable detail */}
        <button
          onClick={() => setShowDetail(!showDetail)}
          className="flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground transition-colors"
        >
          {showDetail ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          {showDetail ? 'Hide breakdown' : 'Show breakdown'}
        </button>

        {showDetail && (
          <div className="space-y-1.5 pt-1">
            {results.map(r => (
              <button
                key={r.settlement_id}
                type="button"
                onClick={() => onSettlementClick?.(r.settlement_id)}
                className={`w-full rounded-md px-3 py-2 text-xs flex flex-wrap items-center gap-x-3 gap-y-1 text-left transition-colors ${
                  r.reconciles
                    ? 'bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30'
                    : 'bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30'
                } ${onSettlementClick ? 'cursor-pointer' : 'cursor-default'}`}
              >
                <span className="font-medium text-foreground">{r.settlement_id}</span>
                <span className="text-muted-foreground">Sales: {fmt(r.sales)}</span>
                {r.refunds !== 0 && (
                  <span className="text-muted-foreground">Refunds: {fmt(r.refunds)}</span>
                )}
                <span className="text-muted-foreground">Fees: -{fmt(r.fees)}</span>
                <span className="text-muted-foreground">Net: {fmt(r.bankDeposit)}</span>
                <span className={r.reconciles ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}>
                  {r.reconciles ? '✅' : '⚠️'}
                </span>
                {onSettlementClick && (
                  <ChevronRight className="h-3.5 w-3.5 ml-auto text-muted-foreground flex-shrink-0" />
                )}
              </button>
            ))}
          </div>
        )}

        <p className="text-[10px] text-muted-foreground pt-1">
          File reconciliation verified at upload. {!showDetail && 'Click "Show breakdown" for details.'}
        </p>
      </CardContent>
    </Card>
  );
}
