/**
 * MarketplaceProfitComparison — Cross-marketplace profit ranking.
 * Pro/Admin-only feature with upgrade prompt for free users.
 * 
 * Uses canonical fee-attribution utility for consistent fee estimation.
 */

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { BarChart3, Lock, ArrowRight, TrendingUp, TrendingDown, AlertTriangle, Truck } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { MARKETPLACE_LABELS } from '@/utils/settlement-engine';
import { loadFulfilmentMethods, loadPostageCosts, getEffectiveMethod, getPostageDeductionForOrder } from '@/utils/fulfilment-settings';
import type { FulfilmentMethod } from '@/utils/fulfilment-settings';
import {
  normalizeMarketplace,
  attributeFees,
  redistributePlatformFees,
  isMarginSuspicious,
  type SettlementRow,
} from '@/utils/insights-fee-attribution';

interface AggregatedMarketplace {
  marketplace_code: string;
  marketplace_name: string;
  avg_margin: number;
  total_revenue: number;
  total_profit: number;
  periods: number;
  has_cost_data: boolean;
  has_estimated_fees: boolean;
  implied_commission_rate: number | null;
  shipping_deduction: number;
  order_count: number;
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
      const [profitRes, settlementsRes, fulfilmentMethods, postageCosts, orderCountsRes] = await Promise.all([
        supabase
          .from('settlement_profit')
          .select('marketplace_code, settlement_id, gross_revenue, gross_profit, margin_percent')
          .eq('user_id', user.id),
        supabase
          .from('settlements')
          .select('marketplace, sales_principal, sales_shipping, gst_on_income, bank_deposit, source, seller_fees, raw_payload, period_start, period_end, is_hidden, is_pre_boundary, fba_fees, other_fees, storage_fees, refunds, settlement_id')
          .eq('user_id', user.id)
          .eq('is_hidden', false)
          .is('duplicate_of_settlement_id', null)
          .not('status', 'in', '("push_failed_permanent","duplicate_suppressed")'),
        loadFulfilmentMethods(user.id),
        loadPostageCosts(user.id),
        supabase
          .from('settlement_lines')
          .select('marketplace_name, order_id')
          .eq('user_id', user.id)
          .eq('accounting_category', 'revenue')
          .not('order_id', 'is', null),
      ]);

      if (profitRes.error) throw profitRes.error;
      if (settlementsRes.error) throw settlementsRes.error;

      const profits = profitRes.data || [];
      const settlements = settlementsRes.data || [];

      // Build order counts map by counting distinct order_ids per marketplace
      const orderCountsByMp: Record<string, number> = {};
      if (orderCountsRes.data && Array.isArray(orderCountsRes.data)) {
        const seen: Record<string, Set<string>> = {};
        for (const row of orderCountsRes.data as any[]) {
          const mp = normalizeMarketplace(row.marketplace_name || '');
          if (!mp || !row.order_id) continue;
          if (!seen[mp]) seen[mp] = new Set();
          seen[mp].add(row.order_id);
        }
        for (const [mp, ids] of Object.entries(seen)) {
          orderCountsByMp[mp] = ids.size;
        }
      }

      // Build a set of active settlement IDs for cross-referencing profit rows
      const activeSettlementIds = new Set(settlements.map(s => (s as any).settlement_id));

      // Group settlements by normalised marketplace
      const grouped: Record<string, SettlementRow[]> = {};
      for (const row of settlements) {
        const rawMp = row.marketplace;
        if (!rawMp) continue;
        const mp = normalizeMarketplace(rawMp);
        if (!grouped[mp]) grouped[mp] = [];
        grouped[mp].push(row as unknown as SettlementRow);
      }

      // ─── Exclude api_sync rows when real CSV data exists ───
      for (const [mp, rows] of Object.entries(grouped)) {
        const realRows = rows.filter(r => r.source !== 'api_sync');
        const apiSyncRows = rows.filter(r => r.source === 'api_sync');
        if (realRows.length > 0 && apiSyncRows.length > 0) {
          grouped[mp] = realRows;
        }
      }

      // Load observed rates for redistribution
      const { data: observedRatesData } = await supabase
        .from('app_settings')
        .select('key, value')
        .like('key', 'observed_commission_rate_%');
      
      const observedRates: Record<string, number> = {};
      if (observedRatesData) {
        for (const row of observedRatesData as any[]) {
          const mpCode = (row.key as string).replace('observed_commission_rate_', '');
          const rate = parseFloat(row.value);
          if (!isNaN(rate) && rate > 0 && rate < 1) {
            observedRates[mpCode] = rate;
          }
        }
      }

      // Calculate redistributed platform fees
      const redistFees = redistributePlatformFees(grouped, observedRates);

