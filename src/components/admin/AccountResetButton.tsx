import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useQueryClient } from '@tanstack/react-query';
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
import { Input } from '@/components/ui/input';
import { RotateCcw, Loader2 } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

const CONFIRM_TEXT = 'DELETE';

export default function AccountResetButton() {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [confirmInput, setConfirmInput] = useState('');

  const isConfirmed = confirmInput === CONFIRM_TEXT;

  const handleReset = async () => {
    if (!isConfirmed) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('account-reset');
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const cleared = Object.values(data.results as Record<string, string>).filter(v => v === 'cleared').length;
      const errors = Object.entries(data.results as Record<string, string>).filter(([, v]) => v.startsWith('error'));

      // Clear wizard session state so it restarts from step 1
      sessionStorage.removeItem('xettle_setup_step');
      sessionStorage.removeItem('xettle_setup_marketplaces');
      sessionStorage.removeItem('xettle_wizard_dismiss_count');

      toast({
        title: '🔄 Account Reset Complete',
        description: `${cleared} tables cleared.${errors.length > 0 ? ` ${errors.length} errors — check console.` : ''} Refresh to see changes.`,
      });

      if (errors.length > 0) {
        console.warn('Reset errors:', Object.fromEntries(errors));
      }
    } catch (err: any) {
      toast({
        title: 'Reset failed',
        description: err.message,
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
      setOpen(false);
      setConfirmInput('');
    }
  };

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        className="border-destructive/30 text-destructive hover:bg-destructive/10 gap-2"
      >
        <RotateCcw className="h-4 w-4" />
        Factory Reset My Account
      </Button>

      <AlertDialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) setConfirmInput(''); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>⚠️ Factory Reset</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>This will permanently delete <strong>all your data</strong>:</p>
              <ul className="list-disc pl-5 text-sm space-y-1">
                <li>All settlements, lines, and profit data</li>
                <li>All marketplace connections and validation</li>
                <li>Xero, Amazon, and Shopify tokens</li>
                <li>Reconciliation checks and notes</li>
                <li>Channel alerts and system events</li>
                <li>App settings (accounting boundary, etc.)</li>
              </ul>
              <p className="font-medium pt-2">Your login account and admin role will be preserved.</p>
              <p className="text-sm pt-2">
                Type <code className="bg-muted px-1.5 py-0.5 rounded font-mono font-bold">DELETE</code> to confirm:
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Input
            value={confirmInput}
            onChange={(e) => setConfirmInput(e.target.value)}
            placeholder="Type DELETE to confirm"
            className="font-mono"
            autoComplete="off"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={loading}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleReset}
              disabled={loading || !isConfirmed}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 gap-2"
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              {loading ? 'Resetting...' : 'Reset Everything'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
