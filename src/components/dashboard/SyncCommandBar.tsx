import React, { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, ShieldCheck, Send, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { runFullUserSync, getLastSyncTime } from '@/actions/sync';
import { getApiCsvMismatchCount } from '@/actions/dataIntegrity';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';

interface SyncCommandBarProps {
  onOpenPushPreview: (settlements: Array<{ settlementId: string; marketplace: string }>) => void;
  onNavigateToMismatches: () => void;
}

export default function SyncCommandBar({ onOpenPushPreview, onNavigateToMismatches }: SyncCommandBarProps) {
  const [syncing, setSyncing] = useState(false);
  const [syncDone, setSyncDone] = useState(false);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [lastSyncLabel, setLastSyncLabel] = useState<string | null>(null);

  const [verifying, setVerifying] = useState(false);
  const [issueCount, setIssueCount] = useState<number | null>(null);

  const [readyCount, setReadyCount] = useState(0);
  const [readySettlements, setReadySettlements] = useState<Array<{ settlementId: string; marketplace: string }>>([]);

  const isStale = lastSyncTime ? (Date.now() - new Date(lastSyncTime).getTime()) > 4 * 60 * 60 * 1000 : true;

  // Load initial data
  const loadData = useCallback(async () => {
    const [syncTime, mismatch] = await Promise.all([
      getLastSyncTime(),
      getApiCsvMismatchCount(),
    ]);

    setLastSyncTime(syncTime);
    if (syncTime) {
      setLastSyncLabel(formatDistanceToNow(new Date(syncTime), { addSuffix: true }));
    }
    setIssueCount(mismatch.needsManualFix);

    // Load ready-to-push count
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      const { data, count } = await supabase
        .from('marketplace_validation')
        .select('settlement_id, marketplace_code', { count: 'exact' })
        .eq('user_id', session.user.id)
        .eq('overall_status', 'ready_to_push');

      setReadyCount(count ?? 0);
      setReadySettlements(
        (data ?? []).map(r => ({ settlementId: r.settlement_id!, marketplace: r.marketplace_code }))
      );
    }
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
      } else {
        setSyncDone(true);
        toast.success('All data refreshed');
        setTimeout(() => setSyncDone(false), 3000);
        await loadData();
      }
    } catch (err: any) {
      toast.error(`Sync failed: ${err.message}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleVerifyAll = async () => {
    setVerifying(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      // Get all settlements with API connections for verification
      const { data: settlements } = await supabase
        .from('settlements')
        .select('settlement_id, marketplace')
        .eq('user_id', session.user.id)
        .in('source', ['api', 'amazon_api', 'ebay_api', 'mirakl_api'])
        .not('status', 'in', '("duplicate_suppressed","push_failed_permanent")')
        .order('period_end', { ascending: false })
        .limit(50);

      if (!settlements || settlements.length === 0) {
        setIssueCount(0);
        toast.success('No API settlements to verify');
        return;
      }

      let discrepancies = 0;
      let matches = 0;

      // Verify in batches
      for (const s of settlements) {
        const { data } = await supabase.functions.invoke('verify-settlement', {
          body: { settlement_id: s.settlement_id },
        });
        if (data?.discrepancy) discrepancies++;
        else matches++;
      }

      setIssueCount(discrepancies);
      if (discrepancies === 0) {
        toast.success(`All ${matches} settlements verified — no issues found`);
      } else {
        toast.warning(`${discrepancies} discrepanc${discrepancies === 1 ? 'y' : 'ies'} found, ${matches} matched`);
      }
    } catch (err: any) {
      toast.error(`Verification failed: ${err.message}`);
    } finally {
      setVerifying(false);
    }
  };

  const handlePushReady = () => {
    if (readySettlements.length === 0) return;
    onOpenPushPreview(readySettlements);
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

        {/* Button 2: Verify All */}
        <div className="flex flex-col items-start gap-0.5">
          <Button
            size="sm"
            variant="outline"
            onClick={handleVerifyAll}
            disabled={verifying}
            className="gap-1.5"
          >
            {verifying ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <ShieldCheck className="h-3.5 w-3.5" />
            )}
            {verifying ? 'Verifying...' : 'Verify All'}
            {issueCount !== null && issueCount > 0 && (
              <Badge variant="destructive" className="ml-1 h-5 px-1.5 text-[10px]">
                {issueCount}
              </Badge>
            )}
          </Button>
          <span className="text-[10px] text-muted-foreground pl-1">
            {issueCount === null ? '—' : issueCount === 0 ? 'All clear' : `${issueCount} issue${issueCount !== 1 ? 's' : ''} found`}
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

        {/* Verify issues CTA */}
        {issueCount !== null && issueCount > 0 && (
          <>
            <div className="h-8 w-px bg-border hidden sm:block" />
            <button
              onClick={onNavigateToMismatches}
              className="text-xs text-amber-600 hover:text-amber-700 hover:underline flex items-center gap-1"
            >
              <AlertTriangle className="h-3 w-3" />
              Review discrepancies →
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
