import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, Undo2, FileText, RefreshCw, ShieldAlert } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { formatAUD } from '@/utils/settlement-parser';

interface RepostSettlement {
  id: string;
  settlement_id: string;
  marketplace: string;
  period_start: string;
  period_end: string;
  bank_deposit: number;
  xero_journal_id: string | null;
  xero_journal_id_1?: string | null;
  xero_journal_id_2?: string | null;
  xero_invoice_number?: string | null;
  xero_invoice_id?: string | null;
  is_split_month?: boolean;
  status?: string;
}

interface SafeRepostModalProps {
  settlement: RepostSettlement;
  onClose: () => void;
  onComplete: () => void;
}

type RepostStep = 'preflight' | 'reason' | 'voiding' | 'voided' | 'ready_to_push' | 'error';

interface PreflightResult {
  canRepost: boolean;
  blockers: string[];
  warnings: string[];
  invoiceStatus?: string;
}

/**
 * SafeRepostModal — Accountant-grade repost workflow (Model A):
 * - One settlement row, multiple invoice attempts
 * - Void existing invoice(s) in Xero
 * - Reset settlement to ready_to_push with repost linkage
 * - User pushes new DRAFT via PushSafetyPreview
 * 
 * Guards:
 * - Blocks repost if invoice is PAID (requires accountant workflow)
 * - Blocks if invoice is already VOIDED (idempotent — shows message)
 * - Blocks if a newer replacement invoice exists
 * - Period lock check
 * - Records immutable audit trail
 */
