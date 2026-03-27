/**
 * BookkeeperPipeline — Unified priority-ordered task pipeline for bookkeepers.
 * Replaces ActionCentre, GapTriageTable, and RecentSettlements on the Home view.
 * 
 * 6 Buckets (priority order):
 * 1. 🔴 BLOCKED — expired tokens, missing mappings
 * 2. 🟡 UPLOAD NEEDED — manual-upload marketplaces missing settlements
 * 3. ⚠️ GAPS / MISMATCHES — recon differences > $1 (unacknowledged)
 * 4. 🔵 READY TO PUSH — validated, within tolerance
 * 5. ⏳ AWAITING BANK MATCH — pushed, waiting for bank feed
 * 6. ✅ COMPLETE — fully reconciled (collapsed)
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useAccountingBoundaryDate } from '@/hooks/useAccountingBoundaryDate';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  RefreshCw, Upload, Send, AlertTriangle, Clock, CheckCircle2,
  Loader2, ChevronDown, ChevronUp, XCircle, Eye, ArrowRight,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { runFullUserSync, getLastSyncTime } from '@/actions/sync';
import { callEdgeFunctionSafe } from '@/utils/sync-capabilities';
import { formatDistanceToNow, format } from 'date-fns';
import { getMarketplaceLabel } from '@/utils/marketplace-labels';
import { formatAUD } from '@/utils/settlement-engine';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { MissingSettlement } from '@/components/dashboard/ActionCentre';

// ─── Types ───────────────────────────────────────────────────────────

type BucketType = 'blocked' | 'scheduled' | 'upload_needed' | 'gaps' | 'ready' | 'awaiting' | 'complete';

interface PipelineItem {
  id: string;
  bucket: BucketType;
  marketplace_code: string;
  marketplace_label: string;
  period_label: string;
  period_start: string;
  period_end: string;
  amount: number | null;
  settlement_id: string | null;
  detail?: string;
  last_activity: string | null;
  payout_status?: string;
}

interface BookkeeperPipelineProps {
  onSwitchToUpload: (missing?: MissingSettlement[]) => void;
  onOpenPushPreview: (settlements: Array<{ settlementId: string; marketplace: string }>) => void;
  onEditSettlement: (settlementId: string) => void;
  onNavigateToSettings: () => void;
  userName?: string;
}

// ─── Bucket config ──────────────────────────────────────────────────

/** Per-marketplace guidance for where to download settlement CSVs */
const UPLOAD_GUIDANCE: Record<string, string> = {
  bigw: 'Download from BigW Seller Portal → Reports → Settlements',
  kogan: 'Download CSV + PDF from Kogan Seller Portal → Payments',
  catch: 'Download from Catch Seller Centre → Financials → Statements',
  mydeal: 'Download from MyDeal Seller Portal → Settlements',
  everyday_market: 'Download from Everyday Market Seller Hub → Payments',
  bunnings: 'Download from Bunnings MarketLink → Reports → Settlements',
};

function getUploadGuidance(marketplaceCode: string): string | undefined {
  const key = marketplaceCode.toLowerCase();
  return UPLOAD_GUIDANCE[key] ?? Object.entries(UPLOAD_GUIDANCE).find(([k]) => key.includes(k))?.[1];
}

const BUCKET_CONFIG: Record<BucketType, { emoji: string; label: string; colorClass: string; dotClass: string }> = {
  blocked:       { emoji: '🔴', label: 'Blocked',              colorClass: 'text-destructive',        dotClass: 'bg-destructive' },
  scheduled:     { emoji: '🕐', label: 'Scheduled / In Transit', colorClass: 'text-amber-600 dark:text-amber-400', dotClass: 'bg-amber-500' },
  upload_needed: { emoji: '🟡', label: 'Upload Needed',        colorClass: 'text-amber-600 dark:text-amber-400', dotClass: 'bg-amber-500' },
  gaps:          { emoji: '⚠️', label: 'Gaps / Mismatches',     colorClass: 'text-amber-600 dark:text-amber-400', dotClass: 'bg-amber-500' },
  ready:         { emoji: '🔵', label: 'Ready to Push to Xero', colorClass: 'text-primary',            dotClass: 'bg-primary' },
  awaiting:      { emoji: '⏳', label: 'Awaiting Bank Match',   colorClass: 'text-muted-foreground',   dotClass: 'bg-muted-foreground' },
  complete:      { emoji: '✅', label: 'Complete',              colorClass: 'text-green-600 dark:text-green-400', dotClass: 'bg-green-500' },
};

