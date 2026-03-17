/**
 * ValidationSweep — Shows the 5-step validation pipeline for every marketplace period.
 * Used as Settlements → Overview tab and triggered after boundary confirmation.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { logger } from '@/utils/logger';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import TablePaginationBar, { DEFAULT_PAGE_SIZE } from '@/components/shared/TablePaginationBar';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import {
  CheckCircle2, XCircle, AlertTriangle, Loader2, RefreshCw,
  Upload, ArrowRight, Send, Search, PartyPopper, Clock, Filter,
  ArrowUpDown, ArrowUp, ArrowDown, CalendarDays, Pause, Play, ChevronDown, ChevronUp,
} from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { triggerValidationSweep, formatAUD, MARKETPLACE_LABELS } from '@/utils/settlement-engine';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import PushSafetyPreview from '@/components/admin/accounting/PushSafetyPreview';
import { runMarketplaceSync, runDirectMarketplaceSync } from '@/actions/sync';
import { ACTIVE_CONNECTION_STATUSES } from '@/constants/connection-status';

interface ValidationRow {
  id: string;
  marketplace_code: string;
  period_label: string;
  period_start: string;
  period_end: string;
  orders_found: boolean;
  orders_count: number;
  orders_total: number;
  settlement_uploaded: boolean;
  settlement_id: string | null;
  settlement_net: number;
  reconciliation_status: string;
  reconciliation_difference: number;
  reconciliation_confidence: number | null;
  reconciliation_confidence_reason: string | null;
  xero_pushed: boolean;
  xero_pushed_at: string | null;
  xero_invoice_id: string | null;
  bank_matched: boolean;
  bank_amount: number | null;
  bank_reference: string | null;
  overall_status: string;
  last_checked_at: string | null;
  processing_state: string | null;
}

interface ValidationSweepProps {
  onSwitchToUpload?: () => void;
  onPushToXero?: (settlementId: string, marketplace: string) => void;
  showSweepAnimation?: boolean;
  /** When set, limits visible rows and shows a "View all" link */
  maxRows?: number;
  onViewAll?: () => void;
}

type FilterStatus = 'all' | 'complete' | 'ready_to_push' | 'settlement_needed' | 'gap_detected';

type SortKey = 'marketplace_code' | 'period_start' | 'orders_count' | 'settlement_net' | 'overall_status';
type SortDir = 'asc' | 'desc';

const STATUS_CONFIG: Record<string, { label: string; color: string; bgClass: string; borderClass: string }> = {
  complete: { label: 'Complete', color: 'text-emerald-700 dark:text-emerald-400', bgClass: 'bg-emerald-100 dark:bg-emerald-900/30', borderClass: 'border-emerald-200 dark:border-emerald-800' },
  bank_matched: { label: 'Complete', color: 'text-emerald-700 dark:text-emerald-400', bgClass: 'bg-emerald-100 dark:bg-emerald-900/30', borderClass: 'border-emerald-200 dark:border-emerald-800' },
  ready_to_push: { label: 'Ready to Push', color: 'text-blue-700 dark:text-blue-400', bgClass: 'bg-blue-100 dark:bg-blue-900/30', borderClass: 'border-blue-200 dark:border-blue-800' },
  pushed_to_xero: { label: 'Pushed', color: 'text-blue-700 dark:text-blue-400', bgClass: 'bg-blue-100 dark:bg-blue-900/30', borderClass: 'border-blue-200 dark:border-blue-800' },
  synced_external: { label: 'In Xero (legacy)', color: 'text-muted-foreground', bgClass: 'bg-muted', borderClass: 'border-border' },
  settlement_needed: { label: 'Upload Needed', color: 'text-amber-700 dark:text-amber-400', bgClass: 'bg-amber-100 dark:bg-amber-900/30', borderClass: 'border-amber-200 dark:border-amber-800' },
  gap_detected: { label: 'Gap Detected', color: 'text-red-700 dark:text-red-400', bgClass: 'bg-red-100 dark:bg-red-900/30', borderClass: 'border-red-200 dark:border-red-800' },
  missing: { label: 'Missing', color: 'text-muted-foreground', bgClass: 'bg-muted', borderClass: 'border-border' },
  already_recorded: { label: 'Already Recorded', color: 'text-muted-foreground', bgClass: 'bg-muted', borderClass: 'border-border' },
};