      // Aggregate profit data by marketplace, filtering out stale/malformed rows
      const mpMap = new Map<string, { revenue: number; profit: number; margins: number[]; count: number }>();
      for (const row of profits) {
        // Skip profit rows for settlements that no longer exist
        if (!activeSettlementIds.has(row.settlement_id)) continue;
        // Skip corrupted rows
        if (Math.abs(Number(row.gross_revenue) || 0) > 10_000_000) continue;
        if ((Number(row.gross_revenue) || 0) <= 0) continue;
        // Skip rows with suspiciously high margins for marketplaces with known fees
        if (isMarginSuspicious(row.marketplace_code, Number(row.margin_percent) || 0)) continue;

        const mp = row.marketplace_code;
        if (!mpMap.has(mp)) mpMap.set(mp, { revenue: 0, profit: 0, margins: [], count: 0 });
        const entry = mpMap.get(mp)!;
        entry.revenue += Number(row.gross_revenue) || 0;
        entry.profit += Number(row.gross_profit) || 0;
        entry.margins.push(Number(row.margin_percent) || 0);
        entry.count++;
      }

      const results: AggregatedMarketplace[] = [];

      // Add marketplaces with valid profit data
      for (const [mp, agg] of mpMap) {
        const avg_margin = agg.margins.length > 0
          ? agg.margins.reduce((a, b) => a + b, 0) / agg.margins.length
          : 0;

        // Apply redistributed platform fees (positive = added to sales sibling, negative = removed from fee-heavy)
        const adjustedProfit = agg.profit - (redistFees[mp] || 0);
        const adjustedMargin = agg.revenue > 0
          ? Math.min((adjustedProfit / agg.revenue) * 100, 100)
          : avg_margin;

        const settRows = grouped[mp];
        const hasEstimated = settRows?.some(r => (r.raw_payload as any)?.fees_estimated === true) || (redistFees[mp] != null && redistFees[mp] !== 0);
        // Check if redistribution used fallback rate
        const redistUsedFallback = (redistFees[mp] != null && redistFees[mp] !== 0) && !observedRates[mp];

        results.push({
          marketplace_code: mp,
          marketplace_name: MARKETPLACE_LABELS[mp] || mp,
          avg_margin: Math.round((redistFees[mp] != null && redistFees[mp] !== 0 ? adjustedMargin : avg_margin) * 10) / 10,
          total_revenue: Math.round(agg.revenue),
          total_profit: Math.round(adjustedProfit),
          periods: agg.count,
          has_cost_data: true,
          has_estimated_fees: hasEstimated || redistUsedFallback,
          implied_commission_rate: null, // No fabricated rates
          shipping_deduction: 0, // Already included in profit data
          order_count: 0,
        });
      }

      // Add marketplaces that only have settlement data (no valid profit rows)
      for (const [mp, rows] of Object.entries(grouped)) {
        if (mpMap.has(mp)) continue;
        const totalSalesExGst = rows.reduce((sum, r) => sum + (r.sales_principal || 0), 0);
        const totalGst = rows.reduce((sum, r) => sum + (r.gst_on_income || 0), 0);
        const totalSales = totalSalesExGst + totalGst;
        if (totalSales <= 0) continue;

        const fulfilmentMethod = getEffectiveMethod(mp, fulfilmentMethods[mp]);
        const postageCost = postageCosts[mp] || 0;
        
        // Use canonical fee attribution
        const attribution = attributeFees(mp, rows, redistFees[mp] || 0);

        // Get order count from settlement_lines and apply shipping deduction
        const mpOrderCount = orderCountsByMp[mp] || 0;
        const shippingDeduction = mpOrderCount > 0
          ? getPostageDeductionForOrder(fulfilmentMethod, null, postageCost, mpOrderCount)
          : 0;

        const adjustedPayout = attribution.effectiveNetPayout - shippingDeduction;
        const margin = totalSales > 0 ? Math.min((adjustedPayout / totalSales) * 100, 100) : 0;

        results.push({
          marketplace_code: mp,
          marketplace_name: MARKETPLACE_LABELS[mp] || mp,
          avg_margin: Math.round(margin * 10) / 10,
          total_revenue: Math.round(totalSales),
          total_profit: Math.round(adjustedPayout),
          periods: rows.length,
          has_cost_data: false,
          has_estimated_fees: attribution.hasEstimatedFees,
          implied_commission_rate: null,
          shipping_deduction: Math.round(shippingDeduction),
          order_count: mpOrderCount,
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
    <TooltipProvider>
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
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="text-[9px] px-1 py-0 border-amber-400/50 text-amber-600 dark:text-amber-400 cursor-help">
                              <AlertTriangle className="h-2 w-2 mr-0.5" />
                              Estimated
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent className="text-xs max-w-xs">
                            Fee data includes estimates from platform fee redistribution. Upload CSV settlements for actual fees.
                          </TooltipContent>
                        </Tooltip>
                      )}
                      {mp.shipping_deduction > 0 && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="text-[9px] px-1 py-0 border-primary/30 text-primary cursor-help">
                              <Truck className="h-2 w-2 mr-0.5" />
                              Est. Shipping
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent className="text-xs max-w-xs">
                            Incl. est. shipping: -{formatAUD(mp.shipping_deduction)} ({mp.order_count} orders)
                          </TooltipContent>
                        </Tooltip>
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
    </TooltipProvider>
  );
}
