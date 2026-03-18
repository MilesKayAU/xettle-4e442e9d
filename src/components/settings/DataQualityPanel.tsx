/**
 * Data Quality Panel — Settings section for retroactive data corrections.
 * Currently provides a manual "Re-sync marketplace labels" sweep.
 */

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { RefreshCw, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

export default function DataQualityPanel() {
  const [sweeping, setSweeping] = useState(false);

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
    </div>
  );
}
