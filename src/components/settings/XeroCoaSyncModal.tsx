import React, { useState, useMemo, useCallback } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Loader2, AlertTriangle, CheckCircle2, Upload, ShieldAlert, Clock, AlertCircle, ChevronRight, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useSettingsPin } from '@/hooks/use-settings-pin';
import SettingsPinDialog from '@/components/shared/SettingsPinDialog';
import {
  batchCreateXeroAccounts,
  refreshXeroCOA,
  getCachedXeroAccounts,
  getCoaLastSyncedAt,
  type CachedXeroAccount,
  type CreateXeroAccountInput,
  type BatchCreateProgress,
} from '@/actions';

export type SyncStatus = 'new' | 'changed' | 'unchanged';

export interface SyncPreviewRow {
  code: string;
  name: string;
  type: string;
  category: string;
  marketplace?: string;
  status: SyncStatus;
  xeroName?: string;
  xeroType?: string;
  tax_type?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  previewRows: SyncPreviewRow[];
  coaAccounts: CachedXeroAccount[];
  onSyncComplete: () => Promise<void>;
}

const BATCH_SIZE = 2;
const HARD_RUN_LIMIT = 2;

interface RunResult {
  created: number;
  updated: number;
  skipped: number;
  errors: Array<{ code: string; error: string }>;
}

