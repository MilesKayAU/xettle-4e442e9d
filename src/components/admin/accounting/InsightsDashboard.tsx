import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info, TrendingUp, DollarSign, BarChart3, Store, Clock, Receipt, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { MARKETPLACE_LABELS } from '@/utils/settlement-engine';
import LoadingSpinner from '@/components/ui/loading-spinner';
import MarketplaceAlertsBanner from '@/components/MarketplaceAlertsBanner';

interface MarketplaceStats {
  marketplace: string;
  label: string;
  totalSales: number;
  totalFees: number;
  totalRefunds: number;
  netPayout: number;
  returnRatio: number;
  feeLoad: number;
  settlementCount: number;
  latestPeriodEnd: string | null;
  avgCommission: number;
}

export default function InsightsDashboard() {
  const [stats, setStats] = useState<MarketplaceStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    try {
      const { data, error } = await supabase
        .from('settlements')
        .select('marketplace, sales_principal, seller_fees, refunds, bank_deposit, fba_fees, other_fees, storage_fees, period_end')
        .order('period_end', { ascending: false });

      if (error) throw error;
      if (!data || data.length === 0) {
        setStats([]);
        return;
      }

      const grouped: Record<string, typeof data> = {};
      for (const row of data) {
        const mp = row.marketplace || 'amazon_au';
        if (!grouped[mp]) grouped[mp] = [];
        grouped[mp].push(row);
      }

      const results: MarketplaceStats[] = [];

      for (const [mp, rows] of Object.entries(grouped)) {
        const totalSales = rows.reduce((sum, r) => sum + (r.sales_principal || 0), 0);
        const totalFees = rows.reduce((sum, r) =>
          sum + Math.abs(r.seller_fees || 0) + Math.abs(r.fba_fees || 0) + Math.abs(r.storage_fees || 0) + Math.abs(r.other_fees || 0), 0);
        const totalRefunds = rows.reduce((sum, r) => sum + Math.abs(r.refunds || 0), 0);
        const netPayout = rows.reduce((sum, r) => sum + (r.bank_deposit || 0), 0);
        const returnRatio = totalSales > 0 ? netPayout / totalSales : 0;
        const feeLoad = totalSales > 0 ? totalFees / totalSales : 0;
        const avgCommission = totalSales > 0 ? (Math.abs(rows.reduce((sum, r) => sum + (r.seller_fees || 0), 0)) / totalSales) : 0;

        const latestPeriodEnd = rows.length > 0 ? rows[0].period_end : null;

        results.push({
          marketplace: mp,
          label: MARKETPLACE_LABELS[mp] || mp,
          totalSales,
          totalFees,
          totalRefunds,
          netPayout,
          returnRatio,
          feeLoad,
          settlementCount: rows.length,
          latestPeriodEnd,
          avgCommission,
        });
      }

      results.sort((a, b) => b.returnRatio - a.returnRatio);
      setStats(results);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner size="lg" text="Loading marketplace insights..." />
      </div>
    );
  }

  if (stats.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">Marketplace Insights</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Cross-marketplace analytics will appear here once you upload your first settlement.
          </p>
        </div>
        <Card>
          <CardContent className="py-16 text-center">
            <BarChart3 className="h-12 w-12 text-muted-foreground/20 mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">No settlement data yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Switch to the <strong>Settlements</strong> tab to upload your first marketplace file.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const bestRatio = Math.max(...stats.map(s => s.returnRatio));
  const totalAllSales = stats.reduce((sum, s) => sum + s.totalSales, 0);
  const totalAllNet = stats.reduce((sum, s) => sum + s.netPayout, 0);
  const overallRatio = totalAllSales > 0 ? totalAllNet / totalAllSales : 0;

  function formatPct(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
  }

  function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function getRatioColor(ratio: number): string {
    if (ratio >= 0.85) return 'text-primary';
    if (ratio >= 0.75) return 'text-foreground';
    return 'text-destructive';
  }

  function getBarWidth(ratio: number): number {
    return Math.max(20, ratio * 100);
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Alerts */}
        {stats.map(s => (
          <MarketplaceAlertsBanner key={s.marketplace} marketplaceCode={s.marketplace} />
        ))}

        {/* Header */}
        <div>
          <h2 className="text-xl font-bold text-foreground">Marketplace Insights</h2>
          <p className="text-sm text-muted-foreground mt-1">
            How much each marketplace actually pays you — based on {stats.reduce((sum, s) => sum + s.settlementCount, 0)} analysed settlements.
          </p>
        </div>

        {/* Summary cards row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground">Total Sales</p>
              <p className="text-xl font-bold text-foreground mt-1">{formatCurrency(totalAllSales)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{stats.length} marketplace{stats.length !== 1 ? 's' : ''}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground">Net Received</p>
              <p className="text-xl font-bold text-foreground mt-1">{formatCurrency(totalAllNet)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">After all deductions</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground">Overall Return</p>
              <p className={`text-xl font-bold mt-1 ${getRatioColor(overallRatio)}`}>${overallRatio.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">Per $1 sold across all</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground">Best Performer</p>
              <p className="text-xl font-bold text-primary mt-1">{stats[0].label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">${stats[0].returnRatio.toFixed(2)} per $1</p>
            </CardContent>
          </Card>
        </div>

        {/* Return per $1 sold — main chart */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Return per $1 Sold</CardTitle>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-xs text-xs">
                  <p className="font-medium mb-1">Marketplace Return Ratio</p>
                  <p>Net Settlement ÷ Gross Sales. Includes marketplace fees & refunds. Excludes COGS, shipping & ads.</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <CardDescription className="text-xs">
              How much you keep after marketplace deductions — higher is better
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {stats.map((s) => (
              <div key={s.marketplace} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{s.label}</span>
                    {s.returnRatio === bestRatio && stats.length > 1 && (
                      <Badge variant="outline" className="text-[10px] h-4 border-primary/30 text-primary">Best</Badge>
                    )}
                  </div>
                  <span className={`text-lg font-bold tabular-nums ${getRatioColor(s.returnRatio)}`}>
                    ${s.returnRatio.toFixed(2)}
                  </span>
                </div>
                <div className="h-3 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-700 ease-out"
                    style={{ width: `${getBarWidth(s.returnRatio)}%`, opacity: s.returnRatio === bestRatio ? 1 : 0.55 }}
                  />
                </div>
              </div>
            ))}

            {/* Comparison insight */}
            {stats.length > 1 && (
              <div className="rounded-md border border-border bg-muted/30 p-3 mt-2">
                <p className="text-xs text-muted-foreground">
                  <strong className="text-foreground">{stats[0].label}</strong> returns the most at{' '}
                  <strong className="text-foreground">${stats[0].returnRatio.toFixed(2)}</strong> per $1.{' '}
                  <strong className="text-foreground">{stats[stats.length - 1].label}</strong> returns{' '}
                  <strong className="text-foreground">${stats[stats.length - 1].returnRatio.toFixed(2)}</strong> —{' '}
                  a <strong className="text-foreground">{formatPct(stats[0].returnRatio - stats[stats.length - 1].returnRatio)}</strong> gap.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Fee Intelligence table */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Fee Intelligence</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Fee load, commission rates and refund impact per marketplace
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2.5 font-medium text-foreground">Marketplace</th>
                    <th className="text-right px-3 py-2.5 font-medium text-foreground">Sales</th>
                    <th className="text-right px-3 py-2.5 font-medium text-foreground">Fee Load</th>
                    <th className="text-right px-3 py-2.5 font-medium text-foreground">Avg Commission</th>
                    <th className="text-right px-3 py-2.5 font-medium text-foreground">Refunds</th>
                    <th className="text-right px-3 py-2.5 font-medium text-foreground">Net</th>
                    <th className="text-right px-3 py-2.5 font-medium text-foreground">Return</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s, idx) => (
                    <tr key={s.marketplace} className={idx > 0 ? 'border-t border-border' : ''}>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-foreground">{s.label}</span>
                          {s.returnRatio === bestRatio && stats.length > 1 && (
                            <Badge variant="outline" className="text-[9px] h-3.5 border-primary/30 text-primary px-1">Best</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{formatCurrency(s.totalSales)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatPct(s.feeLoad)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatPct(s.avgCommission)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatCurrency(s.totalRefunds)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-foreground">{formatCurrency(s.netPayout)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-bold ${getRatioColor(s.returnRatio)}`}>{formatPct(s.returnRatio)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Marketplace overview cards */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">Marketplace Overview</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {stats.map((s) => (
              <Card key={s.marketplace} className="hover:border-primary/20 transition-colors">
                <CardContent className="pt-5 pb-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">{s.label}</span>
                    <span className={`text-lg font-bold tabular-nums ${getRatioColor(s.returnRatio)}`}>
                      {formatPct(s.returnRatio)}
                    </span>
                  </div>

                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-500"
                      style={{ width: `${getBarWidth(s.returnRatio)}%` }}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-y-1.5 text-xs">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <DollarSign className="h-3 w-3" /> Sales
                    </div>
                    <span className="text-right tabular-nums text-foreground">{formatCurrency(s.totalSales)}</span>

                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Receipt className="h-3 w-3" /> Avg commission
                    </div>
                    <span className="text-right tabular-nums text-foreground">{formatPct(s.avgCommission)}</span>

                    <div className="flex items-center gap-1 text-muted-foreground">
                      <TrendingUp className="h-3 w-3" /> Fee load
                    </div>
                    <span className="text-right tabular-nums text-foreground">{formatPct(s.feeLoad)}</span>

                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Store className="h-3 w-3" /> Settlements
                    </div>
                    <span className="text-right tabular-nums text-foreground">{s.settlementCount}</span>

                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3 w-3" /> Latest
                    </div>
                    <span className="text-right text-foreground">{formatDate(s.latestPeriodEnd)}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </TooltipProvider>
  );
}