/**
 * ActionCentre — The main dashboard landing page.
 * Shows 4 workflow-stage cards, visual pipeline timeline, and activity log.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import {
  RefreshCw, Upload, Send, CheckCircle2, AlertTriangle, Plus,
  ArrowRight, Clock, PartyPopper, Loader2, Search,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import SettlementDetailDrawer from '@/components/shared/SettlementDetailDrawer';
import { triggerValidationSweep, formatAUD, MARKETPLACE_LABELS, GATEWAY_CODES, MARKETPLACE_ALIASES } from '@/utils/settlement-engine';
import { isBankMatchRequired } from '@/constants/settlement-rails';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';


interface ValidationRow {
  id: string;
  marketplace_code: string;
  period_label: string;
  period_start: string;
  period_end: string;
  orders_found: boolean;
  settlement_uploaded: boolean;
  settlement_id: string | null;
  settlement_net: number;
  reconciliation_status: string;
  xero_pushed: boolean;
  bank_matched: boolean;
  overall_status: string;
  last_checked_at: string | null;
}

interface SystemEvent {
  id: string;
  event_type: string;
  marketplace_code: string | null;
  period_label: string | null;
  settlement_id: string | null;
  details: any;
  severity: string;
  created_at: string;
}

export interface MissingSettlement {
  marketplace_code: string;
  marketplace_label: string;
  period_label: string;
  period_start: string;
  period_end: string;
  estimated_amount?: number | null;
}

interface ActionCentreProps {
  onSwitchToUpload: (missing?: MissingSettlement[]) => void;
  onSwitchToSettlements: () => void;
  onSwitchToReconciliation?: () => void;
  userName?: string;
  onPipelineFilter?: (marketplace: string, month: string) => void;
}

// Pipeline stage helpers
const PIPELINE_STAGES = ['S', 'X', 'B', 'R'] as const; // Settlement, Xero, Bank, Reconciled
type PipelineStage = { settlement: boolean; xero: boolean; bank: boolean; reconciled: boolean };

function getPipelineForRow(r: ValidationRow): PipelineStage {
  const hasSettlement = r.settlement_uploaded || r.overall_status === 'ready_to_push' || r.overall_status === 'pushed_to_xero' || r.overall_status === 'synced_external' || r.overall_status === 'complete' || r.overall_status === 'bank_matched';
  const hasXero = r.xero_pushed || r.overall_status === 'pushed_to_xero' || r.overall_status === 'synced_external' || r.overall_status === 'complete' || r.overall_status === 'bank_matched';
  // For settlement-confirmed rails, bank stage is auto-complete once posted to Xero
  const settlementConfirmed = hasXero && !isBankMatchRequired(r.marketplace_code);
  const hasBank = r.bank_matched || r.overall_status === 'complete' || r.overall_status === 'bank_matched' || settlementConfirmed;
  const isReconciled = r.overall_status === 'complete' || r.overall_status === 'bank_matched' || settlementConfirmed;
  return { settlement: hasSettlement, xero: hasXero, bank: hasBank, reconciled: isReconciled };
}

function getPipelineForCell(rows: ValidationRow[]): PipelineStage {
  if (rows.length === 0) return { settlement: false, xero: false, bank: false, reconciled: false };
  // Aggregate: a stage is "done" if ALL rows in the cell have it
  return {
    settlement: rows.every(r => getPipelineForRow(r).settlement),
    xero: rows.every(r => getPipelineForRow(r).xero),
    bank: rows.every(r => getPipelineForRow(r).bank),
    reconciled: rows.every(r => getPipelineForRow(r).reconciled),
  };
}

const EVENT_ICONS: Record<string, { icon: React.ReactNode; color: string }> = {
  settlement_saved: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: 'text-emerald-500' },
  xero_push_success: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: 'text-emerald-500' },
  reconciliation_run: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: 'text-emerald-500' },
  validation_sweep_complete: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: 'text-emerald-500' },
  bank_match_confirmed: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: 'text-emerald-500' },
  bank_match_query: { icon: <Search className="h-3.5 w-3.5" />, color: 'text-blue-500' },
  bank_match_failed: { icon: <AlertTriangle className="h-3.5 w-3.5" />, color: 'text-amber-500' },
  reconciliation_mismatch: { icon: <AlertTriangle className="h-3.5 w-3.5" />, color: 'text-amber-500' },
  xero_push_failed: { icon: <AlertTriangle className="h-3.5 w-3.5" />, color: 'text-red-500' },
  validation_sweep_failed: { icon: <AlertTriangle className="h-3.5 w-3.5" />, color: 'text-red-500' },
  shopify_payout_synced: { icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: 'text-emerald-500' },
  scheduled_sync: { icon: <RefreshCw className="h-3.5 w-3.5" />, color: 'text-blue-500' },
};

export default function ActionCentre({
  onSwitchToUpload,
  onSwitchToSettlements,
  onSwitchToReconciliation,
  userName,
  onPipelineFilter,
}: ActionCentreProps) {
  const [rows, setRows] = useState<ValidationRow[]>([]);
  const [events, setEvents] = useState<SystemEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingUploads, setRefreshingUploads] = useState(false);
  const [userCreatedAt, setUserCreatedAt] = useState<Date | null>(null);
  const [apiSyncedMarketplaces, setApiSyncedMarketplaces] = useState<Set<string>>(new Set());
  const [accountingBoundary, setAccountingBoundary] = useState<string | null>(null);
  const [connectedMarketplaces, setConnectedMarketplaces] = useState<string[]>([]);
  const [lastAutoSync, setLastAutoSync] = useState<Date | null>(null);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [drawerSettlementId, setDrawerSettlementId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [readySettlements, setReadySettlements] = useState<Array<{
    id: string; marketplace: string | null; settlement_id: string;
    period_start: string; period_end: string; bank_deposit: number | null;
    status: string | null; posting_state: string | null;
  }>>([]);
  const [autoPostRails, setAutoPostRails] = useState<Set<string>>(new Set());
  const [autoPostFailed, setAutoPostFailed] = useState<Array<{
    id: string; marketplace: string | null; settlement_id: string;
    period_start: string; period_end: string; bank_deposit: number | null;
    posting_error: string | null;
  }>>([]);
  const [ingestedSettlements, setIngestedSettlements] = useState<Array<{
    id: string; marketplace: string | null; settlement_id: string;
    period_start: string; period_end: string; bank_deposit: number | null;
  }>>([]);

  const handleRefreshUploads = async () => {
    setRefreshingUploads(true);
    await loadData();
    setRefreshingUploads(false);
  };

  const loadData = useCallback(async () => {
    try {
      const [validationRes, eventsRes, userRes, apiSettlementsRes, boundaryRes, connectionsRes, lastSyncRes, readySettlementsRes, ingestedRes, autoPostRailsRes, autoPostFailedRes] = await Promise.all([
        supabase.from('marketplace_validation').select('*').order('marketplace_code').order('period_start', { ascending: false }),
        supabase.from('system_events').select('*').order('created_at', { ascending: false }).limit(5),
        supabase.auth.getUser(),
        supabase.from('settlements').select('marketplace').eq('source', 'api'),
        supabase.from('app_settings').select('value').eq('key', 'accounting_boundary_date').maybeSingle(),
        supabase.from('marketplace_connections').select('marketplace_code').order('created_at'),
        supabase.from('sync_history').select('created_at').eq('event_type', 'scheduled_sync').order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('settlements')
          .select('id, marketplace, settlement_id, period_start, period_end, bank_deposit, status, posting_state')
          .eq('status', 'ready_to_push')
          .eq('is_hidden', false)
          .eq('is_pre_boundary', false)
          .is('duplicate_of_settlement_id', null)
          .order('marketplace')
          .order('period_start', { ascending: false }),
        supabase.from('settlements')
          .select('id, marketplace, settlement_id, period_start, period_end, bank_deposit')
          .eq('status', 'ingested')
          .eq('is_hidden', false)
          .eq('is_pre_boundary', false)
          .is('duplicate_of_settlement_id', null)
          .order('period_start', { ascending: false }),
        supabase.from('rail_posting_settings')
          .select('rail')
          .eq('posting_mode', 'auto'),
        supabase.from('settlements')
          .select('id, marketplace, settlement_id, period_start, period_end, bank_deposit, posting_error')
          .eq('posting_state', 'failed')
          .eq('is_hidden', false)
          .order('period_start', { ascending: false }),
      ]);

      if (validationRes.data) setRows(validationRes.data as ValidationRow[]);
      if (eventsRes.data) setEvents(eventsRes.data as SystemEvent[]);
      if (userRes.data?.user?.created_at) setUserCreatedAt(new Date(userRes.data.user.created_at));
      if (apiSettlementsRes.data) {
        setApiSyncedMarketplaces(new Set(apiSettlementsRes.data.map((s: any) => s.marketplace)));
      }
      if (boundaryRes.data?.value) {
        setAccountingBoundary(boundaryRes.data.value);
      } else if (userRes.data?.user?.created_at) {
        setAccountingBoundary(userRes.data.user.created_at.substring(0, 10));
      }
      if (connectionsRes.data) {
        setConnectedMarketplaces(connectionsRes.data.map((c: any) => c.marketplace_code));
      }
      if (lastSyncRes.data?.created_at) {
        setLastAutoSync(new Date(lastSyncRes.data.created_at));
      }
      if (readySettlementsRes.data) {
        setReadySettlements(readySettlementsRes.data as any);
      }
      if (ingestedRes.data) {
        setIngestedSettlements(ingestedRes.data as any);
      }
      if (autoPostRailsRes.data) {
        setAutoPostRails(new Set(autoPostRailsRes.data.map((r: any) => r.rail)));
      }
      if (autoPostFailedRes.data) {
        setAutoPostFailed(autoPostFailedRes.data as any);
      }
    } catch (err) {
      console.error('ActionCentre load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);



  useEffect(() => { loadData(); }, [loadData]);

  // Debounced realtime — prevent flickering during rapid sync updates
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const debouncedLoadData = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => loadData(), 2000);
  }, [loadData]);

  useEffect(() => {
    const channel = supabase
      .channel('action-centre-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'marketplace_validation' }, () => debouncedLoadData())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements' }, () => debouncedLoadData())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'system_events' }, () => debouncedLoadData())
      .subscribe();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [debouncedLoadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await triggerValidationSweep();
      toast.success('Status refresh started');
      setTimeout(() => loadData(), 3000);
    } catch {
      toast.error('Sweep failed');
    } finally {
      setRefreshing(false);
    }
  };

  // ─── Computed ──────────────────────────────────────────────────────

  // Normalise alias codes (e.g. 'ebay' → 'ebay_au') and deduplicate
  const normalisedRows = useMemo(() => {
    const seen = new Map<string, ValidationRow>();
    for (const r of rows) {
      const code = MARKETPLACE_ALIASES[r.marketplace_code] || r.marketplace_code;
      // Skip gateway codes — they're not settlement sources
      if (GATEWAY_CODES.has(code)) continue;
      const key = `${code}_${r.period_start}`;
      const existing = seen.get(key);
      if (!existing || (r.settlement_net || 0) > (existing.settlement_net || 0)) {
        seen.set(key, { ...r, marketplace_code: code });
      }
    }
    return Array.from(seen.values());
  }, [rows]);

  const now = new Date();

  const uploadNeeded = normalisedRows.filter(r => r.overall_status === 'settlement_needed' || r.overall_status === 'missing');
  // Filter out API-synced marketplaces, only show for closed months, AND only if no settlement exists
  const uploadNeededManual = uploadNeeded.filter(r => {
    if (apiSyncedMarketplaces.has(r.marketplace_code)) return false;
    if (r.settlement_uploaded || r.settlement_id) return false; // settlement already exists
    const periodEnd = new Date(r.period_end);
    return periodEnd < now; // only show if period already ended
  });
  // Settlement-native "Send to Xero" — one row per real payout from settlements table
  // Filter out settlements on auto-post rails (they post automatically)
  const readyToPush = useMemo(() => {
    return readySettlements
      .filter(s => {
        const code = MARKETPLACE_ALIASES[s.marketplace || ''] || s.marketplace || 'unknown';
        // Exclude auto-post rails from manual "Send to Xero" card
        if (autoPostRails.has(code) || autoPostRails.has(s.marketplace || '')) return false;
        // Exclude settlements already queued/posting
        if (s.posting_state === 'posting' || s.posting_state === 'posted' || s.posting_state === 'queued') return false;
        return true;
      })
      .map(s => ({
        id: s.id,
        marketplace_code: MARKETPLACE_ALIASES[s.marketplace || ''] || s.marketplace || 'unknown',
        period_label: `${s.period_start} to ${s.period_end}`,
        period_start: s.period_start,
        period_end: s.period_end,
        orders_found: false,
        settlement_uploaded: true,
        settlement_id: s.settlement_id,
        settlement_net: s.bank_deposit || 0,
        reconciliation_status: 'matched',
        xero_pushed: false,
        bank_matched: false,
        overall_status: 'ready_to_push',
        last_checked_at: null,
      } as ValidationRow));
  }, [readySettlements, autoPostRails]);
  // Only show rows backed by a real settlement — exclude synthetic/pre-boundary rows
  // Rail payout mode: rails with bank_match_required=false skip "waiting for payout"
  const postedRows = normalisedRows.filter(r =>
    r.settlement_id &&
    r.overall_status !== 'already_recorded' &&
    (r.overall_status === 'pushed_to_xero' || r.overall_status === 'synced_external' || (r.xero_pushed && !r.bank_matched))
  );
  const awaitingBank = postedRows.filter(r => isBankMatchRequired(r.marketplace_code));
  // Settlement-confirmed rails (no bank match needed) are treated as complete once posted
  const settlementConfirmed = postedRows.filter(r => !isBankMatchRequired(r.marketplace_code));
  const complete = [
    ...normalisedRows.filter(r => r.overall_status === 'complete' || r.overall_status === 'bank_matched'),
    ...settlementConfirmed,
  ];
  const gapDetected = normalisedRows.filter(r => r.overall_status === 'gap_detected');
  const allComplete = rows.length > 0 && uploadNeededManual.length === 0 && readyToPush.length === 0 && awaitingBank.length === 0 && gapDetected.length === 0 && (complete.length > 0);

  // Build a lookup of last known settlement amount per marketplace
  const lastKnownAmounts = useMemo(() => {
    const amounts: Record<string, number> = {};
    for (const r of rows) {
      if (r.settlement_net && r.settlement_net > 0 && !amounts[r.marketplace_code]) {
        amounts[r.marketplace_code] = r.settlement_net;
      }
    }
    return amounts;
  }, [rows]);

  const buildMissingList = useCallback((): MissingSettlement[] => {
    return uploadNeededManual.map(r => ({
      marketplace_code: r.marketplace_code,
      marketplace_label: MARKETPLACE_LABELS[r.marketplace_code] || r.marketplace_code,
      period_label: r.period_label,
      period_start: r.period_start,
      period_end: r.period_end,
      estimated_amount: lastKnownAmounts[r.marketplace_code] || null,
    }));
  }, [uploadNeededManual, lastKnownAmounts]);

  const lastChecked = rows.length > 0 && rows[0].last_checked_at
    ? new Date(rows[0].last_checked_at) : null;

  // 3-month timeline
  const timelineData = useMemo(() => {
    const months: string[] = [];
    for (let i = 2; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    // Combine marketplaces from validation rows AND connected marketplaces
    const allMps = new Set<string>();
    for (const r of normalisedRows) allMps.add(r.marketplace_code);
    for (const c of connectedMarketplaces) {
      const code = MARKETPLACE_ALIASES[c] || c;
      if (!GATEWAY_CODES.has(code)) allMps.add(code);
    }
    const marketplaces = [...allMps].sort();

    return { months, marketplaces };
  }, [normalisedRows, connectedMarketplaces]);

  const getRowsForCell = (marketplace: string, monthKey: string): ValidationRow[] => {
    return normalisedRows.filter(r => {
      const rowMonth = r.period_start?.substring(0, 7);
      return r.marketplace_code === marketplace && rowMonth === monthKey;
    });
  };

  const isCellPreBoundary = (monthKey: string): boolean => {
    if (!accountingBoundary) return false;
    const boundaryMonth = accountingBoundary.substring(0, 7);
    return monthKey < boundaryMonth;
  };

  const formatMonthLabel = (key: string): string => {
    const [, m] = key.split('-').map(Number);
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return `${months[(m || 1) - 1]} ${key.substring(0, 4)}`;
  };

  // Greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const currentMonth = new Date().toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-96" />
        <div className="grid grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-40" />)}
        </div>
        <Skeleton className="h-48" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Greeting header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">
            {greeting}{userName ? `, ${userName}` : ''}.
          </h2>
          <p className="text-muted-foreground mt-1">
            Here's your accounting health — {currentMonth}
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {lastAutoSync && (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              Auto-sync {formatTimeAgo(lastAutoSync)}
            </span>
          )}
          {lastChecked && <span>Updated {formatTimeAgo(lastChecked)}</span>}
        </div>
      </div>

      {/* All-complete banner OR 4 workflow cards */}
      {allComplete ? (
        <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20">
          <CardContent className="py-8 text-center space-y-2">
            <PartyPopper className="h-8 w-8 text-emerald-600 dark:text-emerald-400 mx-auto" />
            <h3 className="text-lg font-semibold text-emerald-800 dark:text-emerald-300">
              All settlements reconciled for {currentMonth}
            </h3>
            <p className="text-sm text-emerald-700/80 dark:text-emerald-400/80">
              Everything is matched and in Xero.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Card 1 — Needs Upload (only closed months) */}
          {uploadNeededManual.length > 0 && (
            <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10">
              <CardContent className="py-5 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400 inline-block" />
                    <h3 className="font-semibold text-sm">Needs Upload</h3>
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-6 w-6 text-muted-foreground hover:text-foreground"
                    disabled={refreshingUploads}
                    onClick={handleRefreshUploads}
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", refreshingUploads && "animate-spin")} />
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {refreshingUploads ? 'Checking...' : `${uploadNeededManual.length} missing settlement${uploadNeededManual.length > 1 ? 's' : ''} from closed periods`}
                </p>
                <ul className="space-y-1">
                  {uploadNeededManual.map(r => (
                    <li key={r.id} className="text-xs flex items-center gap-1.5">
                      <span className="text-amber-400">•</span>
                      {MARKETPLACE_LABELS[r.marketplace_code] || r.marketplace_code} — {formatPeriod(r.period_start)}
                    </li>
                  ))}
                </ul>
                <Button size="sm" variant="outline" className="w-full h-8 text-xs gap-1 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400" onClick={() => {
                  onSwitchToUpload(buildMissingList());
                }}>
                  <Upload className="h-3 w-3" /> Upload now
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Card 2 — Ready to Post */}
          {readyToPush.length > 0 && (() => {
            const totalAmount = readyToPush.reduce((sum, r) => sum + (r.settlement_net || 0), 0);
            return (
            <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10">
              <CardContent className="py-5 space-y-3">
                <div className="flex items-center gap-2">
                   <span className="h-2.5 w-2.5 rounded-full bg-blue-400 inline-block" />
                   <h3 className="font-semibold text-sm">Send to Xero</h3>
                 </div>
                 <p className="text-[10px] text-muted-foreground/70 -mt-1">Not yet posted</p>
                 <div>
                   <p className="text-lg font-bold text-foreground">{formatAUD(totalAmount)} <span className="text-xs font-normal text-muted-foreground">ready to send</span></p>
                  <p className="text-xs text-muted-foreground">{readyToPush.length} settlement{readyToPush.length > 1 ? 's' : ''}</p>
                </div>
                <ul className="space-y-1">
                  {(expandedCards['ready'] ? readyToPush : readyToPush.slice(0, 3)).map(r => (
                    <li key={r.id} className="text-xs flex items-center gap-1.5 cursor-pointer hover:bg-muted/40 rounded px-1 -mx-1 py-0.5" onClick={() => { setDrawerSettlementId(r.settlement_id); setDrawerOpen(true); }}>
                      <span className="text-blue-400">•</span>
                      {MARKETPLACE_LABELS[r.marketplace_code] || r.marketplace_code} — {formatPeriodShort(r.period_start, r.period_end)}
                      {r.settlement_net ? ` — ${formatAUD(r.settlement_net)}` : ''}
                    </li>
                  ))}
                  {readyToPush.length > 3 && (
                    <li>
                      <button onClick={() => setExpandedCards(prev => ({ ...prev, ready: !prev.ready }))} className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                        {expandedCards['ready'] ? '− Show less' : `+ ${readyToPush.length - 3} more`}
                      </button>
                    </li>
                  )}
                </ul>
                <Button size="sm" className="w-full h-8 text-xs gap-1" onClick={onSwitchToSettlements}>
                   <Send className="h-3 w-3" /> Send all to Xero
                 </Button>
              </CardContent>
            </Card>
            );
          })()}

          {/* Card 2b — Uploaded, needs review */}
          {ingestedSettlements.length > 0 && (
            <Card className="border-muted bg-muted/30">
              <CardContent className="py-5 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/40 inline-block" />
                  <h3 className="font-semibold text-sm">Uploaded — needs review</h3>
                </div>
                <p className="text-xs text-muted-foreground">
                  {ingestedSettlements.length} settlement{ingestedSettlements.length > 1 ? 's' : ''} uploaded but not yet validated for posting.
                </p>
                <Button size="sm" variant="outline" className="w-full h-8 text-xs gap-1" onClick={onSwitchToSettlements}>
                  <Search className="h-3 w-3" /> Review in Settlement Matching
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Card 2c — Auto-post failed */}
          {autoPostFailed.length > 0 && (
            <Card className="border-destructive/30 bg-destructive/5">
              <CardContent className="py-5 space-y-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive" />
                  <h3 className="font-semibold text-sm">Auto-post Failed</h3>
                </div>
                <p className="text-xs text-muted-foreground">
                  {autoPostFailed.length} settlement{autoPostFailed.length > 1 ? 's' : ''} failed to auto-post.
                </p>
                <ul className="space-y-1">
                  {autoPostFailed.slice(0, 3).map(s => (
                    <li key={s.id} className="text-xs flex items-center gap-1.5">
                      <span className="text-destructive">•</span>
                      {MARKETPLACE_LABELS[s.marketplace || ''] || s.marketplace} — {formatPeriodShort(s.period_start, s.period_end)}
                    </li>
                  ))}
                  {autoPostFailed.length > 3 && (
                    <li className="text-xs text-muted-foreground">+ {autoPostFailed.length - 3} more</li>
                  )}
                </ul>
                <p className="text-[10px] text-muted-foreground">
                  Review and retry in Settings → Rail Posting Mode
                </p>
              </CardContent>
            </Card>
          )}

          {/* Card 3 — Posted — Awaiting Deposit */}
          {awaitingBank.length > 0 && (() => {
            const grouped = groupByMarketplaceMonth(awaitingBank);
            return (
            <Card className="border-amber-300 dark:border-amber-700 bg-amber-50/60 dark:bg-amber-900/20">
              <CardContent className="py-5 space-y-3">
                 <div className="flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400 inline-block" />
                    <h3 className="font-semibold text-sm">Waiting for Payout</h3>
                  </div>
                  <p className="text-[10px] text-muted-foreground/70 -mt-1">Posted, awaiting destination match</p>
                  <div>
                    <p className="text-lg font-bold text-foreground">{formatAUD(awaitingBank.reduce((sum, r) => sum + (r.settlement_net || 0), 0))} <span className="text-xs font-normal text-muted-foreground">awaiting payout</span></p>
                    <p className="text-xs text-muted-foreground">{awaitingBank.length} settlement{awaitingBank.length > 1 ? 's' : ''} posted to Xero</p>
                    {(() => {
                      const oldestDate = awaitingBank.reduce((oldest, r) => {
                        const d = new Date(r.period_end);
                        return !oldest || d < oldest ? d : oldest;
                      }, null as Date | null);
                      if (!oldestDate) return null;
                      const daysWaiting = Math.floor((Date.now() - oldestDate.getTime()) / 86400000);
                      return (
                        <p className={cn("text-[10px] mt-0.5", daysWaiting > 7 ? "text-amber-600 dark:text-amber-400 font-medium" : "text-muted-foreground")}>
                          Oldest waiting: {daysWaiting} day{daysWaiting !== 1 ? 's' : ''}
                          {daysWaiting > 7 && ' ⚠'}
                        </p>
                      );
                    })()}
                </div>
                <ul className="space-y-1">
                  {(expandedCards['bank'] ? grouped : grouped.slice(0, 3)).map(g => (
                    <li key={g.key} className="text-xs flex items-center gap-1.5">
                      <span className="text-muted-foreground">•</span>
                      <span>{g.label}</span>
                      {g.count > 1 ? (
                        <span className="text-muted-foreground">· {g.count} settlements{g.total ? ` · ${formatAUD(g.total)}` : ''}</span>
                      ) : g.total ? (
                        <span className="text-muted-foreground">· {formatAUD(g.total)}</span>
                      ) : null}
                    </li>
                  ))}
                  {grouped.length > 3 && (
                    <li>
                      <button onClick={() => setExpandedCards(prev => ({ ...prev, bank: !prev.bank }))} className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                        {expandedCards['bank'] ? '− Show less' : `+ ${grouped.length - 3} more`}
                      </button>
                    </li>
                  )}
                </ul>
                <p className="text-[10px] text-muted-foreground italic">
                   This is normal — marketplace payouts typically arrive within 1–3 business days.
                 </p>
              </CardContent>
            </Card>
            );
          })()}

          {/* Card 4 — Fully Reconciled */}
          {complete.length > 0 && (() => {
            const grouped = groupByMarketplaceMonth(complete);
            return (
            <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10">
              <CardContent className="py-5 space-y-3">
                <div className="flex items-center gap-2">
                   <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                   <h3 className="font-semibold text-sm">All Good</h3>
                 </div>
                 <p className="text-[10px] text-muted-foreground/70 -mt-1">Verified payouts</p>
                <p className="text-xs text-muted-foreground">
                  {complete.length} settlement{complete.length > 1 ? 's' : ''} matched
                </p>
                <ul className="space-y-1">
                  {(expandedCards['complete'] ? grouped : grouped.slice(0, 3)).map(g => (
                    <li key={g.key} className="text-xs flex items-center gap-1.5">
                      <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      <span>{g.label}</span>
                      {g.count > 1 && (
                        <span className="text-muted-foreground">· {g.count} settlements{g.total ? ` · ${formatAUD(g.total)}` : ''}</span>
                      )}
                    </li>
                  ))}
                  {grouped.length > 3 && (
                    <li>
                      <button onClick={() => setExpandedCards(prev => ({ ...prev, complete: !prev.complete }))} className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                        {expandedCards['complete'] ? '− Show less' : `+ ${grouped.length - 3} more`}
                      </button>
                    </li>
                  )}
                </ul>
              </CardContent>
            </Card>
            );
          })()}
        </div>
      )}

      {/* Visual Pipeline Timeline */}
      {timelineData.marketplaces.length > 0 && (
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Settlement pipeline</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                   <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground w-40">
                     <TooltipProvider>
                       <Tooltip>
                         <TooltipTrigger asChild>
                           <span className="cursor-help border-b border-dotted border-muted-foreground/40">Rail</span>
                         </TooltipTrigger>
                         <TooltipContent className="text-xs max-w-[220px]">Payout rail — the source that generates settlement payouts (Amazon AU, Shopify Payments, PayPal, etc.)</TooltipContent>
                       </Tooltip>
                     </TooltipProvider>
                   </th>
                  {timelineData.months.map(m => (
                    <th key={m} className="text-center py-2 px-3 text-xs font-medium text-muted-foreground">
                      {formatMonthLabel(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {timelineData.marketplaces.map(mp => (
                  <tr key={mp} className="hover:bg-muted/20 transition-colors">
                    <td className="py-2.5 pr-4 font-medium text-foreground text-xs">
                      {MARKETPLACE_LABELS[mp] || mp}
                    </td>
                    {timelineData.months.map(m => {
                      if (isCellPreBoundary(m)) {
                        return (
                          <td key={m} className="text-center py-2.5 px-3">
                            <TooltipProvider>
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <span className="text-[10px] text-muted-foreground/50 cursor-default">—</span>
                                </TooltipTrigger>
                                <TooltipContent className="text-xs">Before accounting boundary — not tracked</TooltipContent>
                              </Tooltip>
                            </TooltipProvider>
                          </td>
                        );
                      }
                      const cellRows = getRowsForCell(mp, m);
                      if (cellRows.length === 0) {
                        return (
                          <td key={m} className="text-center py-2.5 px-3">
                            <span className="text-[10px] text-muted-foreground/40">—</span>
                          </td>
                        );
                      }
                      const pipeline = getPipelineForCell(cellRows);
                      const stageEntries: { key: string; label: string; done: boolean }[] = [
                        { key: 'S', label: 'Settlement uploaded', done: pipeline.settlement },
                         { key: 'X', label: 'Sent to Xero', done: pipeline.xero },
                         { key: 'B', label: 'Destination deposit matched', done: pipeline.bank },
                         { key: 'R', label: 'Fully reconciled', done: pipeline.reconciled },
                      ];
                      return (
                        <td key={m} className="text-center py-2.5 px-3">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  className="inline-flex items-center gap-1 cursor-pointer hover:scale-110 transition-transform rounded-md p-1 hover:bg-muted/40"
                                  onClick={() => onPipelineFilter?.(mp, m)}
                                >
                                  {stageEntries.map(s => (
                                    <span
                                      key={s.key}
                                      className={cn(
                                        "h-2.5 w-2.5 rounded-full inline-block transition-colors",
                                        s.done ? "bg-emerald-500" : "bg-muted-foreground/20"
                                      )}
                                    />
                                  ))}
                                </button>
                              </TooltipTrigger>
                              <TooltipContent className="text-xs space-y-0.5">
                                {stageEntries.map(s => (
                                  <div key={s.key} className="flex items-center gap-1.5">
                                    <span className={s.done ? 'text-emerald-500' : 'text-muted-foreground'}>
                                      {s.done ? '✓' : '○'}
                                    </span>
                                    <span>{s.label}</span>
                                  </div>
                                ))}
                                <div className="text-muted-foreground pt-1 border-t border-border mt-1">
                                  {cellRows.length} settlement{cellRows.length > 1 ? 's' : ''}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 mt-3 pt-3 border-t border-border text-xs text-muted-foreground">
              <span className="font-medium text-foreground/70">Rail stages:</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500 inline-block" /> Settlement</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500 inline-block" /> Xero</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500 inline-block" /> Destination feed</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500 inline-block" /> Reconciled</span>
              <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/20 inline-block" /> Not yet</span>
              <span className="flex items-center gap-1.5"><span className="text-muted-foreground/50">—</span> Pre-boundary</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Activity log */}
      {events.length > 0 && (
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Issues & recent actions</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {groupActivityEvents(events).map((item, idx) => {
                 const cfg = EVENT_ICONS[item.event_type] || { icon: <Clock className="h-3.5 w-3.5" />, color: 'text-muted-foreground' };
                 const isActionable = item.event_type === 'bank_match_failed' || item.event_type === 'xero_push_failed' || item.event_type === 'reconciliation_mismatch';
                 return (
                   <div key={idx} className="flex items-center gap-2.5 text-xs">
                     <span className={cfg.color}>{cfg.icon}</span>
                     <span className="text-foreground flex-1">
                       {item.label}
                       {item.count > 1 && (
                         <span className="text-muted-foreground ml-1">({item.count} periods)</span>
                       )}
                     </span>
                     {isActionable && (
                       <Button
                         variant="ghost"
                         size="sm"
                         className="h-6 px-2 text-[10px] text-primary hover:text-primary"
                         onClick={() => {
                           if (item.event_type === 'bank_match_failed' && onSwitchToReconciliation) onSwitchToReconciliation();
                           else if (item.event_type === 'xero_push_failed') onSwitchToSettlements();
                           else if (item.event_type === 'reconciliation_mismatch' && onSwitchToReconciliation) onSwitchToReconciliation();
                         }}
                       >
                         {item.event_type === 'bank_match_failed' ? 'Sync feed →' : item.event_type === 'xero_push_failed' ? 'Retry →' : 'View →'}
                       </Button>
                     )}
                     <span className="text-muted-foreground flex-shrink-0">
                       {formatTimeAgo(new Date(item.created_at))}
                     </span>
                   </div>
                 );
               })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Quick link to Reconciliation Hub */}
      {(awaitingBank.length > 0 || gapDetected.length > 0) && onSwitchToReconciliation && (
        <Card className="border-border">
          <CardContent className="py-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Search className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm text-foreground">Review reconciliation issues in detail</span>
            </div>
            <Button variant="outline" size="sm" className="text-xs gap-1" onClick={onSwitchToReconciliation}>
              Open Reconciliation Hub <ArrowRight className="h-3 w-3" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Floating upload button — secondary style, dashboard is read-only feeling */}
      <div className="fixed bottom-6 right-6 z-40">
        <Button
          variant="outline"
          onClick={() => onSwitchToUpload()}
          className="h-10 px-4 gap-2 shadow-md rounded-full bg-background/90 backdrop-blur-sm text-xs"
        >
          <Plus className="h-3.5 w-3.5" /> Upload settlement
        </Button>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatPeriod(dateStr: string): string {
  if (!dateStr || dateStr.length < 10) return dateStr;
  const [y, m] = dateStr.split('-').map(Number);
  if (!y || !m || m < 1 || m > 12) return dateStr;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${months[m - 1]} ${y}`;
}

function formatPeriodShort(dateStr: string, endDateStr?: string): string {
  if (!dateStr || dateStr.length < 10) return dateStr;
  const [, m, d] = dateStr.split('-').map(Number);
  if (!m || !d || m < 1 || m > 12) return dateStr;
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  if (endDateStr && endDateStr.length >= 10) {
    const [, em, ed] = endDateStr.split('-').map(Number);
    if (em === m && ed !== d) return `${months[m - 1]} ${d}–${ed}`;
    if (em !== m) return `${months[m - 1]} ${d}–${months[(em || 1) - 1]} ${ed}`;
  }
  return `${months[m - 1]} ${d}`;
}

interface GroupedRow {
  key: string;
  label: string;
  count: number;
  total: number;
}

function groupByMarketplaceMonth(rows: ValidationRow[]): GroupedRow[] {
  const map = new Map<string, GroupedRow>();
  for (const r of rows) {
    const monthLabel = formatPeriod(r.period_start);
    const mpLabel = MARKETPLACE_LABELS[r.marketplace_code] || r.marketplace_code;
    const key = `${r.marketplace_code}_${monthLabel}`;
    const existing = map.get(key);
    if (existing) {
      existing.count++;
      existing.total += (r.settlement_net || 0);
    } else {
      map.set(key, {
        key,
        label: `${mpLabel} — ${monthLabel}`,
        count: 1,
        total: r.settlement_net || 0,
      });
    }
  }
  return Array.from(map.values());
}

interface GroupedEvent {
  event_type: string;
  label: string;
  count: number;
  created_at: string;
}

function groupActivityEvents(events: SystemEvent[]): GroupedEvent[] {
  const result: GroupedEvent[] = [];
  const groupable = new Map<string, { events: SystemEvent[]; latestAt: string }>();

  for (const e of events) {
    // Group repeated same-type events by event_type + marketplace
    const groupKey = `${e.event_type}:${e.marketplace_code || ''}`;
    const existing = groupable.get(groupKey);
    if (existing) {
      existing.events.push(e);
      if (e.created_at > existing.latestAt) existing.latestAt = e.created_at;
    } else {
      groupable.set(groupKey, { events: [e], latestAt: e.created_at });
    }
  }

  for (const [, group] of groupable) {
    const first = group.events[0];
    if (group.events.length === 1) {
      result.push({
        event_type: first.event_type,
        label: formatEventLabel(first),
        count: 1,
        created_at: group.latestAt,
      });
    } else {
      // Use a summary label for the group
      const mp = first.marketplace_code ? (MARKETPLACE_LABELS[first.marketplace_code] || first.marketplace_code) : '';
      const baseLabel = first.event_type === 'bank_match_failed'
        ? `Destination feed not synced yet: ${mp}`
        : first.event_type === 'bank_match_confirmed'
        ? `Destination deposit matched: ${mp}`
        : formatEventLabel(first);
      result.push({
        event_type: first.event_type,
        label: baseLabel,
        count: group.events.length,
        created_at: group.latestAt,
      });
    }
  }

  // Sort by most recent first
  result.sort((a, b) => b.created_at.localeCompare(a.created_at));
  return result;
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

function formatEventLabel(event: SystemEvent): string {
  const mp = event.marketplace_code ? (MARKETPLACE_LABELS[event.marketplace_code] || event.marketplace_code) : '';
  const period = event.period_label || '';

  switch (event.event_type) {
    case 'validation_sweep_complete': {
      const checked = event.details?.marketplaces_checked;
      const ready = event.details?.ready_to_push;
      const parts: string[] = ['Status refresh completed'];
      if (checked) parts[0] += ` — ${checked} marketplaces checked`;
      if (ready) parts.push(`${ready} ready to push`);
      return parts.join(', ');
    }
    case 'settlement_saved': return `Settlement saved: ${mp} ${period}`;
    case 'xero_push_success': return `Pushed to Xero: ${mp} ${period}`;
    case 'xero_push_failed': return `Xero push failed: ${mp} ${period}`;
    case 'reconciliation_run': return `Reconciliation completed: ${mp} ${period}`;
    case 'bank_match_confirmed': return `Destination deposit matched: ${mp} ${period}`;
    case 'bank_match_failed': return `Destination feed not synced yet: ${mp} ${period}`;
    case 'bank_match_query': {
      const count = event.details?.txns_returned;
      return `Destination feed queried: ${mp} — ${count ?? 0} transactions found`;
    }
    case 'reconciliation_mismatch': {
      const diff = event.details?.difference;
      return `Reconciliation gap${diff ? `: ${formatAUD(diff)}` : ''} ${mp}`;
    }
    case 'shopify_payout_synced': return `Shopify payout synced: ${period}`;
    case 'scheduled_sync': return 'Auto-sync completed';
    default: return event.event_type.replace(/_/g, ' ');
  }
}
