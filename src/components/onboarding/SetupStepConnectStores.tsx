import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { supabase } from '@/integrations/supabase/client';
import { Package, ShoppingBag, CheckCircle2, Loader2, Store, Plus, Upload } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  onNext: () => void;
  onSkip: () => void;
  hasAmazon: boolean;
  hasShopify: boolean;
  selectedMarketplaces: string[];
  onMarketplacesChange: (marketplaces: string[]) => void;
}

interface MarketplaceOption {
  id: string;
  label: string;
  icon: typeof Package;
  type: 'api' | 'csv';
}

const API_MARKETPLACES: MarketplaceOption[] = [
  { id: 'amazon', label: 'Amazon', icon: Package, type: 'api' },
  { id: 'shopify', label: 'Shopify', icon: ShoppingBag, type: 'api' },
];

const CSV_MARKETPLACES: MarketplaceOption[] = [
  { id: 'bunnings', label: 'Bunnings', icon: Store, type: 'csv' },
  { id: 'bigw', label: 'BigW', icon: Store, type: 'csv' },
  { id: 'kogan', label: 'Kogan', icon: Store, type: 'csv' },
  { id: 'catch', label: 'Catch', icon: Store, type: 'csv' },
  { id: 'mydeal', label: 'MyDeal', icon: Store, type: 'csv' },
  { id: 'everyday_market', label: 'Everyday Market', icon: Store, type: 'csv' },
  { id: 'ebay', label: 'eBay', icon: Store, type: 'csv' },
];

export default function SetupStepConnectStores({
  onNext,
  onSkip,
  hasAmazon,
  hasShopify,
  selectedMarketplaces,
  onMarketplacesChange,
}: Props) {
  const [connectingAmazon, setConnectingAmazon] = useState(false);
  const [connectingShopify, setConnectingShopify] = useState(false);
  const [shopDomain, setShopDomain] = useState('');
  const [showShopifyInput, setShowShopifyInput] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customName, setCustomName] = useState('');

  const connectedMap: Record<string, boolean> = {
    amazon: hasAmazon,
    shopify: hasShopify,
  };

  const handleConnectAmazon = async () => {
    setConnectingAmazon(true);
    try {
      const { data, error } = await supabase.functions.invoke('amazon-auth', {
        headers: { 'x-action': 'get-auth-url' },
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
      setShowShopifyInput(true);
      return;
    }
    setConnectingShopify(true);
    try {
      const domain = shopDomain.trim().replace(/^https?:\/\//, '').replace(/\/$/, '');
      const { data, error } = await supabase.functions.invoke('shopify-auth', {
        body: { action: 'install', shop: domain },
      });
      if (error || data?.error) throw new Error(data?.error || 'Failed to start Shopify connection');
      const authUrl = data?.authUrl || data?.url;
      if (authUrl) window.location.href = authUrl;
    } catch (err: any) {
      toast.error(err.message || 'Failed to start Shopify connection');
      setConnectingShopify(false);
    }
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

  const hasAnySelection = selectedMarketplaces.length > 0 || hasAmazon || hasShopify;

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-bold text-foreground">Which marketplaces do you sell on?</h2>
        <p className="text-sm text-muted-foreground">
          Connect APIs for automatic sync, or toggle on CSV-only marketplaces — both work perfectly.
        </p>
      </div>

      {/* API-connected marketplaces */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">API Sync</p>
        {API_MARKETPLACES.map((m) => {
          const Icon = m.icon;
          const isConnected = connectedMap[m.id];
          const isLoading = m.id === 'amazon' ? connectingAmazon : connectingShopify;

          return (
            <Card key={m.id} className={`border transition-colors ${isConnected ? 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-900/10' : 'border-border'}`}>
              <CardContent className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground text-sm">{m.label}</p>
                    {isConnected ? (
                      <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Connected
                      </span>
                    ) : (
                      <span className="text-[10px] text-muted-foreground">Auto-sync settlements</span>
                    )}
                  </div>
                </div>
                {!isConnected && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isLoading}
                    onClick={m.id === 'amazon' ? handleConnectAmazon : handleConnectShopify}
                  >
                    {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Connect'}
                  </Button>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Shopify domain input */}
      {showShopifyInput && !hasShopify && (
        <div className="flex gap-2">
          <Input
            placeholder="your-store.myshopify.com"
            value={shopDomain}
            onChange={(e) => setShopDomain(e.target.value)}
            className="text-sm"
          />
          <Button size="sm" onClick={handleConnectShopify} disabled={connectingShopify}>
            {connectingShopify ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Go'}
          </Button>
        </div>
      )}

      {/* CSV-only marketplaces */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">CSV Upload</p>
        <div className="grid grid-cols-2 gap-2">
          {CSV_MARKETPLACES.map((m) => {
            const isSelected = selectedMarketplaces.includes(m.id);
            return (
              <Card
                key={m.id}
                className={`border transition-colors cursor-pointer ${
                  isSelected
                    ? 'border-primary/40 bg-primary/5'
                    : 'border-border hover:border-primary/20'
                }`}
                onClick={() => toggleMarketplace(m.id)}
              >
                <CardContent className="p-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Store className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium text-foreground">{m.label}</span>
                  </div>
                  <Switch
                    checked={isSelected}
                    onCheckedChange={() => toggleMarketplace(m.id)}
                    onClick={(e) => e.stopPropagation()}
                  />
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Custom marketplace */}
      {showCustomInput ? (
        <div className="flex gap-2">
          <Input
            placeholder="e.g. Woolworths MarketPlus"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddCustom()}
            className="text-sm"
            autoFocus
          />
          <Button size="sm" onClick={handleAddCustom} disabled={!customName.trim()}>
            Add
          </Button>
        </div>
      ) : (
        <button
          onClick={() => setShowCustomInput(true)}
          className="text-xs text-primary hover:text-primary/80 transition-colors flex items-center gap-1"
        >
          <Plus className="h-3 w-3" /> I don't see my marketplace
        </button>
      )}

      {/* Trust signal */}
      <p className="text-xs text-muted-foreground text-center">
        Every platform is optional. You can add or remove marketplaces anytime.
      </p>

      {/* Actions */}
      <div className="flex flex-col items-center gap-2">
        {hasAnySelection && (
          <Button onClick={onNext} className="w-full">
            Continue
          </Button>
        )}
        <button
          onClick={onSkip}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          <Upload className="h-3 w-3" /> Skip all — I'll upload files manually
        </button>
      </div>
    </div>
  );
}
