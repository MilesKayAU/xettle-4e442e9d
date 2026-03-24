/**
 * Hook to load/save inventory rules from app_settings (key: 'inventory_rules').
 * ISOLATION: No settlement, validation, or Xero push imports.
 */
import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface SkuLink {
  canonical: string;
  linked: string[];
}

export interface InventoryRules {
  physical_sources: string[];
  fbm_from_shopify: boolean;
  mirror_platforms: Record<string, string>;
  sku_links: SkuLink[];
}

export const DEFAULT_INVENTORY_RULES: InventoryRules = {
  physical_sources: ['shopify', 'amazon_fba'],
  fbm_from_shopify: true,
  mirror_platforms: {
    kogan: 'shopify',
    ebay: 'shopify',
    mirakl: 'shopify',
  },
  sku_links: [],
};

export function useInventoryRules() {
  const [rules, setRules] = useState<InventoryRules>(DEFAULT_INVENTORY_RULES);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('user_id', user.id)
        .eq('key', 'inventory_rules')
        .maybeSingle();

      if (data?.value) {
        try {
          const parsed = JSON.parse(data.value);
          setRules({
            physical_sources: parsed.physical_sources ?? DEFAULT_INVENTORY_RULES.physical_sources,
            fbm_from_shopify: parsed.fbm_from_shopify ?? DEFAULT_INVENTORY_RULES.fbm_from_shopify,
            mirror_platforms: parsed.mirror_platforms ?? DEFAULT_INVENTORY_RULES.mirror_platforms,
          });
        } catch {
          // keep defaults
        }
      }
      setLoading(false);
    })();
  }, []);

  const saveRules = useCallback(async (newRules: InventoryRules) => {
    setSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setSaving(false); return; }

    await supabase
      .from('app_settings')
      .upsert(
        { user_id: user.id, key: 'inventory_rules', value: JSON.stringify(newRules) },
        { onConflict: 'user_id,key' }
      );

    setRules(newRules);
    setSaving(false);
  }, []);

  return { rules, setRules, saveRules, loading, saving };
}
