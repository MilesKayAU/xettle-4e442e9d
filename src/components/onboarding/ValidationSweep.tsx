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
  ArrowUpDown, ArrowUp, ArrowDown, CalendarDays,
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
      
      // ── Sync guard: fix stale validation rows whose settlement status has changed ──
      const staleCandidate = validationRows.filter(
        r => r.overall_status === 'ready_to_push' && r.settlement_id
      );
      if (staleCandidate.length > 0) {
        const settlementIds = staleCandidate.map(r => r.settlement_id!);
        const { data: settlements } = await supabase
          .from('settlements')
          .select('settlement_id, status')
          .in('settlement_id', settlementIds);

        if (settlements && settlements.length > 0) {
          const statusMap = new Map(settlements.map(s => [s.settlement_id, s.status]));
          const fixPromises: Promise<any>[] = [];

          for (const row of staleCandidate) {
            const sStatus = statusMap.get(row.settlement_id!);
            if (!sStatus) continue;

            if (sStatus === 'already_recorded' || sStatus === 'pushed_to_xero') {
              row.overall_status = 'complete';
              fixPromises.push(
                Promise.resolve(
                  supabase.from('marketplace_validation')
                    .update({ overall_status: 'complete' })
                    .eq('id', row.id)
                )
              );
            } else if (sStatus === 'ingested' || sStatus === 'saved') {
              row.overall_status = 'settlement_needed';
              fixPromises.push(
                Promise.resolve(
                  supabase.from('marketplace_validation')
                    .update({ overall_status: 'settlement_needed' })
                    .eq('id', row.id)
                )
              );
            }
          }
          if (fixPromises.length > 0) {
            await Promise.all(fixPromises);
            logger.debug(`[ValidationSweep] Fixed ${fixPromises.length} stale validation rows`);
          }
        }
      }

      setRows(validationRows);
      
      if (boundaryRes.data?.value) {
        setBoundaryDate(boundaryRes.data.value);
      } else if (userRes.data?.user?.created_at) {
        setBoundaryDate(userRes.data.user.created_at.substring(0, 10));
      }
    } catch (err) {
      console.error('Failed to load validation data:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // Load API-synced marketplace codes
  useEffect(() => {
    const loadApiSyncedCodes = async () => {
      try {
        const [connRes, amazonRes, ebayRes] = await Promise.all([
          supabase.from('marketplace_connections')
            .select('marketplace_code, connection_type, connection_status')
            .eq('connection_type', 'api')
            .in('connection_status', [...ACTIVE_CONNECTION_STATUSES]),
          supabase.from('amazon_tokens').select('id').limit(1),
          supabase.from('ebay_tokens').select('id').limit(1),
        ]);
        const codes = new Set<string>();
        (connRes.data || []).forEach(c => codes.add(c.marketplace_code));
        if (amazonRes.data && amazonRes.data.length > 0) codes.add('amazon_au');
        if (ebayRes.data && ebayRes.data.length > 0) codes.add('ebay_au');
        setApiSyncedCodes(codes);
      } catch (err) {
        logger.debug('[ValidationSweep] Failed to load API-synced codes', err);
      }
    };
    loadApiSyncedCodes();
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel('validation-sweep-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'marketplace_validation' }, () => {
        loadData();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadData]);

  // Sweep animation
  useEffect(() => {
    if (!sweeping) return;
    setSweepStartTime(Date.now());
    setSweepStep(0);

    const intervals = SWEEP_STEPS.map((_, i) =>
      setTimeout(() => setSweepStep(i + 1), (i + 1) * 1200)
    );

    const done = setTimeout(() => {
      setSweepDuration(Math.round((Date.now() - Date.now()) / 1000));
      setSweeping(false);
      loadData();
    }, SWEEP_STEPS.length * 1200 + 800);

    return () => {
      intervals.forEach(clearTimeout);
      clearTimeout(done);
    };
  }, [sweeping, loadData]);

  const handleRefresh = async () => {
    setSweeping(true);
    setSweepStartTime(Date.now());
    try {
      await triggerValidationSweep();
      // Animation will complete and then loadData
    } catch {
      toast.error('Status refresh failed');
      setSweeping(false);
    }
  };

  // Open preview modal for a single settlement
  const openPushPreview = (row: ValidationRow) => {
    if (!row.settlement_id) return;
    setPreviewSettlements([{ settlementId: row.settlement_id, marketplace: row.marketplace_code }]);
    setPreviewOpen(true);
  };

  // Open preview modal for ALL ready-to-push settlements
  const openPushAllPreview = () => {
    const items = readyToPushRows
      .filter(r => r.settlement_id)
      .map(r => ({ settlementId: r.settlement_id!, marketplace: r.marketplace_code }));
    if (items.length === 0) return;
    setPreviewSettlements(items);
    setPreviewOpen(true);
  };

  // Actually execute the push (called after preview confirmation)
  const executePush = async () => {
    for (const { settlementId, marketplace } of previewSettlements) {
      const row = rows.find(r => r.settlement_id === settlementId);
      if (row) setPushing(row.id);
      try {
        const { syncSettlementToXero, syncXeroStatus } = await import('@/utils/settlement-engine');
        
        // syncSettlementToXero now builds canonical 10-category lines internally
        const result = await syncSettlementToXero(settlementId, marketplace);
        
        if (result.success) {
          toast.success(`Pushed to Xero ✅`);
          await syncXeroStatus();
        } else {
          toast.error(result.error || 'Push failed');
        }
      } catch (err: any) {
        toast.error(err.message || 'Push failed');
      } finally {
        setPushing(null);
      }
    }
    setPreviewOpen(false);
    loadData();
  };

  // Counts
  // Filter out already_recorded rows AND shopify_auto analytics-only records from actionable views
  const actionableRows = useMemo(() => {
    return rows.filter(r => 
      r.overall_status !== 'already_recorded' &&
      !(r.settlement_id && r.settlement_id.startsWith('shopify_auto_'))
    );
  }, [rows]);

  const counts = useMemo(() => {
    const c = { complete: 0, ready_to_push: 0, settlement_needed: 0, gap_detected: 0 };
    actionableRows.forEach(r => {
      if (r.overall_status === 'complete' || r.overall_status === 'bank_matched') c.complete++;
      else if (r.overall_status === 'ready_to_push') c.ready_to_push++;
      else if (r.overall_status === 'pushed_to_xero' || r.overall_status === 'synced_external') c.complete++;
      else if (r.overall_status === 'settlement_needed' || r.overall_status === 'missing') c.settlement_needed++;
      else if (r.overall_status === 'gap_detected') c.gap_detected++;
    });
    return c;
  }, [actionableRows]);

  const uniqueMarketplaces = useMemo(() => {
    const codes = [...new Set(actionableRows.map(r => r.marketplace_code))];
    return codes.sort().map(code => ({
      code,
      label: MARKETPLACE_LABELS[code] || code,
    }));
  }, [actionableRows]);

  const filteredRows = useMemo(() => {
    let result = actionableRows;
    // Marketplace filter
    if (marketplaceFilter !== 'all') {
      result = result.filter(r => r.marketplace_code === marketplaceFilter);
    }
    // Date range filter
    if (dateFrom) {
      result = result.filter(r => r.period_start >= dateFrom);
    }
    if (dateTo) {
      result = result.filter(r => r.period_start <= dateTo);
    }
    // Status filter
    if (filter === 'complete') result = result.filter(r => r.overall_status === 'complete' || r.overall_status === 'bank_matched' || r.overall_status === 'pushed_to_xero' || r.overall_status === 'synced_external');
    else if (filter === 'ready_to_push') result = result.filter(r => r.overall_status === 'ready_to_push');
    else if (filter === 'settlement_needed') result = result.filter(r => r.overall_status === 'settlement_needed' || r.overall_status === 'missing');
    else if (filter === 'gap_detected') result = result.filter(r => r.overall_status === 'gap_detected');
    // Sort
    result = [...result].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'marketplace_code':
          cmp = (MARKETPLACE_LABELS[a.marketplace_code] || a.marketplace_code).localeCompare(MARKETPLACE_LABELS[b.marketplace_code] || b.marketplace_code);
          break;
        case 'period_start':
          cmp = a.period_start.localeCompare(b.period_start);
          break;
        case 'orders_count':
          cmp = (a.orders_count || 0) - (b.orders_count || 0);
          break;
        case 'settlement_net':
          cmp = (a.settlement_net || 0) - (b.settlement_net || 0);
          break;
        case 'overall_status':
          cmp = (a.overall_status || '').localeCompare(b.overall_status || '');
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return result;
  }, [actionableRows, filter, marketplaceFilter, dateFrom, dateTo, sortKey, sortDir]);

  const toggleSort = useCallback((key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  }, [sortKey]);

  const [vsPage, setVsPage] = useState(1);
  const vsTotalPages = Math.max(1, Math.ceil(filteredRows.length / DEFAULT_PAGE_SIZE));
  const safeVsPage = Math.min(vsPage, vsTotalPages);
  const paginatedRows = useMemo(() => {
    if (maxRows) return filteredRows.slice(0, maxRows);
    const start = (safeVsPage - 1) * DEFAULT_PAGE_SIZE;
    return filteredRows.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [filteredRows, safeVsPage, maxRows]);
  useEffect(() => { setVsPage(1); }, [filter, marketplaceFilter, dateFrom, dateTo, sortKey, sortDir]);

  const lastChecked = rows.length > 0 && rows[0].last_checked_at
    ? new Date(rows[0].last_checked_at)
    : null;

  const readyToPushRows = actionableRows.filter(r => r.overall_status === 'ready_to_push');
  const uploadNeededRows = actionableRows.filter(r => (r.overall_status === 'settlement_needed' || r.overall_status === 'missing') && !apiSyncedCodes.has(r.marketplace_code));
  const syncNeededRows = actionableRows.filter(r => (r.overall_status === 'settlement_needed' || r.overall_status === 'missing') && apiSyncedCodes.has(r.marketplace_code));

  // ─── Sweep Animation ──────────────────────────────────────────────
  if (sweeping) {
    return (
      <Card className="border-border">
        <CardContent className="py-10 space-y-4">
          <h3 className="text-lg font-semibold text-center">Scanning your data...</h3>
          <div className="max-w-sm mx-auto space-y-3">
            {SWEEP_STEPS.map((step, i) => (
              <div
                key={i}
                className={cn(
                  'flex items-center gap-3 text-sm transition-all duration-500',
                  i < sweepStep ? 'opacity-100' : 'opacity-30'
                )}
                style={{ transitionDelay: `${i * 100}ms` }}
              >
                {i < sweepStep ? (
                  <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                ) : (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground flex-shrink-0" />
                )}
                <span>{step}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ─── Loading ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <div className="grid grid-cols-4 gap-3">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-20" />)}
        </div>
        <Skeleton className="h-64" />
      </div>
    );
  }

  // ─── Empty / All Complete ─────────────────────────────────────────
  if (rows.length === 0) {
    return (
      <Card className="border-border">
        <CardContent className="py-10 text-center space-y-3">
          <Clock className="h-8 w-8 text-muted-foreground mx-auto" />
          <h3 className="text-lg font-semibold">No validation data yet</h3>
          <p className="text-sm text-muted-foreground">
            Connect Shopify and upload settlements to see your validation pipeline.
          </p>
           <Button variant="outline" onClick={handleRefresh} className="mt-2">
             <RefreshCw className="h-4 w-4 mr-2" /> Refresh Status
           </Button>
        </CardContent>
      </Card>
    );
  }

  const allComplete = actionableRows.length > 0 && actionableRows.every(r => r.overall_status === 'complete' || r.overall_status === 'bank_matched' || r.overall_status === 'pushed_to_xero');

  return (
    <div className="space-y-6">
      {/* Header */}
       <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Here's your complete picture</h2>
          {boundaryDate && (() => {
            const boundaryStr = new Date(boundaryDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
            const todayStr = new Date().toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
            // If boundary is today (or very recent with no data), show helpful empty state
            if (boundaryStr === todayStr && actionableRows.length === 0) {
              return (
                <p className="text-sm text-muted-foreground mt-1">
                  Upload your first settlement to see your complete picture
                </p>
              );
            }
            return (
              <p className="text-sm text-muted-foreground mt-1">
                From {boundaryStr} to today
              </p>
            );
          })()}
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {lastChecked && (
            <span>
              Last updated: {formatTimeAgo(lastChecked)}
            </span>
          )}
          <Button variant="ghost" size="sm" onClick={handleRefresh} className="h-7 px-2 gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh Status
          </Button>
        </div>
      </div>

      {/* All-complete banner */}
      {allComplete && (
        <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20">
          <CardContent className="py-6 flex items-center gap-3">
            <PartyPopper className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
            <div>
              <h3 className="font-semibold text-emerald-800 dark:text-emerald-300">Everything is up to date!</h3>
              <p className="text-sm text-emerald-700/80 dark:text-emerald-400/80">
                All settlements reconciled and in Xero. Next check: tomorrow at 6am AEST.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard
          label="Complete"
          count={counts.complete}
          emoji="🟢"
          active={filter === 'complete'}
          onClick={() => setFilter(filter === 'complete' ? 'all' : 'complete')}
          bgClass="bg-emerald-50 dark:bg-emerald-900/20"
          borderClass={filter === 'complete' ? 'border-emerald-400 ring-1 ring-emerald-400' : 'border-emerald-200 dark:border-emerald-800'}
        />
        <SummaryCard
          label="Ready to Push"
          count={counts.ready_to_push}
          emoji="🔵"
          active={filter === 'ready_to_push'}
          onClick={() => setFilter(filter === 'ready_to_push' ? 'all' : 'ready_to_push')}
          bgClass="bg-blue-50 dark:bg-blue-900/20"
          borderClass={filter === 'ready_to_push' ? 'border-blue-400 ring-1 ring-blue-400' : 'border-blue-200 dark:border-blue-800'}
        />
        <SummaryCard
          label="Action Needed"
          count={counts.settlement_needed}
          emoji="🟡"
          active={filter === 'settlement_needed'}
          onClick={() => setFilter(filter === 'settlement_needed' ? 'all' : 'settlement_needed')}
          bgClass="bg-amber-50 dark:bg-amber-900/20"
          borderClass={filter === 'settlement_needed' ? 'border-amber-400 ring-1 ring-amber-400' : 'border-amber-200 dark:border-amber-800'}
        />
        <SummaryCard
          label="Gaps"
          count={counts.gap_detected}
          emoji="🔴"
          active={filter === 'gap_detected'}
          onClick={() => setFilter(filter === 'gap_detected' ? 'all' : 'gap_detected')}
          bgClass="bg-red-50 dark:bg-red-900/20"
          borderClass={filter === 'gap_detected' ? 'border-red-400 ring-1 ring-red-400' : 'border-red-200 dark:border-red-800'}
        />
      </div>

      {/* Filters bar */}
      <div className="flex flex-wrap items-center gap-3">
        {uniqueMarketplaces.length > 1 && (
          <>
            <Filter className="h-4 w-4 text-muted-foreground" />
            <Select value={marketplaceFilter} onValueChange={setMarketplaceFilter}>
              <SelectTrigger className="w-[200px] h-8 text-sm">
                <SelectValue placeholder="All Marketplaces" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Marketplaces</SelectItem>
                {uniqueMarketplaces.map(m => (
                  <SelectItem key={m.code} value={m.code}>{m.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
        <div className="flex items-center gap-1.5">
          <CalendarDays className="h-4 w-4 text-muted-foreground" />
          <Input
            type="date"
            value={dateFrom}
            onChange={e => setDateFrom(e.target.value)}
            className="h-8 w-[140px] text-xs"
            placeholder="From"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={dateTo}
            onChange={e => setDateTo(e.target.value)}
            className="h-8 w-[140px] text-xs"
            placeholder="To"
          />
        </div>
        {(marketplaceFilter !== 'all' || dateFrom || dateTo) && (
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={() => { setMarketplaceFilter('all'); setDateFrom(''); setDateTo(''); }}>
            Clear filters
          </Button>
        )}
      </div>

      <Card className="border-border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <SortableHeader label="Marketplace" sortKey="marketplace_code" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="left" />
                <SortableHeader label="Period" sortKey="period_start" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="left" />
                <SortableHeader label="Orders" sortKey="orders_count" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="center" />
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider">Settlement</th>
                <SortableHeader label="Net Payout" sortKey="settlement_net" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="right" />
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider">Xero</th>
                <th className="text-center px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider">Bank</th>
                <SortableHeader label="Status" sortKey="overall_status" currentKey={sortKey} currentDir={sortDir} onSort={toggleSort} align="center" />
                <th className="text-right px-4 py-2.5 font-medium text-muted-foreground text-xs uppercase tracking-wider">Action</th>
              </tr>
            </thead>
            <tbody>
              {paginatedRows.map((row, idx) => (
                <tr key={row.id} className={cn("transition-colors hover:bg-muted/30", idx % 2 === 1 && "bg-muted/10")}>
                  {/* Marketplace */}
                  <td className="px-4 py-3 font-medium text-foreground">
                    {MARKETPLACE_LABELS[row.marketplace_code] || row.marketplace_code}
                  </td>

                  {/* Period */}
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatPeriod(row.period_start)}
                  </td>

                  {/* Orders */}
                  <td className="px-4 py-3 text-center">
                    {row.orders_found && row.orders_count > 0 ? (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="inline-flex items-center gap-1">
                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                              <span className="text-xs">{row.orders_count} {formatAUD(row.orders_total)}</span>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent>{row.orders_count} orders totalling {formatAUD(row.orders_total)}</TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ) : row.settlement_uploaded ? (
                      <span className="text-xs text-muted-foreground">—</span>
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-muted-foreground mx-auto" />
                    )}
                  </td>

                  {/* Settlement */}
                  <td className="px-4 py-3 text-center">
                    <SettlementCell row={row} />
                  </td>

                  {/* Net Payout */}
                  <td className="px-4 py-3 text-right">
                    {row.settlement_net && row.settlement_net !== 0 ? (
                      <span className="font-semibold text-foreground">{formatAUD(row.settlement_net)}</span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>

                  {/* Xero */}
                  <td className="px-4 py-3 text-center">
                    {row.xero_pushed ? (
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mx-auto" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 text-muted-foreground mx-auto" />
                    )}
                  </td>

                  {/* Bank */}
                  <td className="px-4 py-3 text-center">
                    <BankCell row={row} onConfirmMatch={handleConfirmBankMatch} />
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3 text-center">
                    <StatusPill status={row.overall_status} isApiSynced={apiSyncedCodes.has(row.marketplace_code)} />
                  </td>

                  {/* Action */}
                  <td className="px-4 py-3 text-right">
                    <RowAction
                      row={row}
                      pushing={pushing === row.id}
                      syncing={syncingRow === row.id}
                      isApiSynced={apiSyncedCodes.has(row.marketplace_code)}
                      onUpload={() => onSwitchToUpload?.()}
                      onPush={() => openPushPreview(row)}
                      onSync={async () => {
                        setSyncingRow(row.id);
                        try {
                          const result = await runDirectMarketplaceSync(row.marketplace_code);
                          if (result.success) {
                            toast.success(`Sync triggered for ${MARKETPLACE_LABELS[row.marketplace_code] || row.marketplace_code}`);
                            // First reload after 5s, safety net at 12s
                            setTimeout(() => loadData(), 5000);
                            setTimeout(() => loadData(), 12000);
                          } else {
                            toast.error(result.error || 'Sync failed');
                          }
                        } catch (err: any) {
                          toast.error(err.message || 'Sync failed');
                        } finally {
                          setSyncingRow(null);
                        }
                      }}
                    />
                  </td>
                </tr>
              ))}
              {filteredRows.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-muted-foreground">
                    No records match the selected filter.
                  </td>
                </tr>
              )}
            </tbody>
           </table>
        </div>
        {!maxRows && (
          <TablePaginationBar
            page={safeVsPage}
            totalPages={vsTotalPages}
            totalItems={filteredRows.length}
            pageSize={DEFAULT_PAGE_SIZE}
            onPageChange={setVsPage}
          />
        )}
        {/* View all link when truncated */}
        {maxRows && filteredRows.length > maxRows && (
          <div className="border-t border-border px-4 py-3 text-center">
            <button
              onClick={onViewAll}
              className="text-sm font-medium text-primary hover:underline inline-flex items-center gap-1"
            >
              View all {filteredRows.length} settlements <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </Card>

      {/* Bottom action bar */}
      {(readyToPushRows.length > 0 || uploadNeededRows.length > 0 || syncNeededRows.length > 0) && (
        <Card className="border-border">
          <CardContent className="py-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="space-y-1">
              {readyToPushRows.length > 0 && (
                <p className="text-sm font-medium">
                  {readyToPushRows.length} settlement{readyToPushRows.length > 1 ? 's' : ''} validated and ready for Xero
                </p>
              )}
              {syncNeededRows.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {syncNeededRows.length} API-connected settlement{syncNeededRows.length > 1 ? 's' : ''} can be synced
                </p>
              )}
              {uploadNeededRows.length > 0 && (
                <p className="text-sm text-muted-foreground">
                  {uploadNeededRows.length} marketplace settlement{uploadNeededRows.length > 1 ? 's' : ''} still needed
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {readyToPushRows.length > 0 && (
                <Button size="sm" className="gap-1.5" onClick={openPushAllPreview}>
                  <Send className="h-3.5 w-3.5" /> Push all to Xero
                </Button>
              )}
              {syncNeededRows.length > 0 && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={async () => {
                  const codes = [...new Set(syncNeededRows.map(r => r.marketplace_code))];
                  for (const code of codes) {
                    await runDirectMarketplaceSync(code);
                  }
                  toast.success('Sync triggered for API-connected marketplaces');
                  setTimeout(() => loadData(), 6000);
                  setTimeout(() => loadData(), 14000);
                }}>
                  <RefreshCw className="h-3.5 w-3.5" /> Sync All
                </Button>
              )}
              {uploadNeededRows.length > 0 && onSwitchToUpload && (
                <Button variant="outline" size="sm" className="gap-1.5" onClick={onSwitchToUpload}>
                  <Upload className="h-3.5 w-3.5" /> Go to Smart Upload
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      <PushSafetyPreview
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        onConfirm={executePush}
        settlements={previewSettlements}
      />
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────

function SortableHeader({ label, sortKey: key, currentKey, currentDir, onSort, align = 'left' }: {
  label: string; sortKey: SortKey; currentKey: SortKey; currentDir: SortDir;
  onSort: (key: SortKey) => void; align?: 'left' | 'center' | 'right';
}) {
  const active = currentKey === key;
  const alignClass = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start';
  return (
    <th className={cn("px-4 py-2.5 font-medium text-xs uppercase tracking-wider", `text-${align}`)}>
      <button
        onClick={() => onSort(key)}
        className={cn("inline-flex items-center gap-1 hover:text-foreground transition-colors cursor-pointer", active ? 'text-foreground' : 'text-muted-foreground', alignClass)}
      >
        {label}
        {active ? (
          currentDir === 'asc' ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />
        ) : (
          <ArrowUpDown className="h-3 w-3 opacity-40" />
        )}
      </button>
    </th>
  );
}

function BankCell({ row, onConfirmMatch }: { row: ValidationRow; onConfirmMatch: (row: ValidationRow, txnId: string) => void }) {
  const [checking, setChecking] = React.useState(false);
  const [fuzzyMatch, setFuzzyMatch] = React.useState<{
    date: string | null; amount: number; reference: string; narration: string; transaction_id: string;
  } | null>(null);
  const [fuzzyDiff, setFuzzyDiff] = React.useState<number>(0);

  if (row.bank_matched) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            </span>
          </TooltipTrigger>
          <TooltipContent>
            Auto-matched {row.bank_amount ? formatAUD(row.bank_amount) : ''}{row.bank_reference ? ` — ref: ${row.bank_reference}` : ''}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // If not pushed to Xero at all, show dash
  if (!row.xero_pushed) {
    return <XCircle className="h-3.5 w-3.5 text-muted-foreground mx-auto" />;
  }

  // For synced_external / legacy records without a Xero invoice ID, bank matching isn't applicable
  if (!row.xero_invoice_id) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="text-xs text-muted-foreground">—</span>
          </TooltipTrigger>
          <TooltipContent>Legacy Xero record — bank matching via Xero bank feed</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Check if < 3 days since push — show "Searching..." but with a 30-minute cooldown to prevent constant animation
  if (row.xero_pushed_at) {
    const pushDate = new Date(row.xero_pushed_at);
    const daysSincePush = (Date.now() - pushDate.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSincePush < 3) {
      // Check cooldown — only show animated "Searching" for 30 min after last check
      const cooldownKey = `bank_search_${row.settlement_id}`;
      const lastSearch = sessionStorage.getItem(cooldownKey);
      const cooldownExpired = !lastSearch || (Date.now() - parseInt(lastSearch, 10)) > 30 * 60 * 1000;

      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="inline-flex items-center gap-1">
                {cooldownExpired ? (
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                ) : (
                  <Search className="h-3.5 w-3.5 text-muted-foreground animate-pulse" />
                )}
                <span className="text-[10px] text-muted-foreground">Pending</span>
              </span>
            </TooltipTrigger>
            <TooltipContent>Waiting for bank deposit — usually appears within 3 business days</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
  }

  // Fuzzy match found — show confirmation UI
  if (fuzzyMatch) {
    return (
      <div className="text-left space-y-1">
        <p className="text-[10px] text-muted-foreground">
          Deposit found: {formatAUD(fuzzyMatch.amount)} on {fuzzyMatch.date || '—'}
        </p>
        <p className="text-[10px] text-amber-600 dark:text-amber-400">
          Difference: {formatAUD(fuzzyDiff)}
        </p>
        <div className="flex gap-1">
          <Button
            variant="outline"
            size="sm"
            className="h-5 text-[10px] px-1.5 gap-0.5 border-emerald-300 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400"
            onClick={() => onConfirmMatch(row, fuzzyMatch.transaction_id)}
          >
            <CheckCircle2 className="h-2.5 w-2.5" /> Confirm
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 text-[10px] px-1.5"
            onClick={() => setFuzzyMatch(null)}
          >
            <XCircle className="h-2.5 w-2.5" /> Not this
          </Button>
        </div>
      </div>
    );
  }

  // > 3 days, not found — show "Check bank" button
  const handleCheckBank = async () => {
    setChecking(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(`https://${projectId}.supabase.co/functions/v1/match-bank-deposits`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ settlementId: row.settlement_id }),
      });
      const data = await res.json();
      const result = data?.results?.[0];
      if (result?.matched) {
        toast.success('Bank deposit matched ✅');
      } else if (result?.possible_match) {
        setFuzzyMatch(result.possible_match);
        setFuzzyDiff(result.difference || 0);
      } else {
        toast.info('No bank deposit found yet');
      }
    } catch {
      toast.error('Bank check failed');
    } finally {
      setChecking(false);
    }
  };

  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="ghost" size="sm" className="h-6 text-[10px] px-1.5 gap-1" onClick={handleCheckBank} disabled={checking}>
            {checking ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3.5 w-3.5 text-red-500" />}
            {checking ? 'Checking...' : 'Check bank'}
          </Button>
        </TooltipTrigger>
        <TooltipContent>Not found — click to check bank feed</TooltipContent>
      </Tooltip>
    </TooltipProvider>
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
