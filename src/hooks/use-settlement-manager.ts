/**
 * useSettlementManager — Shared hook for loading, deleting, and managing settlements.
 * Part of the BaseMarketplaceDashboard architecture pattern.
 * All marketplace dashboards MUST use this hook for settlement CRUD.
 */

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { deleteSettlement } from '@/utils/settlement-engine';
import { toast } from 'sonner';

export interface BaseSettlementRow {
  id: string;
  settlement_id: string;
  marketplace: string;
  period_start: string;
  period_end: string;
  sales_principal: number | null;
  seller_fees: number | null;
  bank_deposit: number | null;
  status: string | null;
  created_at: string;
  gst_on_income: number | null;
  gst_on_expenses: number | null;
  xero_journal_id: string | null;
  xero_invoice_number: string | null;
  xero_status: string | null;
}

const DEFAULT_SELECT = 'id, settlement_id, marketplace, period_start, period_end, sales_principal, seller_fees, bank_deposit, status, created_at, gst_on_income, gst_on_expenses, refunds, reimbursements, other_fees, xero_journal_id, xero_invoice_number, xero_status, sales_shipping, bank_verified, bank_verified_amount, bank_verified_at, bank_verified_by';

interface UseSettlementManagerOptions {
  /** Primary marketplace code */
  marketplaceCode: string;
  /** Additional marketplace codes to query (e.g. shopify_orders_X, woolworths_marketplus_X) */
  additionalCodes?: string[];
  /** Custom select string — defaults to all standard fields */
  selectFields?: string;
}

export function useSettlementManager<T extends BaseSettlementRow = BaseSettlementRow>({
  marketplaceCode,
  additionalCodes = [],
  selectFields = DEFAULT_SELECT,
}: UseSettlementManagerOptions) {
  const [settlements, setSettlements] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const allCodes = [marketplaceCode, ...additionalCodes];

  const loadSettlements = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const orFilter = allCodes.map(c => `marketplace.eq.${c}`).join(',');
      const { data, error } = await supabase
        .from('settlements')
        .select(selectFields)
        .or(orFilter)
        .order('period_end', { ascending: false });
      if (error) throw error;
      setSettlements((data || []) as unknown as T[]);
      setHasLoadedOnce(true);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [marketplaceCode]);

  // Initial load
  useEffect(() => {
    loadSettlements(true);
  }, [loadSettlements]);

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel(`settlements-${marketplaceCode}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements' }, () => {
        loadSettlements();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadSettlements, marketplaceCode]);

  const handleDelete = useCallback(async (settlement: BaseSettlementRow) => {
    setDeleting(settlement.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      await supabase.from('settlement_lines').delete().eq('user_id', user.id).eq('settlement_id', settlement.settlement_id);
      await supabase.from('settlement_unmapped').delete().eq('user_id', user.id).eq('settlement_id', settlement.settlement_id);
      await supabase.from('settlements').delete().eq('id', settlement.id);

      toast.success(`Deleted settlement ${settlement.settlement_id}`);
      loadSettlements();
    } catch (err: any) {
      toast.error(`Failed to delete: ${err.message}`);
    } finally {
      setDeleting(null);
    }
  }, [loadSettlements]);

  return {
    settlements,
    loading,
    hasLoadedOnce,
    deleting,
    loadSettlements,
    handleDelete,
    setSettlements,
  };
}
