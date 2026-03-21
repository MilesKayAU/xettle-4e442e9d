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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Loader2, Copy, AlertTriangle, CheckCircle2, ArrowRight, ShieldAlert, Sparkles, ChevronDown, Info } from 'lucide-react';
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
import { supabase } from '@/integrations/supabase/client';

/** Categories that are typically Amazon-specific */
const AMAZON_SPECIFIC = new Set(['FBA Fees', 'Storage Fees']);

/** Optional categories that users should choose before cloning */
const OPTIONAL_CATEGORIES: { key: string; label: string; description: string; defaultFor: string[] }[] = [
  { key: 'FBA Fees', label: 'Fulfilment (FBA) Fees', description: 'Third-party warehouse fulfilment fees. Common for Amazon FBA, some marketplaces offer similar services.', defaultFor: ['amazon'] },
  { key: 'Storage Fees', label: 'Storage Fees', description: 'Warehouse storage charges. Usually only Amazon FBA, but some 3PL marketplaces charge these too.', defaultFor: ['amazon'] },
  { key: 'Advertising Costs', label: 'Advertising Costs', description: 'Sponsored ads / promoted listings on this marketplace.', defaultFor: [] },
  { key: 'Reimbursements', label: 'Reimbursements', description: 'Lost/damaged inventory reimbursements from the marketplace.', defaultFor: ['amazon'] },
  { key: 'Promotional Discounts', label: 'Promotional Discounts', description: 'Marketplace-funded or seller-funded promotional discounts.', defaultFor: [] },
];

interface AiVerdict {
  category: string;
  verdict: 'pass' | 'warn' | 'fail';
  reason?: string;
  suggestedCode?: string;
  suggestedType?: string;
}

