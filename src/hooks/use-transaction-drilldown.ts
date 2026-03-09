/**
 * useTransactionDrilldown — Shared hook for loading and expanding settlement line items.
 * Part of the BaseMarketplaceDashboard architecture pattern.
 */

import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export function useTransactionDrilldown() {
  const [expandedLines, setExpandedLines] = useState<string | null>(null);
  const [lineItems, setLineItems] = useState<Record<string, any[]>>({});
  const [loadingLines, setLoadingLines] = useState<string | null>(null);

  const loadLineItems = useCallback(async (settlementId: string) => {
    if (lineItems[settlementId]) {
      setExpandedLines(expandedLines === settlementId ? null : settlementId);
      return;
    }
    setLoadingLines(settlementId);
    setExpandedLines(settlementId);
    try {
      const { data, error } = await supabase
        .from('settlement_lines')
        .select('order_id, sku, amount, amount_description, posted_date, transaction_type')
        .eq('settlement_id', settlementId)
        .order('posted_date', { ascending: true })
        .limit(200);
      if (error) throw error;
      setLineItems(prev => ({ ...prev, [settlementId]: data || [] }));
    } catch {
      toast.error('Failed to load transaction details');
    } finally {
      setLoadingLines(null);
    }
  }, [lineItems, expandedLines]);

  return {
    expandedLines,
    lineItems,
    loadingLines,
    loadLineItems,
  };
}
