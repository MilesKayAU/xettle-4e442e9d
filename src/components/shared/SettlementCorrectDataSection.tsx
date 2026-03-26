/**
 * SettlementCorrectDataSection — Admin-only re-parse / delete actions
 * for CSV-uploaded settlements that were parsed incorrectly.
 */

import React, { useState, useCallback, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { AlertTriangle, FileUp, Loader2, Trash2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { parseBunningsSummaryPdf } from '@/utils/bunnings-summary-parser';
import { parseGenericCSV, parseGenericXLSX } from '@/utils/generic-csv-parser';
import { parseKoganRemittancePdf, parseKoganPayoutCSV } from '@/utils/kogan-remittance-parser';
import { parseShopifyPayoutCSV } from '@/utils/shopify-payments-parser';
import { parseWoolworthsMarketPlusCSV } from '@/utils/woolworths-marketplus-parser';
import { detectFile } from '@/utils/file-fingerprint-engine';
import { triggerValidationSweep, type StandardSettlement } from '@/utils/settlement-engine';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Props {
  settlement: any;
  isAdmin: boolean;
  onSettlementUpdated: (updated: any) => void;
  onClose: () => void;
}

/** Map StandardSettlement → DB update fields */
function standardToDbFields(s: StandardSettlement) {
  const meta = s.metadata || {};
  return {
    sales_principal: s.sales_ex_gst,
    sales_shipping: meta.shippingExGst || 0,
    seller_fees: -(Math.abs(s.fees_ex_gst)),
    refunds: meta.refundsExGst || 0,
    reimbursements: (meta.refundCommissionExGst || 0) + (meta.manualCreditInclGst || 0),
    other_fees: -Math.abs((meta.subscriptionAmount || 0) + (meta.manualDebitInclGst || 0) + (meta.otherChargesInclGst || 0)),
    gst_on_income: s.gst_on_sales,
    gst_on_expenses: -Math.abs(s.gst_on_fees),
    bank_deposit: s.net_payout,
    period_start: s.period_start,
    period_end: s.period_end,
    reconciliation_status: s.reconciles ? 'reconciled' : 'warning',
  };
}

export default function SettlementCorrectDataSection({ settlement, isAdmin, onSettlementUpdated, onClose }: Props) {
  const [reparsing, setReparsing] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isVisible =
    isAdmin &&
    settlement?.source === 'csv_upload' &&
    settlement?.status !== 'pushed_to_xero' &&
    settlement?.status !== 'already_recorded';

  const handleReparse = useCallback(async (file: File) => {
    setReparsing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Capture old values for audit log
      const oldValues = {
        sales_principal: settlement.sales_principal,
        seller_fees: settlement.seller_fees,
        refunds: settlement.refunds,
        bank_deposit: settlement.bank_deposit,
        other_fees: settlement.other_fees,
        gst_on_income: settlement.gst_on_income,
        gst_on_expenses: settlement.gst_on_expenses,
      };

      let parsed: StandardSettlement | null = null;
      const marketplace = settlement.marketplace as string;
      const isPdf = file.name.toLowerCase().endsWith('.pdf');
      const isCsv = /\.(csv|tsv|txt)$/i.test(file.name);
      const isXlsx = /\.xlsx?$/i.test(file.name);

      // Route to the correct parser based on marketplace
      if (marketplace === 'bunnings' && isPdf) {
        const result = await parseBunningsSummaryPdf(file);
        if (result.success) parsed = result.settlement;
        else throw new Error('Bunnings PDF parse failed');
      } else if (marketplace === 'kogan' && isPdf) {
        throw new Error('Kogan PDF re-parse requires the CSV file as well. Please use the CSV.');
      } else if (marketplace === 'kogan' && isCsv) {
        const text = await file.text();
        const result = parseKoganPayoutCSV(text);
        if (result.success && result.settlements.length > 0) {
          parsed = result.settlements.find(s => s.settlement_id === settlement.settlement_id) || result.settlements[0];
        } else {
          throw new Error('Kogan CSV parse failed');
        }
      } else if (marketplace === 'woolworths_marketplus' && isCsv) {
        const text = await file.text();
        const result = parseWoolworthsMarketPlusCSV(text);
        if (result.success && result.settlements.length > 0) {
          parsed = result.settlements.find(s => s.settlement_id === settlement.settlement_id) || result.settlements[0];
        } else {
          throw new Error('Woolworths CSV parse failed');
        }
      } else if (isCsv || isXlsx) {
        // Generic parser — needs fingerprint/mapping detection
        const detection = await detectFile(file);
        if (!detection || !detection.columnMapping) {
          throw new Error('Could not detect file format. Try re-uploading through the main upload flow.');
        }
        const options: GenericParseOptions = {
          mapping: detection.columnMapping,
          marketplace,
          gstModel: 'seller',
          gstRate: 10,
          groupBySettlement: true,
        };
        let result;
        if (isXlsx) {
          result = await parseGenericXLSX(file, options);
        } else {
          const text = await file.text();
          result = parseGenericCSV(text, options);
        }
        if (result.settlements.length > 0) {
          parsed = result.settlements.find(s => s.settlement_id === settlement.settlement_id) || result.settlements[0];
        } else {
          throw new Error('No settlements found in file');
        }
      } else {
        throw new Error(`Unsupported file type for ${marketplace}. Use PDF or CSV.`);
      }

      if (!parsed) throw new Error('Parser returned no settlement data');

      // Build DB update
      const newFields = standardToDbFields(parsed);

      // Update settlement row
      const { error: updateErr } = await supabase
        .from('settlements')
        .update(newFields as any)
        .eq('id', settlement.id);

      if (updateErr) throw new Error(`Update failed: ${updateErr.message}`);

      // Log the re-parse event
      await supabase.from('system_events' as any).insert({
        user_id: user.id,
        event_type: 'settlement_reparsed',
        severity: 'info',
        marketplace_code: marketplace,
        settlement_id: settlement.settlement_id,
        details: {
          old_values: oldValues,
          new_values: newFields,
          file_name: file.name,
          triggered_by: 'reparse_button',
        },
      } as any);

      // Trigger validation sweep
      try {
        await triggerValidationSweep();
      } catch {}

      // Update local state
      onSettlementUpdated({ ...settlement, ...newFields });
      toast.success('Settlement re-parsed successfully — financial fields updated');
    } catch (err: any) {
      toast.error(`Re-parse failed: ${err.message}`);
    } finally {
      setReparsing(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }, [settlement, onSettlementUpdated]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Log before delete
      await supabase.from('system_events' as any).insert({
        user_id: user.id,
        event_type: 'settlement_deleted_for_reupload',
        severity: 'warning',
        marketplace_code: settlement.marketplace,
        settlement_id: settlement.settlement_id,
        details: {
          bank_deposit: settlement.bank_deposit,
          period: `${settlement.period_start} → ${settlement.period_end}`,
          triggered_by: 'delete_reupload_button',
        },
      } as any);

      // Delete marketplace_validation row
      await supabase
        .from('marketplace_validation')
        .delete()
        .eq('settlement_id', settlement.settlement_id)
        .eq('user_id', user.id);

      // Delete settlement
      const { error } = await supabase
        .from('settlements')
        .delete()
        .eq('id', settlement.id);

      if (error) throw new Error(`Delete failed: ${error.message}`);

      toast.success('Settlement deleted — you can now re-upload the file');
      onClose();
    } catch (err: any) {
      toast.error(`Delete failed: ${err.message}`);
    } finally {
      setDeleting(false);
      setDeleteConfirmOpen(false);
    }
  }, [settlement, onClose]);

  if (!isVisible) return null;

  return (
    <>
      <Separator />
      <div className="space-y-3">
        <div className="flex items-start gap-2 p-3 rounded-lg border-2 border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20">
          <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
          <div className="space-y-1">
            <p className="text-xs font-semibold text-amber-800 dark:text-amber-200">Correct Data</p>
            <p className="text-[11px] text-amber-700 dark:text-amber-300">
              Only use these options if the original file was parsed incorrectly. This will overwrite existing settlement data.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.csv,.tsv,.xlsx,.xls"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleReparse(file);
            }}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => fileInputRef.current?.click()}
            disabled={reparsing}
          >
            {reparsing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileUp className="h-3.5 w-3.5" />}
            {reparsing ? 'Re-parsing…' : 'Re-parse File'}
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1.5 text-destructive border-destructive/30 hover:bg-destructive/10"
            onClick={() => setDeleteConfirmOpen(true)}
            disabled={deleting}
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete & Re-upload
          </Button>
        </div>
      </div>

      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete settlement?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{settlement.settlement_id}</strong> and its validation record.
              You can then re-upload the file through the normal upload flow.
              This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting ? 'Deleting…' : 'Delete Settlement'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
