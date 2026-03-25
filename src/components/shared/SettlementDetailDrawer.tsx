/**
 * SettlementDetailDrawer — Audit view of a posted (or pending) settlement.
 * Shows the exact payload snapshot stored at posting time, header metadata, and audit trail.
 * Unpushed settlements can be edited inline to fix reconciliation gaps.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useAiPageContext } from '@/ai/context/useAiPageContext';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, CheckCircle2, ChevronDown, Clock, Download, ExternalLink, GitCompare, Info, Pencil, Save, Search, X, Zap } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { formatAUD, MARKETPLACE_LABELS } from '@/utils/settlement-engine';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import InvoiceRefreshButton from '@/components/shared/InvoiceRefreshButton';
import XeroInvoiceCompareDrawer from '@/components/shared/XeroInvoiceCompareDrawer';
import CoaBlockerCta from '@/components/shared/CoaBlockerCta';
import { checkXeroReadinessForMarketplace } from '@/actions/xeroReadiness';
import { diagnoseGapReason } from '@/utils/diagnose-gap-reason';
import ParserBugWarningBanner from './ParserBugWarningBanner';
import SettlementCorrectionPanel from './SettlementCorrectionPanel';
import ApiCsvMismatchBanner from './ApiCsvMismatchBanner';

interface SettlementDetailDrawerProps {
  settlementId: string | null; // settlement_id (text), not DB uuid
  open: boolean;
  onClose: () => void;
}

interface NormalizedLineItem {
  description: string;
  account_code: string;
  tax_type: string;
  amount: number;
}

interface SnapshotDetails {
  posting_mode?: string;
  xero_request_payload?: any;
  xero_response?: {
    invoice_id?: string;
    invoice_number?: string;
    xero_status?: string;
    xero_type?: string;
  };
  normalized?: {
    net_amount?: number;
    currency?: string;
    contact_name?: string;
    line_items?: NormalizedLineItem[];
    truncated?: boolean;
  };
}

interface AuditEvent {
  id: string;
  event_type: string;
  created_at: string;
  details: any;
  severity: string;
}

interface EditableFields {
  sales_principal: number;
  seller_fees: number;
  refunds: number;
  bank_deposit: number;
  other_fees: number;
  reimbursements: number;
}

const RECON_TOLERANCE = 1.00;

function calculateReconGap(s: any): number {
  const sales = (s.sales_principal || 0) + (s.sales_shipping || 0);
  const fees = Math.abs(s.seller_fees || 0) + Math.abs(s.fba_fees || 0) + Math.abs(s.storage_fees || 0) + Math.abs(s.advertising_costs || 0) + Math.abs(s.other_fees || 0);
  const refunds = s.refunds || 0;
  const reimbursements = s.reimbursements || 0;
  const expectedNet = sales - fees + refunds + reimbursements;
  const bankDeposit = s.bank_deposit || 0;
  return bankDeposit - expectedNet;
}

// diagnoseGapReason imported from @/utils/diagnose-gap-reason

export default function SettlementDetailDrawer({ settlementId, open, onClose }: SettlementDetailDrawerProps) {
  const [settlement, setSettlement] = useState<any>(null);
  const [snapshot, setSnapshot] = useState<SnapshotDetails | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSnapshot, setHasSnapshot] = useState(true);
  const [externalCandidate, setExternalCandidate] = useState<any>(null);
  const [dismissingCandidate, setDismissingCandidate] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [mappingBlocked, setMappingBlocked] = useState(false);
  const [missingCategories, setMissingCategories] = useState<string[]>([]);
  const [readinessKey, setReadinessKey] = useState(0);
  const [editing, setEditing] = useState(false);
  const [editFields, setEditFields] = useState<EditableFields | null>(null);
  const [saving, setSaving] = useState(false);
  const [apiVerification, setApiVerification] = useState<any>(null);
  const [apiVerifying, setApiVerifying] = useState(false);
  const [apiVerifyOpen, setApiVerifyOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  useAiPageContext(() => ({
    routeId: 'settlement_detail',
    pageTitle: `Settlement Detail — ${settlementId ?? 'none'}`,
    primaryEntities: {
      settlement_ids: settlementId ? [settlementId] : [],
      xero_invoice_ids: settlement?.xero_invoice_id ? [settlement.xero_invoice_id] : [],
    },
    pageStateSummary: {
      posting_state: settlement?.posting_state ?? 'unknown',
      xero_status: settlement?.xero_status ?? null,
      marketplace: settlement?.marketplace ?? null,
      has_snapshot: hasSnapshot,
      event_count: events.length,
      has_external_candidate: !!externalCandidate,
    },
    capabilities: ['compare_invoice', 'view_audit_trail'],
    suggestedPrompts: [
      'Why can\'t I push this settlement?',
      'What happened with this settlement?',
      'Explain the fee breakdown',
    ],
  }));

  useEffect(() => {
    if (!open || !settlementId) return;
    setLoading(true);
    setSnapshot(null);
    setHasSnapshot(true);
    setExternalCandidate(null);

    setEditing(false);
    setEditFields(null);
    setApiVerification(null);
    setApiVerifyOpen(false);

    (async () => {
      const [settRes, eventsRes, candidateRes] = await Promise.all([
        supabase
          .from('settlements')
          .select('*')
          .eq('settlement_id', settlementId)
          .maybeSingle(),
        supabase
          .from('system_events')
          .select('*')
          .eq('settlement_id', settlementId)
          .order('created_at', { ascending: true }),
        supabase
          .from('xero_accounting_matches')
          .select('*')
          .eq('settlement_id', settlementId)
          .eq('match_method', 'external_candidate')
          .maybeSingle(),
      ]);

      if (settRes.data) setSettlement(settRes.data);
      if (candidateRes.data) setExternalCandidate(candidateRes.data);
      if (eventsRes.data) {
        setEvents(eventsRes.data as AuditEvent[]);
        const postEvent = (eventsRes.data as AuditEvent[]).find(
          e => e.event_type === 'xero_push_success' || e.event_type === 'auto_post_success'
        );
        if (postEvent?.details?.normalized?.line_items) {
          setSnapshot(postEvent.details as SnapshotDetails);
          setHasSnapshot(true);
        } else {
          setHasSnapshot(false);
          setSnapshot(null);
        }
      }
      setLoading(false);
    })();
  }, [open, settlementId]);

  // Check mapping readiness for unpushed settlements
  useEffect(() => {
    if (!settlement?.marketplace || settlement.status === 'pushed_to_xero' || settlement.status === 'already_recorded') {
      setMappingBlocked(false);
      setMissingCategories([]);
      return;
    }
    (async () => {
      try {
        const result = await checkXeroReadinessForMarketplace(settlement.marketplace);
        const catCheck = result.checks.find(c => c.key === 'category_coverage');
        if (catCheck?.status === 'fail' && result.missingCategories?.length) {
          setMappingBlocked(true);
          setMissingCategories(result.missingCategories);
        } else {
          setMappingBlocked(false);
          setMissingCategories([]);
        }
      } catch {
        setMappingBlocked(false);
      }
    })();
  }, [settlement?.marketplace, settlement?.status, readinessKey]);

  // Check admin status
  useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.rpc('has_role', { _role: 'admin' });
        setIsAdmin(!!data);
      } catch { setIsAdmin(false); }
    })();
  }, []);

  // Mirakl API verification handler
  const handleVerifyMirakl = useCallback(async () => {
    if (!settlement?.settlement_id) return;
    setApiVerifying(true);
    setApiVerification(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke('verify-mirakl-settlement', {
        body: { settlement_id: settlement.settlement_id },
      });
      if (res.error) throw new Error(res.error.message);
      setApiVerification(res.data);
      setApiVerifyOpen(true);
    } catch (err: any) {
      toast.error(`API verification failed: ${err.message}`);
      setApiVerification({ verdict: 'api_error', error: err.message });
      setApiVerifyOpen(true);
    } finally {
      setApiVerifying(false);
    }
  }, [settlement?.settlement_id]);

  const handleDismissCandidate = useCallback(async () => {
    if (!externalCandidate?.id) return;
    setDismissingCandidate(true);
    const { error } = await supabase
      .from('xero_accounting_matches')
      .delete()
      .eq('id', externalCandidate.id);
    if (error) {
      toast.error('Failed to dismiss external match');
    } else {
      setExternalCandidate(null);
      toast.success('External match dismissed');
    }
    setDismissingCandidate(false);
  }, [externalCandidate]);

  const handleAcknowledgeExternal = useCallback(async () => {
    if (!settlement?.id) return;
    setDismissingCandidate(true);
    const { error } = await supabase
      .from('settlements')
      .update({ status: 'already_recorded' })
      .eq('id', settlement.id);
    if (error) {
      toast.error('Failed to update settlement status');
    } else {
      setSettlement((prev: any) => prev ? { ...prev, status: 'already_recorded' } : prev);
      toast.success('Settlement marked as already recorded — removed from push queue');
    }
    setDismissingCandidate(false);
  }, [settlement]);

  const isEditable = settlement && settlement.status !== 'pushed_to_xero' && settlement.status !== 'already_recorded';

  const startEditing = useCallback(() => {
    if (!settlement) return;
    setEditFields({
      sales_principal: settlement.sales_principal || 0,
      seller_fees: settlement.seller_fees || 0,
      refunds: settlement.refunds || 0,
      bank_deposit: settlement.bank_deposit || 0,
      other_fees: settlement.other_fees || 0,
      reimbursements: settlement.reimbursements || 0,
    });
    setEditing(true);
  }, [settlement]);

  const cancelEditing = useCallback(() => {
    setEditing(false);
    setEditFields(null);
  }, []);

  const handleSaveAndRecheck = useCallback(async () => {
    if (!settlement?.id || !editFields) return;
    setSaving(true);

    // Calculate new recon status
    const tempSettlement = { ...settlement, ...editFields };
    const gap = calculateReconGap(tempSettlement);
    const newReconStatus = Math.abs(gap) < RECON_TOLERANCE ? 'reconciled' : 'recon_warning';

    const { error } = await supabase
      .from('settlements')
      .update({
        sales_principal: editFields.sales_principal,
        seller_fees: editFields.seller_fees,
        refunds: editFields.refunds,
        bank_deposit: editFields.bank_deposit,
        other_fees: editFields.other_fees,
        reimbursements: editFields.reimbursements,
        reconciliation_status: newReconStatus,
      })
      .eq('id', settlement.id);

    if (error) {
      toast.error('Failed to save changes');
    } else {
      setSettlement((prev: any) => prev ? {
        ...prev,
        ...editFields,
        reconciliation_status: newReconStatus,
      } : prev);
      setEditing(false);
      setEditFields(null);
      toast.success(newReconStatus === 'reconciled'
        ? 'Saved — reconciliation now balanced ✓'
        : 'Saved — reconciliation gap still exists');
    }
    setSaving(false);
  }, [settlement, editFields]);


  const reconstructedLines: NormalizedLineItem[] = settlement ? [
    { description: 'Sales', account_code: '200', tax_type: 'OUTPUT', amount: (settlement.sales_principal || 0) + (settlement.sales_shipping || 0) },
    { description: 'Promotional Discounts', account_code: '200', tax_type: 'OUTPUT', amount: settlement.promotional_discounts || 0 },
    { description: 'Refunds', account_code: '205', tax_type: 'OUTPUT', amount: settlement.refunds || 0 },
    { description: 'Reimbursements', account_code: '271', tax_type: 'BASEXCLUDED', amount: settlement.reimbursements || 0 },
    { description: 'Seller Fees', account_code: '407', tax_type: 'INPUT', amount: -(Math.abs(settlement.seller_fees || 0)) },
    { description: 'FBA Fees', account_code: '408', tax_type: 'INPUT', amount: -(Math.abs(settlement.fba_fees || 0)) },
    { description: 'Storage Fees', account_code: '409', tax_type: 'INPUT', amount: -(Math.abs(settlement.storage_fees || 0)) },
    { description: 'Advertising Costs', account_code: '410', tax_type: 'INPUT', amount: -(Math.abs(settlement.advertising_costs || 0)) },
    { description: 'Other Fees', account_code: '405', tax_type: 'INPUT', amount: -(Math.abs(settlement.other_fees || 0)) },
  ].filter(l => Math.abs(l.amount) > 0.01) : [];

  const lineItems = snapshot?.normalized?.line_items || reconstructedLines;
  const netAmount = snapshot?.normalized?.net_amount ?? settlement?.bank_deposit ?? settlement?.net_ex_gst ?? 0;
  const lineItemsSum = lineItems.reduce((s, l) => s + l.amount, 0);
  const bankDeposit = settlement?.bank_deposit;
  const postingMode = snapshot?.posting_mode || (events.find(e => e.event_type === 'auto_post_success') ? 'auto' : 'manual');
  const isAutoPosted = postingMode === 'auto';
  const marketplace = settlement?.marketplace || '';
  const mpLabel = MARKETPLACE_LABELS[marketplace] || marketplace;

  return (
    <>
    <Sheet open={open} onOpenChange={() => onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-base">Settlement Detail</SheetTitle>
          <SheetDescription className="text-xs">
            {loading ? 'Loading...' : `${mpLabel} — ${settlement?.period_start} → ${settlement?.period_end}`}
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="space-y-4 mt-6">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : settlement ? (
          <div className="space-y-5 mt-4">
            {/* Pre-boundary warning */}
            {(settlement.status === 'pre_boundary' || settlement.is_pre_boundary) && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/30 p-3 flex items-start gap-2">
                <Info className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-700 dark:text-amber-300">
                  Period is before your accounting boundary date — import only. This settlement is saved but cannot be pushed to Xero.
                </p>
              </div>
            )}
            {/* External Xero match banner — STRONG duplicate warning */}
            {externalCandidate && !settlement.xero_invoice_id && (
              <div className="rounded-lg border-2 border-destructive bg-destructive/10 overflow-hidden">
                <div className="bg-destructive px-3 py-2 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive-foreground" />
                  <span className="text-sm font-bold text-destructive-foreground">
                    ⚠ DO NOT PUSH — Duplicate Invoice Risk
                  </span>
                </div>
                <div className="p-3 space-y-2">
                  <p className="text-xs text-foreground">
                    An invoice for this exact settlement already exists in Xero, created by <strong>another integration</strong> (e.g. Link My Books):
                  </p>
                  <div className="bg-background rounded-md border border-border p-2.5 text-xs font-mono space-y-1">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Invoice #</span>
                      <span className="font-semibold text-foreground">{externalCandidate.xero_invoice_number}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Amount</span>
                      <span className="text-foreground">{formatAUD(externalCandidate.matched_amount || 0)}</span>
                    </div>
                    {externalCandidate.xero_status && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Status</span>
                        <span className="text-foreground">{externalCandidate.xero_status}</span>
                      </div>
                    )}
                    {externalCandidate.matched_reference && (
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Reference</span>
                        <span className="text-foreground">{externalCandidate.matched_reference}</span>
                      </div>
                    )}
                  </div>
                  <p className="text-[11px] text-destructive font-medium">
                    Pushing this settlement would create a <strong>duplicate invoice</strong> in Xero. This will double-count revenue and GST.
                  </p>
                  <div className="flex gap-2 mt-1">
                    <Button
                      size="sm"
                      variant="destructive"
                      className="h-7 text-xs gap-1"
                      onClick={handleAcknowledgeExternal}
                      disabled={dismissingCandidate}
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      {dismissingCandidate ? 'Saving…' : 'Acknowledge — already in Xero, do not push'}
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    This will mark this settlement as "already recorded" so it won't appear in your push queue.
                  </p>
                </div>
              </div>
            )}
            {/* Settlement marked as already_recorded */}
            {settlement.status === 'already_recorded' && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-muted border border-border text-xs">
                <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">Already recorded in Xero</p>
                  <p className="text-muted-foreground mt-0.5">
                    This settlement was posted by another integration. Xettle will not push it again.
                  </p>
                </div>
              </div>
            )}
            {/* Auto-post banner */}
            {isAutoPosted && settlement.status === 'pushed_to_xero' && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-accent/50 border border-accent text-xs">
                <Zap className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">
                    Auto-posted{settlement.posted_at ? ` on ${new Date(settlement.posted_at).toLocaleDateString('en-AU')}` : ''}
                  </p>
                  <p className="text-muted-foreground mt-0.5">
                    Rail setting: Auto — change in Settings → Rail Posting Mode
                  </p>
                </div>
              </div>
            )}

            {/* Parser bug warning banner */}
            <ParserBugWarningBanner settlement={settlement} />

            {/* Admin correction panel for pushed settlements with wrong bank_deposit */}
            <SettlementCorrectionPanel
              settlement={settlement}
              isAdmin={isAdmin}
              onSettlementUpdated={(updated) => setSettlement(updated)}
            />

            {/* Header metadata */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <span className="text-muted-foreground">Settlement ID</span>
                <p className="font-mono text-foreground truncate">{settlement.settlement_id}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Rail</span>
                <p className="text-foreground">{mpLabel}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Period</span>
                <p className="text-foreground">{settlement.period_start} → {settlement.period_end}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Status</span>
                <p className="text-foreground">
                  <Badge variant={settlement.status === 'pushed_to_xero' ? 'default' : 'secondary'} className="text-[10px]">
                    {settlement.status || 'unknown'}
                  </Badge>
                </p>
              </div>
              {settlement.posted_at && (
                <div>
                  <span className="text-muted-foreground">Posted at</span>
                  <p className="text-foreground">{new Date(settlement.posted_at).toLocaleString('en-AU')}</p>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Posting mode</span>
                <p className="text-foreground capitalize">{postingMode}</p>
              </div>
              {(snapshot?.xero_response?.invoice_number || settlement.xero_invoice_number) && (
                <div>
                  <span className="text-muted-foreground">Xero Invoice #</span>
                  <p className="font-mono text-foreground">{snapshot?.xero_response?.invoice_number || settlement.xero_invoice_number}</p>
                </div>
              )}
              {(snapshot?.xero_response?.invoice_id || settlement.xero_journal_id) && (
                <div>
                  <span className="text-muted-foreground">Xero Invoice ID</span>
                  <p className="font-mono text-foreground text-[10px] truncate">{snapshot?.xero_response?.invoice_id || settlement.xero_journal_id}</p>
                </div>
              )}
              {(snapshot?.xero_response?.xero_status || settlement.xero_status) && (
                <div>
                  <span className="text-muted-foreground">Xero Status</span>
                  <p className="text-foreground">{snapshot?.xero_response?.xero_status || settlement.xero_status}</p>
                </div>
              )}
            </div>

            {/* Reconciliation Gap Card — always shown when gap > $0.05 */}
            {(() => {
              const gap = calculateReconGap(settlement);
              if (Math.abs(gap) <= 0.05) return null;
              const sales = (settlement.sales_principal || 0) + (settlement.sales_shipping || 0);
              const fees = Math.abs(settlement.seller_fees || 0) + Math.abs(settlement.fba_fees || 0) + Math.abs(settlement.storage_fees || 0) + Math.abs(settlement.advertising_costs || 0) + Math.abs(settlement.other_fees || 0);
              const expectedNet = sales - fees + (settlement.refunds || 0) + (settlement.reimbursements || 0);
              const isBlocking = Math.abs(gap) > 1.00;
              const diagnosis = diagnoseGapReason(settlement, gap);
              return (
                <div className={cn(
                  "rounded-lg border-2 p-3 space-y-2",
                  isBlocking
                    ? "border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/20"
                    : "border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20"
                )}>
                  <div className="flex items-center gap-2">
                    <AlertTriangle className={cn("h-4 w-4", isBlocking ? "text-red-600 dark:text-red-400" : "text-amber-600 dark:text-amber-400")} />
                    <span className={cn("text-sm font-semibold", isBlocking ? "text-red-800 dark:text-red-200" : "text-amber-800 dark:text-amber-200")}>
                      Reconciliation Gap: {formatAUD(Math.abs(gap))}
                      {isBlocking && " — Xero push blocked"}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    <span className="text-muted-foreground">Sales (principal + shipping)</span>
                    <span className="font-mono text-right text-foreground">{formatAUD(sales)}</span>
                    <span className="text-muted-foreground">Total fees</span>
                    <span className="font-mono text-right text-foreground">−{formatAUD(fees)}</span>
                    <span className="text-muted-foreground">Refunds</span>
                    <span className="font-mono text-right text-foreground">{formatAUD(settlement.refunds || 0)}</span>
                    <span className="text-muted-foreground">Reimbursements</span>
                    <span className="font-mono text-right text-foreground">{formatAUD(settlement.reimbursements || 0)}</span>
                    <Separator className="col-span-2 my-1" />
                    <span className="text-muted-foreground">Expected net</span>
                    <span className="font-mono text-right text-foreground">{formatAUD(expectedNet)}</span>
                    <span className="text-muted-foreground">Actual bank deposit</span>
                    <span className="font-mono text-right text-foreground">{formatAUD(settlement.bank_deposit || 0)}</span>
                    <span className="text-muted-foreground font-medium">Difference</span>
                    <span className={cn("font-mono text-right font-medium", isBlocking ? "text-red-700 dark:text-red-300" : "text-amber-700 dark:text-amber-300")}>
                      {gap >= 0 ? '+' : ''}{formatAUD(gap)}
                    </span>
                  </div>
                  {diagnosis && (
                    <div className="rounded-md bg-background/50 border border-border p-2 mt-1">
                      <p className="text-[11px] font-medium text-foreground mb-0.5">💡 Likely cause:</p>
                      <p className="text-[11px] text-muted-foreground">{diagnosis}</p>
                    </div>
                  )}
                  {isEditable && !editing && (
                    <p className="text-[11px] text-muted-foreground">
                      Click <strong>Edit Figures</strong> below to correct the amounts and resolve the gap.
                    </p>
                  )}
                </div>
              );
            })()}

            {/* Edit Figures Button / Edit Mode */}
            {isEditable && !editing && (
              <Button variant="outline" size="sm" className="h-7 text-xs gap-1.5" onClick={startEditing}>
                <Pencil className="h-3.5 w-3.5" />
                Edit Figures
              </Button>
            )}

            {editing && editFields && (
              <div className="rounded-lg border border-border bg-muted/30 p-3 space-y-3">
                <h4 className="text-xs font-semibold text-foreground">Edit Settlement Figures</h4>
                <div className="grid grid-cols-2 gap-3">
                  {([
                    ['sales_principal', 'Sales (principal)'],
                    ['seller_fees', 'Seller Fees'],
                    ['refunds', 'Refunds'],
                    ['reimbursements', 'Reimbursements'],
                    ['other_fees', 'Other Fees'],
                    ['bank_deposit', 'Bank Deposit'],
                  ] as [keyof EditableFields, string][]).map(([key, label]) => (
                    <div key={key} className="space-y-1">
                      <label className="text-[10px] text-muted-foreground">{label}</label>
                      <Input
                        type="number"
                        step="0.01"
                        className="h-8 text-xs font-mono"
                        value={editFields[key]}
                        onChange={(e) => setEditFields(prev => prev ? { ...prev, [key]: parseFloat(e.target.value) || 0 } : prev)}
                      />
                    </div>
                  ))}
                </div>
                {/* Live preview of new gap */}
                {(() => {
                  const previewGap = calculateReconGap({ ...settlement, ...editFields });
                  const willReconcile = Math.abs(previewGap) < RECON_TOLERANCE;
                  return (
                    <div className={cn(
                      "flex items-center justify-between text-xs p-2 rounded-md border",
                      willReconcile ? "border-emerald-300 bg-emerald-50 dark:border-emerald-700 dark:bg-emerald-900/20" : "border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-900/20"
                    )}>
                      <span className="text-muted-foreground">
                        {willReconcile ? '✓ Will reconcile on save' : `Gap remaining: ${formatAUD(Math.abs(previewGap))}`}
                      </span>
                      <span className="font-mono font-medium">{previewGap >= 0 ? '+' : ''}{formatAUD(previewGap)}</span>
                    </div>
                  );
                })()}
                <div className="flex items-center gap-2">
                  <Button size="sm" className="h-7 text-xs gap-1.5" onClick={handleSaveAndRecheck} disabled={saving}>
                    <Save className="h-3.5 w-3.5" />
                    {saving ? 'Saving…' : 'Save & Re-check'}
                  </Button>
                  <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={cancelEditing} disabled={saving}>
                    <X className="h-3.5 w-3.5" />
                    Cancel
                  </Button>
                </div>
              </div>
            )}


            {(settlement.xero_invoice_id || settlement.xero_journal_id) && (
              <div className="flex items-center gap-2">
                <InvoiceRefreshButton
                  xeroInvoiceId={settlement.xero_invoice_id || settlement.xero_journal_id}
                  size="sm"
                />
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => setCompareOpen(true)}>
                  <GitCompare className="h-3.5 w-3.5" />
                  Compare to Xettle
                </Button>
              </div>
            )}

            <Separator />

            {/* Source label */}
            {!hasSnapshot && settlement.status === 'pushed_to_xero' && (
              <div className="flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-md px-2.5 py-1.5">
                <AlertTriangle className="h-3 w-3" />
                Reconstructed — posted before audit snapshots were introduced
              </div>
            )}

            {/* Line items table */}
            <div>
              <h4 className="text-xs font-semibold text-foreground mb-2">
                {hasSnapshot ? 'Posted Payload' : 'Line Items'}
                {snapshot?.normalized?.truncated && <span className="text-muted-foreground font-normal ml-1">(truncated to 200)</span>}
              </h4>
              <div className="border border-border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">Description</th>
                      <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">Amount</th>
                      <th className="text-center py-1.5 px-2 font-medium text-muted-foreground">Account</th>
                      <th className="text-center py-1.5 px-2 font-medium text-muted-foreground">Tax</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {lineItems.map((li, i) => (
                      <tr key={i} className="hover:bg-muted/20">
                        <td className="py-1.5 px-2 text-foreground">{li.description}</td>
                        <td className={cn("py-1.5 px-2 text-right font-mono", li.amount >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                          {li.amount >= 0 ? '+' : ''}{formatAUD(li.amount)}
                        </td>
                        <td className="py-1.5 px-2 text-center font-mono text-muted-foreground">{li.account_code}</td>
                        <td className="py-1.5 px-2 text-center text-muted-foreground">{li.tax_type}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/30 border-t border-border">
                    <tr>
                      <td className="py-1.5 px-2 font-semibold text-foreground">Net</td>
                      <td className="py-1.5 px-2 text-right font-mono font-semibold text-foreground">{formatAUD(lineItemsSum)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* COA Mapping Blocker CTA — shown for unpushed settlements with mapping gaps */}
            {mappingBlocked && settlement.marketplace && (
              <CoaBlockerCta
                marketplace={settlement.marketplace}
                missingCategories={missingCategories}
                compact
                onResolved={() => setReadinessKey(k => k + 1)}
              />
            )}

            {/* Bank deposit comparison */}
            {bankDeposit != null && (
              <div className="flex items-center justify-between text-xs p-2.5 rounded-md bg-muted/30 border border-border">
                <span className="text-muted-foreground">Bank deposit</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-medium text-foreground">{formatAUD(bankDeposit)}</span>
                  {Math.abs(bankDeposit - lineItemsSum) < 0.02 ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <span className="text-amber-500 text-[10px]">Δ {formatAUD(bankDeposit - lineItemsSum)}</span>
                  )}
                </div>
              </div>
            )}

            {/* GST summary */}
            {(settlement.gst_on_income || settlement.gst_on_expenses) && (
              <>
                <Separator />
                <div>
                  <h4 className="text-xs font-semibold text-foreground mb-2">GST Summary</h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">GST on income</span>
                      <span className="font-mono text-foreground">+{formatAUD(settlement.gst_on_income || 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">GST on expenses</span>
                      <span className="font-mono text-foreground">{formatAUD(settlement.gst_on_expenses || 0)}</span>
                    </div>
                    <div className="flex justify-between col-span-2 pt-1 border-t border-border">
                      <span className="text-muted-foreground font-medium">Net GST liability</span>
                      <span className="font-mono font-medium text-foreground">
                        {formatAUD((settlement.gst_on_income || 0) + (settlement.gst_on_expenses || 0))}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* API Verification — Admin only, Mirakl/Bunnings settlements */}
            {isAdmin && settlement.marketplace && (
              settlement.marketplace.toLowerCase().includes('bunnings') ||
              settlement.marketplace.toLowerCase().includes('catch') ||
              settlement.marketplace.toLowerCase().includes('mydeal') ||
              settlement.marketplace.toLowerCase().includes('kogan') ||
              settlement.source === 'mirakl_api'
            ) && (
              <>
                <Separator />
                <div className="space-y-2">
                  {!apiVerification && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 text-xs gap-1.5"
                      onClick={handleVerifyMirakl}
                      disabled={apiVerifying}
                    >
                      <Search className="h-3.5 w-3.5" />
                      {apiVerifying ? 'Verifying via API…' : 'Verify via Mirakl API'}
                    </Button>
                  )}

                  {apiVerification && (
                    <Collapsible open={apiVerifyOpen} onOpenChange={setApiVerifyOpen}>
                      <CollapsibleTrigger className="flex items-center gap-2 w-full text-xs font-semibold text-foreground hover:underline">
                        <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", apiVerifyOpen && "rotate-180")} />
                        API Verification
                        {apiVerification.verdict === 'match' && (
                          <Badge variant="default" className="text-[9px] ml-1 bg-emerald-600">Match</Badge>
                        )}
                        {apiVerification.verdict === 'discrepancy' && (
                          <Badge variant="destructive" className="text-[9px] ml-1">Discrepancy</Badge>
                        )}
                        {apiVerification.verdict === 'no_data' && (
                          <Badge variant="secondary" className="text-[9px] ml-1">No Data</Badge>
                        )}
                        {apiVerification.verdict === 'api_error' && (
                          <Badge variant="destructive" className="text-[9px] ml-1">API Error</Badge>
                        )}
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2 space-y-3">
                        {/* Verdict banner */}
                        {apiVerification.verdict === 'match' && (
                          <div className="flex items-center gap-2 p-2 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-xs">
                            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                            <span className="text-emerald-800 dark:text-emerald-200 font-medium">Settlement matches API data</span>
                          </div>
                        )}
                        {apiVerification.verdict === 'discrepancy' && (
                          <div className="flex items-center gap-2 p-2 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs">
                            <AlertTriangle className="h-4 w-4 text-red-600" />
                            <span className="text-red-800 dark:text-red-200 font-medium">Discrepancy found — see details below</span>
                          </div>
                        )}
                        {apiVerification.verdict === 'no_data' && (
                          <div className="flex items-center gap-2 p-2 rounded-md bg-muted border border-border text-xs">
                            <Info className="h-4 w-4 text-muted-foreground" />
                            <span className="text-muted-foreground">No transactions found in Mirakl API for this period/document</span>
                          </div>
                        )}
                        {apiVerification.verdict === 'api_error' && (
                          <div className="flex items-center gap-2 p-2 rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-xs">
                            <AlertTriangle className="h-4 w-4 text-red-600" />
                            <span className="text-red-800 dark:text-red-200">{apiVerification.error || 'API error'}</span>
                          </div>
                        )}

                        {/* Transaction summary table */}
                        {apiVerification.api_transactions?.length > 0 && (
                          <div>
                            <h5 className="text-[11px] font-medium text-muted-foreground mb-1">
                              API Transactions ({apiVerification.transaction_count} total)
                            </h5>
                            <div className="border border-border rounded-md overflow-hidden">
                              <table className="w-full text-[11px]">
                                <thead className="bg-muted/50">
                                  <tr>
                                    <th className="text-left py-1 px-2 font-medium text-muted-foreground">Type</th>
                                    <th className="text-right py-1 px-2 font-medium text-muted-foreground">Count</th>
                                    <th className="text-right py-1 px-2 font-medium text-muted-foreground">Total</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-border/50">
                                  {apiVerification.api_transactions.map((tx: any, i: number) => (
                                    <tr key={i} className="hover:bg-muted/20">
                                      <td className="py-1 px-2 font-mono text-foreground">{tx.transaction_type}</td>
                                      <td className="py-1 px-2 text-right text-muted-foreground">{tx.count}</td>
                                      <td className={cn("py-1 px-2 text-right font-mono",
                                        tx.total_amount >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"
                                      )}>
                                        {formatAUD(tx.total_amount)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        {/* Discrepancies table */}
                        {apiVerification.discrepancies?.length > 0 && (
                          <div>
                            <h5 className="text-[11px] font-medium text-red-600 dark:text-red-400 mb-1">Discrepancies</h5>
                            <div className="border border-red-200 dark:border-red-800 rounded-md overflow-hidden">
                              <table className="w-full text-[11px]">
                                <thead className="bg-red-50 dark:bg-red-900/20">
                                  <tr>
                                    <th className="text-left py-1 px-2 font-medium text-red-700 dark:text-red-300">Field</th>
                                    <th className="text-right py-1 px-2 font-medium text-red-700 dark:text-red-300">Stored</th>
                                    <th className="text-right py-1 px-2 font-medium text-red-700 dark:text-red-300">API</th>
                                    <th className="text-right py-1 px-2 font-medium text-red-700 dark:text-red-300">Diff</th>
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-red-100 dark:divide-red-900/50">
                                  {apiVerification.discrepancies.map((d: any, i: number) => (
                                    <tr key={i}>
                                      <td className="py-1 px-2 font-mono text-foreground">{d.field}</td>
                                      <td className="py-1 px-2 text-right font-mono text-muted-foreground">{formatAUD(d.stored_value)}</td>
                                      <td className="py-1 px-2 text-right font-mono text-foreground">{formatAUD(d.api_value)}</td>
                                      <td className="py-1 px-2 text-right font-mono text-red-600 dark:text-red-400 font-medium">
                                        {d.difference >= 0 ? '+' : ''}{formatAUD(d.difference)}
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          </div>
                        )}

                        {/* Missing transaction types */}
                        {apiVerification.missing_transaction_types?.length > 0 && (
                          <div>
                            <h5 className="text-[11px] font-medium text-amber-600 dark:text-amber-400 mb-1">
                              Unmapped Transaction Types (in API, not in stored data)
                            </h5>
                            <div className="flex flex-wrap gap-1">
                              {apiVerification.missing_transaction_types.map((mt: any, i: number) => (
                                <Badge key={i} variant="outline" className="text-[9px] font-mono">
                                  {mt.transaction_type}: {formatAUD(mt.total_amount)} ({mt.count}x)
                                </Badge>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Re-verify button */}
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 text-[10px] gap-1"
                          onClick={handleVerifyMirakl}
                          disabled={apiVerifying}
                        >
                          <Search className="h-3 w-3" />
                          {apiVerifying ? 'Re-verifying…' : 'Re-verify'}
                        </Button>
                      </CollapsibleContent>
                    </Collapsible>
                  )}
                </div>
              </>
            )}

            {/* Download Audit CSV */}
            {lineItems.length > 0 && settlement && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => {
                    const headers = ['description', 'account_code', 'tax_type', 'amount_ex_gst', 'gst_estimate', 'amount_inc_gst_estimate'];
                    const rows = lineItems.map(li => {
                      const exGst = li.amount;
                      const gstRate = li.tax_type === 'BASEXCLUDED' ? 0 : 0.1;
                      const gst = Math.round(exGst * gstRate * 100) / 100;
                      const inc = Math.round((exGst + gst) * 100) / 100;
                      return [li.description, li.account_code, li.tax_type, exGst, gst, inc]
                        .map(v => `"${String(v).replace(/"/g, '""')}"`).join(',');
                    });
                    const csv = [headers.join(','), ...rows].join('\n');
                    const blob = new Blob([csv], { type: 'text/csv' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `Xettle-${settlement.settlement_id}-audit.csv`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download className="h-3.5 w-3.5" />
                  Download Audit CSV
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs gap-1.5"
                  onClick={() => {
                    const data = {
                      settlement_id: settlement.settlement_id,
                      marketplace: settlement.marketplace,
                      period_start: settlement.period_start,
                      period_end: settlement.period_end,
                      bank_deposit: settlement.bank_deposit,
                      sales_principal: settlement.sales_principal,
                      sales_shipping: settlement.sales_shipping,
                      seller_fees: settlement.seller_fees,
                      refunds: settlement.refunds,
                      gst_on_income: settlement.gst_on_income,
                      gst_on_expenses: settlement.gst_on_expenses,
                      status: settlement.status,
                      xero_invoice_number: settlement.xero_invoice_number,
                    };
                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `Xettle-${settlement.settlement_id}-raw.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  <Download className="h-3.5 w-3.5" />
                  Download Raw Data
                </Button>
              </div>
            )}
            {events.length > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="text-xs font-semibold text-foreground mb-2">Audit Trail</h4>
                  <div className="space-y-1.5">
                    {events.map(e => (
                      <div key={e.id} className="flex items-start gap-2 text-[11px]">
                        <span className={cn(
                          "mt-0.5",
                          e.severity === 'error' ? 'text-destructive' :
                          e.severity === 'warning' ? 'text-amber-500' :
                          'text-emerald-500'
                        )}>
                          {e.severity === 'error' ? <AlertTriangle className="h-3 w-3" /> :
                           e.severity === 'warning' ? <AlertTriangle className="h-3 w-3" /> :
                           <CheckCircle2 className="h-3 w-3" />}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-foreground">{formatEventType(e.event_type)}</span>
                          {e.details?.posting_mode && (
                            <span className="text-muted-foreground ml-1">({e.details.posting_mode})</span>
                          )}
                        </div>
                        <span className="text-muted-foreground flex-shrink-0">
                          {new Date(e.created_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="mt-6 text-sm text-muted-foreground text-center py-8">
            Settlement not found.
          </div>
        )}
      </SheetContent>
    </Sheet>
    <XeroInvoiceCompareDrawer
      open={compareOpen}
      onClose={() => setCompareOpen(false)}
      settlementId={settlementId}
      xeroInvoiceId={settlement?.xero_invoice_id || settlement?.xero_journal_id || null}
    />
    </>
  );
}

function formatEventType(type: string): string {
  const labels: Record<string, string> = {
    settlement_saved: 'Ingested',
    xero_push_success: 'Pushed to Xero (verified)',
    auto_post_success: 'Auto-posted to Xero (verified)',
    auto_post_failed: 'Auto-post failed',
    xero_push_failed: 'Xero push failed',
    bank_match_confirmed: 'Bank deposit matched',
    bank_match_failed: 'Bank match not found',
    bank_match_query: 'Bank feed queried',
    reconciliation_run: 'Reconciliation completed',
    reconciliation_mismatch: 'Reconciliation gap detected',
    validation_sweep_complete: 'Validation sweep',
    xero_api_call: 'Xero API call',
    external_link_removed: 'External link removed (cleanup)',
    external_xero_detected: 'External Xero invoice detected',
    settlement_corrected: '⚠ Settlement corrected (parser bug fix)',
  };
  return labels[type] || type.replace(/_/g, ' ');
}