export default function XeroCoaSyncModal({ open, onOpenChange, previewRows, coaAccounts, onSyncComplete }: Props) {
  const [mode, setMode] = useState<'create_only' | 'create_and_update'>('create_only');
  const [riskConsent, setRiskConsent] = useState(false);
  const [createConsent, setCreateConsent] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<BatchCreateProgress | null>(null);
  const [rateLimitWait, setRateLimitWait] = useState<number | null>(null);
  const settingsPin = useSettingsPin();

  // Track completed codes across multiple runs within the same modal session
  const [completedCodes, setCompletedCodes] = useState<Set<string>>(new Set());
  const [errorResults, setErrorResults] = useState<Array<{ code: string; error: string }>>([]);
  const [lastRunResult, setLastRunResult] = useState<RunResult | null>(null);
  // Offset tracks how many actionable rows have been processed across runs
  const [runOffset, setRunOffset] = useState(0);

  const resetState = useCallback(() => {
    setMode('create_only');
    setRiskConsent(false);
    setCreateConsent(false);
    setProgress(null);
    setRateLimitWait(null);
    setCompletedCodes(new Set());
    setErrorResults([]);
    setLastRunResult(null);
    setRunOffset(0);
  }, []);

  const handleOpenChange = (v: boolean) => {
    if (syncing) return;
    if (!v) resetState();
    onOpenChange(v);
  };

  const summary = useMemo(() => {
    const newCount = previewRows.filter(r => r.status === 'new').length;
    const changedCount = previewRows.filter(r => r.status === 'changed').length;
    const unchangedCount = previewRows.filter(r => r.status === 'unchanged').length;
    return { newCount, changedCount, unchangedCount };
  }, [previewRows]);

  // Build a name→code map from the existing Xero COA for duplicate-name detection
  const existingNameMap = useMemo(() => {
    const map = new Map<string, string>(); // lowercase name → code
    for (const a of coaAccounts) {
      if (a.account_name && a.account_code) {
        map.set(a.account_name.toLowerCase().trim(), a.account_code);
      }
    }
    return map;
  }, [coaAccounts]);

  // Detect name conflicts: rows wanting to create an account whose name already
  // exists in Xero under a DIFFERENT code (Xero enforces globally unique names)
  const nameConflictMap = useMemo(() => {
    const conflicts = new Map<string, string>(); // code → existing code with same name
    for (const row of previewRows) {
      if (row.status !== 'new') continue;
      const existingCode = existingNameMap.get(row.name.toLowerCase().trim());
      if (existingCode && existingCode !== row.code) {
        conflicts.set(row.code, existingCode);
      }
    }
    return conflicts;
  }, [previewRows, existingNameMap]);

  const actionableRows = useMemo(() => {
    const rows = mode === 'create_only'
      ? previewRows.filter(r => r.status === 'new')
      : previewRows.filter(r => r.status === 'new' || r.status === 'changed');
    // Exclude rows with name conflicts — they'd fail at Xero anyway
    return rows.filter(r => !nameConflictMap.has(r.code));
  }, [previewRows, mode, nameConflictMap]);

  // Remaining actionable rows (skip already completed)
  const remainingRows = useMemo(
    () => actionableRows.filter(r => !completedCodes.has(r.code)),
    [actionableRows, completedCodes],
  );

  const rowsForThisRun = useMemo(
    () => remainingRows.slice(0, HARD_RUN_LIMIT),
    [remainingRows],
  );

  const queuedForLaterCount = Math.max(remainingRows.length - HARD_RUN_LIMIT, 0);
  const totalBatches = Math.ceil(rowsForThisRun.length / BATCH_SIZE);

  const canSync = rowsForThisRun.length > 0
    && createConsent
    && (mode === 'create_only' || riskConsent)
    && !syncing;

  const handleSync = async () => {
    settingsPin.requirePin(executeSync);
  };

  const executeSync = async () => {
    setSyncing(true);
    setProgress(null);
    setRateLimitWait(null);
    setLastRunResult(null);

    const accounts: CreateXeroAccountInput[] = rowsForThisRun.map(r => ({
      code: r.code,
      name: r.name,
      type: r.type,
      tax_type: r.tax_type,
    }));

    const result = await batchCreateXeroAccounts(accounts, {
      mode,
      onProgress: (p) => {
        setProgress(p);
        setRateLimitWait(p.rateLimitWait ?? null);
      },
    });

    setSyncing(false);

    if (result.success) {
      const runResult: RunResult = {
        created: result.created,
        updated: result.updated,
        skipped: result.skipped,
        errors: result.errors,
      };
      setLastRunResult(runResult);

      // Mark successfully processed codes as completed
      const errorCodes = new Set(result.errors.map(e => e.code));
      const newCompleted = new Set(completedCodes);
      for (const row of rowsForThisRun) {
        if (!errorCodes.has(row.code)) {
          newCompleted.add(row.code);
        }
      }
      setCompletedCodes(newCompleted);

      // Accumulate errors
      if (result.errors.length > 0) {
        setErrorResults(prev => [...prev, ...result.errors]);
      }

      // Reset consent for next run
      setCreateConsent(false);

      await onSyncComplete();

      // If nothing left, show final toast
      const newRemaining = actionableRows.filter(r => !newCompleted.has(r.code));
      if (newRemaining.length === 0) {
        toast.success('All accounts synced to Xero');
      }
    } else {
      setLastRunResult({ created: 0, updated: 0, skipped: 0, errors: [{ code: 'batch', error: result.error || 'Unknown error' }] });
    }
  };

  const progressPct = progress
    ? Math.round((progress.batchIndex / progress.totalBatches) * 100)
    : 0;

  const getRunState = (row: SyncPreviewRow): 'done' | 'error' | 'idle' | 'next_run' | 'queued' | 'sending' | 'sent' | 'skipped' => {
    if (completedCodes.has(row.code)) return 'done';

    const hasError = errorResults.some(e => e.code === row.code);
    if (hasError) return 'error';

    const isActionable = row.status === 'new' || (row.status === 'changed' && mode === 'create_and_update');
    if (!isActionable) return 'skipped';

    const idx = remainingRows.findIndex(r => r.code === row.code);
    if (idx === -1) return 'skipped';
    if (idx >= HARD_RUN_LIMIT) return 'next_run';
    if (!syncing || !progress) return 'idle';

    const rowBatch = Math.floor(idx / BATCH_SIZE);
    const currentBatch = progress.batchIndex;

    if (rowBatch < currentBatch) return 'sent';
    if (rowBatch === currentBatch && currentBatch < progress.totalBatches) return 'sending';
    return 'queued';
  };

  const renderStatusBadge = (status: SyncStatus) => {
    if (status === 'new') return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300 text-[10px]">Will Create</Badge>;
    if (status === 'changed') return <Badge className="bg-amber-100 text-amber-700 border-amber-300 text-[10px]">Changed</Badge>;
    return <Badge variant="outline" className="text-muted-foreground text-[10px]">Already in Xero</Badge>;
  };

  const renderActionCell = (row: SyncPreviewRow) => {
    const runState = getRunState(row);

    // Name conflict takes priority — show before any run state
    const conflictCode = nameConflictMap.get(row.code);
    if (conflictCode) {
      return (
        <span className="inline-flex items-center gap-1 text-destructive" title={`Name "${row.name}" already exists under code ${conflictCode}`}>
          <AlertTriangle className="h-3.5 w-3.5" />
          <span className="text-[10px] font-medium">Name clash ({conflictCode})</span>
        </span>
      );
    }

    switch (runState) {
      case 'done':
        return (
          <span className="inline-flex items-center gap-1 text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span className="text-[10px] font-medium">Done</span>
          </span>
        );
      case 'error': {
        const err = errorResults.find(e => e.code === row.code);
        return (
          <span className="inline-flex items-center gap-1 text-destructive" title={err?.error}>
            <XCircle className="h-3.5 w-3.5" />
            <span className="text-[10px] font-medium">Failed</span>
          </span>
        );
      }
      case 'sent':
        return (
          <span className="inline-flex items-center gap-1 text-emerald-600">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span className="text-[10px] font-medium">Created</span>
          </span>
        );
      case 'sending':
        return (
          <span className="inline-flex items-center gap-1 text-primary">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            <span className="text-[10px] font-medium">Creating…</span>
          </span>
        );
      case 'queued':
        return (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span className="text-[10px]">Queued</span>
          </span>
        );
      case 'next_run':
        return <Badge variant="secondary" className="text-[10px]">Next batch</Badge>;
      case 'idle':
        return <Badge className="bg-blue-100 text-blue-700 border-blue-300 text-[10px]">This batch</Badge>;
      case 'skipped':
        return <span className="text-[10px] text-muted-foreground">
          {row.status === 'unchanged' ? 'No action' : 'Skipped'}
        </span>;
      default:
        return null;
    }
  };

  const totalCompleted = completedCodes.size;
  const totalErrors = errorResults.length;
  const allDone = remainingRows.length === 0;

  const actionLabel = mode === 'create_only'
    ? `Create ${rowsForThisRun.length} Account${rowsForThisRun.length !== 1 ? 's' : ''} in Xero`
    : `Push ${rowsForThisRun.length} Account${rowsForThisRun.length !== 1 ? 's' : ''} to Xero`;

  return (
    <>
      <SettingsPinDialog
        open={settingsPin.showDialog}
        onVerify={settingsPin.verifyPin}
        onSuccess={settingsPin.unlock}
        onCancel={settingsPin.cancelDialog}
      />

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4 text-primary" />
              Create Accounts in Xero
            </DialogTitle>
            <DialogDescription className="text-xs">
              Push accounts to Xero in batches of {HARD_RUN_LIMIT}. The modal stays open so you can continue pushing.
            </DialogDescription>
          </DialogHeader>

          {/* Overall progress summary */}
          <div className="flex items-center gap-3 text-xs bg-muted/30 rounded-md px-3 py-2 border border-border/50">
            {totalCompleted > 0 && (
              <>
                <span className="text-emerald-700 font-medium">{totalCompleted} synced</span>
                <span className="text-muted-foreground">·</span>
              </>
            )}
            {totalErrors > 0 && (
              <>
                <span className="text-destructive font-medium">{totalErrors} failed</span>
                <span className="text-muted-foreground">·</span>
              </>
            )}
            <span className="text-emerald-700 font-medium">{summary.newCount} to create</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-amber-700 font-medium">{summary.changedCount} changed</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{summary.unchangedCount} already in Xero</span>
          </div>

          {/* Last run result banner */}
          {lastRunResult && !syncing && (
            <Alert className={lastRunResult.errors.length > 0 ? 'border-destructive/50 bg-destructive/5' : 'border-emerald-300 bg-emerald-50'}>
              {lastRunResult.errors.length > 0 ? (
                <XCircle className="h-4 w-4 text-destructive" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              )}
              <AlertDescription className="text-xs space-y-1">
                <div>
                  <strong>Last batch:</strong>{' '}
                  {lastRunResult.created > 0 && `${lastRunResult.created} created`}
                  {lastRunResult.updated > 0 && `, ${lastRunResult.updated} updated`}
                  {lastRunResult.skipped > 0 && `, ${lastRunResult.skipped} skipped`}
                  {lastRunResult.errors.length > 0 && `, ${lastRunResult.errors.length} error${lastRunResult.errors.length !== 1 ? 's' : ''}`}
                </div>
                {lastRunResult.errors.length > 0 && (
                  <div className="space-y-0.5 mt-1">
                    {lastRunResult.errors.map((err, i) => (
                      <div key={i} className="text-destructive text-[10px]">
                        <span className="font-mono">{err.code}</span>: {err.error}
                      </div>
                    ))}
                  </div>
                )}
                {remainingRows.length > 0 && (
                  <div className="text-muted-foreground mt-1">
                    {remainingRows.length} account{remainingRows.length !== 1 ? 's' : ''} remaining — tick the consent below and push the next batch.
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}

          {/* Name conflict warning */}
          {nameConflictMap.size > 0 && (
            <Alert className="border-amber-300 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-xs text-amber-900 space-y-1">
                <div><strong>{nameConflictMap.size} account{nameConflictMap.size !== 1 ? 's' : ''} skipped</strong> — names already exist in Xero under different codes:</div>
                <div className="space-y-0.5">
                  {[...nameConflictMap.entries()].map(([code, existingCode]) => {
                    const row = previewRows.find(r => r.code === code);
                    return (
                      <div key={code} className="text-[10px]">
                        <span className="font-mono">{code}</span> "{row?.name}" → already exists as code <span className="font-mono font-medium">{existingCode}</span>
                      </div>
                    );
                  })}
                </div>
                <div className="text-[10px] text-amber-700 mt-1">Rename the account in your mapping or use the existing code instead.</div>
              </AlertDescription>
            </Alert>
          )}

          {/* All done banner */}
          {allDone && lastRunResult && (
            <Alert className="border-emerald-300 bg-emerald-50">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <AlertDescription className="text-xs text-emerald-800">
                <strong>All done!</strong> {totalCompleted} account{totalCompleted !== 1 ? 's' : ''} synced to Xero.
                {totalErrors > 0 && ` ${totalErrors} had errors — review them above.`}
              </AlertDescription>
            </Alert>
          )}

          <div className="flex items-center gap-3 rounded-md border border-border/50 px-3 py-2">
            <Switch
              id="sync-mode"
              checked={mode === 'create_and_update'}
              onCheckedChange={(checked) => {
                setMode(checked ? 'create_and_update' : 'create_only');
                if (!checked) setRiskConsent(false);
              }}
              disabled={syncing}
            />
            <Label htmlFor="sync-mode" className="text-xs cursor-pointer">
              {mode === 'create_only'
                ? 'Create New Only — existing accounts are left untouched'
                : 'Overwrite Existing — changed accounts will be updated in Xero'}
            </Label>
          </div>

          {mode === 'create_and_update' && summary.changedCount > 0 && (
            <Alert className="border-destructive/50 bg-destructive/5">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <AlertDescription className="text-xs text-destructive">
                Overwriting will modify existing Xero accounts. This cannot be undone from Xettle.
              </AlertDescription>
            </Alert>
          )}

          {/* Current batch info */}
          {!syncing && !allDone && rowsForThisRun.length > 0 && (
            <div className="flex items-center gap-2 text-xs bg-primary/5 border border-primary/20 rounded-md px-3 py-2">
              <Upload className="h-3.5 w-3.5 text-primary shrink-0" />
              <span>
                Next batch: <strong>{rowsForThisRun.length}</strong> account{rowsForThisRun.length !== 1 ? 's' : ''}.
                {queuedForLaterCount > 0 && <> Then <strong>{queuedForLaterCount}</strong> more after that.</>}
              </span>
            </div>
          )}

          {syncing && progress && (
            <div className="space-y-2 bg-muted/40 border border-border/50 rounded-md px-3 py-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">
                  {rateLimitWait
                    ? `⏳ Rate limited — retrying in ${rateLimitWait}s…`
                    : progress.batchIndex < progress.totalBatches
                      ? <>Creating · <strong>Batch {progress.batchIndex + 1} of {progress.totalBatches}</strong></>
                      : '✓ Batch finished'}
                </span>
                <span className="text-xs text-muted-foreground">{progressPct}%</span>
              </div>
              <Progress value={progressPct} className="h-2" />
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                {progress.createdSoFar > 0 && (
                  <span className="text-emerald-600">{progress.createdSoFar} created</span>
                )}
                {progress.updatedSoFar > 0 && (
                  <span className="text-amber-600">{progress.updatedSoFar} updated</span>
                )}
                {progress.errorsSoFar > 0 && (
                  <span className="text-destructive">{progress.errorsSoFar} error{progress.errorsSoFar !== 1 ? 's' : ''}</span>
                )}
              </div>
            </div>
          )}

          <div className="border rounded-lg overflow-auto flex-1 min-h-0">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50 sticky top-0">
                  <th className="text-left p-2 font-medium">Code</th>
                  <th className="text-left p-2 font-medium">Name</th>
                  <th className="text-left p-2 font-medium">Type</th>
                  <th className="text-center p-2 font-medium w-28">Status</th>
                  <th className="text-center p-2 font-medium w-24">Action</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => {
                  const state = getRunState(row);
                  return (
                    <tr
                      key={row.code}
                      className={`border-b last:border-b-0 ${
                        state === 'done' ? 'bg-emerald-50/50 opacity-60' : ''
                      } ${state === 'error' ? 'bg-destructive/5' : ''} ${
                        row.status === 'unchanged' ? 'opacity-50' : ''
                      } ${state === 'sending' ? 'bg-primary/5' : ''} ${
                        state === 'sent' ? 'bg-emerald-50/50' : ''
                      }`}
                    >
                      <td className="p-2 font-mono">{row.code}</td>
                      <td className="p-2">
                        {row.name}
                        {row.status === 'changed' && row.xeroName && row.xeroName !== row.name && (
                          <span className="text-muted-foreground ml-1">(was: {row.xeroName})</span>
                        )}
                      </td>
                      <td className="p-2">{row.type}</td>
                      <td className="p-2 text-center">{renderStatusBadge(row.status)}</td>
                      <td className="p-2 text-center">{renderActionCell(row)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {mode === 'create_and_update' && summary.changedCount > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2">
              <Checkbox
                id="risk-consent"
                checked={riskConsent}
                onCheckedChange={(checked) => setRiskConsent(checked === true)}
                disabled={syncing}
                className="mt-0.5"
              />
              <Label htmlFor="risk-consent" className="text-xs text-destructive cursor-pointer">
                I understand this will modify existing Xero accounts in this run
              </Label>
            </div>
          )}

          {!syncing && !allDone && rowsForThisRun.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/50 px-3 py-2">
              <Checkbox
                id="create-consent"
                checked={createConsent}
                onCheckedChange={(checked) => setCreateConsent(checked === true)}
                disabled={syncing}
                className="mt-0.5"
              />
              <Label htmlFor="create-consent" className="text-xs text-amber-900 cursor-pointer">
                I confirm I want to push {rowsForThisRun.length} account{rowsForThisRun.length !== 1 ? 's' : ''} to live Xero
              </Label>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={syncing}>
              {allDone ? 'Close' : 'Cancel'}
            </Button>
            {!allDone && (
              <Button
                onClick={handleSync}
                disabled={!canSync}
                variant={mode === 'create_and_update' ? 'destructive' : 'default'}
                className="gap-1.5"
              >
                {syncing ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Creating in Xero…
                  </>
                ) : (
                  <>
                    {lastRunResult ? (
                      <ChevronRight className="h-3.5 w-3.5" />
                    ) : mode === 'create_and_update' ? (
                      <ShieldAlert className="h-3.5 w-3.5" />
                    ) : (
                      <Upload className="h-3.5 w-3.5" />
                    )}
                    {lastRunResult ? `Push Next ${rowsForThisRun.length}` : actionLabel}
                  </>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
