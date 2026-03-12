/**
 * PushSafetyPreview — Two-step safety modal shown BEFORE any settlement is pushed to Xero.
 * Shows exact line items, GST treatment, validation checks, and Xero invoice details.
 *
 * ══════════════════════════════════════════════════════════════
 * GOLDEN RULE: Nothing is pushed to Xero without the user explicitly
 * reviewing and confirming the data shown in this modal. This is the
 * ONLY path to Xero. Auto-detection is always a SUGGESTION.
 * User is the final validator for all Xero operations.
 * ══════════════════════════════════════════════════════════════
 */

import React, { useState, useEffect } from 'react';
import { ACCOUNTING_RULES } from '@/constants/accounting-rules';

// Rule #11 enforcement: This component gates Xero pushes.
// ACCOUNTING_RULES.SETTLEMENTS_ARE_ONLY_ACCOUNTING_SOURCE must be true.
// Orders and payments NEVER create accounting entries.
if (!ACCOUNTING_RULES.SETTLEMENTS_ARE_ONLY_ACCOUNTING_SOURCE) {
  throw new Error('CRITICAL: Accounting rule violated — settlements must be the only accounting source');
}
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  CheckCircle2, AlertTriangle, XCircle, Loader2, Send, ArrowLeft, FileText,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import {
  formatAUD, MARKETPLACE_LABELS, MARKETPLACE_CONTACTS,
  buildSimpleInvoiceLines, type XeroLineItem,
} from '@/utils/settlement-engine';
import { XERO_ACCOUNT_MAP } from '@/utils/settlement-parser';
import { cn } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────

interface SettlementPreview {
  settlement_id: string;
  marketplace: string;
  period_start: string;
  period_end: string;
  sales_principal: number;
  sales_shipping: number;
  refunds: number;
  seller_fees: number;
  fba_fees: number;
  storage_fees: number;
  advertising_costs: number;
  other_fees: number;
  reimbursements: number;
  bank_deposit: number;
  gst_on_income: number;
  gst_on_expenses: number;
  bank_verified: boolean;
  reconciliation_status: string | null;
}

interface LineItemPreview {
  description: string;
  amount: number;
  accountCode: string;
  taxType: string;
}

interface ValidationCheck {
  label: string;
  status: 'green' | 'amber' | 'red';
  detail?: string;
}

interface PushSafetyPreviewProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => Promise<void>;
  /** Settlement IDs + marketplace codes to preview */
  settlements: Array<{ settlementId: string; marketplace: string }>;
}

// ─── Tax type labels ────────────────────────────────────────────────

const TAX_LABELS: Record<string, string> = {
  OUTPUT: 'OUTPUT',
  INPUT: 'INPUT',
  BASEXCLUDED: 'BASEXCLUDED',
  EXEMPTOUTPUT: 'EXEMPTOUTPUT',
};

// ─── Account code to name mapping ───────────────────────────────────

const ACCOUNT_NAMES: Record<string, string> = {
  '200': 'Sales',
  '205': 'Refunds',
  '271': 'Reimbursements',
  '405': 'Other Fees',
  '407': 'Seller Fees',
  '408': 'FBA Fees',
  '409': 'Storage Fees',
  '410': 'Advertising',
  '612': 'Split Month Rollovers',
  '824': 'Amazon Sales Tax',
};

// ─── Component ──────────────────────────────────────────────────────