interface AiReviewResult {
  verdicts: AiVerdict[];
  overallAdvice: string[];
  overallVerdict: 'pass' | 'warn' | 'fail';
}

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
  const [showChecklist, setShowChecklist] = useState(true);
  const [categorySelections, setCategorySelections] = useState<Record<string, boolean>>({});

  // AI Review state
  const [aiReview, setAiReview] = useState<AiReviewResult | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiAdviceOpen, setAiAdviceOpen] = useState(false);

  const allCodes = useMemo(() =>
    coaAccounts.filter(a => a.account_code).map(a => a.account_code!),
    [coaAccounts]
  );

  const isNonAuGst = taxProfile && taxProfile !== 'AU_GST';

  // Validate template eligibility — relaxed since we supplement with best-practice defaults
  const templateEligibility = useMemo(() => {
    if (!templateMarketplace) return { eligible: true };
    // Any marketplace with at least 1 account is eligible as a template
    // since missing categories are filled from other marketplaces or defaults
    const templates = coaAccounts.filter(a => {
      if (!a.account_code || !a.is_active) return false;
      const words = templateMarketplace.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
      return words.length > 0
        ? words.every(w => a.account_name.toLowerCase().includes(w))
        : a.account_name.toLowerCase().includes(templateMarketplace.toLowerCase());
    });
    return templates.length > 0
      ? { eligible: true }
      : { eligible: false, reason: `No matching COA accounts found for ${templateMarketplace}. Try a different template.` };
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
      allCoveredMarketplaces: coveredMarketplaces,
    });

    // Apply category checklist selections to optional categories
    const adjustedRows = rows.map(row => {
      const optCat = OPTIONAL_CATEGORIES.find(c => c.key === row.category);
      if (optCat && categorySelections[row.category] === false) {
        return { ...row, enabled: false };
      }
      return row;
    });

    setCloneRows(adjustedRows);
    setAiReview(null); // Reset AI review when rows change

    // Log preview generation event (telemetry)
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await logCloneEvent({
            userId: user.id,
            eventType: 'coa_clone_previewed',
            templateMarketplace,
            targetMarketplace,
            accountsCreated: adjustedRows.filter(r => r.enabled).length,
            taxProfile: undefined,
          });
        }
      } catch { /* non-critical */ }
    })();
  }, [templateMarketplace, open, coaAccounts, allCodes, targetMarketplace, templateEligibility.eligible, matchPattern, categorySelections]);

  // Reset on open — prefer simpler marketplace templates (non-Amazon) as defaults
  useEffect(() => {
    if (open) {
      const preferredOrder = ['ebay_au', 'shopify', 'catch_au', 'kogan_au', 'mydeal_au'];
      const bestDefault = preferredOrder.find(p => coveredMarketplaces.includes(p))
        || coveredMarketplaces.find(c => !c.startsWith('amazon'))
        || coveredMarketplaces[0]
        || '';
      setTemplateMarketplace(bestDefault);
      setAiReview(null);
      setShowChecklist(true);

      // Initialize category selections based on target marketplace
      const isAmazonTarget = targetMarketplace.toLowerCase().includes('amazon');
      const defaults: Record<string, boolean> = {};
      for (const cat of OPTIONAL_CATEGORIES) {
        defaults[cat.key] = cat.defaultFor.length === 0 
          ? true  // Always-on categories like Advertising
          : cat.defaultFor.some(d => isAmazonTarget || targetMarketplace.toLowerCase().includes(d));
      }
      setCategorySelections(defaults);
    }
  }, [open, coveredMarketplaces, targetMarketplace]);

  const enabledRows = cloneRows.filter(r => r.enabled);

  // AI Review handler
  const handleAiReview = async () => {
    if (enabledRows.length === 0) return;
    setAiLoading(true);
    setAiReview(null);
    try {
      const { data, error } = await supabase.functions.invoke('ai-coa-clone-review', {
        body: {
          cloneRows: enabledRows.map(r => ({
            category: r.category,
            newCode: r.newCode,
            newName: r.newName,
            type: r.type,
            templateCode: r.templateCode,
            templateName: r.templateName,
          })),
          existingAccounts: coaAccounts.slice(0, 80),
          targetMarketplace,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setAiReview(data as AiReviewResult);
      setAiAdviceOpen(true);
    } catch (err: any) {
      toast.error(`AI review failed: ${err.message}`);
    } finally {
      setAiLoading(false);
    }
  };

  // Get AI verdict for a specific category
  const getRowVerdict = (category: string): AiVerdict | undefined => {
    return aiReview?.verdicts.find(v => v.category === category);
  };

  const handleCreate = async () => {
    if (enabledRows.length === 0) {
      toast.error('No accounts selected to create');
      return;
    }

    // Get user for event logging
    const { data: { user } } = await supabase.auth.getUser();
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

  // Detect which rows would collide with existing Xero accounts
  const existingCodeSet = useMemo(() => new Set(allCodes), [allCodes]);
  const existingCollisions = useMemo(() => {
    const collisions = new Set<number>();
    for (let i = 0; i < cloneRows.length; i++) {
      if (cloneRows[i].enabled && existingCodeSet.has(cloneRows[i].newCode)) {
        collisions.add(i);
      }
    }
    return collisions;
  }, [cloneRows, existingCodeSet]);

  const allNewAccounts = enabledRows.length > 0 && existingCollisions.size === 0 && codeConflicts.size === 0;
  const hasOverwriteRisk = existingCollisions.size > 0;

  const verdictIcon = (verdict: string) => {
    if (verdict === 'pass') return <CheckCircle2 className="h-3 w-3 text-emerald-600" />;
    if (verdict === 'warn') return <AlertTriangle className="h-3 w-3 text-amber-500" />;
    return <ShieldAlert className="h-3 w-3 text-destructive" />;
  };

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

          {/* Category checklist — ask which optional account types to create */}
          {templateMarketplace && templateEligibility.eligible && (
            <div className="rounded-lg border bg-muted/30 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-medium">Which account categories does {targetMarketplace} need?</Label>
                <button
                  onClick={() => setShowChecklist(!showChecklist)}
                  className="text-[10px] text-primary hover:underline"
                >
                  {showChecklist ? 'Hide' : 'Show'}
                </button>
              </div>
              {showChecklist && (
                <div className="space-y-1.5">
                  <p className="text-[10px] text-muted-foreground">
                    Core categories (Sales, Shipping, Refunds, Seller Fees, Other Fees) are always included. Toggle optional categories below:
                  </p>
                  {OPTIONAL_CATEGORIES.map(cat => {
                    const isChecked = categorySelections[cat.key] !== false;
                    return (
                      <label
                        key={cat.key}
                        className="flex items-start gap-2 rounded-md border bg-background px-3 py-2 cursor-pointer hover:bg-accent/50 transition-colors"
                      >
                        <Checkbox
                          checked={isChecked}
                          onCheckedChange={(checked) => {
                            setCategorySelections(prev => ({ ...prev, [cat.key]: !!checked }));
                          }}
                          className="mt-0.5"
                        />
                        <div className="flex-1 min-w-0">
                          <span className="text-xs font-medium">{cat.label}</span>
                          <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">{cat.description}</p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}

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
                    {aiReview && <th className="p-2 w-8 text-center font-medium">AI</th>}
                  </tr>
                </thead>
                <tbody>
                  {cloneRows.map((row, idx) => {
                    const rowVerdict = getRowVerdict(row.category);
                    return (
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
                          {row.templateCode === '—' ? (
                            <span className="text-xs italic">best practice default</span>
                          ) : (
                            <><span className="font-mono">{row.templateCode}</span> — {row.templateName}</>
                          )}
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
                          {codeConflicts.has(idx) && existingCollisions.has(idx) && (
                            <span className="text-[9px] text-destructive flex items-center gap-0.5 mt-0.5">
                              <AlertTriangle className="h-2.5 w-2.5" /> Exists in Xero — will be blocked
                            </span>
                          )}
                          {codeConflicts.has(idx) && !existingCollisions.has(idx) && (
                            <span className="text-[9px] text-destructive">Code conflict</span>
                          )}
                          {!codeConflicts.has(idx) && row.enabled && (
                            <span className="text-[9px] text-emerald-600 flex items-center gap-0.5 mt-0.5">
                              <CheckCircle2 className="h-2.5 w-2.5" /> New
                            </span>
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
                        {aiReview && (
                          <td className="p-2 text-center" title={rowVerdict?.reason || 'OK'}>
                            {rowVerdict ? verdictIcon(rowVerdict.verdict) : <CheckCircle2 className="h-3 w-3 text-emerald-600" />}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* AI Review section */}
          {cloneRows.length > 0 && enabledRows.length > 0 && (
            <div className="space-y-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleAiReview}
                disabled={aiLoading || enabledRows.length === 0}
                className="gap-1.5 text-xs"
              >
                {aiLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Sparkles className="h-3 w-3" />
                )}
                {aiLoading ? 'Reviewing…' : aiReview ? 'Re-run AI Review' : 'AI Review'}
              </Button>

              {aiReview && (
                <div className="space-y-2">
                  {/* Overall verdict badge */}
                  <div className="flex items-center gap-2">
                    {verdictIcon(aiReview.overallVerdict)}
                    <span className="text-xs font-medium">
                      {aiReview.overallVerdict === 'pass' && 'Structure looks good'}
                      {aiReview.overallVerdict === 'warn' && 'Minor suggestions available'}
                      {aiReview.overallVerdict === 'fail' && 'Issues detected — review before creating'}
                    </span>
                  </div>

                  {/* Per-row warnings */}
                  {aiReview.verdicts.filter(v => v.verdict !== 'pass' && v.reason).map((v, i) => (
                    <div key={i} className="flex items-start gap-2 text-[10px] text-muted-foreground bg-muted/50 rounded px-2 py-1.5">
                      {verdictIcon(v.verdict)}
                      <span><strong>{v.category}:</strong> {v.reason}
                        {v.suggestedCode && <> — suggest code <span className="font-mono">{v.suggestedCode}</span></>}
                        {v.suggestedType && <> as <span className="font-mono">{v.suggestedType}</span></>}
                      </span>
                    </div>
                  ))}

                  {/* Best practice advice */}
                  {aiReview.overallAdvice.length > 0 && (
                    <Collapsible open={aiAdviceOpen} onOpenChange={setAiAdviceOpen}>
                      <CollapsibleTrigger className="flex items-center gap-1 text-xs text-primary hover:underline">
                        <Info className="h-3 w-3" />
                        Xero best-practice tips
                        <ChevronDown className={`h-3 w-3 transition-transform ${aiAdviceOpen ? 'rotate-180' : ''}`} />
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <ul className="mt-1.5 space-y-1 text-[10px] text-muted-foreground list-disc pl-4">
                          {aiReview.overallAdvice.map((tip, i) => (
                            <li key={i}>{tip}</li>
                          ))}
                        </ul>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </div>
              )}
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

          {enabledRows.length > 0 && allNewAccounts && (
            <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 dark:bg-emerald-900/20 dark:text-emerald-400 rounded-md px-3 py-2 border border-emerald-200 dark:border-emerald-800">
              <CheckCircle2 className="h-3.5 w-3.5" />
              <span>
                All {enabledRows.length} account{enabledRows.length !== 1 ? 's' : ''} are new — no existing Xero data will be affected.
                {enabledRows.length > 10 && ` (in ${Math.ceil(enabledRows.length / 10)} batches)`}
              </span>
            </div>
          )}

          {enabledRows.length > 0 && hasOverwriteRisk && (
            <Alert className="border-destructive/50 bg-destructive/5">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <AlertDescription className="text-xs">
                <strong>{existingCollisions.size} account code{existingCollisions.size !== 1 ? 's' : ''} already exist in Xero</strong> and will be blocked from creation.
                Change the conflicting codes above or deselect those rows before proceeding.
              </AlertDescription>
            </Alert>
          )}

          <Alert className="border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-xs text-amber-900 dark:text-amber-300">
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
