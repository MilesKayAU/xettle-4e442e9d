import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { AlertTriangle, ArrowRight, CheckCircle2, Loader2, Undo2, FileText, RefreshCw } from 'lucide-react';
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
  is_split_month?: boolean;
  status?: string;
}

interface SafeRepostModalProps {
  settlement: RepostSettlement;
  onClose: () => void;
  onComplete: () => void;
}

type RepostStep = 'reason' | 'voiding' | 'voided' | 'ready_to_push' | 'error';

/**
 * SafeRepostModal — Accountant-grade repost workflow:
 * 1. Capture reason for repost
 * 2. Void existing invoice(s) in Xero
 * 3. Reset settlement to ready_to_push with repost chain linkage
 * 4. User then pushes new DRAFT via PushSafetyPreview
 * 
 * Rules:
 * - Never overwrite
 * - Never delete
 * - Always audit trail (system_events + repost columns)
 * - Always link old + new invoice IDs via repost_chain_id
 */
export default function SafeRepostModal({ settlement, onClose, onComplete }: SafeRepostModalProps) {
  const [step, setStep] = useState<RepostStep>('reason');
  const [reason, setReason] = useState('');
  const [processing, setProcessing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [voidedInvoiceIds, setVoidedInvoiceIds] = useState<string[]>([]);

  const invoiceIds = [
    settlement.xero_journal_id,
    settlement.xero_journal_id_1,
    settlement.xero_journal_id_2,
  ].filter(Boolean) as string[];

  const handleStartRepost = async () => {
    if (!reason.trim()) {
      toast.error('Please provide a reason for the repost');
      return;
    }

    setProcessing(true);
    setStep('voiding');

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Step 1: Void existing invoices via sync-amazon-journal rollback
      const { data, error } = await supabase.functions.invoke('sync-amazon-journal', {
        body: {
          action: 'rollback',
          userId: user.id,
          settlementId: settlement.settlement_id,
          journalIds: invoiceIds,
          rollbackScope: 'all',
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setVoidedInvoiceIds(invoiceIds);

      // Step 2: Generate a repost chain ID and update settlement
      const chainId = crypto.randomUUID();

      const { error: updateErr } = await supabase
        .from('settlements')
        .update({
          repost_chain_id: chainId,
          repost_of_invoice_id: invoiceIds[0], // Primary voided invoice
          repost_reason: reason.trim(),
          status: 'ready_to_push',
          posting_state: null,
          posting_error: null,
        })
        .eq('id', settlement.id);

      if (updateErr) throw updateErr;

      // Step 3: Log audit event
      await supabase.from('system_events').insert({
        user_id: user.id,
        event_type: 'safe_repost_initiated',
        settlement_id: settlement.settlement_id,
        marketplace_code: settlement.marketplace,
        severity: 'info',
        details: {
          reason: reason.trim(),
          voided_invoice_ids: invoiceIds,
          repost_chain_id: chainId,
          original_invoice_number: settlement.xero_invoice_number || null,
          period: `${settlement.period_start} to ${settlement.period_end}`,
          bank_deposit: settlement.bank_deposit,
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
            <span className="font-mono text-amber-700">{invoiceIds.join(', ').substring(0, 40)}…</span>
          </div>
        </div>

        {/* Step: Reason */}
        {step === 'reason' && (
          <div className="space-y-3">
            {/* Workflow preview */}
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

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={onClose}>Cancel</Button>
              <Button
                size="sm"
                onClick={handleStartRepost}
                disabled={!reason.trim()}
                className="gap-1.5"
              >
                <Undo2 className="h-3.5 w-3.5" />
                Void & Prepare Repost
              </Button>
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
                <li>Repost chain linked for traceability</li>
              </ul>
            </div>

            <div className="bg-blue-50 border border-blue-200 rounded-md p-2.5 text-xs text-blue-800">
              <FileText className="h-3.5 w-3.5 inline mr-1" />
              <strong>Next step:</strong> Go to the settlement row and use "Push to Xero" — it will open the Push Safety Preview 
              with the corrected line items. The new DRAFT invoice will be automatically linked to the voided one.
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
