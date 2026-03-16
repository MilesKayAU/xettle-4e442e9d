import React, { useState, useEffect, useMemo } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, Copy, AlertTriangle, CheckCircle2, ArrowRight } from 'lucide-react';
import { toast } from 'sonner';
import {
  createXeroAccounts,
  getCachedXeroAccounts,
  getCoaLastSyncedAt,
  type CachedXeroAccount,
} from '@/actions';

const CLONE_CATEGORIES = [
  'Sales', 'Shipping', 'Promotional Discounts', 'Refunds', 'Reimbursements',
  'Seller Fees', 'FBA Fees', 'Storage Fees', 'Advertising Costs', 'Other Fees',
] as const;

const REVENUE_CATEGORIES = new Set(['Sales', 'Shipping', 'Promotional Discounts', 'Refunds', 'Reimbursements']);

/** Categories that are typically Amazon-specific */
const AMAZON_SPECIFIC = new Set(['FBA Fees', 'Storage Fees']);

interface TemplateAccount {
  category: string;
  code: string;
  name: string;
  type: string;
  taxType: string | null;
}

interface CloneRow {
  category: string;
  enabled: boolean;
  templateCode: string;
  templateName: string;
  newCode: string;
  newName: string;
  type: string;
  taxType: string | null;
}

interface CloneCoaDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targetMarketplace: string;
  coveredMarketplaces: string[];
  coaAccounts: CachedXeroAccount[];
  onComplete: (createdCodes: Record<string, string>) => void;
}

/**
 * Detect which COA accounts belong to a given marketplace, grouped by category.
 * Uses keyword matching similar to the AI mapper.
 */
function findTemplateAccounts(
  marketplace: string,
  coaAccounts: CachedXeroAccount[]
): TemplateAccount[] {
  const mpLower = marketplace.toLowerCase();
  const results: TemplateAccount[] = [];

  // Build keyword variants for the marketplace
  const keywords = [mpLower];
  if (mpLower.includes('amazon')) {
    keywords.push('amazon');
    if (mpLower.includes('au')) keywords.push('amazon au', 'amazon sales au');
    if (mpLower.includes('usa')) keywords.push('amazon usa', 'amazon sales usa');
  }

  for (const acc of coaAccounts) {
    if (!acc.account_code || !acc.is_active) continue;
    const nameLower = acc.account_name.toLowerCase();

    // Check if this account matches the marketplace
    const matchesMarketplace = keywords.some(kw => nameLower.includes(kw));
    if (!matchesMarketplace) continue;

    // Determine category from account name
    const category = detectCategory(nameLower);
    if (category) {
      results.push({
        category,
        code: acc.account_code,
        name: acc.account_name,
        type: acc.account_type || 'REVENUE',
        taxType: acc.tax_type || null,
      });
    }
  }

  return results;
}

function detectCategory(nameLower: string): string | null {
  if (/advertis/i.test(nameLower)) return 'Advertising Costs';
  if (/storage/i.test(nameLower)) return 'Storage Fees';
  if (/fba|fulfilment|fulfillment/i.test(nameLower)) return 'FBA Fees';
  if (/refund/i.test(nameLower)) return 'Refunds';
  if (/reimburse/i.test(nameLower)) return 'Reimbursements';
  if (/shipping|freight|delivery/i.test(nameLower) && /revenue|income|sales/i.test(nameLower)) return 'Shipping';
  if (/promotional|promo|discount|voucher/i.test(nameLower)) return 'Promotional Discounts';
  if (/seller fee|commission|referral/i.test(nameLower)) return 'Seller Fees';
  if (/\bfee/i.test(nameLower) && !/fba|storage|advertis|shipping/i.test(nameLower)) return 'Seller Fees';
  if (/other.*fee|miscellaneous/i.test(nameLower)) return 'Other Fees';
  if (/sales|revenue|income/i.test(nameLower)) return 'Sales';
  if (/shipping/i.test(nameLower)) return 'Shipping';
  return null;
}

function suggestNextCode(existingCodes: string[], rangeStart: number): string {
  const numericCodes = existingCodes
    .map(c => parseInt(c, 10))
    .filter(n => !isNaN(n))
    .sort((a, b) => a - b);

  const rangeEnd = rangeStart + 199;
  const codesInRange = numericCodes.filter(c => c >= rangeStart && c <= rangeEnd);
  if (codesInRange.length === 0) return String(rangeStart);
  return String(Math.max(...codesInRange) + 1);
}

