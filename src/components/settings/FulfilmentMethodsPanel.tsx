/**
 * FulfilmentMethodsPanel — Settings panel to edit fulfilment method per marketplace.
 * Includes postage cost input, MCF cost input, and auto-triggers profit recalculation on changes.
 */

import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Store, DollarSign, RefreshCw, ArrowUpCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useQueryClient } from '@tanstack/react-query';
import {
  type FulfilmentMethod,
  FULFILMENT_LABELS,
  loadFulfilmentMethods,
  saveFulfilmentMethod,
  getEffectiveMethod,
  loadPostageCosts,
  savePostageCost,
  loadMcfCosts,
  saveMcfCost,
  loadFreeShippingThresholds,
  saveFreeShippingThreshold,
  isAmazonCode,
} from '@/utils/fulfilment-settings';
import LoadingSpinner from '@/components/ui/loading-spinner';

interface MarketplaceRow {
  marketplace_code: string;
  marketplace_name: string;
}

/** Marketplace codes that have MCF-tagged settlement lines */
type McfDetectionMap = Record<string, boolean>;
/** Marketplace codes that have MFN lines but are set to marketplace_fulfilled */
type MfnDetectionMap = Record<string, boolean>;

const BASE_METHOD_OPTIONS: FulfilmentMethod[] = ['self_ship', 'third_party_logistics', 'marketplace_fulfilled', 'not_sure'];
const AMAZON_METHOD_OPTIONS: FulfilmentMethod[] = ['self_ship', 'third_party_logistics', 'marketplace_fulfilled', 'mixed_fba_fbm', 'not_sure'];

async function triggerProfitRecalc(): Promise<{ updated: number; skipped: number } | null> {
  try {
    const { data, error } = await supabase.functions.invoke('recalculate-profit', {
      method: 'POST',
    });
    if (error) throw error;
    return data as { updated: number; skipped: number };
  } catch (e) {
    console.error('[recalculate-profit] failed:', e);
    return null;
  }
}

