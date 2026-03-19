import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Info, TrendingUp, DollarSign, BarChart3 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { MARKETPLACE_LABELS } from '@/utils/settlement-engine';
import LoadingSpinner from '@/components/ui/loading-spinner';

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
}

export default function MarketplaceReturnRatio() {
  const [stats, setStats] = useState<MarketplaceStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    try {
      const { data, error } = await supabase
        .from('settlements')
        .select('marketplace, sales_principal, gst_on_income, seller_fees, refunds, bank_deposit, fba_fees, other_fees, storage_fees')
        .order('period_end', { ascending: false });

      if (error) throw error;
      if (!data || data.length === 0) {
        setStats([]);
        return;
      }

      // Group by marketplace
      const grouped: Record<string, typeof data> = {};
      for (const row of data) {
        const mp = row.marketplace || 'amazon_au';
        if (!grouped[mp]) grouped[mp] = [];
        grouped[mp].push(row);
      }

      const results: MarketplaceStats[] = [];

      for (const [mp, rows] of Object.entries(grouped)) {
        // Use sales INCLUDING GST for consistent cross-marketplace comparison
        const salesExGst = rows.reduce((sum, r) => sum + (r.sales_principal || 0), 0);
        const gstOnSales = rows.reduce((sum, r) => sum + (r.gst_on_income || 0), 0);
        const totalSales = salesExGst + gstOnSales;
        const totalFees = rows.reduce((sum, r) =>
          sum + Math.abs(r.seller_fees || 0) + Math.abs(r.fba_fees || 0) + Math.abs(r.storage_fees || 0) + Math.abs(r.other_fees || 0), 0);
        const totalRefunds = rows.reduce((sum, r) => sum + Math.abs(r.refunds || 0), 0);
        const netPayout = rows.reduce((sum, r) => sum + (r.bank_deposit || 0), 0);

        const grossSales = totalSales;
        const returnRatio = grossSales > 0 ? Math.min(netPayout / grossSales, 1) : 0;
        const feeLoad = grossSales > 0 ? Math.min(totalFees / grossSales, 1) : 0;

        results.push({
          marketplace: mp,
          label: MARKETPLACE_LABELS[mp] || mp,
          totalSales: grossSales,
          totalFees,
          totalRefunds,
          netPayout,
          returnRatio,
          feeLoad,
          settlementCount: rows.length,
        });
      }

      // Sort by return ratio descending (best performing first)
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
      <Card>
        <CardContent className="py-8 flex justify-center">
          <LoadingSpinner size="md" text="Calculating return ratios..." />
        </CardContent>
      </Card>
    );
  }

  if (stats.length === 0) return null;

  const bestRatio = Math.max(...stats.map(s => s.returnRatio));
  const lowestFeeLoad = Math.min(...stats.map(s => s.feeLoad));

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

  function getRatioColor(ratio: number): string {
    if (ratio >= 0.85) return 'text-primary';
    if (ratio >= 0.75) return 'text-foreground';
    return 'text-destructive';
  }

  function getBarWidth(ratio: number): number {
    // Scale bars: minimum 20%, maximum 100%
    return Math.max(20, ratio * 100);
  }

  return (
    <TooltipProvider>
      <Card className="border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Marketplace Return Ratio</CardTitle>
            </div>
            <Tooltip>
              <TooltipTrigger asChild>
                <Info className="h-4 w-4 text-muted-foreground cursor-help" />
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-xs text-xs">
                <p className="font-medium mb-1">How much you keep per $1 sold</p>
                <p>Return Ratio = Net Settlement ÷ Gross Sales</p>
                <p className="mt-1">Includes marketplace fees & refunds. Excludes COGS, shipping & ads.</p>
              </TooltipContent>
            </Tooltip>
          </div>
          <CardDescription className="text-xs">
            For every $1 sold, how much returns to you after marketplace deductions
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-5">
          {/* Marketplace comparison cards */}
          <div className="space-y-3">
            {stats.map((s) => (
              <div key={s.marketplace} className="space-y-2">
                {/* Header row */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{s.label}</span>
                    {s.returnRatio === bestRatio && stats.length > 1 && (
                      <Badge variant="outline" className="text-[10px] h-4 border-primary/30 text-primary">
                        Best
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      ({s.settlementCount} settlement{s.settlementCount !== 1 ? 's' : ''})
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className={`text-lg font-bold tabular-nums ${getRatioColor(s.returnRatio)}`}>
                          ${(s.returnRatio).toFixed(2)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">
                        <p>You keep ${(s.returnRatio).toFixed(2)} for every $1 sold</p>
                        <p className="text-muted-foreground mt-0.5">Return ratio: {formatPct(s.returnRatio)}</p>
                      </TooltipContent>
                    </Tooltip>
                  </div>
                </div>

                {/* Progress bar */}
                <div className="h-2.5 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-500"
                    style={{ width: `${getBarWidth(s.returnRatio)}%`, opacity: s.returnRatio === bestRatio ? 1 : 0.6 }}
                  />
                </div>

                {/* Detail row */}
                <div className="flex items-center gap-4 text-xs text-muted-foreground">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-1">
                        <DollarSign className="h-3 w-3" />
                        Sales: {formatCurrency(s.totalSales)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="text-xs">Gross sales (excl. GST)</TooltipContent>
                  </Tooltip>

                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="flex items-center gap-1">
                        <TrendingUp className="h-3 w-3" />
                        Fee Load: {formatPct(s.feeLoad)}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent className="text-xs">
                      <p>Total marketplace fees ÷ Sales</p>
                      <p className="text-muted-foreground mt-0.5">
                        Fees: {formatCurrency(s.totalFees)} • Refunds: {formatCurrency(s.totalRefunds)}
                      </p>
                    </TooltipContent>
                  </Tooltip>

                  {s.feeLoad === lowestFeeLoad && stats.length > 1 && (
                    <Badge variant="outline" className="text-[10px] h-4 border-primary/20 text-primary">
                      Lowest fees
                    </Badge>
                  )}
                </div>

                {/* Divider (except last) */}
                {stats.indexOf(s) < stats.length - 1 && (
                  <div className="border-b border-border" />
                )}
              </div>
            ))}
          </div>

          {/* Summary footer */}
          {stats.length > 1 && (
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">
                <strong className="text-foreground">{stats[0].label}</strong> returns the most per dollar sold at{' '}
                <strong className="text-foreground">${stats[0].returnRatio.toFixed(2)}</strong>, while{' '}
                <strong className="text-foreground">{stats[stats.length - 1].label}</strong> returns{' '}
                <strong className="text-foreground">${stats[stats.length - 1].returnRatio.toFixed(2)}</strong>.
                {' '}That's a <strong className="text-foreground">{formatPct(stats[0].returnRatio - stats[stats.length - 1].returnRatio)}</strong> difference.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </TooltipProvider>
  );
}