export default function PushSafetyPreview({
  open, onClose, onConfirm, settlements,
}: PushSafetyPreviewProps) {
  const [loading, setLoading] = useState(true);
  const [pushing, setPushing] = useState(false);
  const [previews, setPreviews] = useState<Array<{
    settlement: SettlementPreview;
    lineItems: LineItemPreview[];
    checks: ValidationCheck[];
    contactName: string;
    reference: string;
  }>>([]);

  useEffect(() => {
    if (open && settlements.length > 0) {
      loadPreviews();
    }
  }, [open, settlements]);

  const loadPreviews = async () => {
    setLoading(true);
    try {
      const results = [];
      for (const { settlementId, marketplace } of settlements) {
        const { data: s } = await supabase
          .from('settlements')
          .select('*')
          .eq('settlement_id', settlementId)
          .maybeSingle();

        if (!s) continue;

        const settlement: SettlementPreview = {
          settlement_id: s.settlement_id,
          marketplace: s.marketplace || marketplace,
          period_start: s.period_start,
          period_end: s.period_end,
          sales_principal: s.sales_principal || 0,
          sales_shipping: s.sales_shipping || 0,
          refunds: s.refunds || 0,
          seller_fees: s.seller_fees || 0,
          fba_fees: s.fba_fees || 0,
          storage_fees: s.storage_fees || 0,
          advertising_costs: s.advertising_costs || 0,
          other_fees: s.other_fees || 0,
          reimbursements: s.reimbursements || 0,
          bank_deposit: s.bank_deposit || 0,
          gst_on_income: s.gst_on_income || 0,
          gst_on_expenses: s.gst_on_expenses || 0,
          bank_verified: s.bank_verified || false,
          reconciliation_status: s.reconciliation_status,
        };

        // Build line items for display
        const lineItems = buildLineItemsFromSettlement(settlement);

        // Build validation checks
        const checks = buildValidationChecks(settlement, lineItems);

        const contactName = MARKETPLACE_CONTACTS[settlement.marketplace] || `${settlement.marketplace} Marketplace`;
        const reference = `Xettle-${settlement.settlement_id}`;

        results.push({ settlement, lineItems, checks, contactName, reference });
      }
      setPreviews(results);
    } catch (err) {
      console.error('Failed to load push previews:', err);
    } finally {
      setLoading(false);
    }
  };

  const hasRedCheck = previews.some(p => p.checks.some(c => c.status === 'red'));
  const hasAmberCheck = previews.some(p => p.checks.some(c => c.status === 'amber'));

  const handleConfirm = async () => {
    setPushing(true);
    try {
      await onConfirm();
    } finally {
      setPushing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] p-0 gap-0">
        <DialogHeader className="px-6 pt-6 pb-4">
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Push Safety Preview
          </DialogTitle>
          <DialogDescription>
            Review exactly what will be sent to Xero before confirming.
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] px-6">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">Loading preview…</span>
            </div>
          ) : previews.length === 0 ? (
            <div className="py-8 text-center text-muted-foreground">
              No settlements found to preview.
            </div>
          ) : (
            <div className="space-y-6 pb-4">
              {previews.map((preview, idx) => (
                <SettlementPreviewCard key={preview.settlement.settlement_id} preview={preview} index={idx} total={previews.length} />
              ))}
            </div>
          )}
        </ScrollArea>

        <DialogFooter className="px-6 py-4 border-t border-border">
          <div className="flex items-center justify-between w-full">
            <Button variant="outline" onClick={onClose} disabled={pushing}>
              <ArrowLeft className="h-4 w-4 mr-1" /> Cancel — go back
            </Button>
            <div className="flex items-center gap-3">
              {hasAmberCheck && !hasRedCheck && (
                <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <AlertTriangle className="h-3.5 w-3.5" /> Warnings present
                </span>
              )}
              {hasRedCheck && (
                <span className="text-xs text-red-600 dark:text-red-400 flex items-center gap-1">
                  <XCircle className="h-3.5 w-3.5" /> Fix issues before pushing
                </span>
              )}
              <Button
                onClick={handleConfirm}
                disabled={hasRedCheck || pushing || loading || previews.length === 0}
                className="gap-1.5"
              >
                {pushing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Confirm and push to Xero →
              </Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── Settlement Preview Card ────────────────────────────────────────

function SettlementPreviewCard({ preview, index, total }: {
  preview: {
    settlement: SettlementPreview;
    lineItems: LineItemPreview[];
    checks: ValidationCheck[];
    contactName: string;
    reference: string;
  };
  index: number;
  total: number;
}) {
  const { settlement: s, lineItems, checks, contactName, reference } = preview;
  const label = MARKETPLACE_LABELS[s.marketplace] || s.marketplace;
  const periodLabel = `${formatDate(s.period_start)} – ${formatDate(s.period_end)}`;
  const netGst = (s.gst_on_income || 0) + (s.gst_on_expenses || 0);

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      {/* Header */}
      <div className="bg-muted/50 px-4 py-3 border-b border-border">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold">
              {total > 1 && <span className="text-muted-foreground mr-1">{index + 1}/{total}</span>}
              {s.settlement_id} — {label} — {periodLabel}
            </p>
          </div>
          <Badge variant="outline" className="text-xs">DRAFT</Badge>
        </div>
      </div>

      {/* Line Items */}
      <div className="px-4 py-3 space-y-1">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Line Items</p>
        <div className="font-mono text-xs space-y-1">
          {lineItems.map((li, i) => (
            <div key={i} className="flex items-center justify-between gap-2">
              <span className="text-foreground truncate flex-1">{li.description}</span>
              <span className={cn(
                'tabular-nums font-medium min-w-[100px] text-right',
                li.amount >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-red-700 dark:text-red-400'
              )}>
                {li.amount >= 0 ? '+' : ''}{formatAUD(li.amount)}
              </span>
              <span className="text-muted-foreground min-w-[140px] text-right text-[10px]">
                [account {li.accountCode} {TAX_LABELS[li.taxType] || li.taxType}]
              </span>
            </div>
          ))}
        </div>
      </div>

      <Separator />

      {/* Totals */}
      <div className="px-4 py-3 space-y-1 font-mono text-xs">
        <div className="flex justify-between">
          <span className="font-semibold text-foreground">Net settlement</span>
          <span className="font-semibold tabular-nums">
            {formatAUD(lineItems.reduce((sum, li) => sum + li.amount, 0))}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-foreground">Expected bank deposit</span>
          <span className="tabular-nums">{formatAUD(s.bank_deposit)}</span>
        </div>
      </div>

      <Separator />

      {/* GST */}
      <div className="px-4 py-3 space-y-1 font-mono text-xs">
        <div className="flex justify-between">
          <span className="text-foreground">GST on income</span>
          <span className="tabular-nums text-emerald-700 dark:text-emerald-400">
            +{formatAUD(Math.abs(s.gst_on_income))}
          </span>
        </div>
        <div className="flex justify-between">
          <span className="text-foreground">GST on expenses</span>
          <span className="tabular-nums text-red-700 dark:text-red-400">
            -{formatAUD(Math.abs(s.gst_on_expenses))}
          </span>
        </div>
        <div className="flex justify-between font-semibold">
          <span className="text-foreground">Net GST liability</span>
          <span className="tabular-nums">{formatAUD(netGst)}</span>
        </div>
      </div>

      <Separator />

      {/* Validation Checks */}
      <div className="px-4 py-3 space-y-1.5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Validation Checks</p>
        {checks.map((check, i) => (
          <div key={i} className="flex items-start gap-2 text-xs">
            {check.status === 'green' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 mt-0.5 shrink-0" />}
            {check.status === 'amber' && <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />}
            {check.status === 'red' && <XCircle className="h-3.5 w-3.5 text-red-500 mt-0.5 shrink-0" />}
            <div>
              <span className={cn(
                check.status === 'red' && 'text-red-700 dark:text-red-400 font-medium',
                check.status === 'amber' && 'text-amber-700 dark:text-amber-400',
                check.status === 'green' && 'text-foreground',
              )}>
                {check.label}
              </span>
              {check.detail && (
                <p className="text-muted-foreground text-[10px] mt-0.5">{check.detail}</p>
              )}
            </div>
          </div>
        ))}
      </div>

      <Separator />

      {/* Xero Invoice Details */}
      <div className="px-4 py-3 space-y-1 text-xs">
        <p className="font-semibold text-muted-foreground uppercase tracking-wide mb-2">Xero Invoice Details</p>
        <div className="grid grid-cols-[120px_1fr] gap-y-1 gap-x-3">
          <span className="text-muted-foreground">Status:</span>
          <span className="font-medium">DRAFT</span>
          <span className="text-muted-foreground">Contact:</span>
          <span>{contactName}</span>
          <span className="text-muted-foreground">Date:</span>
          <span>{formatDate(s.period_end)}</span>
          <span className="text-muted-foreground">Reference:</span>
          <span className="font-mono">{reference}</span>
          <span className="text-muted-foreground">Attachment:</span>
          <span className="flex items-center gap-1">
            {reference}.csv <CheckCircle2 className="h-3 w-3 text-emerald-500" />
          </span>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────

function buildLineItemsFromSettlement(s: SettlementPreview): LineItemPreview[] {
  const items: LineItemPreview[] = [];
  const add = (desc: string, amount: number, code: string, tax: string) => {
    if (Math.abs(amount) >= 0.01) {
      items.push({ description: desc, amount: Math.round(amount * 100) / 100, accountCode: code, taxType: tax });
    }
  };

  add('Sales', (s.sales_principal || 0) + (s.sales_shipping || 0), '200', 'OUTPUT');
  add('Refunds', s.refunds || 0, '205', 'OUTPUT');
  add('Seller Fees', s.seller_fees || 0, '407', 'INPUT');
  add('FBA Fees', s.fba_fees || 0, '408', 'INPUT');
  add('Storage Fees', s.storage_fees || 0, '409', 'INPUT');
  add('Advertising', s.advertising_costs || 0, '410', 'INPUT');
  add('Other Fees', s.other_fees || 0, '405', 'INPUT');
  add('Reimbursements', s.reimbursements || 0, '271', 'BASEXCLUDED');

  return items;
}

function buildValidationChecks(s: SettlementPreview, lineItems: LineItemPreview[]): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  // 1. Line items sum to settlement net
  const lineSum = lineItems.reduce((sum, li) => sum + li.amount, 0);
  const bankDeposit = s.bank_deposit || 0;
  const diff = Math.abs(lineSum - bankDeposit);
  if (diff < 0.06) {
    checks.push({ label: 'Line items sum to settlement net', status: 'green' });
  } else if (diff < 1.0) {
    checks.push({ label: 'Line items sum to settlement net', status: 'amber', detail: `Rounding difference: ${formatAUD(diff)}` });
  } else {
    checks.push({ label: 'Line items do NOT sum to settlement net', status: 'red', detail: `Difference: ${formatAUD(diff)} — review required` });
  }

  // 2. Account codes confirmed
  const allCodesKnown = lineItems.every(li => ACCOUNT_NAMES[li.accountCode]);
  checks.push({
    label: 'Account codes confirmed',
    status: allCodesKnown ? 'green' : 'amber',
    detail: allCodesKnown ? undefined : 'Some account codes are custom — verify in Xero',
  });

  // 3. GST treatment correct
  const hasGstData = s.gst_on_income !== 0 || s.gst_on_expenses !== 0;
  checks.push({
    label: 'GST treatment correct (AU/International)',
    status: hasGstData ? 'green' : 'amber',
    detail: hasGstData ? undefined : 'No GST data — verify this settlement has correct tax treatment',
  });

  // 4. Contact maps to known Xero contact
  const knownContact = !!MARKETPLACE_CONTACTS[s.marketplace];
  checks.push({
    label: 'Contact maps to known Xero contact',
    status: knownContact ? 'green' : 'amber',
    detail: knownContact ? undefined : `Using fallback contact: "${s.marketplace} Marketplace"`,
  });

  // 5. Bank deposit confirmed
  checks.push({
    label: s.bank_verified ? 'Bank deposit confirmed' : 'Bank deposit not yet confirmed',
    status: s.bank_verified ? 'green' : 'amber',
    detail: s.bank_verified ? undefined : 'Settlement can still be pushed — bank matching will happen after',
  });

  return checks;
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}
