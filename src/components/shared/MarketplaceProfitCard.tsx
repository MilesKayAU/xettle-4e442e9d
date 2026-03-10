/**
 * MarketplaceProfitCard — Shows profit summary for a single marketplace.
 * Fetches from settlement_profit table.
 */

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { TrendingUp, AlertTriangle, ArrowRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface ProfitRecord {
  id: string;
  marketplace_code: string;
  period_label: string;
  gross_revenue: number;
  total_cogs: number;
  marketplace_fees: number;
  gross_profit: number;
  margin_percent: number;
  orders_count: number;
  units_sold: number;
  uncosted_sku_count: number;
  uncosted_revenue: number;
  calculated_at: string;
}

interface MarketplaceProfitCardProps {
  marketplaceCode: string;
  userId: string;
}

function formatAUD(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}

function getMarginColor(margin: number): string {
  if (margin >= 30) return 'text-emerald-600 dark:text-emerald-400';
  if (margin >= 15) return 'text-amber-600 dark:text-amber-400';
  return 'text-destructive';
}

function getMarginBg(margin: number): string {
  if (margin >= 30) return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400';
  if (margin >= 15) return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400';
  return 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400';
}

export default function MarketplaceProfitCard({ marketplaceCode, userId }: MarketplaceProfitCardProps) {
  const [records, setRecords] = useState<ProfitRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    loadProfit();
  }, [marketplaceCode, userId]);

  async function loadProfit() {
    try {
      const { data, error } = await supabase
        .from('settlement_profit')
        .select('*')
        .eq('user_id', userId)
        .eq('marketplace_code', marketplaceCode)
        .order('calculated_at', { ascending: false })
        .limit(6);

      if (error) throw error;
      setRecords((data || []) as ProfitRecord[]);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  if (loading) {
    return (
      <Card className="border-border">
        <CardContent className="py-6 text-center text-sm text-muted-foreground">
          Loading profit data…
        </CardContent>
      </Card>
    );
  }

  if (records.length === 0) {
    return (
      <Card className="border-border overflow-hidden">
        <div className="bg-gradient-to-br from-muted/30 via-muted/50 to-primary/5">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              Marketplace Profit
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-5 space-y-4">
            <p className="text-sm text-foreground font-medium">
              Unlock profit insights by adding SKU costs
            </p>

            {/* Preview teaser chart */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-background/60 rounded-lg p-3 text-center">
                <p className="text-[10px] text-muted-foreground">Top Marketplace</p>
                <p className="text-sm font-bold text-muted-foreground/40 mt-1">—</p>
              </div>
              <div className="bg-background/60 rounded-lg p-3 text-center">
                <p className="text-[10px] text-muted-foreground">Margin %</p>
                <p className="text-sm font-bold text-muted-foreground/40 mt-1">—</p>
              </div>
              <div className="bg-background/60 rounded-lg p-3 text-center">
                <p className="text-[10px] text-muted-foreground">Fee Leak</p>
                <p className="text-sm font-bold text-muted-foreground/40 mt-1">—</p>
              </div>
            </div>

            <ul className="text-xs text-muted-foreground space-y-1.5">
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary/60" />
                Net profit per marketplace
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary/60" />
                Margin % with trend charts
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary/60" />
                Best &amp; worst performing SKUs
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary/60" />
                Biggest fee leaks identified
              </li>
            </ul>
            <Button
              variant="default"
              size="sm"
              className="gap-1.5 text-xs"
              onClick={() => navigate('/admin?tab=costs')}
            >
              Add SKU Costs <ArrowRight className="h-3 w-3" />
            </Button>
          </CardContent>
        </div>
      </Card>
    );
  }

  const latest = records[0];
  const maxRevenue = Math.max(...records.map(r => r.gross_revenue), 1);

  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            Profit Summary
          </CardTitle>
          <Badge variant="outline" className={`text-[10px] h-5 ${getMarginBg(latest.margin_percent)}`}>
            {latest.margin_percent.toFixed(1)}% margin
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="pb-4 space-y-3">
        {/* Summary row */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <div>
            <p className="text-[10px] text-muted-foreground">Revenue</p>
            <p className="text-sm font-semibold text-foreground">{formatAUD(latest.gross_revenue)}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">COGS</p>
            <p className="text-sm font-semibold text-foreground">-{formatAUD(latest.total_cogs)}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Fees</p>
            <p className="text-sm font-semibold text-foreground">-{formatAUD(latest.marketplace_fees)}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Gross Profit</p>
            <p className={`text-sm font-bold ${getMarginColor(latest.margin_percent)}`}>{formatAUD(latest.gross_profit)}</p>
          </div>
          <div>
            <p className="text-[10px] text-muted-foreground">Margin</p>
            <p className={`text-sm font-bold ${getMarginColor(latest.margin_percent)}`}>{latest.margin_percent.toFixed(1)}%</p>
          </div>
        </div>

        {/* Uncosted SKU warning */}
        {latest.uncosted_sku_count > 0 && (
          <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-md p-2.5">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
            <div className="text-[11px] text-amber-800 dark:text-amber-300">
              <p className="font-medium">{latest.uncosted_sku_count} SKU{latest.uncosted_sku_count !== 1 ? 's' : ''} have no cost entered.</p>
              <p className="text-amber-600 dark:text-amber-400 mt-0.5">
                {formatAUD(latest.uncosted_revenue)} revenue not included in profit calculation.
              </p>
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-[11px] text-primary mt-1"
                onClick={() => navigate('/admin?tab=costs')}
              >
                Add costs <ArrowRight className="h-3 w-3 ml-0.5" />
              </Button>
            </div>
          </div>
        )}

        {/* Margin trend (last 6 periods) */}
        {records.length > 1 && (
          <div className="space-y-1.5">
            <p className="text-[10px] text-muted-foreground font-medium">Margin trend</p>
            <div className="flex items-end gap-1 h-12">
              {[...records].reverse().map((r, i) => {
                const height = Math.max(8, (r.margin_percent / 60) * 100);
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                    <div
                      className={`w-full rounded-sm transition-all ${
                        r.margin_percent >= 30
                          ? 'bg-emerald-400 dark:bg-emerald-500'
                          : r.margin_percent >= 15
                            ? 'bg-amber-400 dark:bg-amber-500'
                            : 'bg-red-400 dark:bg-red-500'
                      }`}
                      style={{ height: `${Math.min(height, 100)}%` }}
                      title={`${r.period_label}: ${r.margin_percent.toFixed(1)}%`}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex gap-1">
              {[...records].reverse().map((r, i) => (
                <p key={i} className="flex-1 text-center text-[8px] text-muted-foreground truncate">
                  {r.period_label.split(' ')[0]?.substring(0, 3)}
                </p>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
