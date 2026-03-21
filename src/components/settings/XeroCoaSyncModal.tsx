import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Loader2, AlertTriangle, CheckCircle2, Upload, ShieldAlert, Clock, AlertCircle } from 'lucide-react';
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

export default function XeroCoaSyncModal({ open, onOpenChange, previewRows, coaAccounts, onSyncComplete }: Props) {
  const [mode, setMode] = useState<'create_only' | 'create_and_update'>('create_only');
  const [riskConsent, setRiskConsent] = useState(false);
  const [createConsent, setCreateConsent] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<BatchCreateProgress | null>(null);
  const [rateLimitWait, setRateLimitWait] = useState<number | null>(null);
  const settingsPin = useSettingsPin();

  const handleOpenChange = (v: boolean) => {
    if (syncing) return;
    if (!v) {
      setMode('create_only');
      setRiskConsent(false);
      setCreateConsent(false);
      setProgress(null);
      setRateLimitWait(null);
    }
    onOpenChange(v);
  };

  const summary = useMemo(() => {
    const newCount = previewRows.filter(r => r.status === 'new').length;
    const changedCount = previewRows.filter(r => r.status === 'changed').length;
    const unchangedCount = previewRows.filter(r => r.status === 'unchanged').length;
    return { newCount, changedCount, unchangedCount };
  }, [previewRows]);

  const actionableRows = useMemo(() => {
    if (mode === 'create_only') return previewRows.filter(r => r.status === 'new');
    return previewRows.filter(r => r.status === 'new' || r.status === 'changed');
  }, [previewRows, mode]);

  const rowsForThisRun = useMemo(
    () => actionableRows.slice(0, HARD_RUN_LIMIT),
    [actionableRows],
  );

  const queuedForLaterCount = Math.max(actionableRows.length - rowsForThisRun.length, 0);
  const totalBatches = Math.ceil(rowsForThisRun.length / BATCH_SIZE);

  const canSync = rowsForThisRun.length > 0
    && createConsent
    && (mode === 'create_only' || riskConsent);

  const handleSync = async () => {
    settingsPin.requirePin(executeSync);
  };

  const executeSync = async () => {
    setSyncing(true);
    setProgress(null);
    setRateLimitWait(null);

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
      const parts: string[] = [];
      if (result.created > 0) parts.push(`${result.created} created in Xero`);
      if (result.updated > 0) parts.push(`${result.updated} updated`);
      if (result.skipped > 0) parts.push(`${result.skipped} skipped`);
      if (result.errors.length > 0) parts.push(`${result.errors.length} error${result.errors.length !== 1 ? 's' : ''}`);
      if (queuedForLaterCount > 0) parts.push(`${queuedForLaterCount} still queued for the next run`);
      toast.success(`Done: ${parts.join(', ')}`);
      await onSyncComplete();
      handleOpenChange(false);
    } else {
      toast.error(`Failed: ${result.error || 'Unknown error'}`);
    }
  };

  const progressPct = progress
    ? Math.round((progress.batchIndex / progress.totalBatches) * 100)
    : 0;

  const getRunState = (row: SyncPreviewRow): 'idle' | 'next_run' | 'queued' | 'sending' | 'sent' | 'skipped' => {
    const isActionable = row.status === 'new' || (row.status === 'changed' && mode === 'create_and_update');
    if (!isActionable) return 'skipped';

    const idx = actionableRows.findIndex(r => r.code === row.code);
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
    const isSkipped = row.status === 'changed' && mode === 'create_only';
    const state = getRunState(row);

    if (!syncing) {
      if (state === 'next_run') return <Badge variant="secondary" className="text-[10px]">Next run</Badge>;
      if (state === 'idle') return <Badge className="bg-blue-100 text-blue-700 border-blue-300 text-[10px]">This run</Badge>;
      if (isSkipped) return <span className="text-[10px] text-muted-foreground">Skipped</span>;
      if (row.status === 'unchanged') return <span className="text-[10px] text-muted-foreground">No action</span>;
      return null;
    }

    switch (state) {
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
        return <Badge variant="secondary" className="text-[10px]">Next run</Badge>;
      case 'skipped':
        return <span className="text-[10px] text-muted-foreground">Skipped</span>;
      default:
        return null;
    }
  };

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
              This changes your live Xero Chart of Accounts, and each click is now hard-limited to 2 total accounts.
            </DialogDescription>
          </DialogHeader>

          <Alert className="border-amber-300 bg-amber-50">
            <AlertCircle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-xs text-amber-900">
              <strong>Hard limit active:</strong> this run can only create or update <strong>2 accounts total</strong> in Xero.
              {queuedForLaterCount > 0 ? ` ${queuedForLaterCount} more will stay queued for the next run.` : ''}
            </AlertDescription>
          </Alert>

          <div className="flex items-center gap-3 text-xs bg-muted/30 rounded-md px-3 py-2 border border-border/50">
            <span className="text-emerald-700 font-medium">{summary.newCount} to create</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-amber-700 font-medium">{summary.changedCount} changed</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{summary.unchangedCount} already in Xero</span>
          </div>

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

          {mode === 'create_and_update' && (
            <Alert className="border-destructive/50 bg-destructive/5">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <AlertDescription className="text-xs text-destructive">
                Overwriting will modify existing Xero accounts. This cannot be undone from Xettle.
              </AlertDescription>
            </Alert>
          )}

          {!syncing && rowsForThisRun.length > 0 && (
            <div className="flex items-center gap-2 text-xs bg-primary/5 border border-primary/20 rounded-md px-3 py-2">
              <Upload className="h-3.5 w-3.5 text-primary shrink-0" />
              <span>
                This run will push <strong>{rowsForThisRun.length}</strong> account{rowsForThisRun.length !== 1 ? 's' : ''} to Xero.
                {queuedForLaterCount > 0 && <> The remaining <strong>{queuedForLaterCount}</strong> will wait for another manual run.</>}
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
                      ? <>Creating <strong>{rowsForThisRun.length}</strong> in Xero · <strong>Batch {progress.batchIndex + 1} of {progress.totalBatches}</strong></>
                      : '✓ This run finished'}
                </span>
                <span className="text-xs text-muted-foreground">{progressPct}%</span>
              </div>
              <Progress value={progressPct} className="h-2" />
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                {progress.createdSoFar > 0 && (
                  <span className="text-emerald-600">{progress.createdSoFar} created in Xero</span>
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
                  const isSkipped = row.status === 'changed' && mode === 'create_only';
                  const runState = getRunState(row);
                  return (
                    <tr
                      key={row.code}
                      className={`border-b last:border-b-0 ${
                        row.status === 'unchanged' ? 'opacity-50' : ''
                      } ${isSkipped ? 'bg-muted/20' : ''} ${
                        runState === 'sending' ? 'bg-primary/5' : ''
                      } ${runState === 'sent' ? 'bg-emerald-50/50' : ''}`}
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

          {!syncing && rowsForThisRun.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/50 px-3 py-2">
              <Checkbox
                id="create-consent"
                checked={createConsent}
                onCheckedChange={(checked) => setCreateConsent(checked === true)}
                disabled={syncing}
                className="mt-0.5"
              />
              <Label htmlFor="create-consent" className="text-xs text-amber-900 cursor-pointer">
                I confirm I want to push {rowsForThisRun.length} account{rowsForThisRun.length !== 1 ? 's' : ''} to live Xero in this run
              </Label>
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={syncing}>
              Cancel
            </Button>
            <Button
              onClick={handleSync}
              disabled={!canSync || syncing}
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
                  {mode === 'create_and_update' ? (
                    <ShieldAlert className="h-3.5 w-3.5" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  {actionLabel}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
