import React, { useState, useMemo } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Loader2, AlertTriangle, CheckCircle2, Upload, ShieldAlert } from 'lucide-react';
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

// ─── Types ───────────────────────────────────────────────────────

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

export default function XeroCoaSyncModal({ open, onOpenChange, previewRows, coaAccounts, onSyncComplete }: Props) {
  const [mode, setMode] = useState<'create_only' | 'create_and_update'>('create_only');
  const [riskConsent, setRiskConsent] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<BatchCreateProgress | null>(null);
  const [rateLimitWait, setRateLimitWait] = useState<number | null>(null);
  const settingsPin = useSettingsPin();

  // Compute summary
  const summary = useMemo(() => {
    const newCount = previewRows.filter(r => r.status === 'new').length;
    const changedCount = previewRows.filter(r => r.status === 'changed').length;
    const unchangedCount = previewRows.filter(r => r.status === 'unchanged').length;
    return { newCount, changedCount, unchangedCount };
  }, [previewRows]);

  // Filter actionable rows based on mode
  const actionableRows = useMemo(() => {
    if (mode === 'create_only') return previewRows.filter(r => r.status === 'new');
    return previewRows.filter(r => r.status === 'new' || r.status === 'changed');
  }, [previewRows, mode]);

  const canSync = actionableRows.length > 0 && (mode === 'create_only' || riskConsent);

  const handleSync = async () => {
    if (mode === 'create_and_update') {
      settingsPin.requirePin(executeSync);
    } else {
      await executeSync();
    }
  };

  const executeSync = async () => {
    setSyncing(true);
    setProgress(null);
    setRateLimitWait(null);

    const accounts: CreateXeroAccountInput[] = actionableRows.map(r => ({
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
      if (result.created > 0) parts.push(`${result.created} created`);
      if (result.updated > 0) parts.push(`${result.updated} updated`);
      if (result.errors.length > 0) parts.push(`${result.errors.length} error${result.errors.length !== 1 ? 's' : ''}`);
      toast.success(`COA sync complete: ${parts.join(', ')}`);
      await onSyncComplete();
      onOpenChange(false);
    } else {
      toast.error(`Sync failed: ${result.error || 'Unknown error'}`);
    }

    // Reset state
    setMode('create_only');
    setRiskConsent(false);
    setProgress(null);
  };

  const progressPct = progress
    ? Math.round((progress.batchIndex / progress.totalBatches) * 100)
    : 0;

  const renderStatusBadge = (status: SyncStatus) => {
    if (status === 'new') return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-300 text-[10px]">New</Badge>;
    if (status === 'changed') return <Badge className="bg-amber-100 text-amber-700 border-amber-300 text-[10px]">Changed</Badge>;
    return <Badge variant="outline" className="text-muted-foreground text-[10px]">Unchanged</Badge>;
  };

  return (
    <>
      <SettingsPinDialog
        open={settingsPin.showDialog}
        onVerify={settingsPin.verifyPin}
        onSuccess={settingsPin.unlock}
        onCancel={settingsPin.cancelDialog}
      />

      <Dialog open={open} onOpenChange={(v) => { if (!syncing) onOpenChange(v); }}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4 text-primary" />
              Sync Accounts to Xero
            </DialogTitle>
            <DialogDescription className="text-xs">
              Preview which accounts will be created or updated in your Xero Chart of Accounts.
            </DialogDescription>
          </DialogHeader>

          {/* Summary strip */}
          <div className="flex items-center gap-3 text-xs bg-muted/30 rounded-md px-3 py-2 border border-border/50">
            <span className="text-emerald-700 font-medium">{summary.newCount} new</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-amber-700 font-medium">{summary.changedCount} changed</span>
            <span className="text-muted-foreground">·</span>
            <span className="text-muted-foreground">{summary.unchangedCount} unchanged</span>
          </div>

          {/* Mode toggle */}
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
                ? 'Create New Only — existing accounts are skipped'
                : 'Overwrite Existing — changed accounts will be updated in Xero'}
            </Label>
          </div>

          {/* Overwrite warning */}
          {mode === 'create_and_update' && (
            <Alert className="border-amber-300 bg-amber-50">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-xs text-amber-900">
                Overwriting will modify existing Xero accounts. This cannot be undone from Xettle.
              </AlertDescription>
            </Alert>
          )}

          {/* Preview table */}
          <div className="border rounded-lg overflow-auto flex-1 min-h-0">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b bg-muted/50 sticky top-0">
                  <th className="text-left p-2 font-medium">Code</th>
                  <th className="text-left p-2 font-medium">Name</th>
                  <th className="text-left p-2 font-medium">Type</th>
                  <th className="text-center p-2 font-medium w-24">Status</th>
                  <th className="text-center p-2 font-medium w-20">Action</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => {
                  const isActionable = row.status === 'new' || (row.status === 'changed' && mode === 'create_and_update');
                  const isSkipped = row.status === 'changed' && mode === 'create_only';
                  return (
                    <tr
                      key={row.code}
                      className={`border-b last:border-b-0 ${
                        row.status === 'unchanged' ? 'opacity-50' : ''
                      } ${isSkipped ? 'bg-muted/20' : ''}`}
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
                      <td className="p-2 text-center">
                        {isActionable && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mx-auto" />}
                        {isSkipped && (
                          <span className="text-[10px] text-muted-foreground">Skipped</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Overwrite consent gate */}
          {mode === 'create_and_update' && summary.changedCount > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/50 px-3 py-2">
              <Checkbox
                id="risk-consent"
                checked={riskConsent}
                onCheckedChange={(checked) => setRiskConsent(checked === true)}
                disabled={syncing}
                className="mt-0.5"
              />
              <Label htmlFor="risk-consent" className="text-xs text-amber-900 cursor-pointer">
                I understand this will modify {summary.changedCount} existing account{summary.changedCount !== 1 ? 's' : ''} in my Xero Chart of Accounts
              </Label>
            </div>
          )}

          {/* Progress bar */}
          {syncing && progress && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {rateLimitWait
                    ? `Rate limited — retrying in ${rateLimitWait}s…`
                    : progress.batchIndex < progress.totalBatches
                      ? `Sending batch ${progress.batchIndex + 1} of ${progress.totalBatches}…`
                      : 'Finishing up…'}
                </span>
                <span>{progressPct}%</span>
              </div>
              <Progress value={progressPct} className="h-2" />
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={syncing}>
              Cancel
            </Button>
            <Button
              onClick={handleSync}
              disabled={!canSync || syncing}
              className="gap-1.5"
            >
              {syncing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : mode === 'create_and_update' ? (
                <ShieldAlert className="h-3.5 w-3.5" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              {syncing
                ? 'Syncing…'
                : `Sync ${actionableRows.length} account${actionableRows.length !== 1 ? 's' : ''}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
