/**
 * RecentSettlements — Dashboard settlement action center.
 * 
 * Mirrors the Link My Books UX pattern:
 *   - Clickable status summary cards (Ready to Push, Posted, Needs Attention)
 *   - Clean table with Gateway, Period, Amount, Bank, Status, Actions
 *   - Action dropdown per row (View, Recalculate, Push to Xero, Hide, Download)
 *   - Pagination (25 per page)
 *   - Only real settlement/payout records, never order aggregates
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  FileText, ArrowRight, CheckCircle2, Clock, Send, AlertTriangle,
  MoreHorizontal, Eye, RefreshCw, EyeOff, Download, ChevronLeft, ChevronRight,
  Ban,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface SettlementRow {
  id: string;
  settlement_id: string;
  marketplace: string;
  period_start: string;
  period_end: string;
  bank_deposit: number;
  status: string;
  xero_status: string | null;
  source: string;
  created_at: string;
  bank_verified: boolean | null;
}

const MARKETPLACE_DISPLAY: Record<string, string> = {
  amazon_au: 'Amazon AU',
  shopify_payments: 'Shopify Payments',
  kogan: 'Kogan',
  mydeal: 'MyDeal',
  bunnings: 'Bunnings',
  catch: 'Catch',
  ebay: 'eBay',
  iconic: 'THE ICONIC',
  bigw: 'Big W',
  everyday_market: 'Everyday Market',
  tradesquare: 'TradeSquare',
  tiktok: 'TikTok Shop',
};

function getMarketplaceLabel(code: string | null): string {
  if (!code) return 'Unknown';
  if (MARKETPLACE_DISPLAY[code]) return MARKETPLACE_DISPLAY[code];
  return code.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatAUD(amount: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const startStr = s.toLocaleDateString('en-AU', opts);
  const endStr = e.toLocaleDateString('en-AU', { ...opts, year: 'numeric' });
  return `${startStr} – ${endStr}`;
}

type StatusCategory = 'ready' | 'posted' | 'attention' | 'other';

function categorize(row: SettlementRow): StatusCategory {
  if (row.xero_status === 'posted' || row.xero_status === 'AUTHORISED') return 'posted';
  if (row.status === 'push_failed' || row.status === 'push_failed_permanent') return 'attention';
  if (row.status === 'parsed' || row.status === 'ready_to_push' || row.status === 'saved') return 'ready';
  return 'other';
}

function StatusBadge({ status, xeroStatus }: { status: string; xeroStatus: string | null }) {
  if (xeroStatus === 'posted' || xeroStatus === 'AUTHORISED') {
    return (
      <Badge variant="outline" className="text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-900/30 dark:border-emerald-800 text-xs">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Posted
      </Badge>
    );
  }
  if (status === 'parsed' || status === 'ready_to_push' || status === 'saved') {
    return (
      <Badge variant="outline" className="text-sky-700 bg-sky-50 border-sky-200 dark:text-sky-400 dark:bg-sky-900/30 dark:border-sky-800 text-xs">
        <Send className="h-3 w-3 mr-1" />
        Ready to Post
      </Badge>
    );
  }
  if (status === 'push_failed' || status === 'push_failed_permanent') {
    return (
      <Badge variant="outline" className="text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/30 dark:border-red-800 text-xs">
        <AlertTriangle className="h-3 w-3 mr-1" />
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground text-xs">
      <Clock className="h-3 w-3 mr-1" />
      {status === 'already_recorded' ? 'Recorded' : 'Pending'}
    </Badge>
  );
}

const PAGE_SIZE = 25;

interface RecentSettlementsProps {
  onViewAll?: () => void;
}

export default function RecentSettlements({ onViewAll }: RecentSettlementsProps) {
  const [allRows, setAllRows] = useState<SettlementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [activeFilter, setActiveFilter] = useState<StatusCategory | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('settlements')
        .select('id, settlement_id, marketplace, period_start, period_end, bank_deposit, status, xero_status, source, created_at, bank_verified')
        .neq('source', 'api_sync')
        .not('status', 'in', '("duplicate_suppressed","hidden")')
        .order('period_end', { ascending: false });

      if (error) throw error;
      setAllRows((data || []) as SettlementRow[]);
    } catch (err) {
      console.error('Failed to load settlements:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Summary counts
  const counts = useMemo(() => {
    const c = { ready: 0, posted: 0, attention: 0, other: 0, readyTotal: 0, postedTotal: 0 };
    for (const r of allRows) {
      const cat = categorize(r);
      c[cat]++;
      if (cat === 'ready') c.readyTotal += r.bank_deposit || 0;
      if (cat === 'posted') c.postedTotal += r.bank_deposit || 0;
    }
    return c;
  }, [allRows]);

  // Filtered + paginated
  const filtered = useMemo(() => {
    if (!activeFilter) return allRows;
    return allRows.filter(r => categorize(r) === activeFilter);
  }, [allRows, activeFilter]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  // Reset page when filter changes
  useEffect(() => { setPage(1); }, [activeFilter]);

  // Actions
  const handleHide = async (row: SettlementRow) => {
    await supabase.from('settlements').update({ status: 'hidden' }).eq('id', row.id);
    toast.success(`Hidden settlement ${row.settlement_id}`);
    fetchAll();
  };

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3"><Skeleton className="h-5 w-40" /></CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  if (allRows.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <FileText className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">No settlements yet</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Upload a settlement file or connect your marketplace to get started
          </p>
        </CardContent>
      </Card>
    );
  }

  const summaryCards: { key: StatusCategory; label: string; count: number; total?: number; color: string; icon: React.ReactNode }[] = [
    {
      key: 'ready',
      label: 'Ready to Post',
      count: counts.ready,
      total: counts.readyTotal,
      color: 'border-sky-200 bg-sky-50/80 dark:border-sky-800 dark:bg-sky-900/20',
      icon: <Send className="h-4 w-4 text-sky-600 dark:text-sky-400" />,
    },
    {
      key: 'posted',
      label: 'Posted',
      count: counts.posted,
      total: counts.postedTotal,
      color: 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-800 dark:bg-emerald-900/20',
      icon: <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />,
    },
    {
      key: 'attention',
      label: 'Needs Attention',
      count: counts.attention,
      color: 'border-red-200 bg-red-50/80 dark:border-red-800 dark:bg-red-900/20',
      icon: <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />,
    },
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Settlements
          </CardTitle>
          {onViewAll && (
            <Button variant="ghost" size="sm" onClick={onViewAll} className="text-xs text-muted-foreground hover:text-foreground">
              Full ledger
              <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0">
        {/* ── Status summary cards (clickable filters) ── */}
        <div className="grid grid-cols-3 gap-3">
          {summaryCards.map(card => (
            <button
              key={card.key}
              onClick={() => setActiveFilter(prev => prev === card.key ? null : card.key)}
              className={cn(
                'rounded-lg border p-3 text-left transition-all hover:shadow-sm',
                card.color,
                activeFilter === card.key && 'ring-2 ring-primary ring-offset-1',
                card.count === 0 && 'opacity-50'
              )}
            >
              <div className="flex items-center gap-2 mb-1">
                {card.icon}
                <span className="text-xs font-medium text-muted-foreground">{card.label}</span>
              </div>
              <p className="text-xl font-bold text-foreground">{card.count}</p>
              {card.total !== undefined && card.count > 0 && (
                <p className="text-xs text-muted-foreground mt-0.5">{formatAUD(card.total)}</p>
              )}
            </button>
          ))}
        </div>

        {/* ── Active filter indicator ── */}
        {activeFilter && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              Showing: {summaryCards.find(c => c.key === activeFilter)?.label}
            </Badge>
            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setActiveFilter(null)}>
              Clear filter
            </Button>
          </div>
        )}

        {/* ── Settlement table ── */}
        <div className="overflow-x-auto rounded-lg border border-border/50">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-b border-border/50">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Gateway</th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Period</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground text-xs uppercase tracking-wider">Settlement Total</th>
                <th className="px-4 py-2.5 text-center font-medium text-muted-foreground text-xs uppercase tracking-wider">Bank</th>
                <th className="px-4 py-2.5 text-center font-medium text-muted-foreground text-xs uppercase tracking-wider">Status</th>
                <th className="px-4 py-2.5 text-center font-medium text-muted-foreground text-xs uppercase tracking-wider w-[80px]">Action</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">
                    No settlements match this filter
                  </td>
                </tr>
              )}
              {pageRows.map((row, idx) => (
                <tr
                  key={row.id}
                  className={cn(
                    'border-b border-border/30 last:border-0 transition-colors hover:bg-muted/30',
                    idx % 2 === 1 && 'bg-muted/10'
                  )}
                >
                  <td className="px-4 py-3 font-medium text-foreground">
                    {getMarketplaceLabel(row.marketplace)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                    {formatDateRange(row.period_start, row.period_end)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-foreground whitespace-nowrap">
                    {formatAUD(row.bank_deposit || 0)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {row.bank_verified ? (
                      <span className="text-emerald-600 dark:text-emerald-400" title="Bank deposit matched">✔</span>
                    ) : (
                      <span className="text-muted-foreground/40" title="Awaiting bank match">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={row.status || ''} xeroStatus={row.xero_status} />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" className="h-8 px-3 text-xs font-medium">
                          Action
                          <MoreHorizontal className="h-3 w-3 ml-1" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-44">
                        <DropdownMenuItem className="text-xs" onClick={() => toast.info('Settlement drill-down coming soon')}>
                          <Eye className="h-3.5 w-3.5 mr-2" />
                          View
                        </DropdownMenuItem>
                        <DropdownMenuItem className="text-xs" onClick={() => toast.info('Recalculate coming soon')}>
                          <RefreshCw className="h-3.5 w-3.5 mr-2" />
                          Refresh
                        </DropdownMenuItem>
                        {(row.status === 'parsed' || row.status === 'ready_to_push' || row.status === 'saved') && (
                          <DropdownMenuItem className="text-xs" onClick={() => toast.info('Push to Xero from Settlements tab')}>
                            <Send className="h-3.5 w-3.5 mr-2" />
                            Send to Xero
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem className="text-xs" onClick={() => handleHide(row)}>
                          <EyeOff className="h-3.5 w-3.5 mr-2" />
                          Hide
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
            <span>
              Page {page} of {totalPages} ({filtered.length} items total)
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline" size="sm" className="h-7 w-7 p-0"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const p = i + 1;
                return (
                  <Button
                    key={p}
                    variant={p === page ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 w-7 p-0 text-xs"
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </Button>
                );
              })}
              <Button
                variant="outline" size="sm" className="h-7 w-7 p-0"
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
