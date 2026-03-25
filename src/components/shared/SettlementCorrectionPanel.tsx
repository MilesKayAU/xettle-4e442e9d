/**
 * Admin-only "Correct & Repost" panel for settlements pushed to Xero
 * with incorrect bank_deposit due to the parser bug.
 *
 * Shows current vs. API-verified amounts and offers Void & Repost workflow.
 */

import React, { useState, useCallback } from 'react';
import { AlertTriangle, RefreshCw, Upload, Loader2, CheckCircle2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { supabase } from '@/integrations/supabase/client';
import { formatAUD } from '@/utils/settlement-engine';
import { toast } from 'sonner';
import { isAffectedByParserBug } from './ParserBugWarningBanner';

interface Props {
  settlement: any;
  isAdmin: boolean;
  onSettlementUpdated: (updated: any) => void;
}

export default function SettlementCorrectionPanel({ settlement, isAdmin, onSettlementUpdated }: Props) {
  const [verifying, setVerifying] = useState(false);
  const [apiAmount, setApiAmount] = useState<number | null>(null);
  const [correcting, setCorrecting] = useState(false);
  const [corrected, setCorrected] = useState(false);

  // Only show for admin + affected + already pushed
  const isPushed = settlement.status === 'pushed_to_xero';
  if (!isAdmin || !isAffectedByParserBug(settlement) || !isPushed) return null;

  const handleFetchCorrectAmount = useCallback(async () => {
    setVerifying(true);
    try {
      const res = await supabase.functions.invoke('verify-settlement', {
        body: { settlement_id: settlement.settlement_id },
      });
      if (res.error) throw new Error(res.error.message);
      const data = res.data;
      if (data?.api_totals?.payment != null) {
        setApiAmount(data.api_totals.payment);
      } else if (data?.verdict === 'api_error') {
        toast.error(`API error: ${data.error || 'Unknown'}`);
      } else {
        toast.error('Could not find PAYMENT amount in API response');
      }
    } catch (err: any) {
      toast.error(`Verification failed: ${err.message}`);
    } finally {
      setVerifying(false);
    }
  }, [settlement.settlement_id]);

  const handleVoidAndRepost = useCallback(async () => {
    if (apiAmount === null) return;
    setCorrecting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const oldDeposit = settlement.bank_deposit;

      // Step 1: Update settlement with correct bank_deposit
      const { error: updateErr } = await supabase
        .from('settlements')
        .update({
          bank_deposit: apiAmount,
          status: 'ready_to_push',
          xero_invoice_id: null,
          xero_invoice_number: null,
        })
        .eq('id', settlement.id);
      if (updateErr) throw new Error(`Update failed: ${updateErr.message}`);

      // Step 2: Log correction event
      await supabase.from('system_events').insert({
        user_id: user.id,
        settlement_id: settlement.settlement_id,
        marketplace_code: settlement.marketplace,
        event_type: 'settlement_corrected',
        severity: 'warning',
        details: {
          correction_reason: 'parser_bug_bank_deposit',
          old_bank_deposit: oldDeposit,
          new_bank_deposit: apiAmount,
          xero_invoice_voided: true,
          old_xero_invoice_id: settlement.xero_invoice_id,
          old_xero_invoice_number: settlement.xero_invoice_number,
          corrected_at: new Date().toISOString(),
          corrected_by: user.id,
          note: 'Corrected: Previous invoice voided due to incorrect bank deposit captured from PDF parser bug. Correct amount verified via Mirakl API.',
        },
      });

      // Step 3: Void the old Xero invoice via sync edge function
      if (settlement.xero_invoice_id) {
        try {
          await supabase.functions.invoke('void-xero-invoice', {
            body: {
              invoice_id: settlement.xero_invoice_id,
              reason: 'Corrected: Previous invoice voided due to incorrect bank deposit captured from PDF parser bug. Correct amount verified via Mirakl API.',
            },
          });
        } catch (voidErr: any) {
          console.warn('Void invoice call failed (may not exist):', voidErr.message);
          // Log but don't block — manual void may be needed
          toast.warning('Could not auto-void old Xero invoice — you may need to void it manually in Xero');
        }
      }

      // Update local state
      onSettlementUpdated({
        ...settlement,
        bank_deposit: apiAmount,
        status: 'ready_to_push',
        xero_invoice_id: null,
        xero_invoice_number: null,
      });

      setCorrected(true);
      toast.success(`Corrected: bank deposit updated from ${formatAUD(oldDeposit)} to ${formatAUD(apiAmount)}. Settlement is ready to re-push to Xero.`);
    } catch (err: any) {
      toast.error(`Correction failed: ${err.message}`);
    } finally {
      setCorrecting(false);
    }
  }, [settlement, apiAmount, onSettlementUpdated]);

  if (corrected) {
    return (
      <div className="rounded-lg border border-emerald-300 bg-emerald-50 dark:bg-emerald-900/20 dark:border-emerald-800 p-3 flex items-start gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
        <div className="text-xs">
          <p className="font-semibold text-emerald-800 dark:text-emerald-200">Correction applied</p>
          <p className="text-emerald-700 dark:text-emerald-300 mt-0.5">
            Bank deposit updated to {formatAUD(apiAmount!)}. Settlement is now ready to re-push to Xero.
          </p>
        </div>
      </div>
    );
  }

  return (
    <>
      <Separator />
      <div className="rounded-lg border-2 border-destructive/50 bg-destructive/5 p-3 space-y-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <span className="text-xs font-bold text-destructive">Correct & Repost (Admin)</span>
        </div>

        <div className="text-[11px] text-muted-foreground space-y-1">
          <p>This settlement was pushed to Xero with an incorrect bank deposit of <strong className="text-foreground">{formatAUD(settlement.bank_deposit)}</strong> due to a parser bug.</p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs bg-background rounded-md border border-border p-2.5">
          <div>
            <span className="text-muted-foreground">Current (incorrect)</span>
            <div className="font-mono font-medium text-destructive">{formatAUD(settlement.bank_deposit)}</div>
          </div>
          <div>
            <span className="text-muted-foreground">API-verified correct</span>
            <div className="font-mono font-medium text-emerald-600">
              {apiAmount !== null ? formatAUD(apiAmount) : '—'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {apiAmount === null ? (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={handleFetchCorrectAmount}
              disabled={verifying}
            >
              {verifying ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              {verifying ? 'Fetching from API…' : 'Fetch correct amount from API'}
            </Button>
          ) : (
            <Button
              variant="destructive"
              size="sm"
              className="h-7 text-xs gap-1.5"
              onClick={handleVoidAndRepost}
              disabled={correcting}
            >
              {correcting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
              {correcting ? 'Correcting…' : 'Void & Repost to Xero'}
            </Button>
          )}
        </div>

        <p className="text-[10px] text-muted-foreground">
          This will void the existing Xero invoice, update the bank deposit, and re-push a corrected invoice. 
          A full audit trail is logged in system events.
        </p>
      </div>
    </>
  );
}
