import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Switch } from '@/components/ui/switch';
import { Loader2, Copy, AlertTriangle, CheckCircle2, ArrowRight, ShieldAlert } from 'lucide-react';
import { toast } from 'sonner';
import {
  getCachedXeroAccounts,
  getCoaLastSyncedAt,
  buildClonePreview,
  executeCoaClone,
  validateTemplateEligibility,
  logCloneEvent,
  type CachedXeroAccount,
  type CloneAccountRow,
} from '@/actions';
import { validateAccountCode } from '@/policy/accountCodePolicy';

/** Categories that are typically Amazon-specific */
const AMAZON_SPECIFIC = new Set(['FBA Fees', 'Storage Fees']);

interface CloneCoaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetMarketplace: string;
  coveredMarketplaces: string[];
  coaAccounts: CachedXeroAccount[];
  /** Current org tax profile from app_settings */
  taxProfile: string | null;
  onComplete: (createdCodes: Record<string, string>) => void;
}

export default function CloneCoaDialog({
  open,
  onOpenChange,
  targetMarketplace,
  coveredMarketplaces,
  coaAccounts,
  taxProfile,
  onComplete,
}: CloneCoaDialogProps) {
  const [templateMarketplace, setTemplateMarketplace] = useState('');
  const [cloneRows, setCloneRows] = useState<CloneAccountRow[]>([]);
  const [creating, setCreating] = useState(false);
  const [matchPattern, setMatchPattern] = useState(true);

  const allCodes = useMemo(() =>
    coaAccounts.filter(a => a.account_code).map(a => a.account_code!),
    [coaAccounts]
  );

  const isNonAuGst = taxProfile && taxProfile !== 'AU_GST';

  // Validate template eligibility (prevent clone loops)
  const templateEligibility = useMemo(() => {
    if (!templateMarketplace) return { eligible: true };
    return validateTemplateEligibility(templateMarketplace, coaAccounts);
  }, [templateMarketplace, coaAccounts]);

  // When template changes, rebuild the clone rows via canonical action
  useEffect(() => {
    if (!templateMarketplace || !open) return;
    if (!templateEligibility.eligible) {
      setCloneRows([]);
      return;
    }

    const rows = buildClonePreview({
      templateMarketplace,
      targetMarketplace,
      coaAccounts,
      existingCodes: allCodes,
      matchPattern,
    });

    setCloneRows(rows);
  }, [templateMarketplace, open, coaAccounts, allCodes, targetMarketplace, templateEligibility.eligible, matchPattern]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setTemplateMarketplace(coveredMarketplaces[0] || '');
    }
  }, [open, coveredMarketplaces]);

  const enabledRows = cloneRows.filter(r => r.enabled);

  const handleCreate = async () => {
    if (enabledRows.length === 0) {
      toast.error('No accounts selected to create');
      return;
    }

    // Get user for event logging
    const { data: { user } } = await (await import('@/integrations/supabase/client')).supabase.auth.getUser();
    const userId = user?.id || 'unknown';

    setCreating(true);
    try {
      const result = await executeCoaClone({ rows: cloneRows });

      if (result.errors.length > 0) {
        for (const err of result.errors) {
          toast.error(err.code ? `${err.code}: ${err.error}` : err.error);
        }
      }

      if (result.success) {
        const count = Object.keys(result.createdMappings).length;
        toast.success(`Created ${count} account${count !== 1 ? 's' : ''} in Xero for ${targetMarketplace}`);

        // Log success event
        await logCloneEvent({
          userId,
          eventType: 'coa_clone_executed',
          templateMarketplace,
          targetMarketplace,
          accountsCreated: count,
          taxProfile,
        });

        onOpenChange(false);
        onComplete(result.createdMappings);
      } else {
        // Log failure event
        await logCloneEvent({
          userId,
          eventType: 'coa_clone_failed',
          templateMarketplace,
          targetMarketplace,
          taxProfile,
          errors: result.errors.map(e => e.error),
        });
      }
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
      await logCloneEvent({
        userId,
        eventType: 'coa_clone_failed',
        templateMarketplace,
        targetMarketplace,
        taxProfile,
        errors: [err.message],
      });
    } finally {
      setCreating(false);
    }
  };

  const toggleRow = (idx: number) => {
    setCloneRows(prev => prev.map((r, i) =>
      i === idx ? { ...r, enabled: !r.enabled } : r
    ));
  };

  const updateRowCode = (idx: number, code: string) => {
    setCloneRows(prev => prev.map((r, i) =>
      i === idx ? { ...r, newCode: code } : r
    ));
  };

  const updateRowName = (idx: number, name: string) => {
    setCloneRows(prev => prev.map((r, i) =>
      i === idx ? { ...r, newName: name } : r
    ));
  };

  // Check for code conflicts using policy
  const codeConflicts = useMemo(() => {
    const conflicts = new Set<number>();
    const usedInRows = new Map<string, number>();
    for (let i = 0; i < cloneRows.length; i++) {
      const row = cloneRows[i];
      if (!row.enabled) continue;
      const validation = validateAccountCode(row.newCode, allCodes, row.type);
      if (!validation.valid) {
        conflicts.add(i);
      }
      if (usedInRows.has(row.newCode)) {
        conflicts.add(i);
        conflicts.add(usedInRows.get(row.newCode)!);
      }
      usedInRows.set(row.newCode, i);
    }
    return conflicts;
  }, [cloneRows, allCodes]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <Copy className="h-4 w-4 text-primary" />
            Clone COA Structure for {targetMarketplace}
          </DialogTitle>
          <DialogDescription className="text-xs">
            Create Xero accounts for {targetMarketplace} based on an existing marketplace's structure.
            Choose a template, review the accounts, then create them in one batch.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Tax profile warning */}
          {isNonAuGst && (
            <Alert className="border-amber-300 bg-amber-50">
              <ShieldAlert className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-xs text-amber-900">
                Your tax profile is <strong>{taxProfile}</strong>. Template accounts use AU GST tax types.
                Verify these tax types are correct for your setup before proceeding.
                Clone does not change your support tier — push gating still applies.
              </AlertDescription>
            </Alert>
          )}

          {/* Template selector */}
          <div>
            <Label className="text-xs font-medium">Clone structure from</Label>
            <Select value={templateMarketplace} onValueChange={setTemplateMarketplace}>
              <SelectTrigger className="h-8 text-sm mt-1">
                <SelectValue placeholder="Select a template marketplace…" />
              </SelectTrigger>
              <SelectContent>
                {coveredMarketplaces.map(mp => (
                  <SelectItem key={mp} value={mp}>{mp}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Match numbering style toggle */}
          <div className="flex items-center justify-between rounded-md border px-3 py-2">
            <div>
              <Label className="text-xs font-medium">Match numbering style</Label>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                Replicate decimal conventions (e.g. 200 → 200.1) from the template
              </p>
            </div>
            <Switch checked={matchPattern} onCheckedChange={setMatchPattern} />
          </div>


          {templateMarketplace && !templateEligibility.eligible && (
            <Alert className="border-destructive/50 bg-destructive/5">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <AlertDescription className="text-xs text-destructive">
                {templateEligibility.reason}
              </AlertDescription>
            </Alert>
          )}

          {/* Preview table */}
          {cloneRows.length > 0 && (
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b bg-muted/50">
                    <th className="p-2 w-8"></th>
                    <th className="p-2 text-left font-medium">Category</th>
                    <th className="p-2 text-left font-medium">Template</th>
                    <th className="p-2 w-6"></th>
                    <th className="p-2 text-left font-medium">New Code</th>
                    <th className="p-2 text-left font-medium">New Name</th>
                  </tr>
                </thead>
                <tbody>
                  {cloneRows.map((row, idx) => (
                    <tr
                      key={row.category}
                      className={`border-b last:border-b-0 ${!row.enabled ? 'opacity-40' : ''} ${codeConflicts.has(idx) ? 'bg-destructive/5' : ''}`}
                    >
                      <td className="p-2">
                        <Checkbox
                          checked={row.enabled}
                          onCheckedChange={() => toggleRow(idx)}
                        />
                      </td>
                      <td className="p-2">
                        <span className="font-medium">{row.category}</span>
                        {AMAZON_SPECIFIC.has(row.category) && !targetMarketplace.toLowerCase().includes('amazon') && (
                          <Badge variant="outline" className="ml-1 text-[9px]">Amazon-specific</Badge>
                        )}
                      </td>
                      <td className="p-2 text-muted-foreground">
                        <span className="font-mono">{row.templateCode}</span> — {row.templateName}
                      </td>
                      <td className="p-2 text-muted-foreground">
                        <ArrowRight className="h-3 w-3" />
                      </td>
                      <td className="p-2">
                        <Input
                          className="h-6 w-16 text-xs font-mono"
                          value={row.newCode}
                          onChange={(e) => updateRowCode(idx, e.target.value)}
                          disabled={!row.enabled}
                        />
                        {codeConflicts.has(idx) && (
                          <span className="text-[9px] text-destructive">Code conflict</span>
                        )}
                      </td>
                      <td className="p-2">
                        <Input
                          className="h-6 w-full text-xs"
                          value={row.newName}
                          onChange={(e) => updateRowName(idx, e.target.value)}
                          disabled={!row.enabled}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {cloneRows.length === 0 && templateMarketplace && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="text-xs">
                No matching accounts found in {templateMarketplace}'s COA structure.
                Try a different template marketplace or create accounts manually.
              </AlertDescription>
            </Alert>
          )}

          {enabledRows.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/30 rounded-md px-3 py-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
              <span>
                {enabledRows.length} account{enabledRows.length !== 1 ? 's' : ''} will be created in Xero
                {enabledRows.length > 10 && ` (in ${Math.ceil(enabledRows.length / 10)} batches)`}
              </span>
            </div>
          )}

          <Alert className="border-amber-300 bg-amber-50">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-xs text-amber-900">
              This will create new accounts in your Xero Chart of Accounts. Tax types are inherited from the template.
              Cloning accounts does not change support tier — push gating still applies per marketplace.
            </AlertDescription>
          </Alert>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={creating}>
            Cancel
          </Button>
          <Button
            onClick={handleCreate}
            disabled={creating || enabledRows.length === 0 || codeConflicts.size > 0}
            className="gap-1"
          >
            {creating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Copy className="h-3 w-3" />}
            Create {enabledRows.length} Account{enabledRows.length !== 1 ? 's' : ''} in Xero
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