function generateNewName(templateName: string, templateMarketplace: string, targetMarketplace: string): string {
  // Replace the template marketplace name with the target marketplace name
  // Handle various formats: "Amazon Sales AU" → "BigW Sales AU"
  const escapedMp = templateMarketplace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapedMp, 'gi');
  const replaced = templateName.replace(regex, targetMarketplace);
  if (replaced !== templateName) return replaced;

  // Fallback: replace first word cluster that matches
  const mpWords = templateMarketplace.split(/\s+/);
  let result = templateName;
  for (const word of mpWords) {
    const wordRegex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    result = result.replace(wordRegex, targetMarketplace);
    if (result !== templateName) break;
  }
  return result !== templateName ? result : `${targetMarketplace} ${templateName}`;
}

export default function CloneCoaDialog({
  open,
  onOpenChange,
  targetMarketplace,
  coveredMarketplaces,
  coaAccounts,
  onComplete,
}: CloneCoaDialogProps) {
  const [templateMarketplace, setTemplateMarketplace] = useState('');
  const [cloneRows, setCloneRows] = useState<CloneRow[]>([]);
  const [creating, setCreating] = useState(false);

  const allCodes = useMemo(() =>
    coaAccounts.filter(a => a.account_code).map(a => a.account_code!),
    [coaAccounts]
  );

  // When template changes, rebuild the clone rows
  useEffect(() => {
    if (!templateMarketplace || !open) return;

    const templateAccounts = findTemplateAccounts(templateMarketplace, coaAccounts);
    const usedCodes = new Set(allCodes);
    const rows: CloneRow[] = [];

    for (const cat of CLONE_CATEGORIES) {
      const templateAcc = templateAccounts.find(ta => ta.category === cat);
      if (!templateAcc) continue;

      const isRevenue = REVENUE_CATEGORIES.has(cat);
      const rangeStart = isRevenue ? 200 : 400;

      // Find next available code
      let nextCode = parseInt(suggestNextCode([...usedCodes], rangeStart), 10);
      while (usedCodes.has(String(nextCode))) nextCode++;
      usedCodes.add(String(nextCode));

      const newName = generateNewName(templateAcc.name, templateMarketplace, targetMarketplace);
      const isAmazonSpecific = AMAZON_SPECIFIC.has(cat);
      const targetIsAmazon = targetMarketplace.toLowerCase().includes('amazon');

      rows.push({
        category: cat,
        enabled: isAmazonSpecific ? targetIsAmazon : true,
        templateCode: templateAcc.code,
        templateName: templateAcc.name,
        newCode: String(nextCode),
        newName: newName,
        type: templateAcc.type,
        taxType: templateAcc.taxType,
      });
    }

    setCloneRows(rows);
  }, [templateMarketplace, open, coaAccounts, allCodes, targetMarketplace]);

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

    setCreating(true);
    try {
      // Batch in groups of 10
      const batches: CloneRow[][] = [];
      for (let i = 0; i < enabledRows.length; i += 10) {
        batches.push(enabledRows.slice(i, i + 10));
      }

      const allCreated: Record<string, string> = {};
      for (const batch of batches) {
        const accounts = batch.map(row => ({
          code: row.newCode,
          name: row.newName,
          type: row.type,
          tax_type: row.taxType || undefined,
        }));

        const result = await createXeroAccounts(accounts);
        if (!result.success) {
          toast.error(`Failed: ${result.error}`);
          return;
        }
        if (result.errors && result.errors.length > 0) {
          for (const err of result.errors) {
            toast.error(`${err.code}: ${err.error}`);
          }
        }
        if (result.created) {
          for (const created of result.created) {
            const matchingRow = batch.find(r => r.newCode === created.code);
            if (matchingRow) {
              allCreated[matchingRow.category] = created.code;
            }
          }
        }
      }

      const count = Object.keys(allCreated).length;
      toast.success(`Created ${count} account${count !== 1 ? 's' : ''} in Xero for ${targetMarketplace}`);
      onOpenChange(false);
      onComplete(allCreated);
    } catch (err: any) {
      toast.error(`Error: ${err.message}`);
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

  // Check for code conflicts
  const codeConflicts = useMemo(() => {
    const conflicts = new Set<number>();
    const usedInRows = new Map<string, number>();
    for (let i = 0; i < cloneRows.length; i++) {
      const row = cloneRows[i];
      if (!row.enabled) continue;
      if (allCodes.includes(row.newCode)) {
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
                          <Badge variant="outline" className="ml-1 text-[9px] text-amber-700 border-amber-300">Amazon-specific</Badge>
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
                          <span className="text-[9px] text-destructive">Code exists</span>
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

          <Alert variant="destructive" className="border-amber-300 bg-amber-50 text-amber-900">
            <AlertTriangle className="h-4 w-4 text-amber-600" />
            <AlertDescription className="text-xs">
              This will create new accounts in your Xero Chart of Accounts. Tax types will be inherited from the template accounts. Review codes and names before proceeding.
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
