/**
 * Data Quality Panel — Settings section for retroactive data corrections.
 * Provides manual sweeps for marketplace labels and fulfilment channel classification.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, CheckCircle2, Package } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

export default function DataQualityPanel() {
  const [sweeping, setSweeping] = useState(false);
  const [classifying, setClassifying] = useState(false);

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
    </div>
  );
}
