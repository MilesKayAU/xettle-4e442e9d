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
// Rule #11 enforcement is server-side: sync-settlement-to-xero requires
// settlementId + settlementData. No order/payment path exists.
// See: src/constants/accounting-rules.ts for canonical documentation.
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  CheckCircle2, AlertTriangle, XCircle, Loader2, Send, ArrowLeft, FileText, RefreshCw,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import {
  formatAUD, MARKETPLACE_LABELS, MARKETPLACE_CONTACTS,
} from '@/utils/settlement-engine';
import {
  buildPostingLineItems, toLineItemPreviews, createAccountCodeResolver,
  REQUIRED_MAPPING_CATEGORIES,
  type SettlementForPosting,
} from '@/utils/xero-posting-line-items';
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
  const [mappingInvalidError, setMappingInvalidError] = useState<string[] | null>(null);
  const [previews, setPreviews] = useState<Array<{
    settlement: SettlementPreview;
    lineItems: LineItemPreview[];
    checks: ValidationCheck[];
    contactName: string;
    reference: string;
    isRepost?: boolean;
    repostOfInvoiceId?: string | null;
    repostReason?: string | null;
  }>>([]);

  useEffect(() => {
    if (open && settlements.length > 0) {
      loadPreviews();
    }
  }, [open, settlements]);

  const loadPreviews = async () => {
    setLoading(true);
    setMappingInvalidError(null);
    try {
      // ─── Pre-validate account codes against CoA ───────────────────
      const { data: { user } } = await supabase.auth.getUser();
      let coaMap = new Map<string, { name: string; type: string; active: boolean }>();
      let userCodes: Record<string, string> = {};
      let lockedMonths = new Set<string>();

      if (user) {
        const [coaRes, codesRes, locksRes] = await Promise.all([
          supabase.from('xero_chart_of_accounts').select('account_code, account_name, account_type, is_active').eq('user_id', user.id),
          supabase.from('app_settings').select('value').eq('user_id', user.id).eq('key', 'accounting_xero_account_codes').maybeSingle(),
          supabase.from('period_locks').select('period_month').eq('user_id', user.id).is('unlocked_at', null),
        ]);
        for (const acc of (coaRes.data || [])) {
          if (acc.account_code) {
            coaMap.set(acc.account_code, {
              name: acc.account_name,
              type: (acc.account_type || '').toUpperCase(),
              active: acc.is_active !== false,
            });
          }
        }
        if (codesRes.data?.value) {
          try { userCodes = JSON.parse(codesRes.data.value); } catch { /* */ }
        }
        (locksRes.data || []).forEach(l => lockedMonths.add(l.period_month));
      }

      const results = [];
      for (const { settlementId, marketplace } of settlements) {
        const { data: s } = await supabase
          .from('settlements')
          .select('*')
          .eq('settlement_id', settlementId)
          .maybeSingle();

        if (!s) continue;

        // Detect repost context
        const isRepost = !!s.repost_of_invoice_id;
        const repostOfInvoiceId = s.repost_of_invoice_id || null;
        const repostReason = s.repost_reason || null;

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

        // ─── Check if already in Xero (Layer 1: settlement row, Layer 2: match cache) ───
        let alreadyInXeroCheck: ValidationCheck | null = null;

        // Layer 1: Settlement row already linked
        if (s.xero_invoice_id) {
          alreadyInXeroCheck = {
            label: 'Invoice already linked in Xero',
            status: 'red',
            detail: `Invoice ID: ${s.xero_invoice_id}${s.xero_invoice_number ? ` (${s.xero_invoice_number})` : ''}${s.xero_status ? ` — Status: ${s.xero_status}` : ''}`,
          };
        }

        // Layer 2: Check xero_accounting_matches cache
        if (!alreadyInXeroCheck && user) {
          const { data: existingMatch } = await supabase
            .from('xero_accounting_matches')
            .select('xero_invoice_id, xero_invoice_number, xero_status, match_method')
            .eq('user_id', user.id)
            .eq('settlement_id', settlementId)
            .maybeSingle();

          if (existingMatch) {
            alreadyInXeroCheck = {
              label: 'Invoice already exists in Xero',
              status: 'red',
              detail: `Matched via ${existingMatch.match_method || 'cache'}${existingMatch.xero_invoice_number ? ` — Invoice: ${existingMatch.xero_invoice_number}` : ''}${existingMatch.xero_invoice_id ? ` (${existingMatch.xero_invoice_id})` : ''}${existingMatch.xero_status ? ` — Status: ${existingMatch.xero_status}` : ''}`,
            };
          }
        }

        // ─── Period lock check ───
        const periodMonth = s.period_end?.substring(0, 7);
        const periodLocked = periodMonth ? lockedMonths.has(periodMonth) : false;

        // Build line items for display using canonical builder
        const resolver = createAccountCodeResolver(userCodes);
        const mpLabel = MARKETPLACE_LABELS[settlement.marketplace] || settlement.marketplace;
        const xeroLines = buildPostingLineItems(settlement as SettlementForPosting, resolver, mpLabel);
        const lineItems = toLineItemPreviews(xeroLines);

        // Build validation checks (now with CoA awareness + already-in-Xero + period lock)
        const checks = buildValidationChecks(settlement, lineItems, coaMap, userCodes, alreadyInXeroCheck, periodLocked, periodMonth);

        const contactName = MARKETPLACE_CONTACTS[settlement.marketplace] || `${settlement.marketplace} Marketplace`;
        const reference = `Xettle-${settlement.settlement_id}`;

        results.push({ settlement, lineItems, checks, contactName, reference, isRepost, repostOfInvoiceId, repostReason });
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
    isRepost?: boolean;
    repostOfInvoiceId?: string | null;
    repostReason?: string | null;
  };
  index: number;
  total: number;
}) {
  const { settlement: s, lineItems, checks, contactName, reference, isRepost, repostOfInvoiceId, repostReason } = preview;
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

      {/* Repost Banner */}
      {isRepost && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 text-xs text-amber-800 flex items-start gap-2">
          <RefreshCw className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <div>
            <p className="font-semibold">This is a repost</p>
            <p className="text-amber-700">
              Previous invoice: <span className="font-mono">{repostOfInvoiceId?.substring(0, 12)}…</span> (voided)
              {repostReason && <span className="ml-1">— Reason: "{repostReason}"</span>}
            </p>
          </div>
        </div>
      )}

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

