/**
 * BulkDeleteDialog — Xero-aware bulk delete confirmation dialog.
 * Part of the BaseMarketplaceDashboard architecture pattern.
 */

import React from 'react';
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

interface BulkDeleteDialogProps {
  open: boolean;
  selectedCount: number;
  syncedCount: number;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function BulkDeleteDialog({
  open,
  selectedCount,
  syncedCount,
  onConfirm,
  onCancel,
}: BulkDeleteDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete {selectedCount} settlement{selectedCount !== 1 ? 's' : ''}?</AlertDialogTitle>
          <AlertDialogDescription>
            {syncedCount > 0 ? (
              <>
                <strong>{syncedCount} of {selectedCount}</strong> selected settlement{selectedCount !== 1 ? 's are' : ' is'} already synced to Xero.
                Deleting them here will <strong>NOT</strong> void the invoices in Xero — you'll need to do that manually.
              </>
            ) : (
              'This action cannot be undone. The selected settlements will be permanently deleted.'
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Delete {selectedCount} Settlement{selectedCount !== 1 ? 's' : ''}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
