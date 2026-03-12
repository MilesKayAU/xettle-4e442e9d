/**
 * ReconciliationStatus — Shows settlement vs Shopify order reconciliation.
 * Fetches from reconciliation_checks and displays period-by-period status.
 */

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle2, AlertTriangle, XCircle, Clock, ChevronDown, ChevronRight, ExternalLink, Eye } from 'lucide-react';
import UnmatchedOrdersModal, { type UnmatchedOrder } from './UnmatchedOrdersModal';

interface ReconciliationCheck {
  id: string;
  marketplace_code: string;
  period_label: string;
  period_start: string;
  period_end: string;
  shopify_order_total: number;
  settlement_net_received: number;
  expected_commission: number;
  actual_commission: number;
  difference: number;
  status: string;
  notes: string | null;
  unmatched_orders: string[] | null;
}

interface ReconciliationStatusProps {
  marketplaceCode: string;
  userId: string;
}

const STATUS_CONFIG = {
  matched: {
    icon: CheckCircle2,
    label: 'Matched',
    emoji: '✅',
    badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800',
  },
  warning: {
    icon: AlertTriangle,
    label: 'Warning',
    emoji: '⚠️',
    badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-amber-200 dark:border-amber-800',
  },
  alert: {
    icon: XCircle,
    label: 'Alert',
    emoji: '🔴',
    badgeClass: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400 border-red-200 dark:border-red-800',
  },
  pending: {
    icon: Clock,
    label: 'Pending',
    emoji: '⏳',
    badgeClass: 'bg-muted text-muted-foreground border-border',
  },
} as const;

function formatAUD(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}

function formatPeriodLabel(start: string, end: string): string {
  const d = new Date(end + 'T00:00:00');
  return d.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' });
}

