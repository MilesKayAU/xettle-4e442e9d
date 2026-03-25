import React, { useEffect, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Shield, Loader2, CheckCircle2, AlertTriangle, XCircle, Play } from 'lucide-react';
import { toast } from 'sonner';
import {
  SCAN_DEFINITIONS,
  runDataIntegrityScan,
  runAllDataIntegrityScans,
  getLastScanTimestamps,
  type ScanResult,
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

type FreshnessStatus = 'fresh' | 'stale' | 'never';

function getFreshness(iso: string | null): FreshnessStatus {
  if (!iso) return 'never';
  const diff = Date.now() - new Date(iso).getTime();
  return diff < 3_600_000 ? 'fresh' : 'stale';
}

const statusConfig: Record<FreshnessStatus, { dot: string; Icon: typeof CheckCircle2 }> = {
  fresh: { dot: 'bg-emerald-500', Icon: CheckCircle2 },
  stale: { dot: 'bg-amber-500', Icon: AlertTriangle },
  never: { dot: 'bg-destructive', Icon: XCircle },
};

export default function DataIntegrityScanner() {
  const [timestamps, setTimestamps] = useState<Record<string, string | null>>({});
  const [runningScan, setRunningScan] = useState<string | null>(null);
  const [runningAll, setRunningAll] = useState(false);
  const [allProgress, setAllProgress] = useState(-1);

  const loadTimestamps = useCallback(async () => {
    const ts = await getLastScanTimestamps();
    setTimestamps(ts);
  }, []);

  useEffect(() => { loadTimestamps(); }, [loadTimestamps]);

  const handleRunSingle = async (key: string) => {
    setRunningScan(key);
    const result = await runDataIntegrityScan(key);
    setRunningScan(null);
    if (result.success) {
      toast.success(`${SCAN_DEFINITIONS.find((d) => d.key === key)?.label} complete`);
    } else {
      toast.error(result.error || 'Scan failed');
    }
    await loadTimestamps();
  };

  const handleRunAll = async () => {
    setRunningAll(true);
    setAllProgress(0);
    const results = await runAllDataIntegrityScans((_, idx) => setAllProgress(idx));
    setRunningAll(false);
    setAllProgress(-1);
    const failed = results.filter((r) => !r.success);
    if (failed.length === 0) {
      toast.success('All integrity scans complete');
    } else {
      toast.error(`${failed.length} of ${results.length} scans failed`);
    }
    await loadTimestamps();
  };

  const isAnyRunning = runningScan !== null || runningAll;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Data Integrity</CardTitle>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5 text-xs"
            disabled={isAnyRunning}
            onClick={handleRunAll}
          >
            {runningAll ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" />
                {allProgress + 1}/{SCAN_DEFINITIONS.length}
              </>
            ) : (
              <>
                <Play className="h-3 w-3" />
                Run All Scans
              </>
            )}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-1 pt-0">
        {SCAN_DEFINITIONS.map((def) => {
          const ts = timestamps[def.key] ?? null;
          const freshness = getFreshness(ts);
          const cfg = statusConfig[freshness];
          const isRunning = runningScan === def.key || (runningAll && allProgress >= 0 && SCAN_DEFINITIONS[allProgress]?.key === def.key);

          return (
            <div
              key={def.key}
              className="flex items-center justify-between rounded-md border border-border/50 px-3 py-2"
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={`h-2 w-2 rounded-full shrink-0 ${isRunning ? 'bg-primary animate-pulse' : cfg.dot}`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-tight truncate">{def.label}</p>
                  <p className="text-xs text-muted-foreground truncate">{def.description}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 ml-3">
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {isRunning ? 'Running…' : relativeTime(ts)}
                </span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 w-7 p-0"
                  disabled={isAnyRunning}
                  onClick={() => handleRunSingle(def.key)}
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
        })}
      </CardContent>
    </Card>
  );
}
