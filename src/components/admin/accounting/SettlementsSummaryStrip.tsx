import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChevronLeft, ChevronRight, DollarSign, TrendingDown, Wallet, BarChart3 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';

function formatAUD(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}

interface SettlementsSummaryStripProps {
  userMarketplaceCount: number;
}

export default function SettlementsSummaryStrip({ userMarketplaceCount }: SettlementsSummaryStripProps) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth());
  const [year, setYear] = useState(now.getFullYear());
  const [data, setData] = useState<{
    revenue: number;
    fees: number;
    net: number;
    synced: number;
    ready: number;
    missing: number;
    failed: number;
    total: number;
  }>({ revenue: 0, fees: 0, net: 0, synced: 0, ready: 0, missing: 0, failed: 0, total: 0 });
  const [loading, setLoading] = useState(true);

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

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      try {
        const { data: settlements, error } = await supabase
          .from('settlements')
          .select('sales_principal, seller_fees, bank_deposit, status')
          .lte('period_start', monthEnd)
          .gte('period_end', monthStart)
          .abortSignal(controller.signal);

        if (error) throw error;
        const rows = settlements || [];

        const revenue = rows.reduce((sum, s) => sum + (s.sales_principal || 0), 0);
        const fees = rows.reduce((sum, s) => sum + (s.seller_fees || 0), 0);
        const net = rows.reduce((sum, s) => sum + (s.bank_deposit || 0), 0);
        const synced = rows.filter(s => ['synced', 'pushed_to_xero', 'synced_external', 'draft_in_xero', 'authorised_in_xero', 'reconciled_in_xero'].includes(s.status || '')).length;
        const ready = rows.filter(s => s.status === 'saved' || s.status === 'parsed').length;
        const failed = rows.filter(s => s.status === 'push_failed').length;

        setData({ revenue, fees, net, synced, ready, failed, missing: 0, total: rows.length });
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
      } finally {
        setLoading(false);
      }
    };
    load();
    return () => { controller.abort(); };
  }, [monthStart, monthEnd]);

  if (loading && data.total === 0) return null;

  return (
    <Card className="bg-gradient-to-r from-primary/5 to-primary/10 border-primary/20">
      <CardContent className="py-5 px-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={prevMonth}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <h2 className="text-lg font-bold text-foreground min-w-[160px] text-center">
              {monthLabel}
            </h2>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={nextMonth}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {/* Revenue */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <DollarSign className="h-3.5 w-3.5" />
              Revenue
            </div>
            <p className="text-2xl font-bold text-foreground">{formatAUD(data.revenue)}</p>
          </div>

          {/* Fees */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <TrendingDown className="h-3.5 w-3.5" />
              Marketplace Fees
            </div>
            <p className="text-2xl font-bold text-foreground">{formatAUD(data.fees)}</p>
          </div>

          {/* Net Payout */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Wallet className="h-3.5 w-3.5" />
              Paid To You
            </div>
            <p className="text-2xl font-bold text-primary">{formatAUD(data.net)}</p>
          </div>

          {/* Settlement Status */}
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <BarChart3 className="h-3.5 w-3.5" />
              Settlements
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {data.synced > 0 && (
                <Badge className="bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 text-xs">
                  ✓ {data.synced} synced
                </Badge>
              )}
              {data.ready > 0 && (
                <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800 text-xs">
                  ● {data.ready} ready
                </Badge>
              )}
              {data.failed > 0 && (
                <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800 text-xs">
                  ✕ {data.failed} failed
                </Badge>
              )}
              {data.total === 0 && (
                <span className="text-sm text-muted-foreground">No settlements</span>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
