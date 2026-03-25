/**
 * ActionCentre — Simplified daily dashboard.
 * Three sections: API Sync Status, Manual Uploads Needed, Ready to Push to Xero.
 */

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { logger } from '@/utils/logger';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Skeleton } from '@/components/ui/skeleton';
import {
  RefreshCw, Upload, Send, CheckCircle2, AlertTriangle,
  Clock, PartyPopper, Search, ShieldAlert,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import SettlementDetailDrawer from '@/components/shared/SettlementDetailDrawer';
import InlineUploadDialog from '@/components/admin/accounting/InlineUploadDialog';
import { triggerValidationSweep, formatAUD, MARKETPLACE_LABELS, GATEWAY_CODES, MARKETPLACE_ALIASES } from '@/utils/settlement-engine';
import { isBankMatchRequired } from '@/constants/settlement-rails';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

import { useSyncStatus } from '@/hooks/useSyncStatus';
import { useApiSyncedCodes } from '@/hooks/useApiSyncedCodes';


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
  onSwitchToSettlements: (filter?: string) => void;
  onSwitchToReconciliation?: () => void;
  userName?: string;
  
}




export default function ActionCentre({
  onSwitchToUpload,
  onSwitchToSettlements,
  onSwitchToReconciliation,
  userName,
  
}: ActionCentreProps) {
  const [rows, setRows] = useState<ValidationRow[]>([]);
  const [events, setEvents] = useState<SystemEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshingUploads, setRefreshingUploads] = useState(false);
  const [userCreatedAt, setUserCreatedAt] = useState<Date | null>(null);
  const [accountingBoundary, setAccountingBoundary] = useState<string | null>(null);
  const [connectedMarketplaces, setConnectedMarketplaces] = useState<string[]>([]);
  const { apiSyncedCodes: connectedApiMarketplaces } = useApiSyncedCodes();
  const [lastAutoSync, setLastAutoSync] = useState<Date | null>(null);
  const [xeroConnected, setXeroConnected] = useState(false);
  const [expandedCards, setExpandedCards] = useState<Record<string, boolean>>({});
  const [drawerSettlementId, setDrawerSettlementId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [autoPostRails, setAutoPostRails] = useState<Set<string>>(new Set());
  const [uploadDialogRow, setUploadDialogRow] = useState<{ marketplace_code: string; period_label: string; period_start: string; period_end: string } | null>(null);
  const [autoPostFailed, setAutoPostFailed] = useState<Array<{
    id: string; marketplace: string | null; settlement_id: string;
    period_start: string; period_end: string; bank_deposit: number | null;
    posting_error: string | null;
  }>>([]);
  const [externalMatchIds, setExternalMatchIds] = useState<Set<string>>(new Set());
  const { xero: xeroSync, marketplaces: syncedIntegrations, loading: syncStatusLoading } = useSyncStatus();

  const handleRefreshUploads = async () => {
    setRefreshingUploads(true);
    await loadData();
    setRefreshingUploads(false);
  };

  const loadData = useCallback(async () => {
    try {
      const [validationRes, eventsRes, userRes, boundaryRes, connectionsRes, lastSyncRes, autoPostRailsRes, autoPostFailedRes, xeroRes] = await Promise.all([
        supabase.from('marketplace_validation').select('*').order('marketplace_code').order('period_start', { ascending: false }),
        supabase.from('system_events').select('*').order('created_at', { ascending: false }).limit(5),
        supabase.auth.getUser(),
        supabase.from('app_settings').select('value').eq('key', 'accounting_boundary_date').maybeSingle(),
        supabase.from('marketplace_connections').select('marketplace_code, connection_type').in('connection_status', ['active', 'connected']).order('created_at'),
        supabase.from('sync_history').select('created_at').eq('event_type', 'scheduled_sync').order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('rail_posting_settings')
          .select('rail')
          .eq('posting_mode', 'auto'),
        supabase.from('settlements')
          .select('id, marketplace, settlement_id, period_start, period_end, bank_deposit, posting_error')
          .eq('posting_state', 'failed')
          .eq('is_hidden', false)
          .order('period_start', { ascending: false }),
        supabase.from('xero_tokens').select('id').limit(1),
      ]);

      if (validationRes.data) setRows(validationRes.data as ValidationRow[]);
      if (eventsRes.data) setEvents(eventsRes.data as SystemEvent[]);
      if (userRes.data?.user?.created_at) setUserCreatedAt(new Date(userRes.data.user.created_at));
      if (boundaryRes.data?.value) {
        setAccountingBoundary(boundaryRes.data.value);
      } else if (userRes.data?.user?.created_at) {
        setAccountingBoundary(userRes.data.user.created_at.substring(0, 10));
      }
      if (connectionsRes.data) {
        const allConns = connectionsRes.data as Array<{ marketplace_code: string; connection_type: string }>;
        setConnectedMarketplaces(allConns.map(c => c.marketplace_code));
      }
      if (lastSyncRes.data?.created_at) {
        setLastAutoSync(new Date(lastSyncRes.data.created_at));
      }
      setXeroConnected(!!xeroRes.data?.length);

      // Fetch external Xero matches for duplicate-risk detection on ready rows
      if (validationRes.data) {
        const readyIds = (validationRes.data as ValidationRow[])
          .filter(r => r.overall_status === 'ready_to_push' && r.settlement_id)
          .map(r => r.settlement_id!);
        if (readyIds.length > 0) {
          const { data: matches } = await supabase
            .from('xero_accounting_matches')
            .select('settlement_id, xero_status')
            .in('settlement_id', readyIds);
          if (matches) {
            const nonPaidMatchIds = new Set(
              matches.filter((m: any) => m.xero_status !== 'PAID').map((m: any) => m.settlement_id)
            );
            setExternalMatchIds(nonPaidMatchIds);
          } else {
            setExternalMatchIds(new Set());
          }
        }
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

  const uploadNeededManual = uploadNeeded.filter(r => {
    if (connectedApiMarketplaces.has(r.marketplace_code)) return false;
    if (r.settlement_uploaded || r.settlement_id) return false; // settlement already exists
    const periodEnd = new Date(r.period_end);
    return periodEnd < now; // only show if period already ended
  });
  // Match Settlements summary cards exactly: count raw validation rows, not deduped homepage rows.
  const readyToPush = useMemo(() => {
    return rows.filter(r => r.overall_status === 'ready_to_push');
  }, [rows]);

  // For the card listing, exclude auto-post rails so we only show manual-send items
  const manualReadyToPush = useMemo(() => {
    return readyToPush.filter(r => {
      if (autoPostRails.has(r.marketplace_code)) return false;
      return true;
    });
  }, [readyToPush, autoPostRails]);

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
  const allComplete = rows.length > 0 && uploadNeededManual.length === 0 && readyToPush.length === 0 && awaitingBank.length === 0 && gapDetected.length === 0 && complete.length > 0;

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


  // Greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const currentMonth = new Date().toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });

  // Build API sync status for Section 1 from the shared live integration status source.
  const apiConnections = useMemo(() => {
    const deduped = new Map<string, { code: string; label: string; synced: boolean }>();

    if (xeroConnected) {
      deduped.set('xero', {
        code: 'xero',
        label: 'Xero',
        synced: xeroSync.status === 'success',
      });
    }

    for (const integration of syncedIntegrations) {
      const normalizedCode = MARKETPLACE_ALIASES[integration.rail] || integration.rail;
      deduped.set(normalizedCode, {
        code: normalizedCode,
        label: MARKETPLACE_LABELS[normalizedCode] || integration.name,
        synced: integration.status === 'success',
      });
    }

    return Array.from(deduped.values());
  }, [syncedIntegrations, xeroConnected, xeroSync.status]);

  const allApiSynced = apiConnections.length > 0 && apiConnections.every(c => c.synced);

  if (loading || syncStatusLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-96" />
        <div className="grid grid-cols-3 gap-4">
          {[1,2,3].map(i => <Skeleton key={i} className="h-32" />)}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Greeting header */}
      <div className="flex items-start justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">
            {greeting}{userName ? `, ${userName}` : ''}.
          </h2>
          <p className="text-muted-foreground mt-1">
            Here's what needs your attention — {currentMonth}
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {lastAutoSync && (
            <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
              <CheckCircle2 className="h-3 w-3" />
              Auto-sync {formatTimeAgo(lastAutoSync)}
            </span>
          )}
          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs gap-1" disabled={refreshing} onClick={handleRefresh}>
            <RefreshCw className={cn("h-3 w-3", refreshing && "animate-spin")} />
            Refresh
          </Button>
        </div>
      </div>

      {/* ─── Section 1: API Sync Status ─── */}
      {apiConnections.length > 0 && (
        <Card className={cn(
          allApiSynced
            ? "border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10"
            : "border-border"
        )}>
          <CardContent className="py-4">
            <div className="flex items-center gap-2 mb-3">
              {allApiSynced ? (
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              ) : (
                <RefreshCw className="h-4 w-4 text-muted-foreground" />
              )}
                <h3 className="font-semibold text-sm">
                  {allApiSynced ? 'All connected integrations synced' : 'Integration Sync Status'}
                </h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {apiConnections.map(conn => (
                <div key={conn.code} className="flex items-center gap-2 text-xs rounded-lg bg-background/50 px-3 py-2">
                  {conn.synced ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  ) : (
                    <Clock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  )}
                  <span className={conn.synced ? 'text-foreground' : 'text-muted-foreground'}>{conn.label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ─── Section 2: Manual Uploads Needed ─── */}
      {uploadNeededManual.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10">
          <CardContent className="py-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Upload className="h-4 w-4 text-amber-500" />
                <h3 className="font-semibold text-sm">Manual Uploads Needed</h3>
                <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-[10px]">{uploadNeededManual.length}</Badge>
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
              These marketplaces don't have API connections — upload settlement CSVs to keep Xero up to date.
            </p>
            <ul className="space-y-1.5">
              {uploadNeededManual.map(r => {
                const isKogan = r.marketplace_code.toLowerCase().includes('kogan');
                return (
                  <li
                    key={r.id}
                    className="text-xs flex items-center gap-2 bg-background/50 rounded px-3 py-1.5 cursor-pointer hover:bg-muted/40 transition-colors"
                    onClick={() => setUploadDialogRow({
                      marketplace_code: r.marketplace_code,
                      period_label: r.period_label,
                      period_start: r.period_start,
                      period_end: r.period_end,
                    })}
                  >
                    <span className="text-amber-400">↑</span>
                    <span className="font-medium">{MARKETPLACE_LABELS[r.marketplace_code] || r.marketplace_code}</span>
                    <span className="text-muted-foreground">— {formatPeriod(r.period_start)}</span>
                    {isKogan && <span className="text-amber-600 dark:text-amber-400 font-medium">(CSV + PDF pair)</span>}
                    <Upload className="h-3 w-3 text-muted-foreground ml-auto shrink-0" />
                  </li>
                );
              })}
            </ul>
            {(() => {
              const apiUploadNeeded = uploadNeeded.filter(r => connectedApiMarketplaces.has(r.marketplace_code));
              return apiUploadNeeded.length > 0 ? (
                <p className="text-[11px] text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 shrink-0" />
                  Plus {apiUploadNeeded.length} API-connected period{apiUploadNeeded.length !== 1 ? 's' : ''} — these sync automatically.
                </p>
              ) : null;
            })()}
            <Button size="sm" variant="outline" className="w-full h-8 text-xs gap-1 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400" onClick={() => {
              onSwitchToUpload(buildMissingList());
            }}>
              <Upload className="h-3 w-3" /> Upload now
            </Button>
          </CardContent>
        </Card>
      )}

      {/* ─── Section 3: Ready for Xero ─── */}
      {readyToPush.length > 0 && (() => {
        const totalReadyCount = readyToPush.length;
        const totalReadyAmount = readyToPush.reduce((sum, r) => sum + (r.settlement_net || 0), 0);
        const manualReadyCount = manualReadyToPush.length;
        const manualReadyAmount = manualReadyToPush.reduce((sum, r) => sum + (r.settlement_net || 0), 0);
        const automatedReadyCount = Math.max(0, totalReadyCount - manualReadyCount);
        const hasExternalRisk = readyToPush.some(r => r.settlement_id && externalMatchIds.has(r.settlement_id));
        return (
          <Card className={cn(
            "bg-blue-50/50 dark:bg-blue-900/10",
            hasExternalRisk
              ? "border-destructive/60 ring-1 ring-destructive/30"
              : "border-blue-200 dark:border-blue-800"
          )}>
            <CardContent className="py-4 space-y-3">
              <div className="flex items-center gap-2">
                <Send className="h-4 w-4 text-blue-500" />
                <h3 className="font-semibold text-sm">Ready for Xero</h3>
                <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-[10px]">{totalReadyCount}</Badge>
              </div>
              {hasExternalRisk && (
                <div className="flex items-start gap-2 rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2">
                  <ShieldAlert className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                  <p className="text-[11px] text-destructive font-medium leading-tight">
                    Some settlements may already exist in Xero. Review flagged rows before pushing.
                  </p>
                </div>
              )}
              <div>
                <p className="text-lg font-bold text-foreground">{formatAUD(totalReadyAmount)} <span className="text-xs font-normal text-muted-foreground">total ready</span></p>
                <p className="text-xs text-muted-foreground">
                  {manualReadyCount > 0
                    ? `${manualReadyCount} need manual review/send${automatedReadyCount > 0 ? ` · ${automatedReadyCount} are auto-post/queued` : ''}`
                    : `${automatedReadyCount} ${automatedReadyCount === 1 ? 'settlement is' : 'settlements are'} auto-post/queued`}
                </p>
                {manualReadyCount > 0 && automatedReadyCount > 0 && (
                  <p className="text-[11px] text-muted-foreground mt-1">
                    Showing the manual-send items first. Manual total: {formatAUD(manualReadyAmount)}.
                  </p>
                )}
              </div>
              {manualReadyCount > 0 && (
                <ul className="space-y-1">
                  {(expandedCards['ready'] ? manualReadyToPush : manualReadyToPush.slice(0, 3)).map(r => {
                  const isRisky = r.settlement_id ? externalMatchIds.has(r.settlement_id) : false;
                  return (
                    <li key={r.id} className={cn(
                      "text-xs flex items-center gap-1.5 cursor-pointer hover:bg-muted/40 rounded px-1 -mx-1 py-0.5",
                      isRisky && "bg-destructive/5"
                    )} onClick={() => { setDrawerSettlementId(r.settlement_id); setDrawerOpen(true); }}>
                      {isRisky ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <ShieldAlert className="h-3.5 w-3.5 text-destructive shrink-0" />
                          </TooltipTrigger>
                          <TooltipContent side="left" className="max-w-[200px] text-xs">
                            Possible duplicate — an invoice for this settlement was found in Xero
                          </TooltipContent>
                        </Tooltip>
                      ) : (
                        <span className="text-blue-400">•</span>
                      )}
                      {MARKETPLACE_LABELS[MARKETPLACE_ALIASES[r.marketplace_code] || r.marketplace_code] || MARKETPLACE_ALIASES[r.marketplace_code] || r.marketplace_code} — {formatPeriodShort(r.period_start, r.period_end)}
                      {r.settlement_net ? ` — ${formatAUD(r.settlement_net)}` : ''}
                    </li>
                  );
                  })}
                  {manualReadyToPush.length > 3 && (
                    <li>
                      <button onClick={() => setExpandedCards(prev => ({ ...prev, ready: !prev.ready }))} className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
                        {expandedCards['ready'] ? '− Show less' : `+ ${manualReadyToPush.length - 3} more`}
                      </button>
                    </li>
                  )}
                </ul>
              )}
              <Button size="sm" variant="outline" className="w-full h-8 text-xs gap-1" onClick={() => onSwitchToSettlements('ready_to_push')}>
                <Search className="h-3 w-3" /> Review all ready items
              </Button>
            </CardContent>
          </Card>
        );
      })()}

      {/* Auto-post failed — always surface errors */}
      {autoPostFailed.length > 0 && (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="py-4 space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <h3 className="font-semibold text-sm">Auto-post Failed</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              {autoPostFailed.length} settlement{autoPostFailed.length > 1 ? 's' : ''} failed to auto-post. Review in Settings → Rail Posting Mode.
            </p>
            <ul className="space-y-1">
              {autoPostFailed.slice(0, 3).map(s => (
                <li key={s.id} className="text-xs flex items-center gap-1.5 cursor-pointer hover:bg-muted/40 rounded px-1 -mx-1 py-0.5" onClick={() => { setDrawerSettlementId(s.settlement_id); setDrawerOpen(true); }}>
                  <span className="text-destructive">•</span>
                  {MARKETPLACE_LABELS[s.marketplace || ''] || s.marketplace} — {formatPeriodShort(s.period_start, s.period_end)}
                </li>
              ))}
              {autoPostFailed.length > 3 && (
                <li className="text-xs text-muted-foreground">+ {autoPostFailed.length - 3} more</li>
              )}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* All-complete banner */}
      {allComplete && (
        <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20">
          <CardContent className="py-6 text-center space-y-2">
            <PartyPopper className="h-7 w-7 text-emerald-600 dark:text-emerald-400 mx-auto" />
            <h3 className="text-base font-semibold text-emerald-800 dark:text-emerald-300">
              You're all caught up for {currentMonth}
            </h3>
            <p className="text-xs text-emerald-700/80 dark:text-emerald-400/80">
              All settlements are processed and in Xero.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Settlement Detail Drawer */}
      <SettlementDetailDrawer
        settlementId={drawerSettlementId}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setDrawerSettlementId(null); }}
      />
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
