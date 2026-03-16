import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Loader2, Link2, Unlink, CheckCircle, RefreshCw, ShoppingBag, ChevronDown, Key, Sparkles, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { type ShopifyApiOrder } from '@/utils/shopify-api-adapter';
import { detectAllMarketplaces, classifyUnknownTag, type BatchDetectionResult } from '@/utils/shopify-order-detector';
import MarketplaceDiscovery from '@/components/shopify/MarketplaceDiscovery';

interface ShopifyStatus {
  connected: boolean;
  shops: Array<{ shop_domain: string; scope: string; installed_at: string }>;
}


const ShopifyConnectionStatus = () => {
  const [status, setStatus] = useState<ShopifyStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [shopDomain, setShopDomain] = useState('');
  const [manualOpen, setManualOpen] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [manualDomain, setManualDomain] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);

  // Discovery modal state
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [discovering, setDiscovering] = useState(false);
  const [discoveryResult, setDiscoveryResult] = useState<BatchDetectionResult | null>(null);
  const [creatingTabs, setCreatingTabs] = useState(false);

  // Pre-populate shop domain from app_settings
  useEffect(() => {
    const loadSavedDomain = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('user_id', session.user.id)
        .eq('key', 'shopify_shop_domain')
        .maybeSingle();
      if (data?.value) {
        setShopDomain(data.value);
        setManualDomain(data.value);
      }
    };
    loadSavedDomain();
  }, []);

  const fetchStatus = async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setStatus({ connected: false, shops: [] });
        setLoading(false);
        return;
      }

      const { data: result, error } = await supabase.functions.invoke('shopify-auth', {
        method: 'GET',
        headers: { 'x-action': 'status' },
      });

      if (error) {
        console.error('Failed to fetch Shopify status:', error);
        setStatus({ connected: false, shops: [] });
      } else {
        setStatus(result);
      }
    } catch (error) {
      console.error('Error fetching Shopify status:', error);
      setStatus({ connected: false, shops: [] });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
  }, []);

  // ─── Discovery: fetch orders & detect marketplaces ────────────────

  const runDiscovery = async (domain: string) => {
    setDiscovering(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-shopify-orders', {
        body: {
          shopDomain: domain,
          dateFrom: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
          limit: 250,
        },
      });

      if (error || !data?.success) {
        toast.error('Could not fetch orders for discovery. You can still use CSV uploads.');
        setDiscovering(false);
        return;
      }

      const apiOrders: ShopifyApiOrder[] = data.orders || [];
      if (apiOrders.length === 0) {
        toast.info('No orders found in the last 90 days.');
        setDiscovering(false);
        return;
      }

      // Use new detector
      const result = await detectAllMarketplaces(
        apiOrders.map(o => ({
          name: o.name,
          tags: o.tags || '',
          note_attributes: o.note_attributes || [],
          gateway: o.payment_gateway_names?.[0] || o.gateway || '',
          source_name: (o as any).source_name || '',
        }))
      );

      if (result.marketplaces.length === 0) {
        toast.info('No marketplace channels detected. Orders may all be direct Shopify sales.');
        setDiscovering(false);
        return;
      }

      setDiscoveryResult(result);
      setDiscoveryOpen(true);
    } catch (err: any) {
      console.error('Discovery error:', err);
      toast.error('Discovery failed — you can still use CSV uploads.');
    } finally {
      setDiscovering(false);
    }
  };

  const handleCreateTabs = async (selectedCodes: string[]) => {
    setCreatingTabs(true);
    try {
      const { provisionMarketplace } = await import('@/actions/marketplaces');
      let created = 0;
      for (const code of selectedCodes) {
        const mpCode = `shopify_orders_${code}`;
        const mp = discoveryResult?.marketplaces.find(m => m.code === code);
        const result = await provisionMarketplace({
          marketplaceCode: mpCode,
          marketplaceName: mp?.name || code,
          connectionType: 'auto_detected',
        });
        if (result.action === 'created') created++;
      }

      toast.success(`${created > 0 ? created : selectedCodes.length} marketplace tab${created !== 1 ? 's' : ''} created`);
      setDiscoveryOpen(false);

      // Update last_fetched_at
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('app_settings').upsert({
          user_id: user.id,
          key: 'shopify_last_fetched_at',
          value: new Date().toISOString(),
        }, { onConflict: 'user_id,key' });
      }

    } catch (err: any) {
      toast.error(err.message || 'Failed to create tabs');
    } finally {
      setCreatingTabs(false);
    }
  };

  const handleClassifyUnknown = async (tag: string, type: string) => {
    await classifyUnknownTag(tag, type);
  };

  // ─── Reconnect: delete invalid token then re-initiate OAuth ─────
  const handleReconnect = async () => {
    const domain = status?.shops?.[0]?.shop_domain;
    if (!domain) return;
    setReconnecting(true);
    try {
      // Step 1: Delete invalid token
      await supabase.functions.invoke('shopify-auth', {
        method: 'POST',
        headers: { 'x-action': 'disconnect' },
      });
      setStatus({ connected: false, shops: [] });

      // Step 2: Re-initiate OAuth
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('You must be logged in');
        setReconnecting(false);
        return;
      }

      const { data: result, error } = await supabase.functions.invoke('shopify-auth', {
        body: { action: 'initiate', shop: domain, userId: session.user.id },
      });

      if (error) throw new Error(error.message);
      if (result?.error) throw new Error(result.error);

      if (result?.authUrl) {
        window.location.href = result.authUrl;
      }
    } catch (error: any) {
      console.error('Reconnect error:', error);
      toast.error(error.message || 'Failed to reconnect');
      setReconnecting(false);
    }
  };

  // ─── Connection handlers ──────────────────────────────────────────

  const isValidDomain = (domain: string) => {
    return domain.trim().endsWith('.myshopify.com') && domain.trim().length > '.myshopify.com'.length;
  };

  const handleConnect = async () => {
    if (!isValidDomain(shopDomain)) {
      toast.error('Please enter a valid .myshopify.com domain');
      return;
    }

    setConnecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('You must be logged in to connect Shopify');
        setConnecting(false);
        return;
      }

      const { data: result, error } = await supabase.functions.invoke('shopify-auth', {
        body: { action: 'initiate', shop: shopDomain.trim(), userId: session.user.id },
      });

      if (error) throw new Error(error.message || 'Failed to start authorization');
      if (result?.error) throw new Error(result.error);

      if (result?.authUrl) {
        window.location.href = result.authUrl;
      } else {
        throw new Error('No authorization URL received');
      }
    } catch (error: any) {
      console.error('Error connecting to Shopify:', error);
      toast.error(error.message || 'Failed to connect to Shopify');
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const { data: result, error } = await supabase.functions.invoke('shopify-auth', {
        method: 'POST',
        headers: { 'x-action': 'disconnect' },
      });

      if (error) throw new Error(error.message || 'Failed to disconnect');
      if (result?.error) throw new Error(result.error);

      toast.success('Disconnected from Shopify');
      setStatus({ connected: false, shops: [] });
    } catch (error: any) {
      console.error('Error disconnecting from Shopify:', error);
      toast.error(error.message || 'Failed to disconnect from Shopify');
    } finally {
      setDisconnecting(false);
    }
  };

  const handleReauthorise = async () => {
    if (!status?.shops?.[0]?.shop_domain) return;
    setConnecting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('You must be logged in');
        setConnecting(false);
        return;
      }

      const { data: result, error } = await supabase.functions.invoke('shopify-auth', {
        body: { action: 'initiate', shop: status.shops[0].shop_domain, userId: session.user.id },
      });

      if (error) throw new Error(error.message || 'Failed to start re-authorization');
      if (result?.error) throw new Error(result.error);

      if (result?.authUrl) {
        window.location.href = result.authUrl;
      }
    } catch (error: any) {
      console.error('Error re-authorising Shopify:', error);
      toast.error(error.message || 'Failed to re-authorise');
      setConnecting(false);
    }
  };

  const handleManualSave = async () => {
    const domain = manualDomain.trim();
    const token = manualToken.trim();
    if (!domain || !token) {
      toast.error('Please enter both shop domain and access token');
      return;
    }

    if (!token.startsWith('shpat_')) {
      toast.error('Invalid token — Custom App tokens must start with "shpat_". If you connected via OAuth, use the "Connect Shopify" button instead.');
      return;
    }

    setSavingToken(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('You must be logged in');
        setSavingToken(false);
        return;
      }

      const { error } = await supabase.from('shopify_tokens').upsert({
        user_id: session.user.id,
        shop_domain: domain,
        access_token: token,
        scope: 'custom_app',
      }, { onConflict: 'user_id,shop_domain' } as any);

      if (error) throw error;

      // Also save shop domain to app_settings
      await supabase.from('app_settings').upsert({
        user_id: session.user.id,
        key: 'shopify_shop_domain',
        value: domain,
      }, { onConflict: 'user_id,key' } as any);

      toast.success('Shopify token saved successfully');
      setManualToken('');
      setManualDomain('');
      setManualOpen(false);
      await fetchStatus();

      // Trigger discovery after manual connection
      runDiscovery(domain);
    } catch (error: any) {
      console.error('Error saving Shopify token:', error);
      toast.error(error.message || 'Failed to save token');
    } finally {
      setSavingToken(false);
    }
  };

  // ─── Render ───────────────────────────────────────────────────────

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-6">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  const scopeCount = status?.shops?.[0]?.scope
    ? status.shops[0].scope.split(',').length
    : 0;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-[hsl(var(--chart-3))] flex items-center justify-center">
                <ShoppingBag className="h-5 w-5 text-primary-foreground" />
              </div>
              <div>
                <CardTitle className="text-lg">Shopify Integration</CardTitle>
                <CardDescription>
                  Connect your Shopify store to auto-fetch orders without CSV uploads
                </CardDescription>
              </div>
            </div>
            <Badge variant={status?.connected ? 'default' : 'secondary'}>
              {status?.connected ? 'Connected' : 'Not Connected'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {status?.connected && status.shops.length > 0 && (
            <>
              {/* Invalid token warning */}
              {status.shops[0]?.scope === 'custom_app' && (
                <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                        Token may be invalid
                      </p>
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        Your Shopify token was entered manually and may not be a valid API token. Reconnect via OAuth to fix this automatically.
                      </p>
                      <Button
                        size="sm"
                        variant="default"
                        className="bg-amber-600 hover:bg-amber-700 text-white"
                        onClick={handleReconnect}
                        disabled={reconnecting}
                      >
                        {reconnecting ? (
                          <>
                            <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                            Reconnecting...
                          </>
                        ) : (
                          <>
                            <RefreshCw className="mr-2 h-3.5 w-3.5" />
                            Reconnect Shopify
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-muted/50 rounded-lg p-3">
                <p className="text-sm font-medium mb-2 flex items-center gap-2">
                  <CheckCircle className="h-4 w-4 text-green-500" />
                  Connected Store
                </p>
                <ul className="space-y-1">
                  {status.shops.map((shop) => (
                    <li key={shop.shop_domain} className="text-sm text-muted-foreground pl-6">
                      {shop.shop_domain}
                    </li>
                  ))}
                </ul>
                {scopeCount > 0 && status.shops[0]?.scope !== 'custom_app' && (
                  <p className="text-xs text-muted-foreground mt-2 pl-6">
                    {scopeCount} scopes active
                  </p>
                )}
              </div>
            </>
          )}

          {!status?.connected ? (
            <div className="space-y-3">
              <Input
                placeholder="yourstore.myshopify.com"
                value={shopDomain}
                onChange={(e) => setShopDomain(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleConnect()}
                autoComplete="off"
              />
              <Button
                onClick={handleConnect}
                disabled={connecting || !isValidDomain(shopDomain)}
                className="w-full"
              >
                {connecting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  <>
                    <Link2 className="mr-2 h-4 w-4" />
                    Connect Shopify →
                  </>
                )}
              </Button>

              <Collapsible open={manualOpen} onOpenChange={setManualOpen}>
                <CollapsibleTrigger asChild>
                  <Button variant="ghost" size="sm" className="w-full text-muted-foreground text-xs gap-1">
                    <Key className="h-3 w-3" />
                    Using a Shopify Custom App instead?
                    <ChevronDown className={`h-3 w-3 transition-transform ${manualOpen ? 'rotate-180' : ''}`} />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-2 pt-2">
                  <Input
                    placeholder="shpat_..."
                    value={manualToken}
                    onChange={(e) => setManualToken(e.target.value)}
                    type="password"
                  />
                  <Input
                    placeholder="yourstore.myshopify.com"
                    value={manualDomain}
                    onChange={(e) => setManualDomain(e.target.value)}
                    autoComplete="off"
                  />
                  <Button
                    onClick={handleManualSave}
                    disabled={savingToken || !manualToken.trim() || !manualDomain.trim()}
                    variant="secondary"
                    className="w-full"
                    size="sm"
                  >
                    {savingToken ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      'Save connection'
                    )}
                  </Button>
                </CollapsibleContent>
              </Collapsible>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  onClick={handleReauthorise}
                  disabled={connecting}
                  className="flex-1"
                >
                  {connecting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <RefreshCw className="mr-2 h-4 w-4" />
                      Re-authorise
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={handleDisconnect}
                  disabled={disconnecting}
                >
                  {disconnecting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Unlink className="mr-2 h-4 w-4" />
                      Disconnect
                    </>
                  )}
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={fetchStatus}
                  title="Refresh status"
                >
                  <RefreshCw className="h-4 w-4" />
                </Button>
              </div>

              {/* Discover marketplaces button */}
              <Button
                variant="secondary"
                size="sm"
                className="w-full gap-2"
                onClick={() => {
                  const domain = status.shops[0]?.shop_domain;
                  if (domain) runDiscovery(domain);
                }}
                disabled={discovering}
              >
                {discovering ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Scanning orders...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-3.5 w-3.5" />
                    Discover my sales channels
                  </>
                )}
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Discovery Modal */}
      <Dialog open={discoveryOpen} onOpenChange={setDiscoveryOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="text-xl">
              Sales Channel Discovery
            </DialogTitle>
            <DialogDescription>
              Select which marketplaces to create tabs for. Each checked channel will get its own dashboard.
            </DialogDescription>
          </DialogHeader>

          {discoveryResult && (
            <MarketplaceDiscovery
              detectionResult={discoveryResult}
              onConfirm={handleCreateTabs}
              onClassifyUnknown={handleClassifyUnknown}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
};

export default ShopifyConnectionStatus;
