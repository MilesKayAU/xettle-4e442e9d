/**
 * useBulkSelect — Shared hook for checkbox selection + bulk delete with Xero awareness.
 * Part of the BaseMarketplaceDashboard architecture pattern.
 */

import { useState, useCallback, useMemo } from 'react';
import { deleteSettlement } from '@/utils/settlement-engine';
import { toast } from 'sonner';
import type { BaseSettlementRow } from './use-settlement-manager';

interface UseBulkSelectOptions {
  settlements: BaseSettlementRow[];
  onComplete: () => void;
}

const XERO_SYNCED_STATUSES = ['synced', 'pushed_to_xero', 'synced_external', 'draft_in_xero', 'authorised_in_xero', 'reconciled_in_xero'];

export function useBulkSelect({ settlements, onComplete }: UseBulkSelectOptions) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);

  const toggleSelect = useCallback((id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (selected.size === settlements.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(settlements.map(s => s.id)));
    }
  }, [selected.size, settlements]);

  /** Count how many selected settlements are synced to Xero */
  const syncedSelectedCount = useMemo(() => settlements.filter(
    s => selected.has(s.id) && (XERO_SYNCED_STATUSES.includes(s.status || '') || s.xero_journal_id)
  ).length, [settlements, selected]);

  /** Core deletion loop — used by both handleBulkDelete and confirmBulkDelete */
  const executeDeletion = useCallback(async (ids: string[]) => {
    setBulkDeleteDialogOpen(false);
    setBulkDeleting(true);
    setSelected(new Set());
    let deleted = 0;
    for (const id of ids) {
      const result = await deleteSettlement(id);
      if (result.success) deleted++;
    }
    setBulkDeleting(false);
    toast.success(`Deleted ${deleted} settlement${deleted !== 1 ? 's' : ''}`);
    onComplete();
  }, [onComplete]);

  const handleBulkDelete = useCallback(async () => {
    if (selected.size === 0) return;
    if (syncedSelectedCount > 0 && !bulkDeleteDialogOpen) {
      setBulkDeleteDialogOpen(true);
      return;
    }
    await executeDeletion(Array.from(selected));
  }, [selected, syncedSelectedCount, bulkDeleteDialogOpen, executeDeletion]);

  const confirmBulkDelete = useCallback(async () => {
    await executeDeletion(Array.from(selected));
  }, [selected, executeDeletion]);

  const cancelBulkDelete = useCallback(() => {
    setBulkDeleteDialogOpen(false);
  }, []);

  return {
    selected,
    setSelected,
    toggleSelect,
    toggleSelectAll,
    bulkDeleting,
    bulkDeleteDialogOpen,
    syncedSelectedCount,
    handleBulkDelete,
    confirmBulkDelete,
    cancelBulkDelete,
  };
}
