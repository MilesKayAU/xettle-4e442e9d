/**
 * SkuComparisonView — Cross-marketplace profit comparison per SKU.
 * Pro/Admin-only feature.
 */

import { useEffect, useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { supabase } from '@/integrations/supabase/client';
import { Search, Lock, ArrowRight, TrendingUp, TrendingDown, AlertTriangle, Package } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  compareSkuAcrossMarketplaces,
  type SettlementForProfit,
  type SettlementLineForProfit,
  type ProductCost,
  type SkuMarketplaceComparison,
} from '@/utils/profit-engine';

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

export default function SkuComparisonView() {
  const [hasAccess, setHasAccess] = useState(false);
  const [accessChecked, setAccessChecked] = useState(false);
  const [allSkus, setAllSkus] = useState<string[]>([]);
  const [selectedSku, setSelectedSku] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [comparison, setComparison] = useState<SkuMarketplaceComparison | null>(null);
  const [loading, setLoading] = useState(true);
  const [mcfMarketplaces, setMcfMarketplaces] = useState<Set<string>>(new Set());

  // Data caches
  const [settlements, setSettlements] = useState<SettlementForProfit[]>([]);
  const [lines, setLines] = useState<SettlementLineForProfit[]>([]);
  const [costs, setCosts] = useState<ProductCost[]>([]);

  const navigate = useNavigate();

  useEffect(() => {
    init();
  }, []);

  async function init() {
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

      if (!canAccess) { setLoading(false); return; }

      // Load all data in parallel
      const [skuRes, settlementRes, linesRes, costsRes, mcfRes] = await Promise.all([
        supabase.from('settlement_lines').select('sku').not('sku', 'is', null).eq('user_id', user.id),
        supabase.from('settlements').select('settlement_id, marketplace, sales_principal, seller_fees, period_start, period_end').eq('user_id', user.id),
        supabase.from('settlement_lines').select('settlement_id, sku, amount, order_id, transaction_type').eq('user_id', user.id),
        supabase.from('product_costs').select('sku, cost, currency, label').eq('user_id', user.id),
        supabase.from('entity_library').select('entity_name').eq('entity_type', 'aggregator').or(`user_id.eq.${user.id},user_id.is.null`),
      ]);

      // Unique SKUs
      const skuSet = new Set<string>();
      for (const row of skuRes.data || []) {
        if (row.sku) skuSet.add(row.sku.toUpperCase().trim());
      }
      setAllSkus(Array.from(skuSet).sort());

      // Settlements
      const setts: SettlementForProfit[] = (settlementRes.data || []).map(s => ({
        settlement_id: s.settlement_id,
        marketplace: s.marketplace || 'unknown',
        gross_amount: Number(s.sales_principal) || 0,
        fees_amount: Number(s.seller_fees) || 0,
        period_start: s.period_start,
        period_end: s.period_end,
      }));
      setSettlements(setts);

      // Lines
      const ls: SettlementLineForProfit[] = (linesRes.data || []).map(l => ({
        settlement_id: l.settlement_id,
        sku: l.sku,
        amount: Number(l.amount) || 0,
        order_id: l.order_id,
        transaction_type: l.transaction_type,
      }));
      setLines(ls);

      // Costs
      const cs: ProductCost[] = (costsRes.data || []).map(c => ({
        sku: c.sku,
        cost: Number(c.cost) || 0,
        currency: c.currency || 'AUD',
        label: c.label || undefined,
      }));
      setCosts(cs);

      // MCF detection — check if any aggregator entity contains 'cedcommerce'
      const mcfSet = new Set<string>();
      const mcfEntities = (mcfRes.data || []).filter(e =>
        e.entity_name.toLowerCase().includes('cedcommerce') || e.entity_name.toLowerCase().includes('mcf')
      );
      if (mcfEntities.length > 0) {
        // Check which marketplaces have MCF-tagged settlements
        for (const s of setts) {
          if (s.marketplace.includes('kogan') || s.marketplace.includes('catch')) {
            mcfSet.add(s.marketplace);
          }
        }
      }
      setMcfMarketplaces(mcfSet);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  function handleSkuSelect(sku: string) {
    setSelectedSku(sku);
    if (!sku) { setComparison(null); return; }
    const result = compareSkuAcrossMarketplaces(sku, settlements, lines, costs);
    setComparison(result);
  }

  const filteredSkus = useMemo(() => {
    if (!searchTerm) return allSkus.slice(0, 50);
    const term = searchTerm.toUpperCase();
    return allSkus.filter(s => s.includes(term)).slice(0, 50);
  }, [allSkus, searchTerm]);

  if (loading || !accessChecked) return null;

  // Locked state
  if (!hasAccess) {
    return (
      <Card className="border-border relative overflow-hidden">
        <div className="absolute inset-0 bg-background/60 backdrop-blur-[2px] z-10 flex items-center justify-center">
          <div className="text-center px-6 max-w-sm">
            <Lock className="h-8 w-8 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm font-semibold text-foreground">📦 SKU Profit Comparison</p>
            <p className="text-xs text-muted-foreground mt-1.5">
              Compare profitability of each product across all your marketplaces.
            </p>
            <Button size="sm" className="mt-3 gap-1.5" onClick={() => navigate('/pricing')}>
              Upgrade to Pro <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Package className="h-4 w-4 text-muted-foreground" />
            SKU Profit Comparison
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-4 opacity-30 pointer-events-none select-none h-24" />
      </Card>
    );
  }

  if (allSkus.length === 0) return null;

  // Insight text
  let insightText: string | null = null;
  if (comparison && comparison.marketplaces.length >= 2) {
    const best = comparison.marketplaces[0];
    const worst = comparison.marketplaces[comparison.marketplaces.length - 1];
    const diff = best.profit_per_unit - worst.profit_per_unit;
    const monthlyImpact = Math.round(diff * worst.units_sold);
    if (diff > 0) {
      insightText = `You make ${formatAUD(diff)} more per unit on ${best.marketplace_name} than ${worst.marketplace_name} for this product. At current volumes that's ~${formatAUD(monthlyImpact)}/period difference.`;
    }
  }

  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <Package className="h-4 w-4 text-primary" />
          SKU Profit Comparison
        </CardTitle>
        <CardDescription className="text-xs">
          Select a SKU to compare profitability across marketplaces
        </CardDescription>
      </CardHeader>
      <CardContent className="pb-4 space-y-4">
        {/* SKU selector */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              placeholder="Search SKU…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 h-9 text-xs"
            />
          </div>
          <Select value={selectedSku} onValueChange={handleSkuSelect}>
            <SelectTrigger className="w-48 h-9 text-xs">
              <SelectValue placeholder="Select SKU" />
            </SelectTrigger>
            <SelectContent>
              {filteredSkus.map(sku => (
                <SelectItem key={sku} value={sku} className="text-xs font-mono">{sku}</SelectItem>
              ))}
              {filteredSkus.length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">No SKUs found</div>
              )}
            </SelectContent>
          </Select>
        </div>

        {/* Comparison table */}
        {comparison && comparison.marketplaces.length > 0 && (
          <>
            <div className="space-y-1">
              <p className="text-xs font-semibold text-foreground">
                {comparison.sku} — {comparison.product_name}
              </p>
            </div>

            <div className="border border-border rounded-md overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px]">Marketplace</TableHead>
                    <TableHead className="text-[10px] text-right">Units</TableHead>
                    <TableHead className="text-[10px] text-right">Revenue/unit</TableHead>
                    <TableHead className="text-[10px] text-right">Fee/unit</TableHead>
                    <TableHead className="text-[10px] text-right">COGS</TableHead>
                    <TableHead className="text-[10px] text-right">Profit/unit</TableHead>
                    <TableHead className="text-[10px] text-right">Margin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {comparison.marketplaces.map((mp, idx) => {
                    const isBest = idx === 0 && comparison.marketplaces.length > 1;
                    const isWorst = idx === comparison.marketplaces.length - 1 && comparison.marketplaces.length > 1;
                    const hasMcf = mcfMarketplaces.has(mp.marketplace_code);

                    return (
                      <TableRow
                        key={mp.marketplace_code}
                        className={isBest ? 'bg-emerald-50/50 dark:bg-emerald-900/10' : isWorst ? 'bg-red-50/50 dark:bg-red-900/10' : ''}
                      >
                        <TableCell className="text-xs font-medium text-foreground">
                          <div className="flex items-center gap-1.5">
                            {mp.marketplace_name}
                            {isBest && <TrendingUp className="h-3 w-3 text-emerald-500" />}
                            {isWorst && <TrendingDown className="h-3 w-3 text-destructive" />}
                            {hasMcf && (
                              <Badge variant="outline" className="text-[8px] h-4 border-amber-300 text-amber-600 dark:text-amber-400">MCF</Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">{mp.units_sold}</TableCell>
                        <TableCell className="text-xs text-right text-foreground">{formatAUD(mp.revenue_per_unit)}</TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">{formatAUD(mp.fee_per_unit)}</TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground">{formatAUD(mp.cogs)}</TableCell>
                        <TableCell className={`text-xs text-right font-semibold ${getMarginColor(mp.margin_percent)}`}>
                          {formatAUD(mp.profit_per_unit)}
                        </TableCell>
                        <TableCell className={`text-xs text-right font-bold ${getMarginColor(mp.margin_percent)}`}>
                          {mp.margin_percent.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            {/* MCF warnings */}
            {comparison.marketplaces.some(mp => mcfMarketplaces.has(mp.marketplace_code)) && (
              <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800 rounded-md p-2.5">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-500 flex-shrink-0 mt-0.5" />
                <div className="text-[11px] text-amber-800 dark:text-amber-300">
                  <p className="font-medium">⚠️ Some orders fulfilled via Amazon MCF</p>
                  <p className="text-amber-600 dark:text-amber-400 mt-0.5">
                    Estimated MCF fee: $7–10/order. True margin may be 5–15% lower on MCF-fulfilled marketplaces.
                    Add MCF cost to SKU costs for accurate margins.
                  </p>
                </div>
              </div>
            )}

            {/* Insight */}
            {insightText && (
              <div className="rounded-md border border-primary/20 bg-primary/5 p-2.5">
                <p className="text-[11px] text-foreground font-medium">{insightText}</p>
              </div>
            )}
          </>
        )}

        {comparison && comparison.marketplaces.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-4">
            No marketplace data found for this SKU.
          </p>
        )}

        {!selectedSku && (
          <p className="text-xs text-muted-foreground text-center py-4">
            Select a SKU above to see cross-marketplace comparison.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