function formatPeriod(start: string, end: string): string {
  try {
    const s = new Date(start);
    const e = new Date(end);
    return `${format(s, 'd MMM')} – ${format(e, 'd MMM yyyy')}`;
  } catch {
    return `${start} – ${end}`;
  }
}

function getGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// ─── Component ──────────────────────────────────────────────────────

export default function BookkeeperPipeline({
  onSwitchToUpload,
  onOpenPushPreview,
  onEditSettlement,
  onNavigateToSettings,
  userName,
}: BookkeeperPipelineProps) {
  const [items, setItems] = useState<PipelineItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncLabel, setLastSyncLabel] = useState<string | null>(null);
  const [showComplete, setShowComplete] = useState(false);
  const { boundaryDate } = useAccountingBoundaryDate();

  // ─── Data fetch ─────────────────────────────────────────────────

  const loadPipeline = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const userId = session.user.id;
    const pipeline: PipelineItem[] = [];

    // Parallel queries
    const [
      blockedRes,
      validationRes,
      scheduledRes,
      amazonOpenRes,
      awaitingRes,
      completeRes,
      syncTime,
    ] = await Promise.all([
      // Blocked: connections with error/expired status
      supabase
        .from('marketplace_connections')
        .select('marketplace_code, marketplace_name, connection_status, updated_at')
        .eq('user_id', userId)
        .in('connection_status', ['error', 'expired', 'disconnected']),

      // All validation rows for upload_needed, gaps, ready
      // Exclude acknowledged gaps at DB level + terminal statuses
      supabase
        .from('marketplace_validation')
        .select('id, marketplace_code, period_label, period_start, period_end, settlement_id, settlement_net, overall_status, reconciliation_difference, gap_acknowledged, updated_at, bank_amount')
        .eq('user_id', userId)
        .not('overall_status', 'in', '("archived","already_recorded","duplicate_suppressed","complete","reconciled","open_period")')
        .or('gap_acknowledged.is.null,gap_acknowledged.eq.false,overall_status.neq.gap_detected')
        .gte('period_end', boundaryDate),

      // Scheduled / In Transit: Shopify payouts not yet arrived
      supabase
        .from('settlements')
        .select('settlement_id, marketplace, period_start, period_end, bank_deposit, payout_status, deposit_date, updated_at' as any)
        .eq('marketplace', 'shopify_payments')
        .in('payout_status', ['scheduled', 'in_transit'])
        .gte('period_end', boundaryDate)
        .order('period_end', { ascending: false })
        .limit(50),

      // Amazon AU open periods (from validation, not settlements — no settlement exists yet)
      supabase
        .from('marketplace_validation')
        .select('id, marketplace_code, period_label, period_start, period_end, settlement_net, overall_status, updated_at')
        .eq('marketplace_code', 'amazon_au')
        .eq('overall_status', 'open_period')
        .gte('period_end', boundaryDate)
        .order('period_end', { ascending: false })
        .limit(10),

      // Awaiting: pushed but not paid
      supabase
        .from('settlements')
        .select('settlement_id, marketplace, period_start, period_end, bank_deposit, status, updated_at')
        .eq('status', 'pushed_to_xero')
        .neq('xero_status', 'PAID')
        .gte('period_end', boundaryDate)
        .order('period_end', { ascending: false })
        .limit(50),

      // Complete: pushed and paid, current month
      supabase
        .from('settlements')
        .select('settlement_id, marketplace, period_start, period_end, bank_deposit, status, xero_status, updated_at')
        .eq('status', 'pushed_to_xero')
        .eq('xero_status', 'PAID')
        .gte('period_end', boundaryDate)
        .gte('period_end', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0])
        .order('period_end', { ascending: false })
        .limit(50),

      getLastSyncTime(),
    ]);

    // Sync label
    if (syncTime) {
      setLastSyncLabel(formatDistanceToNow(new Date(syncTime), { addSuffix: true }));
    }

    // 1. Blocked items
    (blockedRes.data ?? []).forEach(conn => {
      pipeline.push({
        id: `blocked-${conn.marketplace_code}`,
        bucket: 'blocked',
        marketplace_code: conn.marketplace_code,
        marketplace_label: conn.marketplace_name || getMarketplaceLabel(conn.marketplace_code),
        period_label: '',
        period_start: '',
        period_end: '',
        amount: null,
        settlement_id: null,
        detail: `Connection ${conn.connection_status}`,
        last_activity: conn.updated_at,
      });
    });

    // Collect scheduled settlement IDs for deduplication
    const scheduledSettlementIds = new Set(
      (scheduledRes.data ?? []).map((s: any) => String(s.settlement_id))
    );

    // 2–4. From validation rows (exclude scheduled/in_transit settlements)
    (validationRes.data ?? []).forEach(row => {
      // Skip if this settlement is already in the scheduled bucket
      if (row.settlement_id && scheduledSettlementIds.has(String(row.settlement_id))) return;

      let bucket: BucketType;
      if (row.overall_status === 'settlement_needed' || row.overall_status === 'missing') {
        bucket = 'upload_needed';
      } else if (row.overall_status === 'gap_detected' && row.gap_acknowledged !== true) {
        bucket = 'gaps';
      } else if (row.overall_status === 'ready_to_push') {
        bucket = 'ready';
      } else {
        return; // skip other statuses (including acknowledged gaps)
      }

      pipeline.push({
        id: row.id,
        bucket,
        marketplace_code: row.marketplace_code,
        marketplace_label: getMarketplaceLabel(row.marketplace_code),
        period_label: row.period_label,
        period_start: row.period_start,
        period_end: row.period_end,
        amount: row.settlement_net ?? row.bank_amount ?? null,
        settlement_id: row.settlement_id,
        detail: bucket === 'gaps' ? `${formatAUD(Math.abs(row.reconciliation_difference ?? 0))} gap` : undefined,
        last_activity: row.updated_at,
      });
    });

    // Scheduled / In Transit
    (scheduledRes.data ?? []).forEach((s: any) => {
      const payoutStatus = s.payout_status || 'scheduled';
      pipeline.push({
        id: `scheduled-${s.settlement_id}`,
        bucket: 'scheduled',
        marketplace_code: s.marketplace,
        marketplace_label: getMarketplaceLabel(s.marketplace),
        period_label: '',
        period_start: s.period_start,
        period_end: s.period_end,
        amount: s.bank_deposit,
        settlement_id: s.settlement_id,
        detail: payoutStatus === 'in_transit'
          ? 'In transit to your bank'
          : 'Payment announced — not yet transferred',
        last_activity: s.updated_at,
        payout_status: payoutStatus,
      });
    });

    // 5. Awaiting
    (awaitingRes.data ?? []).forEach(s => {
      pipeline.push({
        id: `awaiting-${s.settlement_id}`,
        bucket: 'awaiting',
        marketplace_code: s.marketplace,
        marketplace_label: getMarketplaceLabel(s.marketplace),
        period_label: '',
        period_start: s.period_start,
        period_end: s.period_end,
        amount: s.bank_deposit,
        settlement_id: s.settlement_id,
        last_activity: s.updated_at,
      });
    });

    // 6. Complete
    (completeRes.data ?? []).forEach(s => {
      pipeline.push({
        id: `complete-${s.settlement_id}`,
        bucket: 'complete',
        marketplace_code: s.marketplace,
        marketplace_label: getMarketplaceLabel(s.marketplace),
        period_label: '',
        period_start: s.period_start,
        period_end: s.period_end,
        amount: s.bank_deposit,
        settlement_id: s.settlement_id,
        last_activity: s.updated_at,
      });
    });

    setItems(pipeline);
    setLoading(false);
  }, [boundaryDate]);

  useEffect(() => { loadPipeline(); }, [loadPipeline]);

  // Refresh sync label every minute
  useEffect(() => {
    const interval = setInterval(async () => {
      const t = await getLastSyncTime();
      if (t) setLastSyncLabel(formatDistanceToNow(new Date(t), { addSuffix: true }));
    }, 60_000);
    return () => clearInterval(interval);
  }, []);

  // ─── Actions ────────────────────────────────────────────────────

  const handleRefresh = async () => {
    setSyncing(true);
    try {
      const result = await runFullUserSync();
      if (!result.success) {
        toast.error(result.error || 'Sync failed');
        return;
      }
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await callEdgeFunctionSafe('run-validation-sweep', session.access_token, {});
      }
      toast.success('All data refreshed');
      await loadPipeline();
    } catch (err: any) {
      toast.error(`Sync failed: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handlePushAllReady = () => {
    const readyItems = items.filter(i => i.bucket === 'ready' && i.settlement_id);
    onOpenPushPreview(readyItems.map(i => ({
      settlementId: i.settlement_id!,
      marketplace: i.marketplace_code,
    })));
  };

  // ─── Grouping ───────────────────────────────────────────────────

  const bucketOrder: BucketType[] = ['blocked', 'scheduled', 'upload_needed', 'gaps', 'ready', 'awaiting', 'complete'];
  const grouped = bucketOrder.reduce((acc, bucket) => {
    acc[bucket] = items.filter(i => i.bucket === bucket);
    return acc;
  }, {} as Record<BucketType, PipelineItem[]>);

  const actionableCount = grouped.blocked.length + grouped.upload_needed.length + grouped.gaps.length + grouped.ready.length;
  const displayName = userName?.split('@')[0] || 'there';

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-2">Loading pipeline…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {/* ─── Header ──────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h2 className="text-xl font-bold text-foreground">
            {getGreeting()}, {displayName}.
          </h2>
          <p className="text-sm text-muted-foreground">
            {actionableCount === 0 ? (
              <>All caught up. Last synced {lastSyncLabel || 'unknown'}.</>
            ) : (
              <>{actionableCount} item{actionableCount !== 1 ? 's' : ''} need{actionableCount === 1 ? 's' : ''} attention · Last synced: {lastSyncLabel || 'unknown'}</>
            )}
          </p>
          <p className="text-xs text-muted-foreground/70 mt-0.5">
            Showing settlements from {format(new Date(boundaryDate), 'd MMM yyyy')} · Pre-2026 periods reconciled via Link My Books
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleRefresh}
          disabled={syncing}
          className="gap-1.5 self-start"
        >
          {syncing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {syncing ? 'Syncing…' : 'Refresh'}
        </Button>
      </div>

      {/* ─── Buckets ─────────────────────────────────────────────── */}
      {bucketOrder.map(bucket => {
        const rows = grouped[bucket];
        if (rows.length === 0) return null;
        if (bucket === 'complete') return null; // rendered separately below

        const config = BUCKET_CONFIG[bucket];

        return (
          <Card key={bucket}>
            <CardContent className="py-3 px-4 space-y-2">
              {/* Bucket header */}
              <div className="flex items-center gap-2">
                <span className="text-sm">{config.emoji}</span>
                <h3 className={cn('text-sm font-semibold', config.colorClass)}>
                  {config.label}
                </h3>
                <Badge variant="outline" className="text-[10px] h-5 px-1.5">
                  {rows.length}
                </Badge>
                {bucket === 'scheduled' && (
                  <span className="text-[11px] text-muted-foreground ml-1">
                    Payment announced — not yet in your bank. Will auto-update when received. No action needed.
                  </span>
                )}
              </div>

              {/* Rows */}
              {rows.map(item => (
                <PipelineRow
                  key={item.id}
                  item={item}
                  onUpload={(item) => onSwitchToUpload([{
                    marketplace_code: item.marketplace_code,
                    marketplace_label: item.marketplace_label,
                    period_label: item.period_label,
                    period_start: item.period_start,
                    period_end: item.period_end,
                    estimated_amount: item.amount,
                  }])}
                  onPush={(item) => {
                    if (item.settlement_id) {
                      onOpenPushPreview([{ settlementId: item.settlement_id, marketplace: item.marketplace_code }]);
                    }
                  }}
                  onInvestigate={(item) => {
                    if (item.settlement_id) onEditSettlement(item.settlement_id);
                  }}
                  onFix={() => onNavigateToSettings()}
                />
              ))}

              {/* Push All Ready button */}
              {bucket === 'ready' && rows.length > 1 && (
                <Button
                  size="sm"
                  onClick={handlePushAllReady}
                  className="w-full gap-1.5 mt-1"
                >
                  <Send className="h-3.5 w-3.5" />
                  Push All ({rows.length}) to Xero
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              )}
            </CardContent>
          </Card>
        );
      })}

      {/* ─── Complete bucket (collapsed) ─────────────────────────── */}
      {grouped.complete.length > 0 && (
        <Card>
          <CardContent className="py-3 px-4">
            <button
              onClick={() => setShowComplete(!showComplete)}
              className="flex items-center gap-2 w-full text-left"
            >
              <span className="text-sm">✅</span>
              <span className="text-sm font-medium text-green-600 dark:text-green-400">
                {grouped.complete.length} settlement{grouped.complete.length !== 1 ? 's' : ''} reconciled this month
              </span>
              {showComplete ? (
                <ChevronUp className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground ml-auto" />
              )}
            </button>
            {showComplete && (
              <div className="space-y-1.5 mt-2">
                {grouped.complete.map(item => (
                  <div key={item.id} className="flex items-center justify-between text-sm py-1 px-2 rounded-md bg-muted/30">
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
                      <span className="font-medium truncate">{item.marketplace_label}</span>
                      <span className="text-xs text-muted-foreground truncate">
                        {formatPeriod(item.period_start, item.period_end)}
                      </span>
                    </div>
                    {item.amount != null && item.amount !== 0 ? (
                      <span className="text-xs font-medium text-muted-foreground shrink-0 ml-2">
                        {formatAUD(item.amount)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground shrink-0 ml-2">—</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* All caught up state */}
      {actionableCount === 0 && grouped.awaiting.length === 0 && grouped.complete.length === 0 && (
        <Card>
          <CardContent className="py-8 text-center">
            <CheckCircle2 className="h-8 w-8 text-green-500 mx-auto mb-2" />
            <p className="text-sm font-medium text-foreground">All caught up!</p>
            <p className="text-xs text-muted-foreground mt-1">No settlements need attention right now.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Pipeline Row ───────────────────────────────────────────────────

function PipelineRow({
  item,
  onUpload,
  onPush,
  onInvestigate,
  onFix,
}: {
  item: PipelineItem;
  onUpload: (item: PipelineItem) => void;
  onPush: (item: PipelineItem) => void;
  onInvestigate: (item: PipelineItem) => void;
  onFix: () => void;
}) {
  const actionButton = () => {
    switch (item.bucket) {
      case 'blocked':
        return (
          <Button size="sm" variant="destructive" className="h-7 text-xs gap-1" onClick={onFix}>
            Fix
          </Button>
        );
      case 'upload_needed':
        return (
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onUpload(item)}>
            <Upload className="h-3 w-3" /> Upload
          </Button>
        );
      case 'gaps':
        return (
          <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => onInvestigate(item)}>
            <Eye className="h-3 w-3" /> Investigate
          </Button>
        );
      case 'ready':
        return (
          <Button size="sm" className="h-7 text-xs gap-1" onClick={() => onPush(item)}>
            <Send className="h-3 w-3" /> Push
          </Button>
        );
      case 'scheduled':
        return (
          <Badge variant="outline" className={cn(
            'text-[10px] h-5 px-1.5',
            item.payout_status === 'in_transit'
              ? 'border-blue-400 text-blue-600 dark:text-blue-400'
              : 'border-amber-400 text-amber-600 dark:text-amber-400'
          )}>
            {item.payout_status === 'in_transit' ? 'In Transit' : 'Scheduled'}
          </Badge>
        );
      case 'awaiting':
        return (
          <span className="text-[10px] text-muted-foreground">Waiting…</span>
        );
      default:
        return null;
    }
  };

  const periodStr = item.period_start && item.period_end
    ? formatPeriod(item.period_start, item.period_end)
    : item.period_label || '';

  const timeAgo = item.last_activity
    ? formatDistanceToNow(new Date(item.last_activity), { addSuffix: true })
    : null;

  return (
    <div className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2 hover:bg-muted/30 transition-colors">
      <div className="flex items-center gap-2.5 min-w-0 flex-1">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">{item.marketplace_label}</span>
            {periodStr && (
              <span className="text-xs text-muted-foreground">{periodStr}</span>
            )}
          </div>
          {(item.detail || timeAgo || (item.bucket === 'upload_needed' && getUploadGuidance(item.marketplace_code))) && (
            <div className="flex flex-col gap-0.5 mt-0.5">
              {item.bucket === 'upload_needed' && getUploadGuidance(item.marketplace_code) && (
                <span className="text-xs text-amber-600 dark:text-amber-400">
                  {getUploadGuidance(item.marketplace_code)}
                </span>
              )}
              <div className="flex items-center gap-2">
                {item.detail && (
                  <span className="text-xs text-muted-foreground">{item.detail}</span>
                )}
                {timeAgo && (
                  <span className="text-[10px] text-muted-foreground/60">{timeAgo}</span>
                )}
              </div>
            </div>
          )}
        </div>
        {item.amount != null && item.amount !== 0 ? (
          <span className="text-sm font-semibold tabular-nums shrink-0 ml-2">
            {formatAUD(item.amount)}
          </span>
        ) : item.bucket !== 'blocked' ? (
          <span className="text-sm text-muted-foreground shrink-0 ml-2">—</span>
        ) : null}
      </div>
      <div className="shrink-0 ml-3">
        {actionButton()}
      </div>
    </div>
  );
}
