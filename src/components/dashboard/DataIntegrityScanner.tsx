import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Shield, Loader2, CheckCircle2, AlertTriangle, XCircle, Play, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';
import {
  MANUAL_SCANS,
  AUTO_SCANS,
  runDataIntegrityScan,
  runManualScans,
  getLastScanTimestamps,
  getIngestionWarningCount,
  type ScanDefinition,
} from '@/actions/dataIntegrity';

function relativeTime(iso: string | null): string {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

type FreshnessStatus = 'fresh' | 'stale' | 'failed' | 'never';

function getFreshness(iso: string | null, hasFailed?: boolean): FreshnessStatus {
  if (hasFailed) return 'failed';
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  return diff < 3_600_000 ? 'fresh' : 'stale';
}

const statusConfig: Record<FreshnessStatus, { dot: string }> = {
  fresh: { dot: 'bg-emerald-500' },
  stale: { dot: 'bg-amber-500' },
  failed: { dot: 'bg-destructive' },
  never: { dot: 'bg-destructive' },
};

function ScanRow({
  def,
  timestamp,
  isRunning,
  isAnyRunning,
  hasFailed,
  onRun,
}: {
  def: ScanDefinition;
  timestamp: string | null;
  isRunning: boolean;
  isAnyRunning: boolean;
  hasFailed?: boolean;
  onRun: () => void;
}) {
  const freshness = getFreshness(timestamp, hasFailed);
  const cfg = statusConfig[freshness];

  return (
    <div className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2">
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={`h-2 w-2 rounded-full shrink-0 ${isRunning ? 'bg-primary animate-pulse' : cfg.dot}`} />
        <div className="min-w-0">
          <p className="text-sm font-medium leading-tight truncate">{def.label}</p>
          <p className="text-xs text-muted-foreground truncate">{def.description}</p>
        </div>
      </div>
      <div className="flex items-center gap-2 shrink-0 ml-3">
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {isRunning ? 'Running…' : hasFailed ? 'Failed' : relativeTime(timestamp)}
        </span>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 w-7 p-0"
          disabled={isAnyRunning}
          onClick={onRun}
        >
          {isRunning ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Play className="h-3.5 w-3.5" />
          )}
        </Button>
      </div>
    </div>
  );
}

export default function DataIntegrityScanner() {
  const [timestamps, setTimestamps] = useState<Record<string, string | null>>({});
  const [failedScans, setFailedScans] = useState<Record<string, boolean>>({});
  const [runningScan, setRunningScan] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [allProgress, setAllProgress] = useState(-1);
  const [showAuto, setShowAuto] = useState(false);

  const loadTimestamps = useCallback(async () => {
    const ts = await getLastScanTimestamps();
    setTimestamps(ts);
    // Clear failed states when we reload timestamps (fresh data)
    setFailedScans({});
  }, []);

  useEffect(() => { loadTimestamps(); }, [loadTimestamps]);

  const handleRunSingle = async (key: string, label: string) => {
    setRunningScan(key);
    setFailedScans(prev => ({ ...prev, [key]: false }));
    const result = await runDataIntegrityScan(key);
    setRunningScan(null);
    if (result.success) {
      toast.success(`${label} complete`);
      setFailedScans(prev => ({ ...prev, [key]: false }));
    } else {
      toast.error(result.error || 'Scan failed');
      setFailedScans(prev => ({ ...prev, [key]: true }));
    }
    await loadTimestamps();
  };

  const handleRunManual = async () => {
    setRunningAll(true);
    setAllProgress(0);
    const results = await runManualScans((_, idx) => setAllProgress(idx));
    setRunningAll(false);
    setAllProgress(-1);
    const failed = results.filter((r) => !r.success);
    if (failed.length === 0) {
      toast.success('All data integrity checks complete');
    } else {
      toast.error(`${failed.length} of ${results.length} scans failed`);
    }
    await loadTimestamps();
  };

  const isAnyRunning = runningScan !== null || runningAll;

  // Count how many manual scans are stale/never
  const staleCount = MANUAL_SCANS.filter((d) => {
    const f = getFreshness(timestamps[d.key] ?? null, failedScans[d.key]);
    return f !== 'fresh';
  }).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Data Integrity</CardTitle>
            {staleCount > 0 && !isAnyRunning && (
              <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                {staleCount} stale
              </span>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs"
            disabled={isAnyRunning}
            onClick={handleRunManual}
          >
            {runningAll ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                {allProgress + 1}/{MANUAL_SCANS.length}
              </>
            ) : (
              <>
                <Play className="h-3 w-3" />
                Refresh Data
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-1 pt-0">
        {/* Manual scans — prominent */}
        {MANUAL_SCANS.map((def) => {
          const isRunning = runningScan === def.key || (runningAll && allProgress >= 0 && MANUAL_SCANS[allProgress]?.key === def.key);
          return (
            <ScanRow
              key={def.key}
              def={def}
              timestamp={timestamps[def.key] ?? null}
              isRunning={isRunning}
              isAnyRunning={isAnyRunning}
              hasFailed={failedScans[def.key]}
              onRun={() => handleRunSingle(def.key, def.label)}
            />
          );
        })}

        {/* Auto scans — collapsed by default */}
        <button
          type="button"
          className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors pt-1 w-full"
          onClick={() => setShowAuto(!showAuto)}
        >
          <Clock className="h-3 w-3" />
          <span>Automated syncs</span>
          {showAuto ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>

        {showAuto && AUTO_SCANS.map((def) => {
          const isRunning = runningScan === def.key;
          return (
            <div key={def.key} className="opacity-75">
              <ScanRow
                def={def}
                timestamp={timestamps[def.key] ?? null}
                isRunning={isRunning}
                isAnyRunning={isAnyRunning}
                hasFailed={failedScans[def.key]}
                onRun={() => handleRunSingle(def.key, def.label)}
              />
              {def.cronNote && (
                <p className="text-[10px] text-muted-foreground pl-5 -mt-0.5">{def.cronNote}</p>
              )}
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
