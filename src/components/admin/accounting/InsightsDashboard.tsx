import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Info, TrendingUp, DollarSign, BarChart3, Store, Clock, Receipt, Plus, Megaphone, Wallet } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { MARKETPLACE_LABELS } from '@/utils/settlement-engine';
import LoadingSpinner from '@/components/ui/loading-spinner';
import MarketplaceAlertsBanner from '@/components/MarketplaceAlertsBanner';
import { toast } from '@/hooks/use-toast';

interface FeeBreakdown {
  label: string;
  amount: number;
  pctOfSales: number;
  color: string;
}

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
  adSpend: number;
  returnAfterAds: number | null;
  // Fee breakdown
  commissionTotal: number;
  fbaTotal: number;
  storageTotal: number;
  otherFeesTotal: number;
  feeBreakdown: FeeBreakdown[];
}

interface AdSpendRecord {
  marketplace_code: string;
  spend_amount: number;
}

export default function InsightsDashboard() {
  const [stats, setStats] = useState<MarketplaceStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [adDialogOpen, setAdDialogOpen] = useState(false);
  const [adDialogMarketplace, setAdDialogMarketplace] = useState('');
  const [adMonth, setAdMonth] = useState('');
  const [adAmount, setAdAmount] = useState('');
  const [adCurrency, setAdCurrency] = useState('AUD');
  const [adNotes, setAdNotes] = useState('');
  const [adSaving, setAdSaving] = useState(false);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    try {
      const [settlementsRes, adSpendRes] = await Promise.all([
        supabase
          .from('settlements')
          .select('marketplace, sales_principal, gst_on_income, seller_fees, refunds, bank_deposit, fba_fees, other_fees, storage_fees, period_end')
          .order('period_end', { ascending: false }),
        supabase
          .from('marketplace_ad_spend')
          .select('marketplace_code, spend_amount'),
      ]);

      if (settlementsRes.error) throw settlementsRes.error;
      const data = settlementsRes.data;
      if (!data || data.length === 0) {
        setStats([]);
        return;
      }

      const adSpendByMp: Record<string, number> = {};
      if (adSpendRes.data) {
        for (const row of adSpendRes.data as AdSpendRecord[]) {
          adSpendByMp[row.marketplace_code] = (adSpendByMp[row.marketplace_code] || 0) + Number(row.spend_amount);
        }
      }

      const grouped: Record<string, typeof data> = {};
      for (const row of data) {
        const mp = row.marketplace || 'amazon_au';
        if (!grouped[mp]) grouped[mp] = [];
        grouped[mp].push(row);
      }

      const results: MarketplaceStats[] = [];

      for (const [mp, rows] of Object.entries(grouped)) {
        // Use sales INCLUDING GST for consistent cross-marketplace comparison
        const totalSalesExGst = rows.reduce((sum, r) => sum + (r.sales_principal || 0), 0);
        const totalGstOnSales = rows.reduce((sum, r) => sum + (r.gst_on_income || 0), 0);
        const totalSales = totalSalesExGst + totalGstOnSales; // Gross sales inc GST
        const totalFees = rows.reduce((sum, r) =>
          sum + Math.abs(r.seller_fees || 0) + Math.abs(r.fba_fees || 0) + Math.abs(r.storage_fees || 0) + Math.abs(r.other_fees || 0), 0);
        const totalRefunds = rows.reduce((sum, r) => sum + Math.abs(r.refunds || 0), 0);
        const netPayout = rows.reduce((sum, r) => sum + (r.bank_deposit || 0), 0);
        // Cap ratio at 1.0 — a return > $1 per $1 sold is impossible
        const returnRatio = totalSales > 0 ? Math.min(netPayout / totalSales, 1) : 0;
        const feeLoad = totalSales > 0 ? Math.min(totalFees / totalSales, 1) : 0;
        const commissionTotal = Math.abs(rows.reduce((sum, r) => sum + (r.seller_fees || 0), 0));
        const avgCommission = totalSales > 0 ? Math.min(commissionTotal / totalSales, 1) : 0;
        const latestPeriodEnd = rows.length > 0 ? rows[0].period_end : null;
        const fbaTotal = Math.abs(rows.reduce((sum, r) => sum + (r.fba_fees || 0), 0));
        const storageTotal = Math.abs(rows.reduce((sum, r) => sum + (r.storage_fees || 0), 0));
        const otherFeesTotal = Math.abs(rows.reduce((sum, r) => sum + (r.other_fees || 0), 0));

        const adSpend = adSpendByMp[mp] || 0;
        const returnAfterAds = totalSales > 0 ? Math.max(Math.min((netPayout - adSpend) / totalSales, 1), -1) : null;

        // Build fee breakdown for waterfall
        const feeBreakdown: FeeBreakdown[] = [];
        if (commissionTotal > 0) feeBreakdown.push({ label: 'Commission', amount: commissionTotal, pctOfSales: totalSales > 0 ? commissionTotal / totalSales : 0, color: 'bg-primary' });
        if (fbaTotal > 0) feeBreakdown.push({ label: 'FBA Fulfilment', amount: fbaTotal, pctOfSales: totalSales > 0 ? fbaTotal / totalSales : 0, color: 'bg-destructive' });
        if (storageTotal > 0) feeBreakdown.push({ label: 'Storage', amount: storageTotal, pctOfSales: totalSales > 0 ? storageTotal / totalSales : 0, color: 'bg-muted-foreground' });
        if (totalRefunds > 0) feeBreakdown.push({ label: 'Refunds', amount: totalRefunds, pctOfSales: totalSales > 0 ? totalRefunds / totalSales : 0, color: 'bg-muted-foreground/60' });
        if (otherFeesTotal > 0) feeBreakdown.push({ label: 'Other fees', amount: otherFeesTotal, pctOfSales: totalSales > 0 ? otherFeesTotal / totalSales : 0, color: 'bg-muted-foreground/40' });
        feeBreakdown.sort((a, b) => b.amount - a.amount);

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
          adSpend,
          returnAfterAds,
          commissionTotal,
          fbaTotal,
          storageTotal,
          otherFeesTotal,
          feeBreakdown,
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

  function openAdDialog(marketplaceCode: string) {
    setAdDialogMarketplace(marketplaceCode);
    setAdMonth('');
    setAdAmount('');
    setAdCurrency('AUD');
    setAdNotes('');
    setAdDialogOpen(true);
  }

  async function saveAdSpend() {
    if (!adMonth || !adAmount || Number(adAmount) <= 0) {
      toast({ title: 'Please enter a valid month and amount', variant: 'destructive' });
      return;
    }
    setAdSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const periodStart = `${adMonth}-01`;
      const d = new Date(periodStart);
      const periodEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];

      const { error } = await supabase
        .from('marketplace_ad_spend')
        .upsert({
          user_id: user.id,
          marketplace_code: adDialogMarketplace,
          period_start: periodStart,
          period_end: periodEnd,
          spend_amount: Number(adAmount),
          currency: adCurrency,
          source: 'manual',
          notes: adNotes || null,
        }, { onConflict: 'user_id,marketplace_code,period_start' });

      if (error) throw error;

      toast({ title: 'Ad spend saved' });
      setAdDialogOpen(false);
      await loadStats();
    } catch (err: any) {
      toast({ title: 'Failed to save', description: err.message, variant: 'destructive' });
    } finally {
      setAdSaving(false);
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
  const totalAllFees = stats.reduce((sum, s) => sum + s.totalFees, 0);
  const totalAllAdSpend = stats.reduce((sum, s) => sum + s.adSpend, 0);
  const overallRatio = totalAllSales > 0 ? totalAllNet / totalAllSales : 0;
  const overallAfterAds = totalAllSales > 0 ? Math.max((totalAllNet - totalAllAdSpend) / totalAllSales, -1) : null;
  const netPctOfSales = totalAllSales > 0 ? (totalAllNet / totalAllSales * 100).toFixed(0) : '0';

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

  function getAdImpactText(s: MarketplaceStats): string | null {
    if (s.adSpend <= 0 || s.returnAfterAds === null) return null;
    const drop = s.returnRatio - s.returnAfterAds;
    if (drop <= 0) return null;
    return `Advertising reduced return from $${s.returnRatio.toFixed(2)} → $${s.returnAfterAds.toFixed(2)}`;
  }

  // Generate the main insight sentence
  const topRevenue = [...stats].sort((a, b) => b.totalSales - a.totalSales)[0];
  const bestProfit = [...stats].sort((a, b) => b.returnRatio - a.returnRatio)[0];

  function getHeroInsight(): string {
    if (stats.length === 1) {
      return `${stats[0].label} returns $${stats[0].returnRatio.toFixed(2)} for every $1 sold after marketplace fees.`;
    }
    // If same marketplace leads both, simple message
    if (topRevenue.marketplace === bestProfit.marketplace) {
      return `${topRevenue.label} leads in both revenue (${formatCurrency(topRevenue.totalSales)}) and profit efficiency ($${topRevenue.returnRatio.toFixed(2)} per $1).`;
    }
    const profitMultiple = bestProfit.returnRatio / topRevenue.returnRatio;
    if (profitMultiple >= 1.5) {
      return `${topRevenue.label} generates the most revenue, but ${bestProfit.label} returns ${profitMultiple.toFixed(1)}× more profit per sale.`;
    }
    return `${topRevenue.label} drives the most revenue (${formatCurrency(topRevenue.totalSales)}), while ${bestProfit.label} keeps $${bestProfit.returnRatio.toFixed(2)} per $1 sold.`;
  }

  // Stacked bar segments for $1 breakdown
  function getStackedSegments(s: MarketplaceStats) {
    if (s.totalSales <= 0) return { net: 0, ads: 0, fees: 0 };
    const feePct = s.feeLoad;
    const adsPct = s.adSpend / s.totalSales;
    const netPct = Math.max(0, 1 - feePct - adsPct);
    return { net: netPct * 100, ads: adsPct * 100, fees: feePct * 100 };
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

        {/* Hero insight sentence */}
        <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
          <p className="text-sm text-foreground font-medium">{getHeroInsight()}</p>
        </div>

        {/* Summary cards row — 5 cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground">Total Sales</p>
              <p className="text-xl font-bold text-foreground mt-1">{formatCurrency(totalAllSales)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{stats.length} marketplace{stats.length !== 1 ? 's' : ''}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground font-medium">Marketplace Fees Paid</p>
              <p className="text-xl font-bold text-destructive mt-1">{formatCurrency(totalAllFees)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{formatPct(totalAllSales > 0 ? totalAllFees / totalAllSales : 0)} of sales</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground">Net Received</p>
              <p className="text-xl font-bold text-foreground mt-1">{formatCurrency(totalAllNet)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{netPctOfSales}% of total sales</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="text-xs text-muted-foreground cursor-help underline decoration-dotted">Return per $1 Sold</p>
                </TooltipTrigger>
                <TooltipContent className="text-xs max-w-xs">How much you keep per $1 of sales after marketplace fees. Excludes COGS, shipping & advertising.</TooltipContent>
              </Tooltip>
              <p className={`text-xl font-bold mt-1 ${getRatioColor(overallRatio)}`}>${overallRatio.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">(after marketplace fees)</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="text-xs text-muted-foreground cursor-help underline decoration-dotted">Top Revenue</p>
                </TooltipTrigger>
                <TooltipContent className="text-xs max-w-xs">The marketplace generating the highest total sales volume — your volume engine.</TooltipContent>
              </Tooltip>
              <p className="text-xl font-bold text-foreground mt-1">{topRevenue.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{formatCurrency(topRevenue.totalSales)} sales</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="text-xs text-muted-foreground cursor-help underline decoration-dotted">Best Performer</p>
                </TooltipTrigger>
                <TooltipContent className="text-xs max-w-xs">The marketplace returning the most profit per $1 sold — your efficiency engine.</TooltipContent>
              </Tooltip>
              <p className="text-xl font-bold text-primary mt-1">{bestProfit.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">${bestProfit.returnRatio.toFixed(2)} per $1</p>
            </CardContent>
          </Card>
        </div>

        {/* $1 Sale Breakdown — main chart */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">$1 Sale Breakdown</CardTitle>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-xs text-xs">
                  <p className="font-medium mb-1">Marketplace Payout</p>
                  <p><strong>Marketplace payout</strong> = Net Settlement ÷ Gross Sales</p>
                  <p className="mt-1"><strong>After advertising</strong> = (Net Settlement − Ad Spend) ÷ Gross Sales</p>
                  <p className="mt-1 text-muted-foreground">Excludes COGS, shipping costs & tax.</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <CardDescription className="text-xs">
              For every $1 you sell, here's what you keep after marketplace fees
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {stats.map((s) => {
              const segments = getStackedSegments(s);
              const impactText = getAdImpactText(s);

              return (
                <div key={s.marketplace} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-foreground">{s.label}</span>
                      {s.returnRatio === bestRatio && stats.length > 1 && (
                        <Badge variant="outline" className="text-[10px] h-4 border-primary/30 text-primary">Best</Badge>
                      )}
                    </div>
                    <div className="text-right">
                      <span className={`text-lg font-bold tabular-nums ${getRatioColor(s.returnRatio)}`}>
                        ${s.returnRatio.toFixed(2)}
                      </span>
                      <span className="text-xs text-muted-foreground ml-1">you keep</span>
                    </div>
                  </div>

                  {/* Stacked $1 breakdown bar */}
                  <div className="h-6 rounded-full overflow-hidden flex bg-muted/30">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="h-full bg-primary rounded-l-full transition-all duration-700 ease-out" style={{ width: `${segments.net}%` }} />
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">${(segments.net / 100).toFixed(2)} you keep</TooltipContent>
                    </Tooltip>
                    {segments.ads > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="h-full bg-amber-400 transition-all duration-500" style={{ width: `${segments.ads}%` }} />
                        </TooltipTrigger>
                        <TooltipContent className="text-xs">${(segments.ads / 100).toFixed(2)} advertising</TooltipContent>
                      </Tooltip>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="h-full bg-muted-foreground/50 rounded-r-full transition-all duration-500" style={{ width: `${segments.fees}%` }} />
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">${(segments.fees / 100).toFixed(2)} marketplace fees</TooltipContent>
                    </Tooltip>
                  </div>

                  {/* Legend */}
                  <div className="flex gap-3 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-primary inline-block" />
                      ${(segments.net / 100).toFixed(2)} you keep
                    </span>
                    {segments.ads > 0 && (
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-accent inline-block" />
                        ${(segments.ads / 100).toFixed(2)} ads
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/50 inline-block" />
                      ${(segments.fees / 100).toFixed(2)} fees
                    </span>
                  </div>

                  {/* After advertising row */}
                  {s.adSpend > 0 && s.returnAfterAds !== null ? (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Megaphone className="h-3 w-3" /> After advertising
                      </span>
                      <span className={`font-semibold tabular-nums ${getRatioColor(s.returnAfterAds)}`}>
                        ${s.returnAfterAds.toFixed(2)}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="text-[11px] text-muted-foreground">Add ad spend to see true return</p>
                      <Button variant="ghost" size="sm" className="h-6 text-[11px] px-2 text-primary" onClick={() => openAdDialog(s.marketplace)}>
                        <Plus className="h-3 w-3 mr-1" /> Add Ad Spend
                      </Button>
                    </div>
                  )}

                  {/* Impact insight text */}
                  {impactText && (
                    <p className="text-[11px] text-muted-foreground italic">{impactText}</p>
                  )}
                </div>
              );
            })}

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
                {/* Cross-marketplace ad comparison */}
                {stats.filter(s => s.adSpend > 0).length > 1 && (() => {
                  const withAds = stats.filter(s => s.returnAfterAds !== null && s.adSpend > 0);
                  const bestAfterAds = withAds.reduce((best, s) => (s.returnAfterAds! > best.returnAfterAds! ? s : best), withAds[0]);
                  const worstAfterAds = withAds.reduce((worst, s) => (s.returnAfterAds! < worst.returnAfterAds! ? s : worst), withAds[0]);
                  if (bestAfterAds.marketplace === worstAfterAds.marketplace) return null;
                  const diff = bestAfterAds.returnAfterAds! - worstAfterAds.returnAfterAds!;
                  return (
                    <p className="text-xs text-muted-foreground mt-1.5">
                      After advertising, <strong className="text-foreground">{bestAfterAds.label}</strong> returns{' '}
                      <strong className="text-foreground">${diff.toFixed(2)}</strong> more per $1 than{' '}
                      <strong className="text-foreground">{worstAfterAds.label}</strong>.
                    </p>
                  );
                })()}
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
              Marketplace fees, commission rates, advertising impact and refund impact
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2.5 font-medium text-foreground">Marketplace</th>
                    <th className="text-right px-3 py-2.5 font-medium text-foreground">Sales</th>
                    <th className="text-right px-3 py-2.5 font-medium text-foreground">
                      <Tooltip>
                        <TooltipTrigger className="cursor-help underline decoration-dotted">Marketplace Fees</TooltipTrigger>
                        <TooltipContent className="text-xs">Total marketplace fees as a percentage of sales</TooltipContent>
                      </Tooltip>
                    </th>
                    <th className="text-right px-3 py-2.5 font-medium text-foreground">Avg Commission</th>
                    <th className="text-right px-3 py-2.5 font-medium text-foreground">Refunds</th>
                    <th className="text-right px-3 py-2.5 font-medium text-foreground">
                      <Tooltip>
                        <TooltipTrigger className="cursor-help underline decoration-dotted">Ad Spend</TooltipTrigger>
                        <TooltipContent className="text-xs">Total advertising spend (analytics only — not synced to accounting)</TooltipContent>
                      </Tooltip>
                    </th>
                    <th className="text-right px-3 py-2.5 font-medium text-foreground">Net</th>
                    <th className="text-right px-3 py-2.5 font-medium text-foreground">
                      <Tooltip>
                        <TooltipTrigger className="cursor-help underline decoration-dotted">Payout</TooltipTrigger>
                        <TooltipContent className="text-xs">Net Settlement ÷ Gross Sales (after marketplace fees)</TooltipContent>
                      </Tooltip>
                    </th>
                    <th className="text-right px-3 py-2.5 font-medium text-foreground">
                      <Tooltip>
                        <TooltipTrigger className="cursor-help underline decoration-dotted">After Ads</TooltipTrigger>
                        <TooltipContent className="text-xs">(Net Settlement − Ad Spend) ÷ Gross Sales</TooltipContent>
                      </Tooltip>
                    </th>
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
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatPct(s.feeLoad)} of sales</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatPct(s.avgCommission)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatCurrency(s.totalRefunds)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                        {s.adSpend > 0 ? formatCurrency(s.adSpend) : (
                          <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5 text-primary" onClick={() => openAdDialog(s.marketplace)}>
                            <Plus className="h-3 w-3 mr-0.5" /> Add
                          </Button>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-foreground">{formatCurrency(s.netPayout)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-bold ${getRatioColor(s.returnRatio)}`}>{formatPct(s.returnRatio)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-bold ${s.returnAfterAds !== null && s.adSpend > 0 ? getRatioColor(s.returnAfterAds) : 'text-muted-foreground'}`}>
                        {s.adSpend > 0 && s.returnAfterAds !== null ? formatPct(s.returnAfterAds) : '—'}
                      </td>
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

                  {/* Stacked bar in card */}
                  <div className="h-3 rounded-full overflow-hidden flex">
                    <div className="h-full bg-primary transition-all duration-500" style={{ width: `${getStackedSegments(s).net}%` }} />
                    {s.adSpend > 0 && (
                      <div className="h-full bg-accent transition-all duration-500" style={{ width: `${getStackedSegments(s).ads}%` }} />
                    )}
                    <div className="h-full bg-muted-foreground/25 transition-all duration-500" style={{ width: `${getStackedSegments(s).fees}%` }} />
                  </div>

                  <div className="grid grid-cols-2 gap-y-1.5 text-xs">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <DollarSign className="h-3 w-3" /> Sales
                    </div>
                    <span className="text-right tabular-nums text-foreground">{formatCurrency(s.totalSales)}</span>

                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Receipt className="h-3 w-3" /> Marketplace fees
                    </div>
                    <span className="text-right tabular-nums text-foreground">{formatPct(s.feeLoad)} of sales</span>

                    <div className="flex items-center gap-1 text-muted-foreground">
                      <TrendingUp className="h-3 w-3" /> Avg commission
                    </div>
                    <span className="text-right tabular-nums text-foreground">{formatPct(s.avgCommission)}</span>

                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Megaphone className="h-3 w-3" /> Ad spend
                    </div>
                    <span className="text-right tabular-nums text-foreground">
                      {s.adSpend > 0 ? formatCurrency(s.adSpend) : (
                        <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1 text-primary" onClick={() => openAdDialog(s.marketplace)}>
                          <Plus className="h-3 w-3 mr-0.5" /> Add
                        </Button>
                      )}
                    </span>

                    {s.adSpend > 0 && s.returnAfterAds !== null && (
                      <>
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Megaphone className="h-3 w-3" /> After ads
                        </div>
                        <span className={`text-right tabular-nums font-semibold ${getRatioColor(s.returnAfterAds)}`}>
                          {formatPct(s.returnAfterAds)}
                        </span>
                      </>
                    )}

                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Store className="h-3 w-3" /> Settlements
                    </div>
                    <span className="text-right tabular-nums text-foreground">{s.settlementCount}</span>

                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3 w-3" /> Latest
                    </div>
                    <span className="text-right text-foreground">{formatDate(s.latestPeriodEnd)}</span>
                  </div>

                  {/* Insight text */}
                  {(() => {
                    const impact = getAdImpactText(s);
                    if (!impact) return null;
                    return <p className="text-[11px] text-muted-foreground italic border-t border-border pt-2">{impact}</p>;
                  })()}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Add Ad Spend Dialog */}
        <Dialog open={adDialogOpen} onOpenChange={setAdDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add Advertising Spend</DialogTitle>
              <DialogDescription>
                Record monthly ad spend for <strong>{MARKETPLACE_LABELS[adDialogMarketplace] || adDialogMarketplace}</strong>. This is analytics only — not synced to your accounting software.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="ad-month">Month</Label>
                <Input
                  id="ad-month"
                  type="month"
                  value={adMonth}
                  onChange={(e) => setAdMonth(e.target.value)}
                  placeholder="2026-03"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ad-amount">Spend Amount</Label>
                <Input
                  id="ad-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={adAmount}
                  onChange={(e) => setAdAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ad-currency">Currency</Label>
                <Select value={adCurrency} onValueChange={setAdCurrency}>
                  <SelectTrigger id="ad-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AUD">AUD</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ad-notes">Notes (optional)</Label>
                <Textarea
                  id="ad-notes"
                  value={adNotes}
                  onChange={(e) => setAdNotes(e.target.value)}
                  placeholder="e.g. Sponsored Products campaign"
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAdDialogOpen(false)}>Cancel</Button>
              <Button onClick={saveAdSpend} disabled={adSaving}>
                {adSaving ? 'Saving...' : 'Save Ad Spend'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
