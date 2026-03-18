import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { Package, ShoppingBag, CheckCircle2, Loader2, Store, Plus, Upload, ArrowRight, ArrowLeft, Search, X, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { getCachedXeroAccounts } from '@/actions';
import { getMarketplaceCoverage } from '@/actions/coaCoverage';
import CoaBlockerCta from '@/components/shared/CoaBlockerCta';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import {
  type FulfilmentMethod,
  FULFILMENT_LABELS,
  loadFulfilmentMethods,
  saveFulfilmentMethod,
  getEffectiveMethod,
} from '@/utils/fulfilment-settings';

interface Props {
  onNext: () => void;
  onSkip: () => void;
  onBack?: () => void;
  hasAmazon: boolean;
  hasShopify: boolean;
  hasXero?: boolean;
  justConnectedXero?: boolean;
  selectedMarketplaces: string[];
  onMarketplacesChange: (marketplaces: string[]) => void;
  onFireBackgroundScan?: (fnName: string) => void;
}

const CSV_MARKETPLACES = [
  { id: 'bunnings', label: 'Bunnings' },
  { id: 'bigw', label: 'BigW' },
  { id: 'kogan', label: 'Kogan' },
  { id: 'catch', label: 'Catch' },
  { id: 'mydeal', label: 'MyDeal' },
  { id: 'everyday_market', label: 'Everyday Market' },
  { id: 'ebay', label: 'eBay' },
];

const MARKETPLACE_CODE_ALIASES: Record<string, string[]> = {
  everyday_market: ['woolworths'],
  woolworths: ['everyday_market'],
  ebay: ['ebay_au'],
  ebay_au: ['ebay'],
};

function expandMarketplaceCodes(codes: string[]): string[] {
  const expanded = new Set<string>();
  for (const code of codes) {
    const normalized = (code || '').toLowerCase().trim();
    if (!normalized) continue;
    expanded.add(normalized);
    for (const alias of MARKETPLACE_CODE_ALIASES[normalized] || []) {
      expanded.add(alias);
    }
  }
  return Array.from(expanded);
}

function marketplaceLabelFromCode(code: string): string {
  const known = CSV_MARKETPLACES.find(m => m.id === code);
  if (known) return known.label;
  return code.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-4">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-2 w-2 rounded-full transition-colors ${
            i + 1 === current
              ? 'bg-primary'
              : i + 1 < current
              ? 'bg-primary/40'
              : 'bg-muted-foreground/20'
          }`}
        />
      ))}
    </div>
  );
}

export default function SetupStepConnectStores({
  onNext,
  onSkip,
  onBack,
  hasAmazon,
  hasShopify,
  hasXero,
  justConnectedXero,
  selectedMarketplaces,
  onMarketplacesChange,
  onFireBackgroundScan,
}: Props) {
  const getInitialStep = (): 1 | 2 | 3 => {
    if (hasShopify && hasAmazon) return 3;
    if (hasShopify) return 2;
    return 1;
  };

  const [step, setStep] = useState<1 | 2 | 3>(getInitialStep);
  const [connectingAmazon, setConnectingAmazon] = useState(false);
  const [connectingShopify, setConnectingShopify] = useState(false);
  const [shopDomain, setShopDomain] = useState('mileskayaustralia.myshopify.com');
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customName, setCustomName] = useState('');
  const [persistingSelections, setPersistingSelections] = useState(false);
  const [fulfilmentChoices, setFulfilmentChoices] = useState<Record<string, FulfilmentMethod>>({});

  // Pre-populate fulfilment defaults when selection changes
  useEffect(() => {
    setFulfilmentChoices(prev => {
      const next = { ...prev };
      for (const code of selectedMarketplaces) {
        if (!(code in next)) {
          next[code] = getEffectiveMethod(code);
        }
      }
      return next;
    });
  }, [selectedMarketplaces]);

  const handleConnectAmazon = async () => {
    setConnectingAmazon(true);
    try {
      const { data, error } = await supabase.functions.invoke('amazon-auth', {
        headers: { 'x-action': 'authorize' },
        body: {},
      });
      if (error || data?.error) throw new Error(data?.error || 'Failed to get Amazon auth URL');
      const authUrl = data?.authUrl || data?.url;
      if (authUrl) window.location.href = authUrl;
    } catch (err: any) {
      toast.error(err.message || 'Failed to start Amazon connection');
      setConnectingAmazon(false);
    }
  };

  const handleConnectShopify = async () => {
    if (!shopDomain.trim()) {
      toast.error('Enter your Shopify store domain first');
      return;
    }
    setConnectingShopify(true);
    try {
      const domain = shopDomain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase.functions.invoke('shopify-auth', {
        body: { action: 'initiate', shop: domain, userId: user.id },
      });
      if (error || data?.error) throw new Error(data?.error || 'Failed to start Shopify connection');
      const authUrl = data?.authUrl || data?.url;
      if (authUrl) window.location.href = authUrl;
    } catch (err: any) {
      toast.error(err.message || 'Failed to start Shopify connection');
      setConnectingShopify(false);
    }
  };

  const advanceFromShopify = () => {
    if (hasShopify && onFireBackgroundScan) {
      onFireBackgroundScan('fetch-shopify-payouts');
      onFireBackgroundScan('scan-shopify-channels');
    }
    setStep(2);
  };

  const advanceFromAmazon = () => {
    if (hasAmazon && onFireBackgroundScan) {
      onFireBackgroundScan('fetch-amazon-settlements');
    }
    setStep(3);
  };

  const toggleMarketplace = (id: string) => {
    const updated = selectedMarketplaces.includes(id)
      ? selectedMarketplaces.filter(m => m !== id)
      : [...selectedMarketplaces, id];
    onMarketplacesChange(updated);
  };

  // ─── Smart marketplace search ───
  const [registryResults, setRegistryResults] = useState<Array<{ marketplace_code: string; marketplace_name: string }>>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [nearMatch, setNearMatch] = useState<{ marketplace_code: string; marketplace_name: string } | null>(null);
  const searchTimeout = useRef<ReturnType<typeof setTimeout>>();

  const searchRegistry = useCallback(async (query: string) => {
    if (query.trim().length < 2) {
      setRegistryResults([]);
      setNearMatch(null);
      return;
    }
    setSearchLoading(true);
    try {
      const { data } = await supabase
        .from('marketplace_registry')
        .select('marketplace_code, marketplace_name')
        .eq('is_active', true)
        .ilike('marketplace_name', `%${query.trim()}%`)
        .limit(6);

      const results = (data || []).filter(
        r => !CSV_MARKETPLACES.some(m => m.id === r.marketplace_code) &&
             !selectedMarketplaces.includes(r.marketplace_code)
      );
      setRegistryResults(results);

      // Check for near-match (fuzzy): if no exact results but query is 3+ chars
      if (results.length === 0 && query.trim().length >= 3) {
        // Broader search — check if any marketplace contains part of the query
        const { data: broader } = await supabase
          .from('marketplace_registry')
          .select('marketplace_code, marketplace_name')
          .eq('is_active', true)
          .limit(50);
        const q = query.trim().toLowerCase();
        const fuzzy = (broader || []).find(r => {
          const name = r.marketplace_name.toLowerCase();
          // Check if first 3+ chars match
          return name.includes(q.slice(0, 3)) || q.includes(name.slice(0, 3));
        });
        setNearMatch(fuzzy && !selectedMarketplaces.includes(fuzzy.marketplace_code) ? fuzzy : null);
      } else {
        setNearMatch(null);
      }
    } catch {
      setRegistryResults([]);
    } finally {
      setSearchLoading(false);
    }
  }, [selectedMarketplaces]);

  const handleCustomNameChange = (value: string) => {
    setCustomName(value);
    if (searchTimeout.current) clearTimeout(searchTimeout.current);
    searchTimeout.current = setTimeout(() => searchRegistry(value), 250);
  };

  const handleSelectRegistryMatch = (match: { marketplace_code: string; marketplace_name: string }) => {
    if (!selectedMarketplaces.includes(match.marketplace_code)) {
      onMarketplacesChange([...selectedMarketplaces, match.marketplace_code]);
    }
    setCustomName('');
    setRegistryResults([]);
    setNearMatch(null);
    setShowCustomInput(false);
    toast.success(`${match.marketplace_name} added`);
  };

  const handleAddCustom = async () => {
    if (!customName.trim()) return;
    const name = customName.trim();
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');

    // Save to marketplace_registry so all users benefit
    try {
      const { data: { user } } = await supabase.auth.getUser();
      await supabase.from('marketplace_registry').upsert({
        marketplace_code: id,
        marketplace_name: name,
        country: 'AU',
        type: 'marketplace',
        added_by: user?.id ? 'user' : 'system',
        is_active: true,
      }, { onConflict: 'marketplace_code' });
    } catch {
      // Non-fatal — still add locally
    }

    if (!selectedMarketplaces.includes(id)) {
      onMarketplacesChange([...selectedMarketplaces, id]);
    }
    setCustomName('');
    setRegistryResults([]);
    setNearMatch(null);
    setShowCustomInput(false);
    toast.success(`${name} added — you can upload its files in the next step.`);
  };

  const persistSelectedMarketplaces = async () => {
    if (selectedMarketplaces.length === 0) return;

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const uniqueCodes = Array.from(new Set(
      selectedMarketplaces.map(code => code.toLowerCase().trim()).filter(Boolean)
    ));

    if (uniqueCodes.length === 0) return;

    const connectionRows = uniqueCodes.map(code => ({
      user_id: user.id,
      marketplace_code: code,
      marketplace_name: marketplaceLabelFromCode(code),
      country_code: 'AU',
      connection_type: 'manual',
      connection_status: 'active',
    }));

    const { error: connectionErr } = await supabase
      .from('marketplace_connections')
      .upsert(connectionRows as any, { onConflict: 'user_id,marketplace_code' } as any);

    if (connectionErr) throw connectionErr;

    // Persist fulfilment methods — only for keys that don't already exist
    try {
      const existingMethods = await loadFulfilmentMethods(user.id);
      for (const code of uniqueCodes) {
        if (!existingMethods[code]) {
          const method = fulfilmentChoices[code] || getEffectiveMethod(code);
          await saveFulfilmentMethod(user.id, code, method);
        }
      }
    } catch {
      // Non-fatal — don't block onboarding
    }

    const codesToResolve = expandMarketplaceCodes(uniqueCodes);
    await supabase
      .from('channel_alerts' as any)
      .update({ status: 'auto_resolved_setup', actioned_at: new Date().toISOString() } as any)
      .eq('user_id', user.id)
      .eq('status', 'pending')
      .in('source_name', codesToResolve as any);
  };

  // ─── Post-provision COA coverage check ───
  const [coaGapMarketplace, setCoaGapMarketplace] = useState<string | null>(null);

  const handleContinueFromMarketplaceStep = async () => {
    setPersistingSelections(true);
    try {
      await persistSelectedMarketplaces();

      // Run COA coverage check for newly selected marketplaces
      if (hasXero && selectedMarketplaces.length > 0) {
        try {
          const accounts = await getCachedXeroAccounts();
          if (accounts.length > 0) {
            const coverage = getMarketplaceCoverage(selectedMarketplaces, accounts);
            const firstUncovered = coverage.uncovered[0] || coverage.partial[0];
            if (firstUncovered) {
              setCoaGapMarketplace(firstUncovered);
              setPersistingSelections(false);
              return; // Don't advance — show COA gap resolution
            }
          }
        } catch {
          // Non-critical — proceed without COA check
        }
      }
    } catch (err) {
      console.error('[setup] failed to persist selected marketplaces:', err);
      toast.error('Could not fully save marketplace selections, but setup will continue.');
    } finally {
      setPersistingSelections(false);
    }
    onNext();
  };

  // Back within sub-steps goes to previous sub-step, or to wizard back
  const handleInternalBack = () => {
    if (step === 1 && onBack) {
      onBack();
    } else if (step === 2) {
      setStep(1);
    } else if (step === 3) {
      setStep(2);
    }
  };

  return (
    <div className="space-y-6">
      {/* Celebration header when Xero was just connected */}
      {justConnectedXero && hasXero && step === 1 && (
        <div className="text-center space-y-2">
          <div className="flex items-center justify-center gap-2">
            <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            <h2 className="text-xl font-bold text-foreground">Nice one — Xero is connected!</h2>
          </div>
          <p className="text-sm text-muted-foreground">
            Now let's connect your sales channels so Xettle can automatically pull settlement data.
          </p>
        </div>
      )}

      <StepDots current={step} total={3} />

      {/* ── Step 1: Shopify ── */}
      {step === 1 && (
        <Card className={`border transition-colors ${hasShopify ? 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-900/10' : 'border-border'}`}>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center">
                <ShoppingBag className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground text-lg">Connect Shopify</h3>
                {hasShopify ? (
                  <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Connected
                  </span>
                ) : (
                  <p className="text-xs text-muted-foreground">Auto-sync payouts and detect sub-channels automatically</p>
                )}
              </div>
            </div>

            {!hasShopify && (
              <div className="space-y-2">
                <Input
                  placeholder="your-store.myshopify.com"
                  value={shopDomain}
                  onChange={(e) => setShopDomain(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleConnectShopify()}
                  className="text-sm"
                />
                <Button
                  onClick={handleConnectShopify}
                  disabled={connectingShopify}
                  className="w-full"
                >
                  {connectingShopify ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <ShoppingBag className="h-4 w-4 mr-2" />
                  )}
                  Connect Shopify
                </Button>
              </div>
            )}

            {hasShopify && (
              <Button onClick={advanceFromShopify} className="w-full">
                Continue <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            )}

            <div className="flex items-center justify-between">
              {onBack ? (
                <button
                  onClick={onBack}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
                >
                  <ArrowLeft className="h-3 w-3" /> Back
                </button>
              ) : <div />}
              {!hasShopify && (
                <button
                  onClick={() => setStep(2)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Skip — I don't use Shopify
                </button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Step 2: Amazon ── */}
      {step === 2 && (
        <Card className={`border transition-colors ${hasAmazon ? 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-900/10' : 'border-border'}`}>
          <CardContent className="p-6 space-y-4">
            <div className="flex items-center gap-3">
              <div className="h-11 w-11 rounded-xl bg-primary/10 flex items-center justify-center">
                <Package className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground text-lg">Connect Amazon</h3>
                {hasAmazon ? (
                  <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" /> Connected
                  </span>
                ) : (
                  <p className="text-xs text-muted-foreground">Auto-fetch settlements every cycle — no more downloading CSVs</p>
                )}
              </div>
            </div>

            {!hasAmazon && (
              <Button
                onClick={handleConnectAmazon}
                disabled={connectingAmazon}
                className="w-full"
              >
                {connectingAmazon ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Package className="h-4 w-4 mr-2" />
                )}
                Connect Amazon
              </Button>
            )}

            {hasAmazon && (
              <Button onClick={advanceFromAmazon} className="w-full">
                Continue <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            )}

            <div className="flex items-center justify-between">
              <button
                onClick={() => setStep(1)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
              >
                <ArrowLeft className="h-3 w-3" /> Back
              </button>
              {!hasAmazon && (
                <button
                  onClick={() => setStep(3)}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Skip — I don't use Amazon
                </button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Step 3: CSV Marketplaces ── */}
      {step === 3 && (
        <div className="space-y-4">
          <div className="text-center space-y-1">
            <div className="flex items-center justify-center gap-2">
              <Store className="h-5 w-5 text-primary" />
              <h3 className="font-semibold text-foreground text-lg">Which marketplaces do you use?</h3>
            </div>
            <p className="text-xs text-muted-foreground">
              Toggle on <span className="font-semibold">all</span> the marketplaces you sell through — select as many as you need.
              {hasXero && " We'll also detect channels from Xero automatically."}
              {(hasShopify || hasAmazon) && ' Your connected stores will sync too.'}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {CSV_MARKETPLACES.map((m) => {
              const isSelected = selectedMarketplaces.includes(m.id);
              return (
                <Card key={m.id} className={`border transition-colors cursor-pointer ${isSelected ? 'border-primary/40 bg-primary/5' : 'border-border hover:border-primary/20'}`} onClick={() => toggleMarketplace(m.id)}>
                  <CardContent className="p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Store className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium text-foreground">{m.label}</span>
                    </div>
                    <Switch checked={isSelected} onCheckedChange={() => toggleMarketplace(m.id)} onClick={(e) => e.stopPropagation()} />
                  </CardContent>
                </Card>
              );
            })}
          </div>

          {selectedMarketplaces.length > 0 && (
            <p className="text-xs text-center text-primary font-medium">
              {selectedMarketplaces.length} marketplace{selectedMarketplaces.length !== 1 ? 's' : ''} selected — settlement folders will be created for each
            </p>
          )}

          {showCustomInput ? (
            <div className="space-y-2">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  placeholder="Type a marketplace name..."
                  value={customName}
                  onChange={(e) => handleCustomNameChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && registryResults.length === 0 && !nearMatch) handleAddCustom();
                    if (e.key === 'Escape') { setShowCustomInput(false); setCustomName(''); setRegistryResults([]); setNearMatch(null); }
                  }}
                  className="text-sm pl-9 pr-9"
                  autoFocus
                />
                {customName && (
                  <button onClick={() => { setCustomName(''); setRegistryResults([]); setNearMatch(null); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Search results dropdown */}
              {(registryResults.length > 0 || searchLoading) && (
                <div className="border border-border rounded-lg bg-card shadow-sm overflow-hidden">
                  {searchLoading && (
                    <div className="p-2 flex items-center gap-2 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Searching...
                    </div>
                  )}
                  {registryResults.map((r) => (
                    <button
                      key={r.marketplace_code}
                      onClick={() => handleSelectRegistryMatch(r)}
                      className="w-full text-left px-3 py-2 text-sm hover:bg-accent/50 transition-colors flex items-center gap-2 border-b border-border last:border-b-0"
                    >
                      <Store className="h-3.5 w-3.5 text-primary" />
                      <span className="font-medium text-foreground">{r.marketplace_name}</span>
                      <span className="text-xs text-muted-foreground ml-auto">Select</span>
                    </button>
                  ))}
                </div>
              )}

              {/* Near-match suggestion */}
              {nearMatch && !searchLoading && registryResults.length === 0 && (
                <div className="border border-primary/30 rounded-lg bg-primary/5 p-3 space-y-2">
                  <p className="text-xs text-muted-foreground flex items-center gap-1">
                    <Sparkles className="h-3 w-3 text-primary" />
                    Did you mean <span className="font-semibold text-foreground">{nearMatch.marketplace_name}</span>?
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => handleSelectRegistryMatch(nearMatch)}>
                      Yes, use {nearMatch.marketplace_name}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-xs h-7" onClick={handleAddCustom}>
                      No, save "{customName.trim()}" as new
                    </Button>
                  </div>
                </div>
              )}

              {/* Save as new option when no results */}
              {customName.trim().length >= 2 && !searchLoading && registryResults.length === 0 && !nearMatch && (
                <Button size="sm" variant="outline" onClick={handleAddCustom} className="w-full text-xs flex items-center gap-1.5">
                  <Plus className="h-3 w-3" /> Save "{customName.trim()}" as a new marketplace
                </Button>
              )}
            </div>
          ) : (
            <button onClick={() => setShowCustomInput(true)} className="text-xs text-primary hover:text-primary/80 transition-colors flex items-center gap-1 mx-auto">
              <Plus className="h-3 w-3" /> I don't see my marketplace
            </button>
          )}

          <p className="text-xs text-muted-foreground text-center">
            Every platform is optional. You can add or remove marketplaces anytime.
          </p>

          {/* COA gap resolution prompt */}
          {coaGapMarketplace && (
            <div className="space-y-3">
              <CoaBlockerCta
                marketplace={coaGapMarketplace}
                onResolved={() => {
                  setCoaGapMarketplace(null);
                  toast.success('COA gap resolved — continuing setup.');
                  onNext();
                }}
              />
              <Button
                variant="ghost"
                size="sm"
                className="text-xs text-muted-foreground"
                onClick={() => {
                  setCoaGapMarketplace(null);
                  onNext();
                }}
              >
                Skip — I'll set up accounts later
              </Button>
            </div>
          )}

          <div className="flex flex-col items-center gap-2">
            <Button onClick={handleContinueFromMarketplaceStep} className="w-full" disabled={persistingSelections || !!coaGapMarketplace}>
              {persistingSelections ? <><Loader2 className="h-4 w-4 animate-spin mr-2" />Saving selections...</> : 'Continue'}
            </Button>
            <div className="flex items-center justify-between w-full">
              <button onClick={() => setStep(2)} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                <ArrowLeft className="h-3 w-3" /> Back
              </button>
              {!hasXero && !hasShopify && !hasAmazon && (
                <button onClick={onSkip} className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1">
                  <Upload className="h-3 w-3" /> Skip all — I'll upload files manually
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