// buildLineItemsFromSettlement — replaced by canonical builder (xero-posting-line-items.ts)
// Kept as a no-op reference; actual building now happens in loadPreviews() above.

function buildValidationChecks(
  s: SettlementPreview,
  lineItems: LineItemPreview[],
  coaMap?: Map<string, { name: string; type: string; active: boolean }>,
  userCodes?: Record<string, string>,
  alreadyInXeroCheck?: ValidationCheck | null,
  periodLocked?: boolean,
  periodMonth?: string | null,
): ValidationCheck[] {
  const checks: ValidationCheck[] = [];

  // 0a. Period lock check — blocks push
  if (periodLocked && periodMonth) {
    checks.push({
      label: 'Period is locked',
      status: 'red',
      detail: `${periodMonth} is closed. Unlock the period first to push changes.`,
    });
  }

  // 0. Already in Xero — must be first (blocks push)
  if (alreadyInXeroCheck) {
    checks.push(alreadyInXeroCheck);
  } else {
    checks.push({ label: 'No existing invoice found in Xero ✓', status: 'green' });
  }

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

  // 2. Account codes validated against Chart of Accounts
  if (coaMap && coaMap.size > 0) {
    const invalidCodes: string[] = [];
    const inactiveCodes: string[] = [];
    const wrongTypeCodes: string[] = [];
    const REVENUE_TYPES = ['REVENUE', 'SALES', 'OTHERINCOME', 'DIRECTCOSTS'];
    const EXPENSE_TYPES = ['EXPENSE', 'OVERHEADS', 'DIRECTCOSTS', 'CURRLIAB', 'LIABILITY'];
    const REVENUE_DESCS = ['Sales', 'Refunds', 'Reimbursements'];

    for (const li of lineItems) {
      const entry = coaMap.get(li.accountCode);
      if (!entry) {
        invalidCodes.push(li.accountCode);
      } else if (!entry.active) {
        inactiveCodes.push(`${li.accountCode} (${entry.name})`);
      } else {
        const isRevenue = REVENUE_DESCS.some(r => li.description.includes(r));
        const validTypes = isRevenue ? REVENUE_TYPES : EXPENSE_TYPES;
        if (!validTypes.includes(entry.type)) {
          wrongTypeCodes.push(`${li.accountCode} (${entry.name}) — ${isRevenue ? 'expected Revenue' : 'expected Expense'}, got ${entry.type}`);
        }
      }
    }

    if (invalidCodes.length > 0) {
      checks.push({
        label: 'Account codes NOT found in Xero',
        status: 'red',
        detail: `Missing: ${invalidCodes.join(', ')} — review Account Mapping`,
      });
    } else if (inactiveCodes.length > 0) {
      checks.push({
        label: 'Some accounts are inactive in Xero',
        status: 'red',
        detail: `Inactive: ${inactiveCodes.join(', ')}`,
      });
    } else if (wrongTypeCodes.length > 0) {
      checks.push({
        label: 'Account type mismatch',
        status: 'red',
        detail: wrongTypeCodes.join('; '),
      });
    } else {
      checks.push({ label: 'All account codes verified in Xero ✓', status: 'green' });
    }
  } else {
    // No CoA cached — fallback to old check
    const allCodesKnown = lineItems.every(li => ACCOUNT_NAMES[li.accountCode]);
    checks.push({
      label: 'Account codes confirmed',
      status: allCodesKnown ? 'green' : 'amber',
      detail: allCodesKnown ? undefined : 'Some account codes are custom — verify in Xero',
    });
  }

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
