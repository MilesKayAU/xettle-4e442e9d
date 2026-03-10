import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { supabase } from '@/integrations/supabase/client';
import { ShoppingBag, Package, CheckCircle2, Loader2, Upload } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  onNext: () => void;
  onSkip: () => void;
  hasAmazon: boolean;
  hasShopify: boolean;
}

const CONNECTORS = [
  { id: 'amazon', label: 'Amazon', icon: Package, recommended: true },
  { id: 'shopify', label: 'Shopify', icon: ShoppingBag, recommended: true },
];

export default function SetupStepConnectStores({ onNext, onSkip, hasAmazon, hasShopify }: Props) {
  const [connectingAmazon, setConnectingAmazon] = useState(false);
  const [connectingShopify, setConnectingShopify] = useState(false);
  const [shopDomain, setShopDomain] = useState('');
  const [showShopifyInput, setShowShopifyInput] = useState(false);

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
      if (data?.url) {
        window.location.href = data.url;
      }
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
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to start Shopify connection');
      setConnectingShopify(false);
    }
  };

  const anyConnected = hasAmazon || hasShopify;

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-bold text-foreground">Let Xettle automate your accounting</h2>
        <p className="text-sm text-muted-foreground">
          Connect your sales channels so Xettle can automatically find settlements and prepare your books.
        </p>
      </div>

      <div className="grid gap-3">
        {CONNECTORS.map((connector) => {
          const Icon = connector.icon;
          const isConnected = connectedMap[connector.id];
          const isLoading = connector.id === 'amazon' ? connectingAmazon : connectingShopify;

          return (
            <Card key={connector.id} className={`border transition-colors ${isConnected ? 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-900/10' : 'border-border'}`}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <p className="font-medium text-foreground">{connector.label}</p>
                    {connector.recommended && !isConnected && (
                      <span className="text-[10px] font-medium text-primary">Recommended</span>
                    )}
                    {isConnected && (
                      <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Connected
                      </span>
                    )}
                  </div>
                </div>
                {!isConnected && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isLoading}
                    onClick={connector.id === 'amazon' ? handleConnectAmazon : handleConnectShopify}
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

      {/* Trust signal */}
      <p className="text-xs text-muted-foreground text-center">
        Xettle never changes your accounting without your approval. You can change these anytime later.
      </p>

      {/* Actions */}
      <div className="flex flex-col items-center gap-2">
        {anyConnected && (
          <Button onClick={onNext} className="w-full">
            Continue
          </Button>
        )}
        <button
          onClick={onSkip}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1"
        >
          <Upload className="h-3 w-3" />
          Or upload settlement files manually
        </button>
      </div>
    </div>
  );
}
