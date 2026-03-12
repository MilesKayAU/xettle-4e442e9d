import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { Package, ShoppingBag, CheckCircle2, Loader2, Store, Plus, Upload, ArrowRight, ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';

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

  const handleAddCustom = () => {
    if (!customName.trim()) return;
    const id = customName.trim().toLowerCase().replace(/\s+/g, '_');
    if (!selectedMarketplaces.includes(id)) {
      onMarketplacesChange([...selectedMarketplaces, id]);
    }
    setCustomName('');
    setShowCustomInput(false);
    toast.success(`${customName.trim()} added — you can upload its files in the next step.`);
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
            <div className="flex gap-2">
              <Input placeholder="e.g. Woolworths MarketPlus" value={customName} onChange={(e) => setCustomName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()} className="text-sm" autoFocus />
              <Button size="sm" onClick={handleAddCustom} disabled={!customName.trim()}>Add</Button>
            </div>
          ) : (
            <button onClick={() => setShowCustomInput(true)} className="text-xs text-primary hover:text-primary/80 transition-colors flex items-center gap-1 mx-auto">
              <Plus className="h-3 w-3" /> I don't see my marketplace
            </button>
          )}

          <p className="text-xs text-muted-foreground text-center">
            Every platform is optional. You can add or remove marketplaces anytime.
          </p>

          <div className="flex flex-col items-center gap-2">
            <Button onClick={onNext} className="w-full">
              Continue
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
