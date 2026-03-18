/**
 * MarketplaceProfitComparison — Cross-marketplace profit ranking.
 * Pro/Admin-only feature with upgrade prompt for free users.
 */

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { BarChart3, Lock, ArrowRight, TrendingUp, TrendingDown, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { MARKETPLACE_LABELS } from '@/utils/settlement-engine';
import { loadFulfilmentMethods, loadPostageCosts, getEffectiveMethod } from '@/utils/fulfilment-settings';
import type { FulfilmentMethod } from '@/utils/fulfilment-settings';

// Estimated commission rates (mirrors edge function + InsightsDashboard)
const COMMISSION_ESTIMATES: Record<string, number> = {
  kogan: 0.12, bigw: 0.08, everyday_market: 0.10, mydeal: 0.10,
  bunnings: 0.10, catch: 0.12, ebay_au: 0.13, iconic: 0.15,
  tradesquare: 0.10, tiktok: 0.05,
};
const DEFAULT_COMMISSION_RATE = 0.10;

interface AggregatedMarketplace {
  marketplace_code: string;
  marketplace_name: string;
  avg_margin: number;
  total_revenue: number;
  total_profit: number;
  periods: number;
  has_cost_data: boolean;
  has_estimated_fees: boolean;
}

function formatAUD(amount: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

function getMarginColor(margin: number): string {
  if (margin >= 30) return 'text-emerald-600 dark:text-emerald-400';
  if (margin >= 15) return 'text-amber-600 dark:text-amber-400';
  return 'text-destructive';
}

export default function MarketplaceProfitComparison() {
  const [data, setData] = useState<AggregatedMarketplace[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [accessChecked, setAccessChecked] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    checkAccessAndLoad();
  }, []);

  async function checkAccessAndLoad() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Check role
      const { data: roles } = await supabase
        .from('user_roles')
        .select('role')
        .eq('user_id', user.id);

      const userRoles = (roles || []).map(r => r.role);
      const canAccess = userRoles.includes('pro') || userRoles.includes('admin');
      setHasAccess(canAccess);
      setAccessChecked(true);

      if (!canAccess) {
        setLoading(false);
        return;
      }

      // Load profit data + all marketplaces from settlements + fulfilment/postage settings
      const [profitRes, settlementsRes, fulfilmentMethods, postageCosts] = await Promise.all([
        supabase
          .from('settlement_profit')
          .select('marketplace_code, gross_revenue, gross_profit, margin_percent')
          .eq('user_id', user.id),
        supabase
          .from('settlements')
          .select('marketplace, sales_principal, sales_shipping, gst_on_income, bank_deposit, source, seller_fees, raw_payload')
          .eq('user_id', user.id)
          .eq('is_hidden', false)
          .is('duplicate_of_settlement_id', null)
          .not('status', 'in', '("push_failed_permanent","duplicate_suppressed")'),
        loadFulfilmentMethods(user.id),
        loadPostageCosts(user.id),
      ]);

      if (profitRes.error) throw profitRes.error;
      if (settlementsRes.error) throw settlementsRes.error;

      const profits = profitRes.data || [];
      const settlements = settlementsRes.data || [];

      // Aggregate profit data by marketplace, filtering out corrupted rows
      const mpMap = new Map<string, { revenue: number; profit: number; margins: number[]; count: number }>();
      for (const row of profits) {
        if (Math.abs(Number(row.gross_revenue) || 0) > 10_000_000) continue;
        const mp = row.marketplace_code;
        if (!mpMap.has(mp)) mpMap.set(mp, { revenue: 0, profit: 0, margins: [], count: 0 });
        const entry = mpMap.get(mp)!;
        entry.revenue += Number(row.gross_revenue) || 0;
        entry.profit += Number(row.gross_profit) || 0;
        entry.margins.push(Number(row.margin_percent) || 0);
        entry.count++;
      }

      // Also aggregate settlement-level data for marketplaces without profit rows
      // Track per-marketplace with source breakdown for mixed CSV/api_sync handling
      interface SettlementAgg {
        revenue: number; payout: number; count: number; hasEstimated: boolean;
        csvSalesExGst: number; csvFees: number; csvPayout: number; csvGst: number; csvCount: number;
        apiSyncSalesExGst: number; apiSyncGst: number; apiSyncCount: number;
      }
      const settlementMap = new Map<string, SettlementAgg>();
      for (const row of settlements) {
        const mp = row.marketplace;
        if (!mp) continue;
        if (!settlementMap.has(mp)) settlementMap.set(mp, {
          revenue: 0, payout: 0, count: 0, hasEstimated: false,
          csvSalesExGst: 0, csvFees: 0, csvPayout: 0, csvGst: 0, csvCount: 0,
          apiSyncSalesExGst: 0, apiSyncGst: 0, apiSyncCount: 0,
        });
        const entry = settlementMap.get(mp)!;
        const salesExGst = Number(row.sales_principal) || 0;
        const gst = Number(row.gst_on_income) || 0;
        const shipping = Number(row.sales_shipping) || 0;
        entry.revenue += salesExGst + shipping + gst;
        entry.payout += Number(row.bank_deposit) || 0;
        entry.count++;
        const payload = row.raw_payload as any;
        if (payload?.fees_estimated === true) entry.hasEstimated = true;

        const isApiSyncZeroFee = (row as any).source === 'api_sync' && Math.abs(Number(row.seller_fees) || 0) < 0.01;
        if (isApiSyncZeroFee) {
          entry.apiSyncSalesExGst += salesExGst;
          entry.apiSyncGst += gst;
          entry.apiSyncCount++;
        } else {
          entry.csvSalesExGst += salesExGst;
          entry.csvFees += Math.abs(Number(row.seller_fees) || 0);
          entry.csvPayout += Number(row.bank_deposit) || 0;
          entry.csvGst += gst;
          entry.csvCount++;
        }
      }

      const results: AggregatedMarketplace[] = [];

      // ─── Platform Family Fee Redistribution ───────────────────────────
      // MyDeal, BigW, and Everyday Market share the Woolworths MarketPlus platform.
      // Platform-level fees get assigned to MyDeal even when sales are on BigW/Everyday Market.
      const PLATFORM_FAMILIES: Record<string, string[]> = {
        woolworths_marketplus: ['mydeal', 'bigw', 'everyday_market', 'woolworths_market'],
      };

      const redistributedFees: Record<string, number> = {};
      for (const siblings of Object.values(PLATFORM_FAMILIES)) {
        const presentSiblings = siblings.filter(s => settlementMap.has(s));
        if (presentSiblings.length < 2) continue;

        const feeHeavy: string[] = [];
        const salesSiblings: string[] = [];
        for (const s of presentSiblings) {
          const agg = settlementMap.get(s)!;
          const sales = agg.revenue;
          const fees = agg.csvFees + Math.abs(agg.csvSalesExGst > 0 ? 0 : agg.apiSyncSalesExGst * (COMMISSION_ESTIMATES[s] || DEFAULT_COMMISSION_RATE));
          const totalFees = fees || Math.abs(agg.csvFees);
          if (totalFees > Math.max(sales * 1.5, 50)) {
            feeHeavy.push(s);
          } else if (sales > 0) {
            salesSiblings.push(s);
          }
        }

        if (feeHeavy.length === 0 || salesSiblings.length === 0) continue;

        let totalExcessFees = 0;
        for (const fh of feeHeavy) {
          const agg = settlementMap.get(fh)!;
          const ownFees = agg.revenue * 0.15;
          totalExcessFees += Math.max(agg.csvFees - ownFees, 0);
        }

        let totalSiblingSales = 0;
        const siblingSalesMap: Record<string, number> = {};
        for (const s of salesSiblings) {
          const sales = settlementMap.get(s)!.revenue;
          siblingSalesMap[s] = sales;
          totalSiblingSales += sales;
        }

        if (totalSiblingSales > 0 && totalExcessFees > 0) {
          for (const s of salesSiblings) {
            redistributedFees[s] = (totalExcessFees * siblingSalesMap[s]) / totalSiblingSales;
          }
        }
      }

      // Add marketplaces with profit data (postage already included in gross_profit)
      for (const [mp, agg] of mpMap) {
        const avg_margin = agg.margins.length > 0
          ? agg.margins.reduce((a, b) => a + b, 0) / agg.margins.length
          : 0;
        results.push({
          marketplace_code: mp,
          marketplace_name: MARKETPLACE_LABELS[mp] || mp,
          avg_margin: Math.round(avg_margin * 10) / 10,
          total_revenue: Math.round(agg.revenue),
          total_profit: Math.round(agg.profit - (redistributedFees[mp] || 0)),
          periods: agg.count,
          has_cost_data: true,
          has_estimated_fees: settlementMap.get(mp)?.hasEstimated || redistributedFees[mp] > 0 || false,
        });
      }

      // Add marketplaces that only have settlement data (no profit rows)
      for (const [mp, agg] of settlementMap) {
        if (mpMap.has(mp)) continue;
        if (agg.revenue <= 0) continue;
        const fulfilmentMethod = getEffectiveMethod(mp, fulfilmentMethods[mp]);
        const postageCost = postageCosts[mp] || 0;
        const shouldDeductShipping = fulfilmentMethod === 'self_ship' || fulfilmentMethod === 'third_party_logistics';
        const estimatedPostageDeduction = shouldDeductShipping ? postageCost * agg.count : 0;

        let adjustedPayout = agg.payout - estimatedPostageDeduction;
        let hasEstimated = agg.hasEstimated;

        // Handle mixed CSV + api_sync: extrapolate real CSV fee rate onto api_sync rows
        if (agg.apiSyncCount > 0 && agg.csvCount > 0) {
          const realFeeRate = agg.csvSalesExGst > 0 ? agg.csvFees / agg.csvSalesExGst : (COMMISSION_ESTIMATES[mp] || DEFAULT_COMMISSION_RATE);
          const estimatedApiSyncFees = agg.apiSyncSalesExGst * realFeeRate;
          adjustedPayout = agg.csvPayout + (agg.apiSyncSalesExGst + agg.apiSyncGst - estimatedApiSyncFees) - estimatedPostageDeduction;
          hasEstimated = true;
        } else if (agg.apiSyncCount > 0 && agg.csvCount === 0) {
          const estimatedRate = COMMISSION_ESTIMATES[mp] || DEFAULT_COMMISSION_RATE;
          const estimatedFees = agg.apiSyncSalesExGst * estimatedRate;
          adjustedPayout = agg.revenue - estimatedFees - estimatedPostageDeduction;
          hasEstimated = true;
        }

        // Deduct redistributed platform fees
        if (redistributedFees[mp]) {
          adjustedPayout -= redistributedFees[mp];
          hasEstimated = true;
        }

        const margin = agg.revenue > 0 ? Math.min((adjustedPayout / agg.revenue) * 100, 100) : 0;
        results.push({
          marketplace_code: mp,
          marketplace_name: MARKETPLACE_LABELS[mp] || mp,
          avg_margin: Math.round(margin * 10) / 10,
          total_revenue: Math.round(agg.revenue),
          total_profit: Math.round(adjustedPayout),
          periods: agg.count,
          has_cost_data: false,
          has_estimated_fees: hasEstimated,
        });
      }

      results.sort((a, b) => b.avg_margin - a.avg_margin);
      setData(results);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  if (loading || !accessChecked) return null;

  // Locked state for non-Pro users
  if (!hasAccess) {
    return (
      <Card className="border-border relative overflow-hidden">
        <div className="absolute inset-0 bg-background/60 backdrop-blur-[2px] z-10 flex items-center justify-center">
          <div className="text-center px-6 max-w-sm">
            <Lock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-semibold text-foreground">
              📊 Cross-Marketplace Profit Comparison
            </p>
            <p className="text-xs text-muted-foreground mt-1.5">
              See which marketplace makes you the most money per sale.
            </p>
            <Button
              size="sm"
              className="mt-3 gap-1.5"
              onClick={() => navigate('/pricing')}
            >
              Upgrade to Pro <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-muted-foreground" />
            Marketplace Profit Ranking
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-4 opacity-30 pointer-events-none select-none">
          {/* Blurred placeholder rows */}
          {[1, 2, 3].map(i => (
            <div key={i} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-muted-foreground w-5">{i}</span>
                <span className="text-xs text-foreground">Marketplace {i}</span>
              </div>
              <span className="text-xs font-medium">XX%</span>
            </div>
          ))}
        </CardContent>
      </Card>
    );
  }

  if (data.length === 0) return null;

  const best = data[0];
  const worst = data[data.length - 1];

  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          Marketplace Profit Ranking
        </CardTitle>
        <CardDescription className="text-xs">
          Average margin across all periods — which marketplace makes you the most?
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="border border-border rounded-md overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-[10px] w-10">Rank</TableHead>
                <TableHead className="text-[10px]">Marketplace</TableHead>
                <TableHead className="text-[10px] text-right">Avg Margin</TableHead>
                <TableHead className="text-[10px] text-right">Revenue</TableHead>
                <TableHead className="text-[10px] text-right">Profit</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((mp, idx) => {
                const isBest = idx === 0 && data.length > 1;
                const isWorst = idx === data.length - 1 && data.length > 1;
                return (
                  <TableRow key={mp.marketplace_code} className={isBest ? 'bg-emerald-50/50 dark:bg-emerald-900/10' : isWorst ? 'bg-red-50/50 dark:bg-red-900/10' : ''}>
                    <TableCell className="text-xs font-bold text-muted-foreground">{idx + 1}</TableCell>
                    <TableCell className="text-xs font-medium text-foreground flex items-center gap-1.5">
                      {mp.marketplace_name}
                      {isBest && <TrendingUp className="h-3 w-3 text-emerald-500" />}
                      {isWorst && <TrendingDown className="h-3 w-3 text-destructive" />}
                      {!mp.has_cost_data && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 border-muted-foreground/30 text-muted-foreground">payout margin</Badge>
                      )}
                      {mp.has_estimated_fees && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-400/50 text-amber-600 dark:text-amber-400">
                          <AlertTriangle className="h-2 w-2 mr-0.5" />
                          Estimated
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className={`text-xs text-right font-semibold ${getMarginColor(mp.avg_margin)}`}>
                      {mp.avg_margin.toFixed(1)}%
                    </TableCell>
                    <TableCell className="text-xs text-right text-muted-foreground">{formatAUD(mp.total_revenue)}</TableCell>
                    <TableCell className="text-xs text-right font-medium text-foreground">{formatAUD(mp.total_profit)}</TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {data.length > 1 && (
          <p className="text-[10px] text-muted-foreground mt-2">
            Based on {data.reduce((s, d) => s + d.periods, 0)} settlement periods across {data.length} marketplaces.
            {data.some(d => !d.has_cost_data) && ' Marketplaces marked "payout margin" use net payout ÷ gross sales (add SKU costs for true profit).'}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
