/**
 * FulfilmentMethodsPanel — Settings panel to edit fulfilment method per marketplace.
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Store } from 'lucide-react';
import { toast } from 'sonner';
import {
  type FulfilmentMethod,
  FULFILMENT_LABELS,
  loadFulfilmentMethods,
  saveFulfilmentMethod,
  getEffectiveMethod,
} from '@/utils/fulfilment-settings';
import LoadingSpinner from '@/components/ui/loading-spinner';

interface MarketplaceRow {
  marketplace_code: string;
  marketplace_name: string;
}

const METHOD_OPTIONS: FulfilmentMethod[] = ['self_ship', 'third_party_logistics', 'marketplace_fulfilled', 'not_sure'];

export default function FulfilmentMethodsPanel() {
  const [marketplaces, setMarketplaces] = useState<MarketplaceRow[]>([]);
  const [methods, setMethods] = useState<Record<string, FulfilmentMethod>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const [connRes, stored] = await Promise.all([
          supabase
            .from('marketplace_connections')
            .select('marketplace_code, marketplace_name')
            .eq('user_id', user.id)
            .eq('connection_status', 'active'),
          loadFulfilmentMethods(user.id),
        ]);

        setMarketplaces(connRes.data || []);
        setMethods(stored);
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleChange = async (code: string, method: FulfilmentMethod) => {
    setSaving(code);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await saveFulfilmentMethod(user.id, code, method);
      setMethods(prev => ({ ...prev, [code]: method }));
      toast.success(`Fulfilment method updated for ${code}`);
    } catch {
      toast.error('Failed to save fulfilment method');
    } finally {
      setSaving(null);
    }
  };

  if (loading) return <LoadingSpinner size="sm" text="Loading..." />;

  if (marketplaces.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No marketplaces connected yet. Connect a marketplace first to configure fulfilment.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <p className="text-sm text-muted-foreground">
        Set how orders are fulfilled per marketplace. This affects postage cost deductions in Profit Analysis.
      </p>
      {marketplaces.map((mp) => {
        const effective = getEffectiveMethod(mp.marketplace_code, methods[mp.marketplace_code]);
        return (
          <div key={mp.marketplace_code} className="rounded-lg border border-border p-4 space-y-3">
            <div className="flex items-center gap-2">
              <Store className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">{mp.marketplace_name}</span>
              {saving === mp.marketplace_code && (
                <span className="text-xs text-muted-foreground animate-pulse">Saving…</span>
              )}
            </div>
            <RadioGroup
              value={effective}
              onValueChange={(v) => handleChange(mp.marketplace_code, v as FulfilmentMethod)}
              className="grid grid-cols-1 sm:grid-cols-2 gap-2"
            >
              {METHOD_OPTIONS.map((opt) => (
                <div key={opt} className="flex items-center space-x-2">
                  <RadioGroupItem value={opt} id={`${mp.marketplace_code}-${opt}`} />
                  <Label htmlFor={`${mp.marketplace_code}-${opt}`} className="text-xs cursor-pointer">
                    {FULFILMENT_LABELS[opt]}
                  </Label>
                </div>
              ))}
            </RadioGroup>
          </div>
        );
      })}
    </div>
  );
}
