import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, ShieldCheck, Send, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { runFullUserSync, getLastSyncTime } from '@/actions/sync';
import { supabase } from '@/integrations/supabase/client';
import { callEdgeFunctionSafe } from '@/utils/sync-capabilities';
import { formatDistanceToNow } from 'date-fns';

interface SyncCommandBarProps {
  onOpenPushPreview: (settlements: Array<{ settlementId: string; marketplace: string }>) => void;
  onNavigateToMismatches: () => void;
}

interface ResolveResult {
  resolved: number;
  corrected: number;
  manual: number;
  unchanged: number;
}

export default function SyncCommandBar({ onOpenPushPreview, onNavigateToMismatches }: SyncCommandBarProps) {
  const [syncing, setSyncing] = useState(false);
  const [syncDone, setSyncDone] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [lastSyncLabel, setLastSyncLabel] = useState<string | null>(null);

  const [resolving, setResolving] = useState(false);
  const [gapCount, setGapCount] = useState<number | null>(null);
  const [resolveResult, setResolveResult] = useState<ResolveResult | null>(null);

  const [readyCount, setReadyCount] = useState(0);
  const [readySettlements, setReadySettlements] = useState<Array<{ settlementId: string; marketplace: string }>>([]);

  const isStale = lastSyncTime ? (Date.now() - new Date(lastSyncTime).getTime()) > 4 * 60 * 60 * 1000 : true;

  // Load initial data
  const loadData = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;

    const [syncTime, gapResult, readyResult] = await Promise.all([
      getLastSyncTime(),
      supabase
        .from('marketplace_validation')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', session.user.id)
        .eq('overall_status', 'gap_detected'),
      supabase
        .from('marketplace_validation')
        .select('settlement_id, marketplace_code', { count: 'exact' })
        .eq('user_id', session.user.id)
        .eq('overall_status', 'ready_to_push'),
    ]);

    setLastSyncTime(syncTime);
    if (syncTime) {
      setLastSyncLabel(formatDistanceToNow(new Date(syncTime), { addSuffix: true }));
    }
    setGapCount(gapResult.count ?? 0);
    setReadyCount(readyResult.count ?? 0);
    setReadySettlements(
      (readyResult.data ?? []).map(r => ({ settlementId: r.settlement_id!, marketplace: r.marketplace_code }))
    );
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // Refresh label every minute
  useEffect(() => {
    if (!lastSyncTime) return;
    const interval = setInterval(() => {
      setLastSyncLabel(formatDistanceToNow(new Date(lastSyncTime), { addSuffix: true }));
    }, 60_000);
    return () => clearInterval(interval);
  }, [lastSyncTime]);

  const handleRefreshAll = async () => {
    setSyncing(true);
    setSyncDone(false);
    try {
      const result = await runFullUserSync();
      if (!result.success) {
        toast.error(result.error || 'Sync failed');
        return;
      }

      // Trigger validation sweep so gap counts reflect new data immediately
      const { data: { session } } = await supabase.auth.getSession();
      if (session) {
        await callEdgeFunctionSafe('run-validation-sweep', session.access_token, {});
      }

      setSyncDone(true);
      toast.success('All data refreshed');
      setTimeout(() => setSyncDone(false), 3000);
      await loadData();
    } catch (err: any) {
      toast.error(`Sync failed: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleResolveGaps = async () => {
    setResolving(true);
    setResolveResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      // FIX 1: Record gap count BEFORE resolution
      const { count: gapsBefore } = await supabase
        .from('marketplace_validation')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', session.user.id)
        .eq('overall_status', 'gap_detected');

      // Get all gap_detected settlements
      const { data: gaps } = await supabase
        .from('marketplace_validation')
        .select('settlement_id, marketplace_code')
        .eq('user_id', session.user.id)
        .eq('overall_status', 'gap_detected');

      if (!gaps || gaps.length === 0) {
        setGapCount(0);
        toast.success('No gaps to resolve');
        setResolving(false);
        return;
      }

      toast.info(`Resolving ${gaps.length} gap${gaps.length !== 1 ? 's' : ''}...`);

      let corrected = 0;
      let manual = 0;
      let unchanged = 0;

      for (const gap of gaps) {
        if (!gap.settlement_id) { manual++; continue; }

        try {
          // FIX 5: Check error from supabase.functions.invoke
          const { data, error } = await supabase.functions.invoke('verify-settlement', {
            body: {
              settlement_id: gap.settlement_id,
              auto_correct: true,
              triggered_by: 'resolve_gaps_button',
            },
          });

          if (error) {
            console.error(`[resolve-gaps] Edge function error for ${gap.settlement_id}:`, error.message);
            manual++;
            continue;
          }

          // FIX 2: Handle all verdict types correctly
          const verdict = data?.verdict;
          const autoCorrected = data?.auto_corrected === true;

          if (autoCorrected) {
            corrected++; // fields updated, gap may or may not be resolved
          } else if (verdict === 'match') {
            unchanged++; // no discrepancy — gap may be data staleness
          } else if (verdict === 'no_api_connection') {
            manual++;
          } else if (verdict === 'no_data') {
            manual++; // tried but API returned nothing
          } else if (verdict === 'api_error') {
            manual++;
          } else if (verdict === 'discrepancy') {
            unchanged++; // discrepancy found but below $1 threshold or pushed
          } else {
            manual++; // unknown verdict — safer to flag for review
          }
        } catch (err: any) {
          console.error(`[resolve-gaps] Failed for ${gap.settlement_id}:`, err.message);
          manual++;
        }
      }

      // Trigger validation sweep to recalculate all statuses
      await callEdgeFunctionSafe('run-validation-sweep', session.access_token, {});

      // FIX 1: Record gap count AFTER sweep for truthful measurement
      const { count: gapsAfter } = await supabase
        .from('marketplace_validation')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', session.user.id)
        .eq('overall_status', 'gap_detected');

      const resolved = (gapsBefore ?? 0) - (gapsAfter ?? 0);

      setResolveResult({ resolved, corrected, manual, unchanged });

      // Build honest toast message
      const parts: string[] = [];
      if (resolved > 0) parts.push(`Resolved ${resolved} gap${resolved !== 1 ? 's' : ''}`);
      if (corrected > 0) parts.push(`${corrected} fields corrected`);
      if (manual > 0) parts.push(`${manual} need review`);
      if (unchanged > 0) parts.push(`${unchanged} unchanged`);

      if (resolved > 0) {
        toast.success(parts.join(' · '));
      } else if (manual > 0 && corrected === 0) {
        toast.warning(parts.join(' · '));
      } else if (corrected > 0) {
        toast.info(parts.join(' · '));
      } else {
        toast.info('No gaps could be auto-resolved');
      }

      await loadData();
    } catch (err: any) {
      toast.error(`Gap resolution failed: ${err.message}`);
    } finally {
      setResolving(false);
    }
  };

  const handlePushReady = () => {
    if (readySettlements.length === 0) return;
    onOpenPushPreview(readySettlements);
  };

  const formatResolveLabel = (r: ResolveResult): string => {
    const parts: string[] = [];
    if (r.resolved > 0) parts.push(`${r.resolved} resolved`);
    if (r.corrected > 0) parts.push(`${r.corrected} corrected`);
    if (r.manual > 0) parts.push(`${r.manual} manual`);
    if (r.unchanged > 0) parts.push(`${r.unchanged} unchanged`);
    return parts.join(' · ') || 'No changes';
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-5 py-4 shadow-sm">
        {/* Button 1: Refresh All */}
        <div className="flex flex-col items-start gap-0.5">
          <Button
            size="sm"
            variant={syncDone ? 'outline' : 'default'}
            onClick={handleRefreshAll}
            disabled={syncing}
            className="gap-1.5"
          >
            {syncing ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : syncDone ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            {syncing ? 'Syncing...' : syncDone ? 'Synced' : 'Refresh All Data'}
          </Button>
          {lastSyncLabel && (
            <span className="text-[10px] text-muted-foreground pl-1">
              Last synced: {lastSyncLabel}
            </span>
          )}
        </div>

        <div className="h-8 w-px bg-border hidden sm:block" />

        {/* Button 2: Resolve Gaps */}
        <div className="flex flex-col items-start gap-0.5">
          <Button
            size="sm"
            variant="outline"
            onClick={handleResolveGaps}
            disabled={resolving}
            className="gap-1.5"
          >
            {resolving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            {resolving ? 'Resolving...' : 'Resolve Gaps'}
            {gapCount !== null && gapCount > 0 && (
              <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-[10px]">
                {gapCount}
              </Badge>
            )}
          </Button>
          <span className="text-[10px] text-muted-foreground pl-1">
            {resolveResult
              ? formatResolveLabel(resolveResult)
              : gapCount === null ? '—' : gapCount === 0 ? 'All clear' : `${gapCount} gap${gapCount !== 1 ? 's' : ''} detected`}
          </span>
        </div>

        <div className="h-8 w-px bg-border hidden sm:block" />

        {/* Button 3: Push Ready */}
        <div className="flex flex-col items-start gap-0.5">
          <Button
            size="sm"
            variant={readyCount > 0 ? 'default' : 'outline'}
            onClick={handlePushReady}
            disabled={readyCount === 0}
            className="gap-1.5"
          >
            <Send className="h-3.5 w-3.5" />
            Push Ready
            {readyCount > 0 && (
              <Badge className="ml-1 h-5 px-1.5 text-[10px] bg-primary-foreground text-primary">
                {readyCount}
              </Badge>
            )}
          </Button>
          <span className="text-[10px] text-muted-foreground pl-1">
            {readyCount === 0 ? 'Nothing to push' : `${readyCount} settlement${readyCount !== 1 ? 's' : ''} ready`}
          </span>
        </div>

        {/* Gap review CTA */}
        {gapCount !== null && gapCount > 0 && (
          <>
            <div className="h-8 w-px bg-border hidden sm:block" />
            <button
              onClick={onNavigateToMismatches}
              className="text-xs text-amber-600 hover:text-amber-700 hover:underline flex items-center gap-1"
            >
              <AlertTriangle className="h-3 w-3" />
              Review gaps →
            </button>
          </>
        )}
      </div>

      {/* Staleness prompt — only when > 4 hours */}
      {isStale && !syncing && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
          <AlertTriangle className="h-3 w-3 text-amber-500" />
          <span>
            Data last refreshed {lastSyncLabel || 'unknown'} ·{' '}
            <button onClick={handleRefreshAll} className="text-primary hover:underline font-medium">
              Refresh now
            </button>
          </span>
        </div>
      )}
    </div>
  );
}
