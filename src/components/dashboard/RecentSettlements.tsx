/**
 * RecentSettlements — Dashboard settlement action center.
 * 
 * Features:
 *   - Clickable status summary cards (Ready to Push, Posted, Needs Attention, Hidden)
 *   - Clean table with Gateway, Period, Amount, Bank, Status, Actions
 *   - Action dropdown: View (inline drill-down), Refresh, Send to Xero, Download CSV, Hide/Unhide
 *   - Pagination (25 per page)
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  FileText, ArrowRight, CheckCircle2, Clock, Send, AlertTriangle,
  MoreHorizontal, Eye, RefreshCw, EyeOff, Download, ChevronLeft, ChevronRight,
  EyeIcon, ChevronDown, ChevronUp, Loader2,
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
  sales_principal: number | null;
  seller_fees: number | null;
  fba_fees: number | null;
  refunds: number | null;
  gst_on_income: number | null;
  other_fees: number | null;
  storage_fees: number | null;
  advertising_costs: number | null;
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

type StatusCategory = 'ready' | 'posted' | 'attention' | 'hidden' | 'other';

function categorize(row: SettlementRow): StatusCategory {
  if ((row as any).is_hidden) return 'hidden';
  if (row.status === 'push_failed' || row.status === 'push_failed_permanent') return 'attention';
  if (['pushed_to_xero', 'reconciled_in_xero', 'bank_verified'].includes(row.status)) return 'posted';
  if (row.xero_status === 'DRAFT' || row.xero_status === 'AUTHORISED' || row.xero_status === 'PAID') return 'posted';
  if (row.status === 'ready_to_push') return 'ready';
  if (row.status === 'ingested') return 'other';
  return 'other';
}

function StatusBadge({ status, xeroStatus, syncOrigin }: { status: string; xeroStatus: string | null; syncOrigin?: string }) {
  // Fully reconciled (PAID in Xero)
  if (status === 'reconciled_in_xero' || status === 'bank_verified' || xeroStatus === 'PAID') {
    return (
      <Badge variant="outline" className="text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-900/30 dark:border-emerald-800 text-xs">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Reconciled ✓
      </Badge>
    );
  }
  // Pushed to Xero (covers draft + authorised + external)
  if (status === 'pushed_to_xero') {
    if (syncOrigin === 'external') {
      return (
        <Badge variant="outline" className="text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-900/30 dark:border-emerald-800 text-xs">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Already in Xero
        </Badge>
      );
    }
    if (xeroStatus === 'AUTHORISED') {
      return (
        <Badge variant="outline" className="text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-900/30 dark:border-amber-800 text-xs">
          <Clock className="h-3 w-3 mr-1" />
          Posted — Awaiting Deposit
        </Badge>
      );
    }
    if (xeroStatus === 'DRAFT') {
      return (
        <Badge variant="outline" className="text-orange-700 bg-orange-50 border-orange-200 dark:text-orange-400 dark:bg-orange-900/30 dark:border-orange-800 text-xs">
          <FileText className="h-3 w-3 mr-1" />
          In Xero — Draft
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-900/30 dark:border-emerald-800 text-xs">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        In Xero
      </Badge>
    );
  }
  if (status === 'ready_to_push') {
    return (
      <Badge variant="outline" className="text-sky-700 bg-sky-50 border-sky-200 dark:text-sky-400 dark:bg-sky-900/30 dark:border-sky-800 text-xs">
        <Send className="h-3 w-3 mr-1" />
        Ready to Post
      </Badge>
    );
  }
  if (status === 'ingested') {
    return (
      <Badge variant="outline" className="text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-900/30 dark:border-amber-800 text-xs">
        <Clock className="h-3 w-3 mr-1" />
        Posted — Awaiting Deposit
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
      Pending
    </Badge>
  );
}

// ── Inline drill-down panel ──
function SettlementDrillDown({ row }: { row: SettlementRow }) {
  const [lines, setLines] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('settlement_lines')
        .select('order_id, sku, amount, amount_description, transaction_type')
        .eq('settlement_id', row.settlement_id)
        .order('amount', { ascending: true })
        .limit(50);
      setLines(data || []);
      setLoading(false);
    })();
  }, [row.settlement_id]);

  const summaryItems = [
    { label: 'Gross Sales', value: row.sales_principal },
    { label: 'Seller Fees', value: row.seller_fees },
    { label: 'FBA Fees', value: row.fba_fees },
    { label: 'Storage Fees', value: row.storage_fees },
    { label: 'Advertising', value: row.advertising_costs },
    { label: 'Other Fees', value: row.other_fees },
    { label: 'Refunds', value: row.refunds },
    { label: 'GST on Income', value: row.gst_on_income },
    { label: 'Net Deposit', value: row.bank_deposit },
  ].filter(i => i.value !== null && i.value !== 0);

  return (
    <div className="bg-muted/30 border-t border-border/50 px-6 py-4 space-y-4">
      {/* Financial summary */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Financial Summary</p>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
          {summaryItems.map(item => (
            <div key={item.label} className="space-y-0.5">
              <p className="text-[11px] text-muted-foreground">{item.label}</p>
              <p className={cn(
                'text-sm font-semibold',
                (item.value || 0) < 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground'
              )}>
                {formatAUD(item.value || 0)}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Line items */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Transaction Lines {lines && `(${lines.length}${lines.length >= 50 ? '+' : ''})`}
        </p>
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </div>
        ) : lines && lines.length > 0 ? (
          <div className="max-h-48 overflow-y-auto rounded border border-border/50">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/40 border-b border-border/50">
                  <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Type</th>
                  <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Description</th>
                  <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Order</th>
                  <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i} className="border-b border-border/20 last:border-0">
                    <td className="px-3 py-1.5 text-muted-foreground">{line.transaction_type || '—'}</td>
                    <td className="px-3 py-1.5 text-foreground">{line.amount_description || line.sku || '—'}</td>
                    <td className="px-3 py-1.5 text-muted-foreground font-mono">{line.order_id || '—'}</td>
                    <td className={cn(
                      'px-3 py-1.5 text-right font-mono',
                      (line.amount || 0) < 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground'
                    )}>
                      {formatAUD(line.amount || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/70 py-2">No line items recorded for this settlement</p>
        )}
      </div>
    </div>
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
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('settlements')
        .select('id, settlement_id, marketplace, period_start, period_end, bank_deposit, status, xero_status, source, created_at, bank_verified, sales_principal, seller_fees, fba_fees, refunds, gst_on_income, other_fees, storage_fees, advertising_costs')
        .neq('source', 'api_sync')
        .neq('status', 'duplicate_suppressed')
        .neq('status', 'already_recorded')
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
    const c = { ready: 0, posted: 0, attention: 0, hidden: 0, other: 0, readyTotal: 0, postedTotal: 0 };
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
    if (activeFilter === 'hidden') return allRows.filter(r => r.status === 'hidden');
    const visible = showHidden ? allRows : allRows.filter(r => r.status !== 'hidden');
    if (!activeFilter) return visible;
    return visible.filter(r => categorize(r) === activeFilter);
  }, [allRows, activeFilter, showHidden]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  useEffect(() => { setPage(1); }, [activeFilter, showHidden]);

  // ── Actions ──
  const handleHide = async (row: SettlementRow) => {
    await supabase.from('settlements').update({ is_hidden: true } as any).eq('id', row.id);
    toast.success(`Hidden: ${getMarketplaceLabel(row.marketplace)} ${formatDateRange(row.period_start, row.period_end)}`);
    fetchAll();
  };

  const handleUnhide = async (row: SettlementRow) => {
    await supabase.from('settlements').update({ is_hidden: false } as any).eq('id', row.id);
    toast.success(`Restored: ${getMarketplaceLabel(row.marketplace)} ${formatDateRange(row.period_start, row.period_end)}`);
    fetchAll();
  };

  const handleView = (row: SettlementRow) => {
    setExpandedId(prev => prev === row.id ? null : row.id);
  };

  const handleDownloadCSV = (row: SettlementRow) => {
    const headers = ['Field', 'Amount'];
    const rows = [
      ['Marketplace', getMarketplaceLabel(row.marketplace)],
      ['Period', `${row.period_start} to ${row.period_end}`],
      ['Settlement ID', row.settlement_id],
      ['Gross Sales', String(row.sales_principal || 0)],
      ['Seller Fees', String(row.seller_fees || 0)],
      ['FBA Fees', String(row.fba_fees || 0)],
      ['Storage Fees', String(row.storage_fees || 0)],
      ['Advertising', String(row.advertising_costs || 0)],
      ['Other Fees', String(row.other_fees || 0)],
      ['Refunds', String(row.refunds || 0)],
      ['GST on Income', String(row.gst_on_income || 0)],
      ['Net Deposit', String(row.bank_deposit || 0)],
    ];
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `settlement-${row.settlement_id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV downloaded');
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
      color: 'border-amber-200 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-900/20',
      icon: <CheckCircle2 className="h-4 w-4 text-amber-600 dark:text-amber-400" />,
    },
    // Only show Needs Attention when there are items
    ...(counts.attention > 0 ? [{
      key: 'attention' as StatusCategory,
      label: 'Needs Attention',
      count: counts.attention,
      color: 'border-red-200 bg-red-50/80 dark:border-red-800 dark:bg-red-900/20',
      icon: <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />,
    }] : []),
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Settlements
          </CardTitle>
          <div className="flex items-center gap-2">
            {counts.hidden > 0 && (
              <Button
                variant={activeFilter === 'hidden' ? 'secondary' : 'ghost'}
                size="sm"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setActiveFilter(prev => prev === 'hidden' ? null : 'hidden')}
              >
                <EyeOff className="h-3 w-3 mr-1" />
                {counts.hidden} hidden
              </Button>
            )}
            {onViewAll && (
              <Button variant="ghost" size="sm" onClick={onViewAll} className="text-xs text-muted-foreground hover:text-foreground">
                Full ledger
                <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0">
        {/* ── Status summary cards (clickable filters) ── */}
        <div className={cn("grid gap-3", summaryCards.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
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
              {card.total !== undefined && card.count > 0 ? (
                <>
                  <p className="text-xl font-bold text-foreground">{formatAUD(card.total)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{card.count} settlement{card.count > 1 ? 's' : ''}</p>
                </>
              ) : (
                <p className="text-xl font-bold text-foreground">{card.count}</p>
              )}
            </button>
          ))}
        </div>

        {/* ── Active filter indicator ── */}
        {activeFilter && (
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              Showing: {activeFilter === 'hidden' ? 'Hidden' : summaryCards.find(c => c.key === activeFilter)?.label}
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
                <React.Fragment key={row.id}>
                  <tr
                    className={cn(
                      'border-b border-border/30 last:border-0 transition-colors hover:bg-muted/30',
                      idx % 2 === 1 && 'bg-muted/10',
                      expandedId === row.id && 'bg-muted/20',
                      row.status === 'hidden' && 'opacity-60'
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
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem className="text-xs" onClick={() => handleView(row)}>
                            <Eye className="h-3.5 w-3.5 mr-2" />
                            {expandedId === row.id ? 'Close breakdown' : 'View breakdown'}
                          </DropdownMenuItem>

                          <DropdownMenuItem className="text-xs" onClick={() => handleDownloadCSV(row)}>
                            <Download className="h-3.5 w-3.5 mr-2" />
                            Download CSV
                          </DropdownMenuItem>

                          <DropdownMenuSeparator />

                          <DropdownMenuItem className="text-xs" onClick={() => {
                            toast.info('Recalculate: re-parse from the Settlements tab');
                          }}>
                            <RefreshCw className="h-3.5 w-3.5 mr-2" />
                            Recalculate
                          </DropdownMenuItem>

                          {(row.status === 'parsed' || row.status === 'ready_to_push' || row.status === 'saved') && (
                            <DropdownMenuItem className="text-xs" onClick={() => {
                              toast.info('Push to Xero from the Settlements tab');
                            }}>
                              <Send className="h-3.5 w-3.5 mr-2" />
                              Send to Xero
                            </DropdownMenuItem>
                          )}

                          <DropdownMenuSeparator />

                          {row.status === 'hidden' ? (
                            <DropdownMenuItem className="text-xs" onClick={() => handleUnhide(row)}>
                              <EyeIcon className="h-3.5 w-3.5 mr-2" />
                              Unhide
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem className="text-xs text-destructive" onClick={() => handleHide(row)}>
                              <EyeOff className="h-3.5 w-3.5 mr-2" />
                              Hide
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                  {/* ── Inline drill-down ── */}
                  {expandedId === row.id && (
                    <tr>
                      <td colSpan={6} className="p-0">
                        <SettlementDrillDown row={row} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
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