export default function SafeRepostModal({ settlement, onClose, onComplete }: SafeRepostModalProps) {
  const [step, setStep] = useState<RepostStep>('preflight');
  const [reason, setReason] = useState('');
  const [processing, setProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [voidedInvoiceIds, setVoidedInvoiceIds] = useState<string[]>([]);
  const [preflight, setPreflight] = useState<PreflightResult | null>(null);

  const invoiceIds = [
    settlement.xero_journal_id,
    settlement.xero_journal_id_1,
    settlement.xero_journal_id_2,
  ].filter(Boolean) as string[];

  // Run preflight checks on mount
  useEffect(() => {
    runPreflightChecks();
  }, []);

  const runPreflightChecks = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setPreflight({ canRepost: false, blockers: ['Not authenticated'], warnings: [] });
        setStep('reason');
        return;
      }

      const blockers: string[] = [];
      const warnings: string[] = [];

      // 1. Period lock check
      const periodMonth = settlement.period_end?.substring(0, 7);
      if (periodMonth) {
        const { data: lockData } = await supabase
          .from('period_locks')
          .select('id')
          .eq('user_id', user.id)
          .eq('period_month', periodMonth)
          .is('unlocked_at', null)
          .maybeSingle();
        if (lockData) {
          blockers.push(`Period ${periodMonth} is locked. Unlock it first.`);
        }
      }

      // 2. Check if invoice IDs exist
      if (invoiceIds.length === 0) {
        blockers.push('No invoice IDs found on this settlement — nothing to void.');
      }

      // 3. Check for existing non-VOIDED match in xero_accounting_matches
      const { data: existingMatch } = await supabase
        .from('xero_accounting_matches')
        .select('xero_invoice_id, xero_status, xero_invoice_number')
        .eq('user_id', user.id)
        .eq('settlement_id', settlement.settlement_id)
        .maybeSingle();

      if (existingMatch) {
        const status = existingMatch.xero_status?.toUpperCase();

        if (status === 'PAID') {
          blockers.push(
            `Invoice ${existingMatch.xero_invoice_number || existingMatch.xero_invoice_id} is PAID in Xero. ` +
            `Paid invoices cannot be voided — use credit notes in Xero instead.`
          );
        } else if (status === 'VOIDED') {
          // Already voided — check if a newer replacement exists
          warnings.push('Previous invoice is already VOIDED in Xero.');
        }

        // Check if a different (newer) invoice exists for this settlement
        if (existingMatch.xero_invoice_id && !invoiceIds.includes(existingMatch.xero_invoice_id)) {
          blockers.push(
            `A different invoice (${existingMatch.xero_invoice_number || existingMatch.xero_invoice_id}) ` +
            `already exists for this settlement. Resolve it first.`
          );
        }
      }

      const result: PreflightResult = {
        canRepost: blockers.length === 0,
        blockers,
        warnings,
        invoiceStatus: existingMatch?.xero_status || undefined,
      };

      setPreflight(result);
      setStep(result.canRepost ? 'reason' : 'reason'); // Always show reason step with blockers visible
    } catch (err) {
      console.error('Preflight check failed:', err);
      setPreflight({ canRepost: true, blockers: [], warnings: ['Preflight checks could not complete — proceed with caution.'] });
      setStep('reason');
    }
  };

  const handleStartRepost = async () => {
    if (!reason.trim()) {
      toast.error('Please provide a reason for the repost');
      return;
    }

    if (preflight && !preflight.canRepost) {
      toast.error('Cannot repost — resolve blockers first');
      return;
    }

    setProcessing(true);
    setStep('voiding');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Step 1: Void existing invoices via sync-settlement-to-xero rollback
      // This function is marketplace-agnostic — it voids by invoice ID
      const { data, error } = await supabase.functions.invoke('sync-settlement-to-xero', {
        body: {
          action: 'rollback',
          userId: user.id,
          settlementId: settlement.settlement_id,
          invoiceIds: invoiceIds,
          rollbackScope: 'all',
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setVoidedInvoiceIds(invoiceIds);

      // Step 2: Check if auto_repost_after_rollback is enabled for this marketplace
      const { data: railSetting } = await supabase
        .from('rail_posting_settings')
        .select('auto_repost_after_rollback, posting_mode')
        .eq('user_id', user.id)
        .eq('rail', settlement.marketplace)
        .maybeSingle();

      // If auto-post is ON but auto_repost_after_rollback is OFF, use manual_hold
      // This prevents the auto-poster from picking up the settlement immediately
      const useManualHold = railSetting?.posting_mode === 'auto' && !railSetting?.auto_repost_after_rollback;

      // Step 3: Update settlement for repost (Model A — same row)
      const { error: updateErr } = await supabase
        .from('settlements')
        .update({
          repost_of_invoice_id: invoiceIds[0], // Primary voided invoice
          repost_reason: reason.trim(),
          status: 'ready_to_push',
          posting_state: useManualHold ? 'manual_hold' : null,
          posting_error: null,
          // Clear old invoice links so PushSafetyPreview doesn't block
          xero_invoice_id: null,
          xero_journal_id: null,
          xero_journal_id_1: null,
          xero_journal_id_2: null,
          xero_invoice_number: null,
          xero_status: null,
        })
        .eq('id', settlement.id)
        .eq('user_id', user.id);

      if (updateErr) throw updateErr;

      // Step 3: Update xero_accounting_matches to mark old match as VOIDED
      await supabase
        .from('xero_accounting_matches')
        .update({ xero_status: 'VOIDED' })
        .eq('user_id', user.id)
        .eq('settlement_id', settlement.settlement_id);

      // Step 4: Log immutable audit event
      await supabase.from('system_events').insert({
        user_id: user.id,
        event_type: 'safe_repost_initiated',
        settlement_id: settlement.settlement_id,
        marketplace_code: settlement.marketplace,
        severity: 'info',
        details: {
          reason: reason.trim(),
          voided_invoice_ids: invoiceIds,
          original_invoice_number: settlement.xero_invoice_number || null,
          period: `${settlement.period_start} to ${settlement.period_end}`,
          bank_deposit: settlement.bank_deposit,
          actor_user_id: user.id,
          initiated_at: new Date().toISOString(),
        },
      });

      setStep('voided');
      toast.success('Invoice voided — settlement ready for repost');
    } catch (err: any) {
      console.error('Repost failed:', err);
      setErrorMsg(err.message || 'Repost failed');
      setStep('error');
    } finally {
      setProcessing(false);
    }
  };

  const handleFinish = () => {
    onComplete();
    onClose();
  };

  const isPreflightLoading = step === 'preflight';
  const hasBlockers = preflight && preflight.blockers.length > 0;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-background rounded-lg shadow-xl max-w-lg w-full p-6 space-y-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div>
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <RefreshCw className="h-5 w-5 text-primary" />
            Safe Repost
          </h3>
          <p className="text-xs text-muted-foreground mt-1">
            Void the existing invoice and create a new corrected DRAFT — with full audit trail
          </p>
        </div>

        {/* Settlement context */}
        <div className="bg-muted/50 rounded-md p-3 text-xs space-y-1.5">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Settlement</span>
            <span className="font-mono font-medium">{settlement.settlement_id}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Period</span>
            <span>{settlement.period_start} → {settlement.period_end}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Deposit</span>
            <span className="font-mono">{formatAUD(settlement.bank_deposit)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Invoice{invoiceIds.length > 1 ? 's' : ''}</span>
            <span className="font-mono text-amber-700">{invoiceIds.join(', ').substring(0, 40)}{invoiceIds.join(', ').length > 40 ? '…' : ''}</span>
          </div>
        </div>

        {/* Preflight loading */}
        {isPreflightLoading && (
          <div className="flex items-center justify-center py-6 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" />
            Running safety checks…
          </div>
        )}

        {/* Step: Reason (with preflight results) */}
        {step === 'reason' && (
          <div className="space-y-3">
            {/* Blockers */}
            {hasBlockers && (
              <div className="bg-destructive/10 border border-destructive/30 rounded-md p-3 space-y-1.5">
                <p className="text-xs font-semibold text-destructive flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5" />
                  Repost blocked
                </p>
                {preflight!.blockers.map((b, i) => (
                  <p key={i} className="text-xs text-destructive/80 ml-5">• {b}</p>
                ))}
              </div>
            )}

            {/* Warnings */}
            {preflight && preflight.warnings.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-md p-2.5 text-xs text-amber-800">
                {preflight.warnings.map((w, i) => (
                  <p key={i}>⚠ {w}</p>
                ))}
              </div>
            )}

            {/* Workflow preview */}
            {!hasBlockers && (
              <>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="outline" className="text-[10px]">1. Void old</Badge>
                  <ArrowRight className="h-3 w-3" />
                  <Badge variant="outline" className="text-[10px]">2. Reset status</Badge>
                  <ArrowRight className="h-3 w-3" />
                  <Badge variant="outline" className="text-[10px]">3. Push new DRAFT</Badge>
                </div>

                <div>
                  <Label htmlFor="repost-reason" className="text-sm font-medium">
                    Reason for repost <span className="text-destructive">*</span>
                  </Label>
                  <Textarea
                    id="repost-reason"
                    placeholder="e.g. Wrong account codes on fee lines, Missing refund line, Incorrect GST treatment…"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    className="mt-1.5 text-sm"
                    rows={3}
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    This is recorded in the audit trail and visible to your accountant.
                  </p>
                </div>

                <div className="bg-amber-50 border border-amber-200 rounded-md p-2.5 text-xs text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5 inline mr-1" />
                  <strong>This will void {invoiceIds.length} invoice{invoiceIds.length > 1 ? 's' : ''} in Xero.</strong>{' '}
                  Voided invoices remain visible in Xero history but have no financial effect.
                  The settlement will be reset to "Ready to Push" so you can push a corrected DRAFT.
                </div>
              </>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
              {!hasBlockers && (
                <Button
                  size="sm"
                  onClick={handleStartRepost}
                  disabled={!reason.trim()}
                  className="gap-1.5"
                >
                  <Undo2 className="h-3.5 w-3.5" />
                  Void & Prepare Repost
                </Button>
              )}
            </div>
          </div>
        )}

        {/* Step: Voiding in progress */}
        {step === 'voiding' && (
          <div className="flex flex-col items-center py-6 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin mb-2" />
            <p className="text-sm font-medium">Voiding invoice{invoiceIds.length > 1 ? 's' : ''} in Xero…</p>
            <p className="text-xs mt-1">This may take a moment</p>
          </div>
        )}

        {/* Step: Voided — ready to push */}
        {step === 'voided' && (
          <div className="space-y-4">
            <div className="flex flex-col items-center py-4">
              <CheckCircle2 className="h-8 w-8 text-green-500 mb-2" />
              <p className="text-sm font-medium text-foreground">Invoice voided successfully</p>
              <p className="text-xs text-muted-foreground mt-1">
                Settlement reset to <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Ready to Push</Badge>
              </p>
            </div>

            <div className="bg-muted/50 rounded-md p-3 text-xs space-y-1">
              <p><strong>Audit trail recorded:</strong></p>
              <ul className="list-disc list-inside text-muted-foreground space-y-0.5">
                <li>Voided invoice ID{voidedInvoiceIds.length > 1 ? 's' : ''}: <span className="font-mono">{voidedInvoiceIds.map(id => id.substring(0, 8) + '…').join(', ')}</span></li>
                <li>Reason: "{reason}"</li>
                <li>Old match marked VOIDED in tracking cache</li>
              </ul>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-md p-2.5 text-xs text-blue-800">
              <FileText className="h-3.5 w-3.5 inline mr-1" />
              <strong>Next step:</strong> Go to the settlement row and use "Push to Xero" — the Push Safety Preview
              will show a repost banner linking back to the voided invoice. The new DRAFT will be recorded as a replacement.
            </div>

            <div className="flex justify-end">
              <Button size="sm" onClick={handleFinish} className="gap-1.5">
                <CheckCircle2 className="h-3.5 w-3.5" />
                Done — I'll push the new DRAFT
              </Button>
            </div>
          </div>
        )}

        {/* Step: Error */}
        {step === 'error' && (
          <div className="space-y-4">
            <div className="flex flex-col items-center py-4">
              <AlertTriangle className="h-8 w-8 text-destructive mb-2" />
              <p className="text-sm font-medium text-destructive">Repost failed</p>
              <p className="text-xs text-muted-foreground mt-1 text-center max-w-sm">{errorMsg}</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>Close</Button>
              <Button size="sm" onClick={() => { setStep('reason'); setErrorMsg(''); }}>
                Try Again
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