// Sweep animation steps
const SWEEP_STEPS = [
  'Checking Shopify orders...',
  'Checking uploaded settlements...',
  'Checking Xero accounting...',
  'Checking bank deposits...',
];

export default function ValidationSweep({
  onSwitchToUpload,
  onPushToXero,
  showSweepAnimation = false,
  maxRows,
  onViewAll,
}: ValidationSweepProps) {
  const [rows, setRows] = useState<ValidationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [sweeping, setSweeping] = useState(showSweepAnimation);
  const [sweepStep, setSweepStep] = useState(0);
  const [sweepStartTime, setSweepStartTime] = useState<number | null>(null);
  const [sweepDuration, setSweepDuration] = useState<number | null>(null);
  const [filter, setFilter] = useState<FilterStatus>('all');
  const [marketplaceFilter, setMarketplaceFilter] = useState<string>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [sortKey, setSortKey] = useState<SortKey>('period_start');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [boundaryDate, setBoundaryDate] = useState<string | null>(null);
  const [pushing, setPushing] = useState<string | null>(null);
  const [confirmingBank, setConfirmingBank] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewSettlements, setPreviewSettlements] = useState<Array<{ settlementId: string; marketplace: string }>>([]);
  const [apiSyncedCodes, setApiSyncedCodes] = useState<Set<string>>(new Set());
  const [syncingRow, setSyncingRow] = useState<string | null>(null);
  const [pausedCodes, setPausedCodes] = useState<Set<string>>(new Set());
  const [allConnections, setAllConnections] = useState<Array<{ marketplace_code: string; marketplace_name: string; connection_status: string }>>([]);
  const [showPaused, setShowPaused] = useState(false);
  const [togglingPause, setTogglingPause] = useState<string | null>(null);

  const handleConfirmBankMatch = async (row: ValidationRow, transactionId: string) => {
    setConfirmingBank(row.id);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/match-bank-deposits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ settlementId: row.settlement_id, force_match: true, transaction_id: transactionId }),
      });
      const data = await res.json();
      if (data?.matched || data?.results?.[0]?.matched) {
        toast.success('Bank deposit confirmed ✅');
        loadData();
      } else {
        toast.error('Could not confirm match');
      }
    } catch (err: any) {
      toast.error(err.message || 'Bank match failed');
    } finally {
      setConfirmingBank(null);
    }
  };

  const loadData = useCallback(async () => {
    try {
      const [valRes, boundaryRes, userRes] = await Promise.all([
        supabase
          .from('marketplace_validation')
          .select('*')
          .order('marketplace_code')
          .order('period_start', { ascending: false }),
        supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'accounting_boundary_date')
          .maybeSingle(),
        supabase.auth.getUser(),
      ]);

      if (valRes.error) throw valRes.error;
      const validationRows = (valRes.data || []) as ValidationRow[];

      // Load marketplace connections (API-synced codes + paused codes)
      const { data: connData } = await supabase
        .from('marketplace_connections')
        .select('marketplace_code, marketplace_name, connection_type, connection_status');
      const allConns = (connData || []) as Array<{ marketplace_code: string; marketplace_name: string; connection_type: string; connection_status: string }>;
      setAllConnections(allConns.map(c => ({ marketplace_code: c.marketplace_code, marketplace_name: c.marketplace_name, connection_status: c.connection_status })));
      const apiCodes = new Set<string>(
        allConns
          .filter((c) => c.connection_type === 'api' && (ACTIVE_CONNECTION_STATUSES as readonly string[]).includes(c.connection_status))
          .map((c) => c.marketplace_code)
      );
      setApiSyncedCodes(apiCodes);
      const paused = new Set<string>(
        allConns
          .filter((c) => c.connection_status === 'paused')
          .map((c) => c.marketplace_code)
      );
      setPausedCodes(paused);

      if (boundaryRes.data?.value) {
        setBoundaryDate(boundaryRes.data.value);
      }

      setRows(validationRows);
    } catch (err: any) {
      logger.error('[ValidationSweep] loadData error:', err);
      toast.error('Failed to load validation data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Sweep animation effect
  useEffect(() => {
    if (!sweeping) return;
    setSweepStartTime(Date.now());
    const interval = setInterval(() => {
      setSweepStep((prev) => {
        if (prev >= SWEEP_STEPS.length - 1) {
          clearInterval(interval);
          setTimeout(() => {
            setSweeping(false);
            setSweepDuration(Date.now() - (sweepStartTime || Date.now()));
            loadData();
          }, 600);
          return prev;
        }
        return prev + 1;
      });
    }, 1200);
    return () => clearInterval(interval);
  }, [sweeping]);

  const handleRunSweep = async () => {
    setSweeping(true);
    setSweepStep(0);
    setSweepStartTime(Date.now());
    try {
      await triggerValidationSweep();
    } catch (err: any) {
      toast.error('Sweep failed: ' + (err.message || 'Unknown error'));
      setSweeping(false);
    }
  };

  const handleSyncRow = async (row: ValidationRow) => {
    setSyncingRow(row.id);
    try {
      const result = await runDirectMarketplaceSync(row.marketplace_code);
      if (result?.success) {
        toast.success(`Synced ${row.marketplace_code} for ${row.period_label}`);
        loadData();
      } else {
        toast.error(result?.error || 'Sync failed');
      }
    } catch (err: any) {
      toast.error(err.message || 'Sync failed');
    } finally {
      setSyncingRow(null);
    }
  };

  // Memoized filtering + sorting
  const filteredRows = useMemo(() => {
    // Filter out paused marketplace rows
    let result = rows.filter((r) => !pausedCodes.has(r.marketplace_code));
    if (filter !== 'all') {
      result = result.filter((r) => {
        if (filter === 'complete') return r.overall_status === 'complete' || r.overall_status === 'bank_matched';
        return r.overall_status === filter;
      });
    }
    if (marketplaceFilter !== 'all') {
      result = result.filter((r) => r.marketplace_code === marketplaceFilter);
    }
    if (dateFrom) {
      result = result.filter((r) => r.period_start >= dateFrom);
    }
    if (dateTo) {
      result = result.filter((r) => r.period_end <= dateTo);
    }
    result = [...result].sort((a, b) => {
      const aVal = a[sortKey];
      const bVal = b[sortKey];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (typeof aVal === 'number' && typeof bVal === 'number') {
        return sortDir === 'asc' ? aVal - bVal : bVal - aVal;
      }
      return sortDir === 'asc'
        ? String(aVal).localeCompare(String(bVal))
        : String(bVal).localeCompare(String(aVal));
    });
    return result;
  }, [rows, filter, marketplaceFilter, dateFrom, dateTo, sortKey, sortDir, pausedCodes]);

  const uniqueMarketplaces = useMemo(() => [...new Set(rows.map((r) => r.marketplace_code))].sort(), [rows]);

  const pausedCount = useMemo(() => {
    const pausedMarketplaceCodes = new Set(allConnections.filter(c => c.connection_status === 'paused').map(c => c.marketplace_code));
    return rows.filter(r => pausedMarketplaceCodes.has(r.marketplace_code)).length;
  }, [rows, allConnections]);

  const statusCounts = useMemo(() => {
    const activeRows = rows.filter(r => !pausedCodes.has(r.marketplace_code));
    const counts: Record<FilterStatus, number> = { all: activeRows.length, complete: 0, ready_to_push: 0, settlement_needed: 0, gap_detected: 0 };
    activeRows.forEach((r) => {
      if (r.overall_status === 'complete' || r.overall_status === 'bank_matched') counts.complete++;
      else if (r.overall_status === 'ready_to_push' || r.overall_status === 'pushed_to_xero') counts.ready_to_push++;
      else if (r.overall_status === 'settlement_needed' || r.overall_status === 'missing') counts.settlement_needed++;
      else if (r.overall_status === 'gap_detected') counts.gap_detected++;
    });
    return counts;
  }, [rows, pausedCodes]);

  const handleTogglePause = async (marketplaceCode: string, currentStatus: string) => {
    setTogglingPause(marketplaceCode);
    try {
      const newStatus = currentStatus === 'paused' ? 'active' : 'paused';
      const { error } = await supabase
        .from('marketplace_connections')
        .update({ connection_status: newStatus })
        .eq('marketplace_code', marketplaceCode);
      if (error) throw error;
      toast.success(newStatus === 'paused' ? `${marketplaceCode} paused — hidden from overview` : `${marketplaceCode} resumed`);
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update');
    } finally {
      setTogglingPause(null);
    }
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const SortIcon = ({ col }: { col: SortKey }) => {
    if (sortKey !== col) return <ArrowUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return sortDir === 'asc' ? <ArrowUp className="h-3 w-3 ml-1" /> : <ArrowDown className="h-3 w-3 ml-1" />;
  };

  // Pagination
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);
  const displayRows = maxRows ? filteredRows.slice(0, maxRows) : filteredRows;
  const totalPages = Math.ceil(displayRows.length / pageSize);
  const pagedRows = displayRows.slice((page - 1) * pageSize, page * pageSize);

  const handlePush = async (row: ValidationRow) => {
    if (!row.settlement_id || !onPushToXero) return;
    setPushing(row.id);
    try {
      await onPushToXero(row.settlement_id, row.marketplace_code);
      toast.success(`Pushed ${row.marketplace_code} ${row.period_label} to Xero`);
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Push failed');
    } finally {
      setPushing(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="p-6 space-y-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-40 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (sweeping) {
    return (
      <Card>
        <CardContent className="p-6 text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin mx-auto text-primary" />
          <p className="text-sm font-medium">{SWEEP_STEPS[sweepStep]}</p>
          <div className="flex gap-1 justify-center">
            {SWEEP_STEPS.map((_, i) => (
              <div key={i} className={cn('h-1.5 w-8 rounded-full', i <= sweepStep ? 'bg-primary' : 'bg-muted')} />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        <SummaryCard label="All Periods" count={statusCounts.all} emoji="📋" active={filter === 'all'} onClick={() => setFilter('all')} bgClass="bg-muted/50" borderClass="border-border" />
        <SummaryCard label="Complete" count={statusCounts.complete} emoji="✅" active={filter === 'complete'} onClick={() => setFilter('complete')} bgClass="bg-emerald-50 dark:bg-emerald-900/20" borderClass="border-emerald-200 dark:border-emerald-800" />
        <SummaryCard label="Ready to Push" count={statusCounts.ready_to_push} emoji="🚀" active={filter === 'ready_to_push'} onClick={() => setFilter('ready_to_push')} bgClass="bg-blue-50 dark:bg-blue-900/20" borderClass="border-blue-200 dark:border-blue-800" />
        <SummaryCard label="Upload Needed" count={statusCounts.settlement_needed} emoji="📤" active={filter === 'settlement_needed'} onClick={() => setFilter('settlement_needed')} bgClass="bg-amber-50 dark:bg-amber-900/20" borderClass="border-amber-200 dark:border-amber-800" />
        <SummaryCard label="Gaps" count={statusCounts.gap_detected} emoji="⚠️" active={filter === 'gap_detected'} onClick={() => setFilter('gap_detected')} bgClass="bg-red-50 dark:bg-red-900/20" borderClass="border-red-200 dark:border-red-800" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={marketplaceFilter} onValueChange={setMarketplaceFilter}>
          <SelectTrigger className="w-[180px] h-8 text-xs">
            <Filter className="h-3 w-3 mr-1" />
            <SelectValue placeholder="All Marketplaces" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Marketplaces</SelectItem>
            {uniqueMarketplaces.map((m) => (
              <SelectItem key={m} value={m}>{MARKETPLACE_LABELS[m] || m}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-1">
          <CalendarDays className="h-3 w-3 text-muted-foreground" />
          <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="h-8 w-[130px] text-xs" placeholder="From" />
          <span className="text-xs text-muted-foreground">–</span>
          <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="h-8 w-[130px] text-xs" placeholder="To" />
        </div>
        <Button variant="outline" size="sm" className="h-8 text-xs gap-1 ml-auto" onClick={handleRunSweep} disabled={sweeping}>
          <RefreshCw className={cn('h-3 w-3', sweeping && 'animate-spin')} />
          Re-scan
        </Button>
      </div>

      {/* Paused channels indicator */}
      {pausedCount > 0 && (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-2">
          <button
            onClick={() => setShowPaused(!showPaused)}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            <Pause className="h-3 w-3" />
            <span>{pausedCount} period{pausedCount !== 1 ? 's' : ''} hidden ({allConnections.filter(c => c.connection_status === 'paused').length} paused channel{allConnections.filter(c => c.connection_status === 'paused').length !== 1 ? 's' : ''})</span>
            {showPaused ? <ChevronUp className="h-3 w-3 ml-auto" /> : <ChevronDown className="h-3 w-3 ml-auto" />}
          </button>
          {showPaused && (
            <div className="mt-2 space-y-1.5 pt-2 border-t border-border">
              {allConnections
                .filter(c => c.connection_status === 'paused')
                .map(conn => (
                  <div key={conn.marketplace_code} className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">
                      <Pause className="h-3 w-3 inline mr-1.5" />
                      {MARKETPLACE_LABELS[conn.marketplace_code] || conn.marketplace_name || conn.marketplace_code}
                    </span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs gap-1 px-2"
                      disabled={togglingPause === conn.marketplace_code}
                      onClick={() => handleTogglePause(conn.marketplace_code, 'paused')}
                    >
                      {togglingPause === conn.marketplace_code ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Play className="h-3 w-3" />
                      )}
                      Resume
                    </Button>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/30">
                  <th className="px-3 py-2 text-left font-medium cursor-pointer" onClick={() => handleSort('marketplace_code')}>
                    <span className="inline-flex items-center">Marketplace<SortIcon col="marketplace_code" /></span>
                  </th>
                  <th className="px-3 py-2 text-left font-medium cursor-pointer" onClick={() => handleSort('period_start')}>
                    <span className="inline-flex items-center">Period<SortIcon col="period_start" /></span>
                  </th>
                  <th className="px-3 py-2 text-center font-medium cursor-pointer" onClick={() => handleSort('orders_count')}>
                    <span className="inline-flex items-center">Orders<SortIcon col="orders_count" /></span>
                  </th>
                  <th className="px-3 py-2 text-center font-medium">Settlement</th>
                  <th className="px-3 py-2 text-right font-medium cursor-pointer" onClick={() => handleSort('settlement_net')}>
                    <span className="inline-flex items-center justify-end">Net<SortIcon col="settlement_net" /></span>
                  </th>
                  <th className="px-3 py-2 text-center font-medium">Xero</th>
                  <th className="px-3 py-2 text-center font-medium">Bank</th>
                  <th className="px-3 py-2 text-center font-medium cursor-pointer" onClick={() => handleSort('overall_status')}>
                    <span className="inline-flex items-center">Status<SortIcon col="overall_status" /></span>
                  </th>
                  <th className="px-3 py-2 text-center font-medium">Action</th>
                </tr>
              </thead>
              <tbody>
                {pagedRows.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-3 py-8 text-center text-muted-foreground">
                      {rows.length === 0 ? 'No validation data yet. Run a scan to get started.' : 'No periods match your filters.'}
                    </td>
                  </tr>
                ) : (
                  pagedRows.map((row) => (
                    <tr key={row.id} className="border-b hover:bg-muted/20 transition-colors group">
                      <td className="px-3 py-2 font-medium">
                        <span className="inline-flex items-center gap-1">
                          {MARKETPLACE_LABELS[row.marketplace_code] || row.marketplace_code}
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  className="opacity-0 group-hover:opacity-60 hover:!opacity-100 transition-opacity"
                                  onClick={() => handleTogglePause(row.marketplace_code, 'active')}
                                  disabled={togglingPause === row.marketplace_code}
                                >
                                  {togglingPause === row.marketplace_code ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <Pause className="h-3 w-3" />
                                  )}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="right" className="text-xs">Pause this channel — hides from overview</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </span>
                      </td>
                      <td className="px-3 py-2">{row.period_label}</td>
                      <td className="px-3 py-2 text-center">{row.orders_found ? row.orders_count : '—'}</td>
                      <td className="px-3 py-2 text-center"><SettlementCell row={row} /></td>
                      <td className="px-3 py-2 text-right font-mono">{row.settlement_net ? formatAUD(row.settlement_net) : '—'}</td>
                      <td className="px-3 py-2 text-center">
                        {row.xero_pushed ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mx-auto" /> : <XCircle className="h-3.5 w-3.5 text-muted-foreground mx-auto" />}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {row.bank_matched ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mx-auto" /> : <XCircle className="h-3.5 w-3.5 text-muted-foreground mx-auto" />}
                      </td>
                      <td className="px-3 py-2 text-center">
                        <StatusPill status={row.overall_status} isApiSynced={apiSyncedCodes.has(row.marketplace_code)} />
                      </td>
                      <td className="px-3 py-2 text-center">
                        <RowAction
                          row={row}
                          pushing={pushing === row.id}
                          syncing={syncingRow === row.id}
                          isApiSynced={apiSyncedCodes.has(row.marketplace_code)}
                          onUpload={() => onSwitchToUpload?.()}
                          onPush={() => handlePush(row)}
                          onSync={() => handleSyncRow(row)}
                        />
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {!maxRows && displayRows.length > pageSize && (
            <TablePaginationBar
              page={page}
              totalPages={totalPages}
              pageSize={pageSize}
              totalItems={displayRows.length}
              onPageChange={setPage}
            />
          )}
          {maxRows && filteredRows.length > maxRows && onViewAll && (
            <div className="p-3 text-center border-t">
              <Button variant="ghost" size="sm" className="text-xs gap-1" onClick={onViewAll}>
                View all {filteredRows.length} periods <ArrowRight className="h-3 w-3" />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {previewOpen && (
        <PushSafetyPreview
          settlements={previewSettlements}
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          onConfirm={async () => { setPreviewOpen(false); loadData(); }}
        />
      )}
    </div>
  );
}

function SummaryCard({
  label, count, emoji, active, onClick, bgClass, borderClass,
}: {
  label: string; count: number; emoji: string; active: boolean;
  onClick: () => void; bgClass: string; borderClass: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'rounded-lg border p-4 text-left transition-all hover:shadow-sm cursor-pointer',
        bgClass, borderClass,
      )}
    >
      <div className="text-2xl font-bold">{emoji} {count}</div>
      <div className="text-xs font-medium text-muted-foreground mt-1">{label}</div>
    </button>
  );
}

function StatusPill({ status, isApiSynced }: { status: string; isApiSynced?: boolean }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.missing;
  const label = isApiSynced && (status === 'settlement_needed' || status === 'missing')
    ? 'Sync Needed'
    : config.label;
  return (
    <Badge className={cn('text-[10px] font-medium', config.bgClass, config.color, config.borderClass)}>
      {label}
    </Badge>
  );
}

function SettlementCell({ row }: { row: ValidationRow }) {
  if (!row.settlement_uploaded) {
    return <XCircle className="h-3.5 w-3.5 text-muted-foreground mx-auto" />;
  }

  // Confidence badge
  const conf = row.reconciliation_confidence;
  let confIcon: React.ReactNode;
  let confLabel: string;

  if (conf === null || conf === undefined) {
    confIcon = <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    confLabel = 'Uploaded';
  } else if (conf >= 0.9) {
    confIcon = <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    confLabel = 'Matched';
  } else if (conf >= 0.7) {
    confIcon = <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
    confLabel = 'Near match';
  } else {
    confIcon = <AlertTriangle className="h-3.5 w-3.5 text-red-500" />;
    confLabel = 'Gap — review';
  }

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1">
            {confIcon}
            <span className="text-xs">{confLabel}</span>
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs">
          {row.reconciliation_confidence_reason || `Confidence: ${conf !== null ? (conf * 100).toFixed(0) + '%' : 'N/A'}`}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function RowAction({
  row, pushing, syncing, isApiSynced, onUpload, onPush, onSync,
}: {
  row: ValidationRow; pushing: boolean; syncing?: boolean; isApiSynced?: boolean;
  onUpload: () => void; onPush: () => void; onSync?: () => void;
}) {
  if (row.overall_status === 'settlement_needed' || row.overall_status === 'missing') {
    if (isApiSynced && onSync) {
      return (
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={onSync} disabled={syncing}>
          {syncing ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {syncing ? 'Syncing...' : 'Sync'}
        </Button>
      );
    }
    return (
      <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={onUpload}>
        <Upload className="h-3 w-3" /> Upload
      </Button>
    );
  }
  if (row.overall_status === 'ready_to_push') {
    return (
      <Button size="sm" className="h-7 text-xs gap-1" onClick={onPush} disabled={pushing}>
        {pushing ? <Loader2 className="h-3 w-3 animate-spin" /> : <ArrowRight className="h-3 w-3" />}
        Push →
      </Button>
    );
  }
  if (row.overall_status === 'gap_detected') {
    return (
      <Button variant="outline" size="sm" className="h-7 text-xs gap-1 border-red-200 text-red-700 dark:border-red-800 dark:text-red-400">
        <AlertTriangle className="h-3 w-3" /> Review
      </Button>
    );
  }
  return <span className="text-xs text-muted-foreground">—</span>;
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatPeriod(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-AU', { month: 'short', year: '2-digit' });
}

function formatTimeAgo(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
