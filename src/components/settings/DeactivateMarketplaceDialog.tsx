/**
 * DeactivateMarketplaceDialog — Confirms marketplace deactivation with safety checks.
 *
 * Before allowing deactivation it checks:
 *   1. Outstanding (unposted) settlements for the marketplace
 *   2. Pushed-but-unreconciled settlements
 *
 * On confirm it sets connection_status → 'deactivated' which propagates
 * site-wide because all queries filter by ACTIVE_CONNECTION_STATUSES.
 */
import { useState, useEffect } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertTriangle, Info, Power, PowerOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface DeactivateMarketplaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  marketplaceCode: string;
  marketplaceName: string;
  /** Called after successful status change so parent can refresh state */
  onStatusChanged: () => void;
  /** If true, this is a reactivation instead of deactivation */
  reactivate?: boolean;
}

interface OutstandingCheck {
  unpostedCount: number;
  unreconciledCount: number;
  loading: boolean;
}

export default function DeactivateMarketplaceDialog({
  open, onOpenChange, marketplaceCode, marketplaceName, onStatusChanged, reactivate = false,
}: DeactivateMarketplaceDialogProps) {
  const [checks, setChecks] = useState<OutstandingCheck>({ unpostedCount: 0, unreconciledCount: 0, loading: true });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || reactivate) {
      setChecks({ unpostedCount: 0, unreconciledCount: 0, loading: false });
      return;
    }
    let cancelled = false;

    (async () => {
      setChecks(prev => ({ ...prev, loading: true }));
      // Check outstanding settlements for this marketplace
      const [unposted, unreconciled] = await Promise.all([
        supabase
          .from('settlements')
          .select('id', { count: 'exact', head: true })
          .eq('marketplace', marketplaceCode)
          .eq('is_hidden', false)
          .in('status', ['pending', 'needs_review', 'ready_to_push']),
        supabase
          .from('settlements')
          .select('id', { count: 'exact', head: true })
          .eq('marketplace', marketplaceCode)
          .eq('is_hidden', false)
          .eq('status', 'posted')
          .neq('reconciliation_status', 'matched'),
      ]);

      if (!cancelled) {
        setChecks({
          unpostedCount: unposted.count ?? 0,
          unreconciledCount: unreconciled.count ?? 0,
          loading: false,
        });
      }
    })();

    return () => { cancelled = true; };
  }, [open, marketplaceCode, reactivate]);

  const handleConfirm = async () => {
    setSubmitting(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const newStatus = reactivate ? 'active' : 'deactivated';

      const { error } = await supabase
        .from('marketplace_connections')
        .update({ connection_status: newStatus })
        .eq('user_id', user.id)
        .eq('marketplace_code', marketplaceCode);

      if (error) throw error;

      toast.success(
        reactivate
          ? `${marketplaceName} reactivated — it will now appear in scoring and syncs.`
          : `${marketplaceName} deactivated — hidden from scoring, mapper, and syncs site-wide.`
      );
      onStatusChanged();
      onOpenChange(false);
    } catch (err: any) {
      toast.error(`Failed to update: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const hasOutstanding = checks.unpostedCount > 0 || checks.unreconciledCount > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {reactivate ? <Power className="h-4 w-4 text-emerald-600" /> : <PowerOff className="h-4 w-4 text-destructive" />}
            {reactivate ? 'Reactivate' : 'Deactivate'} {marketplaceName}
          </DialogTitle>
          <DialogDescription>
            {reactivate
              ? 'This will re-include this marketplace in all scoring, syncs, and mapper coverage checks.'
              : 'This is a site-wide change. The marketplace will be excluded from:'}
          </DialogDescription>
        </DialogHeader>

        {!reactivate && (
          <ul className="text-xs text-muted-foreground space-y-1 ml-4 list-disc">
            <li>Account Mapper coverage & scoring</li>
            <li>Dashboard setup warnings & task counts</li>
            <li>All Xero sync & posting workflows</li>
            <li>Reconciliation checks</li>
          </ul>
        )}

        {checks.loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-3">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Checking outstanding items…
          </div>
        ) : hasOutstanding && !reactivate ? (
          <Alert className="border-amber-300 bg-amber-50">
            <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
            <AlertDescription className="text-xs text-amber-900 space-y-1">
              {checks.unpostedCount > 0 && (
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="text-[10px] border-amber-400">
                    {checks.unpostedCount}
                  </Badge>
                  <span>unposted settlement{checks.unpostedCount !== 1 ? 's' : ''} still pending</span>
                </div>
              )}
              {checks.unreconciledCount > 0 && (
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className="text-[10px] border-amber-400">
                    {checks.unreconciledCount}
                  </Badge>
                  <span>posted settlement{checks.unreconciledCount !== 1 ? 's' : ''} not yet reconciled</span>
                </div>
              )}
              <p className="pt-1 text-[10px]">
                These items will remain in the system but won't appear in active workflows.
                You can reactivate this marketplace at any time to resume.
              </p>
            </AlertDescription>
          </Alert>
        ) : !reactivate ? (
          <div className="flex items-center gap-2 text-xs text-emerald-700 py-1">
            <Info className="h-3.5 w-3.5" />
            No outstanding settlements found — safe to deactivate.
          </div>
        ) : null}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant={reactivate ? 'default' : 'destructive'}
            onClick={handleConfirm}
            disabled={submitting}
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
            {reactivate ? 'Reactivate' : 'Deactivate'} {marketplaceName}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
