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
import { BarChart3, Lock, ArrowRight, TrendingUp, TrendingDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { MARKETPLACE_LABELS } from '@/utils/settlement-engine';

interface AggregatedMarketplace {
  marketplace_code: string;
  marketplace_name: string;
  avg_margin: number;
  total_revenue: number;
  total_profit: number;
  periods: number;
  has_cost_data: boolean;
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

      // Load profit data + all marketplaces from settlements
      const [profitRes, settlementsRes] = await Promise.all([
        supabase
          .from('settlement_profit')
          .select('marketplace_code, gross_revenue, gross_profit, margin_percent')
          .eq('user_id', user.id),
        supabase
          .from('settlements')
          .select('marketplace, sales_principal, sales_shipping, bank_deposit')
          .eq('user_id', user.id)
          .eq('is_hidden', false)
          .is('duplicate_of_settlement_id', null)
          .not('status', 'in', '("push_failed_permanent","duplicate_suppressed")'),
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
      const settlementMap = new Map<string, { revenue: number; payout: number; count: number }>();
      for (const row of settlements) {
        const mp = row.marketplace;
        if (!mp) continue;
        if (!settlementMap.has(mp)) settlementMap.set(mp, { revenue: 0, payout: 0, count: 0 });
        const entry = settlementMap.get(mp)!;
        entry.revenue += (Number(row.sales_principal) || 0) + (Number(row.sales_shipping) || 0);
        entry.payout += Number(row.bank_deposit) || 0;
        entry.count++;
      }

      const results: AggregatedMarketplace[] = [];

      // Add marketplaces with profit data
      for (const [mp, agg] of mpMap) {
        const avg_margin = agg.margins.length > 0
          ? agg.margins.reduce((a, b) => a + b, 0) / agg.margins.length
          : 0;
        results.push({
          marketplace_code: mp,
          marketplace_name: MARKETPLACE_LABELS[mp] || mp,
          avg_margin: Math.round(avg_margin * 10) / 10,
          total_revenue: Math.round(agg.revenue),
          total_profit: Math.round(agg.profit),
          periods: agg.count,
          has_cost_data: true,
        });
      }

      // Add marketplaces that only have settlement data (no profit rows)
      for (const [mp, agg] of settlementMap) {
        if (mpMap.has(mp)) continue; // already included
        const margin = agg.revenue > 0 ? (agg.payout / agg.revenue) * 100 : 0;
        results.push({
          marketplace_code: mp,
          marketplace_name: MARKETPLACE_LABELS[mp] || mp,
          avg_margin: Math.round(margin * 10) / 10,
          total_revenue: Math.round(agg.revenue),
          total_profit: Math.round(agg.payout),
          periods: agg.count,
          has_cost_data: false,
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
          </p>
        )}
      </CardContent>
    </Card>
  );
}
