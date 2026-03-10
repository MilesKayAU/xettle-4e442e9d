/**
 * ActionCentre — The main dashboard landing page.
 * Shows status cards, 3-month timeline, overdue alerts, and activity log.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
import { triggerValidationSweep, formatAUD, MARKETPLACE_LABELS } from '@/utils/settlement-engine';
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
}

interface ActionCentreProps {
  onSwitchToUpload: (missing?: MissingSettlement[]) => void;
  onSwitchToSettlements: () => void;
  userName?: string;
}

// Status icons for the timeline grid
const STATUS_ICONS: Record<string, { icon: string; label: string }> = {
  complete: { icon: '✅', label: 'Complete' },
  bank_matched: { icon: '✅', label: 'Complete' },
  ready_to_push: { icon: '🟡', label: 'Ready to push' },
  pushed_to_xero: { icon: '✅', label: 'Synced to Xero' },
  settlement_needed: { icon: '❌', label: 'Missing/needed' },
  missing: { icon: '❌', label: 'Missing/needed' },
  gap_detected: { icon: '⚠️', label: 'Gap detected' },
  already_recorded: { icon: '✅', label: 'Complete' },
};

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
};

export default function ActionCentre({
  onSwitchToUpload,
  onSwitchToSettlements,
  userName,
}: ActionCentreProps) {
  const [rows, setRows] = useState<ValidationRow[]>([]);
  const [events, setEvents] = useState<SystemEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [validationRes, eventsRes] = await Promise.all([
        supabase.from('marketplace_validation').select('*').order('marketplace_code').order('period_start', { ascending: false }),
        supabase.from('system_events').select('*').order('created_at', { ascending: false }).limit(5),
      ]);

      if (validationRes.data) setRows(validationRes.data as ValidationRow[]);
      if (eventsRes.data) setEvents(eventsRes.data as SystemEvent[]);
    } catch (err) {
      console.error('ActionCentre load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);



  useEffect(() => { loadData(); }, [loadData]);

  // Realtime
  useEffect(() => {
    const channel = supabase
      .channel('action-centre-live')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'marketplace_validation' }, () => loadData())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'system_events' }, () => loadData())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await triggerValidationSweep();
      toast.success('Validation sweep started');
      setTimeout(() => loadData(), 3000);
    } catch {
      toast.error('Sweep failed');
    } finally {
      setRefreshing(false);
    }
  };

  // ─── Computed ──────────────────────────────────────────────────────
  const uploadNeeded = rows.filter(r => r.overall_status === 'settlement_needed' || r.overall_status === 'missing');
  const readyToPush = rows.filter(r => r.overall_status === 'ready_to_push');
  const awaitingBank = rows.filter(r => r.overall_status === 'pushed_to_xero' || (r.xero_pushed && !r.bank_matched));
  const complete = rows.filter(r => r.overall_status === 'complete' || r.overall_status === 'bank_matched' || r.overall_status === 'already_recorded');
  const gapDetected = rows.filter(r => r.overall_status === 'gap_detected');
  const allComplete = rows.length > 0 && uploadNeeded.length === 0 && readyToPush.length === 0 && awaitingBank.length === 0 && gapDetected.length === 0;

  const lastChecked = rows.length > 0 && rows[0].last_checked_at
    ? new Date(rows[0].last_checked_at) : null;

  // Overdue: settlement_needed for > 30 days
  const overdueRows = uploadNeeded.filter(r => {
    const periodEnd = new Date(r.period_end);
    return Date.now() - periodEnd.getTime() > 30 * 24 * 60 * 60 * 1000;
  });

  // 3-month timeline
  const timelineData = useMemo(() => {
    const now = new Date();
    const months: string[] = [];
    for (let i = 2; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }

    const marketplaces = [...new Set(rows.map(r => r.marketplace_code))];

    return { months, marketplaces };
  }, [rows]);

  const getStatusForCell = (marketplace: string, monthKey: string): string => {
    const row = rows.find(r => {
      const d = new Date(r.period_start);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return r.marketplace_code === marketplace && key === monthKey;
    });
    return row?.overall_status || 'missing';
  };

  const formatMonthLabel = (key: string): string => {
    const [y, m] = key.split('-');
    const d = new Date(parseInt(y), parseInt(m) - 1, 1);
    return d.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' });
  };

  // Greeting
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const currentMonth = new Date().toLocaleDateString('en-AU', { month: 'long', year: 'numeric' });

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-12 w-96" />
        <div className="grid grid-cols-3 gap-4">
          {[1,2,3].map(i => <Skeleton key={i} className="h-40" />)}
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
          {lastChecked && <span>Updated {formatTimeAgo(lastChecked)}</span>}
          <Button variant="ghost" size="sm" onClick={handleRefresh} disabled={refreshing} className="h-7 px-2 gap-1.5">
            {refreshing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </Button>
        </div>
      </div>

      {/* Overdue alerts */}
      {overdueRows.map(r => (
        <Card key={r.id} className="border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/20">
          <CardContent className="py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
              <p className="text-sm">
                <span className="font-medium">{MARKETPLACE_LABELS[r.marketplace_code] || r.marketplace_code}</span> settlement is {Math.floor((Date.now() - new Date(r.period_end).getTime()) / (24 * 60 * 60 * 1000))} days overdue.
                <span className="text-muted-foreground"> Settlements are usually received within 14 days of period end.</span>
              </p>
            </div>
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1 border-amber-300 dark:border-amber-700" onClick={() => {
              const missing: MissingSettlement[] = uploadNeeded.map(r => ({
                marketplace_code: r.marketplace_code,
                marketplace_label: MARKETPLACE_LABELS[r.marketplace_code] || r.marketplace_code,
                period_label: r.period_label,
                period_start: r.period_start,
                period_end: r.period_end,
              }));
              onSwitchToUpload(missing);
            }}>
              <Upload className="h-3 w-3" /> Upload now
            </Button>
          </CardContent>
        </Card>
      ))}

      {/* All-complete banner OR 3 status cards */}
      {allComplete ? (
        <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/20">
          <CardContent className="py-8 text-center space-y-2">
            <PartyPopper className="h-8 w-8 text-emerald-600 dark:text-emerald-400 mx-auto" />
            <h3 className="text-lg font-semibold text-emerald-800 dark:text-emerald-300">
              All settlements complete for {currentMonth}
            </h3>
            <p className="text-sm text-emerald-700/80 dark:text-emerald-400/80">
              Everything is reconciled and in Xero.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Needs Attention */}
          {uploadNeeded.length > 0 && (
            <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-900/10">
              <CardContent className="py-5 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🔴</span>
                  <h3 className="font-semibold text-sm">Upload Needed</h3>
                </div>
                <p className="text-xs text-muted-foreground">
                  {uploadNeeded.length} marketplace settlement{uploadNeeded.length > 1 ? 's' : ''} missing
                </p>
                <ul className="space-y-1">
                  {uploadNeeded.slice(0, 3).map(r => (
                    <li key={r.id} className="text-xs flex items-center gap-1.5">
                      <span className="text-amber-500">•</span>
                      {MARKETPLACE_LABELS[r.marketplace_code] || r.marketplace_code} — {formatPeriod(r.period_start)}
                    </li>
                  ))}
                  {uploadNeeded.length > 3 && (
                    <li className="text-xs text-muted-foreground">+ {uploadNeeded.length - 3} more</li>
                  )}
                </ul>
                <Button size="sm" variant="outline" className="w-full h-8 text-xs gap-1 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400" onClick={() => {
                  const missing: MissingSettlement[] = uploadNeeded.map(r => ({
                    marketplace_code: r.marketplace_code,
                    marketplace_label: MARKETPLACE_LABELS[r.marketplace_code] || r.marketplace_code,
                    period_label: r.period_label,
                    period_start: r.period_start,
                    period_end: r.period_end,
                  }));
                  onSwitchToUpload(missing);
                }}>
                  <Upload className="h-3 w-3" /> Upload now
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Ready for Xero */}
          {readyToPush.length > 0 && (
            <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-900/10">
              <CardContent className="py-5 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🔵</span>
                  <h3 className="font-semibold text-sm">Ready for Xero</h3>
                </div>
                <p className="text-xs text-muted-foreground">
                  {readyToPush.length} settlement{readyToPush.length > 1 ? 's' : ''} validated
                </p>
                <ul className="space-y-1">
                  {readyToPush.slice(0, 3).map(r => (
                    <li key={r.id} className="text-xs flex items-center gap-1.5">
                      <span className="text-blue-500">•</span>
                      {MARKETPLACE_LABELS[r.marketplace_code] || r.marketplace_code} — {formatPeriod(r.period_start)}
                      {r.settlement_net ? ` — ${formatAUD(r.settlement_net)}` : ''}
                    </li>
                  ))}
                  {readyToPush.length > 3 && (
                    <li className="text-xs text-muted-foreground">+ {readyToPush.length - 3} more</li>
                  )}
                </ul>
                <Button size="sm" className="w-full h-8 text-xs gap-1" onClick={onSwitchToSettlements}>
                  <Send className="h-3 w-3" /> Push all to Xero
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Awaiting Bank Match */}
          {awaitingBank.length > 0 && (
            <Card className="border-blue-200 dark:border-blue-800 bg-blue-50/30 dark:bg-blue-900/10">
              <CardContent className="py-5 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🔵</span>
                  <h3 className="font-semibold text-sm">Awaiting bank match</h3>
                </div>
                <p className="text-xs text-muted-foreground">
                  {awaitingBank.length} settlement{awaitingBank.length > 1 ? 's' : ''} pending bank match
                </p>
                <ul className="space-y-1">
                  {awaitingBank.slice(0, 3).map(r => (
                    <li key={r.id} className="text-xs flex items-center gap-1.5">
                      <span className="text-blue-500">•</span>
                      {MARKETPLACE_LABELS[r.marketplace_code] || r.marketplace_code} — {r.settlement_net ? formatAUD(r.settlement_net) : ''}
                    </li>
                  ))}
                  {awaitingBank.length > 3 && (
                    <li className="text-xs text-muted-foreground">+ {awaitingBank.length - 3} more</li>
                  )}
                </ul>
                <Button size="sm" variant="outline" className="w-full h-8 text-xs gap-1" onClick={onSwitchToSettlements}>
                  <Search className="h-3 w-3" /> Check bank feed
                </Button>
              </CardContent>
            </Card>
          )}

          {/* All Clear */}
          {complete.length > 0 && (
            <Card className="border-emerald-200 dark:border-emerald-800 bg-emerald-50/50 dark:bg-emerald-900/10">
              <CardContent className="py-5 space-y-3">
                <div className="flex items-center gap-2">
                  <span className="text-lg">🟢</span>
                  <h3 className="font-semibold text-sm">Complete this month</h3>
                </div>
                <p className="text-xs text-muted-foreground">
                  {complete.length} settlement{complete.length > 1 ? 's' : ''} synced
                </p>
                <ul className="space-y-1">
                  {complete.slice(0, 3).map(r => (
                    <li key={r.id} className="text-xs flex items-center gap-1.5">
                      <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      {MARKETPLACE_LABELS[r.marketplace_code] || r.marketplace_code} — {formatPeriod(r.period_start)}
                    </li>
                  ))}
                  {complete.length > 3 && (
                    <li className="text-xs text-muted-foreground">+ {complete.length - 3} more</li>
                  )}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* 3-Month Timeline Grid */}
      {timelineData.marketplaces.length > 0 && (
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Settlement history</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground w-40">Marketplace</th>
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
                      const status = getStatusForCell(mp, m);
                      const config = STATUS_ICONS[status] || STATUS_ICONS.missing;
                      return (
                        <td key={m} className="text-center py-2.5 px-3">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <span className="text-base cursor-default">{config.icon}</span>
                              </TooltipTrigger>
                              <TooltipContent>{config.label}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex flex-wrap gap-4 mt-3 text-[10px] text-muted-foreground">
              <span>✅ Complete</span>
              <span>🟡 Ready to push</span>
              <span>⚠️ Gap detected</span>
              <span>❌ Missing/needed</span>
              <span>🔄 In progress</span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Activity log */}
      {events.length > 0 && (
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold">Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-2">
              {events.map(e => {
                const cfg = EVENT_ICONS[e.event_type] || { icon: <Clock className="h-3.5 w-3.5" />, color: 'text-muted-foreground' };
                return (
                  <div key={e.id} className="flex items-center gap-2.5 text-xs">
                    <span className={cfg.color}>{cfg.icon}</span>
                    <span className="text-foreground flex-1">
                      {formatEventLabel(e)}
                    </span>
                    <span className="text-muted-foreground flex-shrink-0">
                      {formatTimeAgo(new Date(e.created_at))}
                    </span>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Floating upload button */}
      <div className="fixed bottom-6 right-6 z-40">
        <Button
          onClick={() => onSwitchToUpload()}
          className="h-12 px-5 gap-2 shadow-lg rounded-full"
        >
          <Plus className="h-4 w-4" /> Upload settlement
        </Button>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────────

function formatPeriod(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-AU', { month: 'short', year: 'numeric' });
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
    case 'validation_sweep_complete': return 'Validation sweep completed';
    case 'settlement_saved': return `Settlement saved: ${mp} ${period}`;
    case 'xero_push_success': return `Pushed to Xero: ${mp} ${period}`;
    case 'xero_push_failed': return `Xero push failed: ${mp} ${period}`;
    case 'reconciliation_run': return `Reconciliation completed: ${mp} ${period}`;
    case 'bank_match_confirmed': return `Bank deposit matched: ${mp} ${period}`;
    case 'bank_match_failed': return `No bank deposit found: ${mp} ${period}`;
    case 'bank_match_query': {
      const count = event.details?.txns_returned;
      return `Bank feed queried: ${mp} — ${count ?? 0} transactions found`;
    }
    case 'reconciliation_mismatch': {
      const diff = event.details?.difference;
      return `Reconciliation gap${diff ? `: ${formatAUD(diff)}` : ''} ${mp}`;
    }
    case 'settlement_detected': return `Settlement detected: ${mp} ${period}`;
    default: return event.event_type.replace(/_/g, ' ');
  }
}