export default function FulfilmentMethodsPanel() {
  const queryClient = useQueryClient();
  const [marketplaces, setMarketplaces] = useState<MarketplaceRow[]>([]);
  const [methods, setMethods] = useState<Record<string, FulfilmentMethod>>({});
  const [postageCosts, setPostageCosts] = useState<Record<string, string>>({});
  const [freeShippingThresholds, setFreeShippingThresholds] = useState<Record<string, string>>({});
  const [mcfCosts, setMcfCosts] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [mixedModePromptDismissed, setMixedModePromptDismissed] = useState(true);
  const [mcfDetected, setMcfDetected] = useState<McfDetectionMap>({});
  const [mfnDetected, setMfnDetected] = useState<MfnDetectionMap>({});

  useEffect(() => {
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        const [connRes, stored, costs, mcfCostsData, thresholds] = await Promise.all([
          supabase
            .from('marketplace_connections')
            .select('marketplace_code, marketplace_name')
            .eq('user_id', user.id)
            .eq('connection_status', 'active'),
          loadFulfilmentMethods(user.id),
          loadPostageCosts(user.id),
          loadMcfCosts(user.id),
          loadFreeShippingThresholds(user.id),
        ]);

        // Deduplicate by marketplace_code (keep first occurrence)
        const rawConns = connRes.data || [];
        const seen = new Set<string>();
        const deduped = rawConns.filter(c => {
          if (seen.has(c.marketplace_code)) return false;
          seen.add(c.marketplace_code);
          return true;
        });
        setMarketplaces(deduped);
        setMethods(stored);
        const costStrings: Record<string, string> = {};
        for (const [code, val] of Object.entries(costs)) {
          costStrings[code] = val > 0 ? String(val) : '';
        }
        setPostageCosts(costStrings);
        const mcfStrings: Record<string, string> = {};
        for (const [code, val] of Object.entries(mcfCostsData)) {
          mcfStrings[code] = val > 0 ? String(val) : '';
        }
        setMcfCosts(mcfStrings);
        const thresholdStrings: Record<string, string> = {};
        for (const [code, val] of Object.entries(thresholds)) {
          thresholdStrings[code] = val > 0 ? String(val) : '';
        }
        setFreeShippingThresholds(thresholdStrings);
        // Check if mixed mode prompt was dismissed
        const { data: dismissed } = await supabase
          .from('app_settings')
          .select('value')
          .eq('user_id', user.id)
          .eq('key', 'mixed_mode_prompt_dismissed')
          .maybeSingle();
        setMixedModePromptDismissed(dismissed?.value === 'true');

        // Detect MCF and MFN lines across all marketplaces
        try {
          const codes = (connRes.data || []).map(m => m.marketplace_code);
          if (codes.length > 0) {
            // Check for MCF lines
            const { data: mcfLines } = await supabase
              .from('settlement_lines')
              .select('settlement_id')
              .eq('user_id', user.id)
              .in('fulfilment_channel', ['MCF', 'MCF_inferred'])
              .limit(100);
            
            if (mcfLines && mcfLines.length > 0) {
              // Get marketplace codes for these settlements
              const settlementIds = [...new Set(mcfLines.map(l => l.settlement_id))];
              const { data: settlements } = await supabase
                .from('settlements')
                .select('settlement_id, marketplace')
                .in('settlement_id', settlementIds)
                .eq('user_id', user.id);
              const mcfMap: McfDetectionMap = {};
              for (const s of settlements || []) {
                if (s.marketplace) mcfMap[s.marketplace] = true;
              }
              setMcfDetected(mcfMap);
            }

            // Check for MFN lines
            const { data: mfnLines } = await supabase
              .from('settlement_lines')
              .select('settlement_id')
              .eq('user_id', user.id)
              .in('fulfilment_channel', ['MFN', 'MFN_inferred'])
              .limit(100);
            
            if (mfnLines && mfnLines.length > 0) {
              const settlementIds = [...new Set(mfnLines.map(l => l.settlement_id))];
              const { data: settlements } = await supabase
                .from('settlements')
                .select('settlement_id, marketplace')
                .in('settlement_id', settlementIds)
                .eq('user_id', user.id);
              const mfnMap: MfnDetectionMap = {};
              for (const s of settlements || []) {
                if (s.marketplace) mfnMap[s.marketplace] = true;
              }
              setMfnDetected(mfnMap);
            }
          }
        } catch {
          // Non-fatal — detection is advisory
        }

      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // Background recalc after settings change (debounced via fire-and-forget)
  const recalcInBackground = useCallback(() => {
    triggerProfitRecalc().then((result) => {
      if (result) {
        console.log(`[profit-recalc] Updated ${result.updated} settlements`);
      }
    });
  }, []);

  const handleChange = async (code: string, method: FulfilmentMethod) => {
    setSaving(code);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await saveFulfilmentMethod(user.id, code, method);
      setMethods(prev => ({ ...prev, [code]: method }));
      toast.success(`Fulfilment method updated for ${code}`);
      recalcInBackground();
      queryClient.invalidateQueries({ queryKey: ['dashboard-task-counts'] });
    } catch {
      toast.error('Failed to save fulfilment method');
    } finally {
      setSaving(null);
    }
  };

  const handlePostageSave = async (code: string, value: string) => {
    const trimmed = value.trim();
    const num = trimmed === '' ? 0 : parseFloat(trimmed);
    if (isNaN(num) || num < 0) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await savePostageCost(user.id, code, num);
      // Update local state to reflect cleared value
      setPostageCosts(prev => ({ ...prev, [code]: num > 0 ? String(num) : '' }));
      toast.success(num > 0 ? `Postage cost saved for ${code}` : `Postage cost cleared for ${code}`);
      recalcInBackground();
      queryClient.invalidateQueries({ queryKey: ['dashboard-task-counts'] });
    } catch {
      toast.error('Failed to save postage cost');
    }
  };

  const handleThresholdSave = async (code: string, value: string) => {
    const trimmed = value.trim();
    const num = trimmed === '' ? 0 : parseFloat(trimmed);
    if (isNaN(num) || num < 0) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await saveFreeShippingThreshold(user.id, code, num);
      setFreeShippingThresholds(prev => ({ ...prev, [code]: num > 0 ? String(num) : '' }));
      toast.success(num > 0 ? `Free shipping threshold saved for ${code}` : `Free shipping threshold cleared for ${code}`);
      recalcInBackground();
    } catch {
      toast.error('Failed to save free shipping threshold');
    }
  };
  const handleMcfSave = async (code: string, value: string) => {
    const num = parseFloat(value);
    if (isNaN(num) || num < 0) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await saveMcfCost(user.id, code, num);
      toast.success(`MCF cost saved for ${code}`);
      recalcInBackground();
    } catch {
      toast.error('Failed to save MCF cost');
    }
  };

  const handleManualRecalc = async () => {
    setRecalculating(true);
    try {
      const result = await triggerProfitRecalc();
      if (result) {
        toast.success(`Profit recalculated for ${result.updated} settlement${result.updated !== 1 ? 's' : ''}`);
      } else {
        toast.error('Recalculation failed — check console');
      }
    } finally {
      setRecalculating(false);
    }
  };

  const handleSaveAllAndRecalc = async () => {
    setSavingAll(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Save all fulfilment methods
      for (const mp of marketplaces) {
        const method = methods[mp.marketplace_code];
        if (method) {
          await saveFulfilmentMethod(user.id, mp.marketplace_code, method);
        }
      }

      // Save all postage costs (empty = 0, which clears)
      for (const mp of marketplaces) {
        const val = postageCosts[mp.marketplace_code]?.trim() || '';
        const num = val === '' ? 0 : parseFloat(val);
        if (!isNaN(num) && num >= 0) {
          await savePostageCost(user.id, mp.marketplace_code, num);
        }
      }

      // Save MCF costs
      for (const mp of marketplaces) {
        const val = mcfCosts[mp.marketplace_code];
        const num = parseFloat(val || '');
        if (!isNaN(num) && num >= 0) {
          await saveMcfCost(user.id, mp.marketplace_code, num);
        }
      }

      // Save free-shipping thresholds
      for (const mp of marketplaces) {
        const val = freeShippingThresholds[mp.marketplace_code]?.trim() || '';
        const num = val === '' ? 0 : parseFloat(val);
        if (!isNaN(num) && num >= 0) {
          await saveFreeShippingThreshold(user.id, mp.marketplace_code, num);
        }
      }

      // Recalculate profit
      const result = await triggerProfitRecalc();

      // Invalidate dashboard task counts so health panel updates
      queryClient.invalidateQueries({ queryKey: ['dashboard-task-counts'] });

      if (result) {
        toast.success(`✅ Settings saved & profit recalculated for ${result.updated} settlement${result.updated !== 1 ? 's' : ''}`);
      } else {
        toast.success('Settings saved');
      }
    } catch (err) {
      toast.error('Failed to save — check console');
      console.error('[handleSaveAllAndRecalc]', err);
    } finally {
      setSavingAll(false);
    }
  };

  const handleDismissPrompt = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('app_settings').upsert({
        user_id: user.id,
        key: 'mixed_mode_prompt_dismissed',
        value: 'true',
      }, { onConflict: 'user_id,key' });
      setMixedModePromptDismissed(true);
    } catch {
      // silent
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

  // Check if any Amazon marketplace is still on marketplace_fulfilled (upgrade prompt candidate)
  const amazonOnOldDefault = marketplaces.some(
    mp => isAmazonCode(mp.marketplace_code) &&
          getEffectiveMethod(mp.marketplace_code, methods[mp.marketplace_code]) === 'marketplace_fulfilled'
  );

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Set how orders are fulfilled per marketplace. This affects postage cost deductions in Profit Analysis.
        </p>
        <Button
          size="sm"
          onClick={handleSaveAllAndRecalc}
          disabled={savingAll}
          className="shrink-0 ml-4 gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${savingAll ? 'animate-spin' : ''}`} />
          {savingAll ? 'Saving…' : 'Save & Recalculate'}
        </Button>
      </div>

      {amazonOnOldDefault && !mixedModePromptDismissed && (
        <Alert className="border-primary/30 bg-primary/5">
          <ArrowUpCircle className="h-4 w-4 text-primary" />
          <AlertDescription className="flex items-center justify-between gap-4">
            <span className="text-sm">
              We now support mixed FBA + FBM tracking for Amazon. Update your setting for more accurate margins.
            </span>
            <Button variant="ghost" size="sm" onClick={handleDismissPrompt} className="shrink-0 text-xs">
              Dismiss
            </Button>
          </AlertDescription>
        </Alert>
      )}

      {marketplaces.map((mp) => {
        const effective = getEffectiveMethod(mp.marketplace_code, methods[mp.marketplace_code]);
        const isAmazon = isAmazonCode(mp.marketplace_code);
        const methodOptions = isAmazon ? AMAZON_METHOD_OPTIONS : BASE_METHOD_OPTIONS;
        const showPostageInput = effective === 'self_ship' || effective === 'third_party_logistics' || effective === 'mixed_fba_fbm';
        const showMcfInput = (isAmazon && effective === 'mixed_fba_fbm') || mcfDetected[mp.marketplace_code];
        const showMfnBanner = mfnDetected[mp.marketplace_code] && effective === 'marketplace_fulfilled';
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
              {methodOptions.map((opt) => (
                <div key={opt} className="flex items-center space-x-2">
                  <RadioGroupItem value={opt} id={`${mp.marketplace_code}-${opt}`} />
                  <Label htmlFor={`${mp.marketplace_code}-${opt}`} className="text-xs cursor-pointer">
                    {FULFILMENT_LABELS[opt]}
                  </Label>
                </div>
              ))}
            </RadioGroup>
            {showPostageInput && (
              <div className="pt-1 space-y-1">
                <Label htmlFor={`postage-${mp.marketplace_code}`} className="text-xs text-muted-foreground flex items-center gap-1">
                  <DollarSign className="h-3 w-3" />
                  {effective === 'mixed_fba_fbm'
                    ? 'Avg. postage cost per order (applied to merchant-fulfilled FBM orders only)'
                    : 'Avg. postage cost per order'}
                </Label>
                <div className="relative w-40">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                  <Input
                    id={`postage-${mp.marketplace_code}`}
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="0.00"
                    value={postageCosts[mp.marketplace_code] || ''}
                    onChange={(e) =>
                      setPostageCosts(prev => ({ ...prev, [mp.marketplace_code]: e.target.value }))
                    }
                    onBlur={(e) => handlePostageSave(mp.marketplace_code, e.target.value)}
                    className="pl-7 h-8 text-sm"
                  />
                </div>
              </div>
            )}
            {showMfnBanner && (
              <Alert className="border-amber-300/30 bg-amber-50/50 dark:border-amber-800/30 dark:bg-amber-900/10">
                <AlertDescription className="text-xs text-amber-800 dark:text-amber-300">
                  We detected merchant-fulfilled (FBM) orders for {mp.marketplace_name}. Consider switching to <strong>Mixed FBA + FBM</strong> for accurate postage deductions.
                </AlertDescription>
              </Alert>
            )}
            {showMcfInput && (
              <div className="pt-1 space-y-1">
                <Label htmlFor={`mcf-${mp.marketplace_code}`} className="text-xs text-muted-foreground flex items-center gap-1">
                  <DollarSign className="h-3 w-3" />
                  MCF (Multi-Channel Fulfilment) cost per order
                </Label>
                <div className="relative w-40">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                  <Input
                    id={`mcf-${mp.marketplace_code}`}
                    type="number"
                    min={0}
                    step={0.01}
                    placeholder="8.00"
                    value={mcfCosts[mp.marketplace_code] || ''}
                    onChange={(e) =>
                      setMcfCosts(prev => ({ ...prev, [mp.marketplace_code]: e.target.value }))
                    }
                    onBlur={(e) => handleMcfSave(mp.marketplace_code, e.target.value)}
                    className="pl-7 h-8 text-sm"
                  />
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