export default function ReconciliationStatus({ marketplaceCode, userId }: ReconciliationStatusProps) {
  const [checks, setChecks] = useState<ReconciliationCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [unmatchedModalCheck, setUnmatchedModalCheck] = useState<ReconciliationCheck | null>(null);
  const [unmatchedOrders, setUnmatchedOrders] = useState<UnmatchedOrder[]>([]);

  useEffect(() => {
    loadChecks();
  }, [marketplaceCode, userId]);

  async function loadChecks() {
    try {
      const { data, error } = await supabase
        .from('reconciliation_checks')
        .select('*')
        .eq('user_id', userId)
        .eq('marketplace_code', marketplaceCode)
        .order('period_start', { ascending: false })
        .limit(12);

      if (error) throw error;
      setChecks((data || []) as ReconciliationCheck[]);
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
          Loading reconciliation data…
        </CardContent>
      </Card>
    );
  }

  if (checks.length === 0) {
    return (
      <Card className="border-border">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
            Settlement Reconciliation
          </CardTitle>
        </CardHeader>
        <CardContent className="pb-4">
          <p className="text-xs text-muted-foreground">
            No reconciliation data yet. Upload settlements and Shopify orders to compare.
          </p>
        </CardContent>
      </Card>
    );
  }

  const matched = checks.filter(c => c.status === 'matched').length;
  const warnings = checks.filter(c => c.status === 'warning').length;
  const alerts = checks.filter(c => c.status === 'alert').length;

  return (
    <Card className="border-border">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-primary" />
            Settlement Reconciliation
          </CardTitle>
          <div className="flex items-center gap-2 text-xs">
            {matched > 0 && <span className="text-emerald-600 dark:text-emerald-400">✅ {matched}</span>}
            {warnings > 0 && <span className="text-amber-600 dark:text-amber-400">⚠️ {warnings}</span>}
            {alerts > 0 && <span className="text-red-600 dark:text-red-400">🔴 {alerts}</span>}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pb-3 space-y-1">
        {checks.map((check) => {
          const config = STATUS_CONFIG[check.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.pending;
          const isExpanded = expandedId === check.id;
          const isExpandable = check.status === 'warning' || check.status === 'alert';
          const diff = Math.abs(check.difference || 0);

          return (
            <div key={check.id}>
              <button
                className={`w-full flex items-center justify-between gap-3 py-2 px-2 rounded-md text-left transition-colors ${
                  isExpandable ? 'hover:bg-muted/50 cursor-pointer' : 'cursor-default'
                } ${isExpanded ? 'bg-muted/30' : ''}`}
                onClick={() => isExpandable && setExpandedId(isExpanded ? null : check.id)}
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  {isExpandable && (
                    isExpanded
                      ? <ChevronDown className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      : <ChevronRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                  )}
                  <span className="text-xs font-medium text-foreground w-20 flex-shrink-0">
                    {formatPeriodLabel(check.period_start, check.period_end)}
                  </span>
                  <span className="text-xs text-muted-foreground truncate">
                    {formatAUD(check.settlement_net_received)}
                    {check.shopify_order_total > 0 && check.shopify_order_total !== check.settlement_net_received
                      ? ` vs ${formatAUD(check.shopify_order_total)} orders`
                      : ' — Bank not verified'}
                  </span>
                </div>
                <Badge variant="outline" className={`text-[10px] h-5 flex-shrink-0 ${config.badgeClass}`}>
                  {config.emoji} {check.status === 'matched' ? 'Matched' : `${formatAUD(diff)} gap`}
                </Badge>
              </button>

              {isExpanded && (
                <div className="ml-6 mr-2 mb-2 p-3 bg-muted/20 rounded-md border border-border space-y-2">
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div>
                      <span className="text-muted-foreground">Shopify orders total:</span>
                      <span className="ml-1 font-medium text-foreground">{formatAUD(check.shopify_order_total)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Settlement received:</span>
                      <span className="ml-1 font-medium text-foreground">{formatAUD(check.settlement_net_received)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Expected commission:</span>
                      <span className="ml-1 font-medium text-foreground">{formatAUD(check.expected_commission)}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">Difference:</span>
                      <span className={`ml-1 font-semibold ${check.status === 'alert' ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'}`}>
                        {formatAUD(check.difference)}
                      </span>
                    </div>
                  </div>

                  <div className="border-t border-border pt-2">
                    <p className="text-[11px] font-medium text-muted-foreground mb-1">Possible causes:</p>
                    <ul className="text-[11px] text-muted-foreground space-y-0.5 list-disc list-inside">
                      <li>Returns not yet processed</li>
                      <li>Orders pending from end of period</li>
                      <li>Fee rate changed</li>
                    </ul>
                  </div>

                  {check.unmatched_orders && check.unmatched_orders.length > 0 && (
                    <div className="border-t border-border pt-2">
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-6 text-[10px] gap-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          // Build basic unmatched order objects from stored IDs
                          const orders: UnmatchedOrder[] = check.unmatched_orders!.map(id => ({
                            order_number: id,
                            date: '—',
                            amount: 0,
                            customer: '—',
                            status: 'unmatched',
                          }));
                          setUnmatchedOrders(orders);
                          setUnmatchedModalCheck(check);
                        }}
                      >
                        <Eye className="h-3 w-3" />
                        View {check.unmatched_orders.length} unmatched order{check.unmatched_orders.length !== 1 ? 's' : ''}
                      </Button>
                    </div>
                  )}

                  {check.notes && (
                    <p className="text-[10px] text-muted-foreground italic border-t border-border pt-1">
                      {check.notes}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </CardContent>

      {unmatchedModalCheck && (
        <UnmatchedOrdersModal
          open={!!unmatchedModalCheck}
          periodLabel={formatPeriodLabel(unmatchedModalCheck.period_start, unmatchedModalCheck.period_end)}
          marketplaceName={unmatchedModalCheck.marketplace_code.replace(/_/g, ' ')}
          orders={unmatchedOrders}
          onClose={() => { setUnmatchedModalCheck(null); setUnmatchedOrders([]); }}
        />
      )}
    </Card>
  );
}

// ─── Summary component for InsightsDashboard ─────────────────────────────────

interface ReconciliationHealthProps {
  className?: string;
  userId?: string;
}

export function ReconciliationHealth({ className, userId }: ReconciliationHealthProps) {
  const [data, setData] = useState<{
    total: number;
    matched: number;
    warnings: number;
    alerts: number;
    byMarketplace: { code: string; total: number; matched: number; warnings: number; alerts: number }[];
  } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!userId) {
      setData(null);
      setLoading(false);
      return;
    }

    loadHealth();
  }, [userId]);

  async function loadHealth() {
    if (!userId) return;

    try {
      const { data: checks, error } = await supabase
        .from('reconciliation_checks')
        .select('marketplace_code, status')
        .eq('user_id', userId);

      if (error) throw error;
      if (!checks || checks.length === 0) {
        setData(null);
        return;
      }

      const byMp = new Map<string, { code: string; total: number; matched: number; warnings: number; alerts: number }>();

      let total = 0, matched = 0, warnings = 0, alerts = 0;

      for (const c of checks) {
        total++;
        if (c.status === 'matched') matched++;
        else if (c.status === 'warning') warnings++;
        else if (c.status === 'alert') alerts++;

        const mp = c.marketplace_code;
        if (!byMp.has(mp)) byMp.set(mp, { code: mp, total: 0, matched: 0, warnings: 0, alerts: 0 });
        const entry = byMp.get(mp)!;
        entry.total++;
        if (c.status === 'matched') entry.matched++;
        else if (c.status === 'warning') entry.warnings++;
        else if (c.status === 'alert') entry.alerts++;
      }

      setData({
        total,
        matched,
        warnings,
        alerts,
        byMarketplace: Array.from(byMp.values()),
      });
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  if (loading || !data || data.total === 0) return null;

  const healthPct = data.total > 0 ? Math.round((data.matched / data.total) * 100) : 0;
  const needsAttention = data.warnings + data.alerts;

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          Reconciliation Health
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-4 space-y-3">
        {/* Health score */}
        <div className="flex items-center gap-3">
          <div className={`text-2xl font-bold ${healthPct >= 90 ? 'text-emerald-600 dark:text-emerald-400' : healthPct >= 70 ? 'text-amber-600 dark:text-amber-400' : 'text-destructive'}`}>
            {healthPct}%
          </div>
          <div className="flex-1">
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${healthPct >= 90 ? 'bg-emerald-500' : healthPct >= 70 ? 'bg-amber-500' : 'bg-destructive'}`}
                style={{ width: `${healthPct}%` }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground mt-1">
              {data.matched}/{data.total} periods reconciled
            </p>
          </div>
        </div>

        {/* Summary counts */}
        <div className="flex items-center gap-4 text-xs">
          <span className="text-emerald-600 dark:text-emerald-400">✅ {data.matched} matched</span>
          {data.warnings > 0 && <span className="text-amber-600 dark:text-amber-400">⚠️ {data.warnings} warnings</span>}
          {data.alerts > 0 && <span className="text-red-600 dark:text-red-400">🔴 {data.alerts} alerts</span>}
        </div>

        {/* Attention notice */}
        {needsAttention > 0 && (
          <p className="text-xs text-muted-foreground">
            {needsAttention} period{needsAttention !== 1 ? 's' : ''} need{needsAttention === 1 ? 's' : ''} attention →
          </p>
        )}

        {/* Per-marketplace breakdown */}
        {data.byMarketplace.length > 1 && (
          <div className="border-t border-border pt-2 space-y-1">
            {data.byMarketplace.map(mp => (
              <div key={mp.code} className="flex items-center justify-between text-[11px]">
                <span className="text-foreground font-medium capitalize">{mp.code.replace(/_/g, ' ')}</span>
                <div className="flex items-center gap-2">
                  <span className="text-emerald-600 dark:text-emerald-400">{mp.matched}✅</span>
                  {mp.warnings > 0 && <span className="text-amber-600 dark:text-amber-400">{mp.warnings}⚠️</span>}
                  {mp.alerts > 0 && <span className="text-red-600 dark:text-red-400">{mp.alerts}🔴</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
