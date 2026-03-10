import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import {
  ChevronLeft, ChevronRight, AlertTriangle, Upload, Send,
  Loader2, CheckCircle2, XCircle, RefreshCw
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { syncSettlementToXero, syncXeroStatus, buildSimpleInvoiceLines, formatAUD, type StandardSettlement } from '@/utils/settlement-engine';
import { type UserMarketplace, MARKETPLACE_CATALOG } from './MarketplaceSwitcher';

interface MonthlyReconciliationStatusProps {
  userMarketplaces: UserMarketplace[];
  onSwitchToUpload?: () => void;
  onSelectMarketplace?: (code: string) => void;
}

interface SettlementSummary {
  id: string;
  settlement_id: string;
  marketplace: string;
  status: string | null;
  xero_invoice_number: string | null;
  xero_status: string | null;
  xero_journal_id: string | null;
  bank_deposit: number | null;
  sales_principal: number | null;
  seller_fees: number | null;
  gst_on_income: number | null;
  gst_on_expenses: number | null;
  refunds: number | null;
  reimbursements: number | null;
  other_fees: number | null;
  sales_shipping: number | null;
  period_start: string;
  period_end: string;
}

export default function MonthlyReconciliationStatus({
  userMarketplaces,
  onSwitchToUpload,
  onSelectMarketplace,
}: MonthlyReconciliationStatusProps) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [settlements, setSettlements] = useState<SettlementSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [pushingAll, setPushingAll] = useState(false);
  const [pushProgress, setPushProgress] = useState({ current: 0, total: 0 });
  const [syncing, setSyncing] = useState(false);

  const monthStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
  const monthEnd = new Date(year, month + 1, 0).toISOString().split('T')[0];
  const monthLabel = new Date(year, month).toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });

  const prevMonth = () => {
    if (month === 0) { setMonth(11); setYear(y => y - 1); }
    else setMonth(m => m - 1);
  };
  const nextMonth = () => {
    if (month === 11) { setMonth(0); setYear(y => y + 1); }
    else setMonth(m => m + 1);
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('settlements')
        .select('id, settlement_id, marketplace, status, xero_invoice_number, xero_status, xero_journal_id, bank_deposit, sales_principal, seller_fees, gst_on_income, gst_on_expenses, refunds, reimbursements, other_fees, sales_shipping, period_start, period_end')
        .lte('period_start', monthEnd)
        .gte('period_end', monthStart)
        .order('marketplace');
      if (error) throw error;
      setSettlements((data || []) as SettlementSummary[]);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [monthStart, monthEnd]);

  useEffect(() => { loadData(); }, [loadData]);

  // Group settlements by marketplace
  const byMarketplace = new Map<string, SettlementSummary[]>();
  for (const s of settlements) {
    const code = s.marketplace;
    if (!byMarketplace.has(code)) byMarketplace.set(code, []);
    byMarketplace.get(code)!.push(s);
  }

  // Detect missing marketplaces
  const connectedCodes = new Set(userMarketplaces.map(m => m.marketplace_code));
  const uploadedCodes = new Set(settlements.map(s => s.marketplace));
  const missingCodes = [...connectedCodes].filter(c => !uploadedCodes.has(c));
  const missingNames = missingCodes.map(c => {
    const cat = MARKETPLACE_CATALOG.find(m => m.code === c);
    return cat?.name || c;
  });

  // Counts
  const readyToPush = settlements.filter(s => s.status === 'saved' || s.status === 'parsed').length;
  const pushed = settlements.filter(s => s.status === 'synced' || s.status === 'pushed_to_xero' || s.status === 'synced_external').length;
  const failed = settlements.filter(s => s.status === 'push_failed').length;

  const handlePushAll = async () => {
    const toPush = settlements.filter(s => s.status === 'saved' || s.status === 'parsed');
    if (toPush.length === 0) return;

    const confirmed = window.confirm(
      `Push ${toPush.length} settlement${toPush.length > 1 ? 's' : ''} to Xero?\n\n` +
      toPush.map(s => {
        const cat = MARKETPLACE_CATALOG.find(m => m.code === s.marketplace);
        return `• ${cat?.name || s.marketplace}: ${formatAUD(s.bank_deposit || 0)}`;
      }).join('\n')
    );
    if (!confirmed) return;

    setPushingAll(true);
    setPushProgress({ current: 0, total: toPush.length });
    let ok = 0, skipped = 0, fail = 0;

    for (let i = 0; i < toPush.length; i++) {
      setPushProgress({ current: i + 1, total: toPush.length });
      const s = toPush[i];

      // Skip if already has xero_journal_id (duplicate)
      if (s.xero_journal_id) { skipped++; continue; }

      const std: StandardSettlement = {
        marketplace: s.marketplace,
        settlement_id: s.settlement_id,
        period_start: s.period_start,
        period_end: s.period_end,
        sales_ex_gst: s.sales_principal || 0,
        gst_on_sales: s.gst_on_income || 0,
        fees_ex_gst: s.seller_fees || 0,
        gst_on_fees: s.gst_on_expenses || 0,
        net_payout: s.bank_deposit || 0,
        source: 'csv_upload',
        reconciles: true,
        metadata: {
          refundsExGst: s.refunds || 0,
          shippingExGst: s.sales_shipping || 0,
          subscriptionAmount: (s.other_fees && s.other_fees < 0) ? 0 : (s.other_fees || 0),
          refundCommissionExGst: s.reimbursements || 0,
        },
      };

      const lineItems = buildSimpleInvoiceLines(std);
      const result = await syncSettlementToXero(s.settlement_id, s.marketplace, { lineItems });
      if (result.success) ok++;
      else fail++;
    }

    setPushingAll(false);
    toast.success(`✅ ${ok} pushed · ${skipped > 0 ? `⚠️ ${skipped} skipped · ` : ''}${fail > 0 ? `❌ ${fail} failed` : ''}`);

    // Sync back from Xero and reload
    await syncXeroStatus();
    loadData();
  };

  const handleSyncFromXero = async () => {
    setSyncing(true);
    const result = await syncXeroStatus();
    setSyncing(false);
    if (result.success) {
      toast.success(`Synced ${result.updated || 0} settlement${result.updated !== 1 ? 's' : ''} from Xero`);
      loadData();
    } else {
      toast.error(result.error || 'Failed to sync from Xero');
    }
  };

  return (
    <Card className="border-border">
      <CardContent className="py-4 space-y-4">
        {/* Period selector */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={prevMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-sm font-semibold text-foreground min-w-[140px] text-center">
              {monthLabel}
            </span>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={nextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleSyncFromXero} disabled={syncing}>
              {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              Refresh from Xero
            </Button>
            {readyToPush > 0 && (
              <Button size="sm" className="h-7 text-xs gap-1" onClick={handlePushAll} disabled={pushingAll} data-push-all>
                {pushingAll ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                Push All Ready ({readyToPush})
              </Button>
            )}
          </div>
        </div>

        {/* Push progress */}
        {pushingAll && (
          <div className="space-y-1">
            <Progress value={(pushProgress.current / pushProgress.total) * 100} className="h-2" />
            <p className="text-[10px] text-muted-foreground text-center">
              Pushing {pushProgress.current} of {pushProgress.total}…
            </p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-4 text-sm text-muted-foreground gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <>
            {/* Missing marketplaces warning */}
            {missingCodes.length > 0 && (
              <div className="flex items-center justify-between bg-amber-50 dark:bg-amber-950/20 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                    ⚠️ {missingCodes.length} missing — {missingNames.join(', ')}
                  </span>
                </div>
                <Button
                  variant="link"
                  size="sm"
                  className="h-auto p-0 text-xs text-amber-700 dark:text-amber-400"
                  onClick={() => {
                    if (onSelectMarketplace && missingCodes[0]) onSelectMarketplace(missingCodes[0]);
                    if (onSwitchToUpload) onSwitchToUpload();
                  }}
                >
                  Upload now →
                </Button>
              </div>
            )}

            {/* Summary stats */}
            {settlements.length > 0 && (
              <div className="flex items-center gap-3 flex-wrap">
                {pushed > 0 && (
                  <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 text-xs font-medium">
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                    {pushed} in Xero
                  </Badge>
                )}
                {readyToPush > 0 && (
                  <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800 text-xs font-medium">
                    <span className="h-2 w-2 rounded-full bg-amber-500 mr-1.5" />
                    {readyToPush} ready to push
                  </Badge>
                )}
                {failed > 0 && (
                  <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800 text-xs font-medium">
                    <XCircle className="h-3 w-3 mr-1" />
                    {failed} failed
                  </Badge>
                )}
                {missingCodes.length > 0 && (
                  <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800 text-xs font-medium">
                    <AlertTriangle className="h-3 w-3 mr-1" />
                    {missingCodes.length} missing
                  </Badge>
                )}
              </div>
            )}

            {settlements.length === 0 && missingCodes.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-2">
                No settlements for {monthLabel}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
