/**
 * useBulkSelect — Shared hook for checkbox selection + bulk delete with Xero awareness.
 * Part of the BaseMarketplaceDashboard architecture pattern.
 */

import { useState, useCallback } from 'react';
import { deleteSettlement } from '@/utils/settlement-engine';
import { toast } from 'sonner';
import type { BaseSettlementRow } from './use-settlement-manager';

interface UseBulkSelectOptions {
  settlements: BaseSettlementRow[];
  onComplete: () => void;
}

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
  const syncedSelectedCount = settlements.filter(
    s => selected.has(s.id) && (s.status === 'synced' || s.status === 'pushed_to_xero' || s.xero_journal_id)
  ).length;

  const handleBulkDelete = useCallback(async () => {
    if (selected.size === 0) return;
    // If synced items exist and dialog not yet shown, open confirmation
    if (syncedSelectedCount > 0 && !bulkDeleteDialogOpen) {
      setBulkDeleteDialogOpen(true);
      return;
    }
    setBulkDeleteDialogOpen(false);
    setBulkDeleting(true);
    let deleted = 0;
    for (const id of selected) {
      const result = await deleteSettlement(id);
      if (result.success) deleted++;
    }
    setSelected(new Set());
    setBulkDeleting(false);
    toast.success(`Deleted ${deleted} settlement${deleted !== 1 ? 's' : ''}`);
    onComplete();
  }, [selected, syncedSelectedCount, bulkDeleteDialogOpen, onComplete]);

  const confirmBulkDelete = useCallback(async () => {
    setBulkDeleteDialogOpen(false);
    setBulkDeleting(true);
    let deleted = 0;
    for (const id of selected) {
      const result = await deleteSettlement(id);
      if (result.success) deleted++;
    }
    setSelected(new Set());
    setBulkDeleting(false);
    toast.success(`Deleted ${deleted} settlement${deleted !== 1 ? 's' : ''}`);
    onComplete();
  }, [selected, onComplete]);

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
