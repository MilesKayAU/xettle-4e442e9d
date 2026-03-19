/**
 * Data Quality Panel — Settings section for retroactive data corrections.
 * Provides manual sweeps for marketplace labels, fulfilment classification,
 * and an RLS policy audit inventory for admin users.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, CheckCircle2, Package, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';

interface RlsTableEntry {
  table_name: string;
  rls_enabled: boolean;
  policy_count: number;
  policy_names: string[];
}

export default function DataQualityPanel() {
  const [sweeping, setSweeping] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [rlsLoading, setRlsLoading] = useState(false);
  const [rlsInventory, setRlsInventory] = useState<RlsTableEntry[] | null>(null);
  const [rlsError, setRlsError] = useState<string | null>(null);

  const handleSweep = async () => {
    setSweeping(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error('Not authenticated'); return; }

      const { retroactiveLabelSweep } = await import('@/actions/settlements');
      const result = await retroactiveLabelSweep(user.id);

      if (result.totalCorrected > 0) {
        const detail = Object.entries(result.corrections).map(([k, v]) => `${v} ${k}`).join(', ');
        toast.success(`Corrected ${result.totalCorrected} order labels — ${detail}`);
      } else {
        toast.info('All marketplace labels are already correct — no changes needed.');
      }
    } catch {
      toast.error('Sweep failed. Please try again.');
    } finally {
      setSweeping(false);
    }
  };

  const handleClassifyFulfilment = async () => {
    setClassifying(true);
    try {
      const { data, error } = await supabase.functions.invoke('backfill-fulfilment-channel', {
        method: 'POST',
      });

      if (error) throw error;

      if (data?.success) {
        const fba = data.classified_fba || 0;
        const fbm = data.classified_fbm || 0;
        const total = data.orders_processed || 0;

        if (total > 0) {
          toast.success(`Classified ${total} Amazon orders — ${fba} FBA, ${fbm} FBM`);
        } else {
          toast.info('All Amazon fulfilment data is already classified — no changes needed.');
        }
      } else {
        toast.error(data?.error || 'Classification failed');
      }
    } catch {
      toast.error('Fulfilment classification failed. Please try again.');
    } finally {
      setClassifying(false);
    }
  };

  const handleRlsAudit = async () => {
    setRlsLoading(true);
    setRlsError(null);
    try {
      const { data, error } = await supabase.functions.invoke('rls-audit', {
        method: 'POST',
      });

      if (error) throw error;

      if (data?.success && data.inventory) {
        setRlsInventory(data.inventory);
      } else if (data?.success && data.tables) {
        setRlsInventory(data.tables);
      } else {
        setRlsError(data?.error || 'Failed to fetch RLS inventory');
      }
    } catch (err: any) {
      setRlsError(err.message || 'RLS audit failed');
    } finally {
      setRlsLoading(false);
    }
  };

  const gapTables = rlsInventory?.filter(t => !t.rls_enabled || t.policy_count === 0) || [];

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        If you've uploaded CSV settlement files after Shopify orders were already synced,
        some order marketplace labels may be incorrect in the reconciliation view.
        This sweep corrects them using your uploaded CSV data as ground truth.
      </p>
      <Button
        onClick={handleSweep}
        disabled={sweeping}
        variant="outline"
        className="gap-2"
      >
        {sweeping ? (
          <RefreshCw className="h-4 w-4 animate-spin" />
        ) : (
          <CheckCircle2 className="h-4 w-4" />
        )}
        Re-sync marketplace labels from uploaded CSVs
      </Button>

      <div className="border-t border-border pt-4 mt-4">
        <p className="text-sm text-muted-foreground mb-3">
          Analyses your Amazon settlement history to identify FBA vs FBM orders.
          Required for accurate mixed-mode profit calculations. Uses fee-pattern
          inference — orders with FBA fulfilment fees are classified as FBA (AFN),
          others as FBM (MFN).
        </p>
        <Button
          onClick={handleClassifyFulfilment}
          disabled={classifying}
          variant="outline"
          className="gap-2"
        >
          {classifying ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <Package className="h-4 w-4" />
          )}
          Classify Amazon fulfilment data
        </Button>
      </div>

      <div className="border-t border-border pt-4 mt-4">
        <p className="text-sm text-muted-foreground mb-3">
          Generate a row-level security policy inventory for all database tables.
          Flags any tables missing RLS or with zero policies.
        </p>
        <Button
          onClick={handleRlsAudit}
          disabled={rlsLoading}
          variant="outline"
          className="gap-2"
        >
          {rlsLoading ? (
            <RefreshCw className="h-4 w-4 animate-spin" />
          ) : (
            <ShieldCheck className="h-4 w-4" />
          )}
          Run RLS policy audit
        </Button>

        {rlsError && (
          <p className="text-xs text-destructive mt-2">{rlsError}</p>
        )}

        {rlsInventory && (
          <div className="mt-3 space-y-2">
            {gapTables.length > 0 && (
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-2">
                <p className="text-xs font-semibold text-destructive">
                  ⚠ {gapTables.length} table{gapTables.length !== 1 ? 's' : ''} missing RLS coverage:
                </p>
                <ul className="text-xs text-destructive/80 mt-1 space-y-0.5">
                  {gapTables.map(t => (
                    <li key={t.table_name}>
                      <code className="text-[11px]">{t.table_name}</code>
                      {!t.rls_enabled && ' — RLS disabled'}
                      {t.rls_enabled && t.policy_count === 0 && ' — RLS enabled but 0 policies'}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="max-h-48 overflow-y-auto border border-border rounded-md">
              <table className="w-full text-xs">
                <thead className="bg-muted/50 sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-1 font-medium text-muted-foreground">Table</th>
                    <th className="text-center px-2 py-1 font-medium text-muted-foreground">RLS</th>
                    <th className="text-center px-2 py-1 font-medium text-muted-foreground">Policies</th>
                  </tr>
                </thead>
                <tbody>
                  {rlsInventory.map(t => (
                    <tr key={t.table_name} className={!t.rls_enabled || t.policy_count === 0 ? 'bg-destructive/5' : ''}>
                      <td className="px-2 py-1 font-mono text-[11px]">{t.table_name}</td>
                      <td className="px-2 py-1 text-center">
                        <Badge variant={t.rls_enabled ? 'default' : 'destructive'} className="text-[9px] px-1 py-0">
                          {t.rls_enabled ? '✓' : '✗'}
                        </Badge>
                      </td>
                      <td className="px-2 py-1 text-center">
                        <Badge variant={t.policy_count > 0 ? 'secondary' : 'destructive'} className="text-[9px] px-1 py-0">
                          {t.policy_count}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[10px] text-muted-foreground">
              {rlsInventory.length} tables scanned. {rlsInventory.filter(t => t.rls_enabled && t.policy_count > 0).length} fully covered.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
