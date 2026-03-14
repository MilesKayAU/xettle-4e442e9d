/**
 * useXeroSync — Shared hook for Xero push, rollback, refresh, and mark-as-synced.
 * Part of the BaseMarketplaceDashboard architecture pattern.
 */

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  syncSettlementToXero,
  syncXeroStatus,
  rollbackSettlementFromXero,
  type StandardSettlement,
} from '@/utils/settlement-engine';
import { runUniversalReconciliation } from '@/utils/universal-reconciliation';
import { toast } from 'sonner';
import type { BaseSettlementRow } from './use-settlement-manager';

interface UseXeroSyncOptions {
  loadSettlements: () => void;
}

export function useXeroSync({ loadSettlements }: UseXeroSyncOptions) {
  const [pushing, setPushing] = useState<string | null>(null);
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [refreshingXero, setRefreshingXero] = useState(false);

  /** Build a StandardSettlement from a DB row for recon + Xero push */
  const toStandardSettlement = useCallback((s: BaseSettlementRow & Record<string, any>): StandardSettlement => ({
    marketplace: s.marketplace,
    settlement_id: s.settlement_id,
    period_start: s.period_start,
    period_end: s.period_end,
    sales_ex_gst: s.sales_principal || 0,
    gst_on_sales: s.gst_on_income || 0,
    fees_ex_gst: s.seller_fees || 0,
    gst_on_fees: s.gst_on_expenses || 0,
    net_payout: s.bank_deposit || 0,
    source: 'csv_upload',
    reconciles: true,
    metadata: {
      refundsExGst: s.refunds || 0,
      shippingExGst: s.sales_shipping || 0,
      // Exclude payout-type adjustments from subscription — only include positive other_fees (real subscription charges)
      subscriptionAmount: (s.other_fees && s.other_fees < 0) ? 0 : (s.other_fees || 0),
      refundCommissionExGst: s.reimbursements || 0,
    },
  }), []);

  const handlePushToXero = useCallback(async (
    settlement: BaseSettlementRow & Record<string, any>,
    bankAmount?: number,
  ) => {
    setPushing(settlement.id);
    try {
      const stdSettlement = toStandardSettlement(settlement);
      const reconResult = runUniversalReconciliation(stdSettlement);

      if (!reconResult.canSync) {
        toast.error('Critical reconciliation issues — resolve before syncing to Xero.');
        return;
      }
      if (reconResult.overallStatus === 'warn') {
        toast.warning('Reconciliation warnings exist — proceeding with sync.');
      }

      const lineItems = await buildSimpleInvoiceLines(stdSettlement);
      const result = await syncSettlementToXero(settlement.settlement_id, settlement.marketplace, { lineItems });

      if (result.success) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user && bankAmount !== undefined) {
          await supabase.from('settlements').update({
            bank_verified: true,
            bank_verified_amount: bankAmount,
            bank_verified_at: new Date().toISOString(),
            bank_verified_by: user.id,
          } as any).eq('id', settlement.id);
        }
        toast.success('Invoice created in Xero!');
        loadSettlements();
      } else {
        if (result.error?.includes('already exists in Xero')) {
          toast.error('Duplicate invoice detected — void the existing invoice in Xero first, then retry.', { duration: 8000 });
        } else {
          toast.error(result.error || 'Failed to push to Xero');
        }
      }
    } catch (err: any) {
      toast.error(`Xero sync failed: ${err.message}`);
    } finally {
      setPushing(null);
    }
  }, [loadSettlements, toStandardSettlement]);

  const handleRollback = useCallback(async (settlement: BaseSettlementRow) => {
    if (!settlement.xero_journal_id) return;
    const confirmed = window.confirm(
      `This will void invoice ${settlement.xero_invoice_number || settlement.xero_journal_id} in Xero and reset the settlement to "Ready to push". Continue?`
    );
    if (!confirmed) return;
    setRollingBack(settlement.id);
    try {
      const invoiceIds = [settlement.xero_journal_id];
      const result = await rollbackSettlementFromXero(settlement.settlement_id, settlement.marketplace, invoiceIds);
      if (result.success) {
        await supabase.from('settlements').update({
          status: 'saved', xero_journal_id: null, xero_invoice_number: null, xero_status: null
        } as any).eq('id', settlement.id);
        toast.success('Invoice voided in Xero — settlement reset to Ready');
        loadSettlements();
      } else {
        toast.error(result.error || 'Rollback failed');
      }
    } catch (err: any) {
      toast.error(`Rollback failed: ${err.message}`);
    } finally {
      setRollingBack(null);
    }
  }, [loadSettlements]);

  const handleRefreshXero = useCallback(async () => {
    setRefreshingXero(true);
    try {
      const result = await syncXeroStatus();
      if (result.success) {
        const total = (result.updated || 0) + (result.fuzzy_matched || 0);
        if (total > 0) {
          toast.success(`Xero audit: ${result.updated || 0} exact match${(result.updated || 0) !== 1 ? 'es' : ''}, ${result.fuzzy_matched || 0} fuzzy match${(result.fuzzy_matched || 0) !== 1 ? 'es' : ''}`);
        } else {
          toast.info('Xero audit complete — no new matches found');
        }
        loadSettlements();
      } else {
        if (result.error?.includes('No Xero connection')) {
          // Silent — no Xero connected, don't show error
          console.log('[XeroSync] No Xero connection — skipping audit');
        } else {
          toast.error(result.error || 'Failed to refresh from Xero');
        }
      }
    } catch (err: any) {
      toast.error(`Refresh failed: ${err.message}`);
    } finally {
      setRefreshingXero(false);
    }
  }, [loadSettlements]);

  const handleMarkAlreadySynced = useCallback(async (settlementId: string) => {
    const { error } = await supabase
      .from('settlements')
      .update({ status: 'synced_external' })
      .eq('settlement_id', settlementId);
    if (error) {
      toast.error('Failed to update status');
    } else {
      toast.success('Marked as Already in Xero');
      loadSettlements();
    }
  }, [loadSettlements]);

  const handleBulkMarkSynced = useCallback(async (settlements: BaseSettlementRow[]) => {
    const unsyncedIds = settlements
      .filter(s => s.status === 'saved' || s.status === 'parsed')
      .map(s => s.settlement_id);
    if (unsyncedIds.length === 0) {
      toast.info('No unsynced settlements to mark');
      return;
    }
    const { error } = await supabase
      .from('settlements')
      .update({ status: 'synced_external' })
      .in('settlement_id', unsyncedIds);
    if (error) {
      toast.error('Failed to update statuses');
    } else {
      toast.success(`Marked ${unsyncedIds.length} settlements as Already in Xero`);
      loadSettlements();
    }
  }, [loadSettlements]);

  return {
    pushing,
    rollingBack,
    refreshingXero,
    toStandardSettlement,
    handlePushToXero,
    handleRollback,
    handleRefreshXero,
    handleMarkAlreadySynced,
    handleBulkMarkSynced,
  };
}
