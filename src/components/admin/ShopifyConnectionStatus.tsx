import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Loader2, Link2, Unlink, CheckCircle, RefreshCw, ShoppingBag, ChevronDown, Key } from 'lucide-react';
import { toast } from 'sonner';

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
  // Pre-populate shop domain from app_settings (not from user email)
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
    } catch (error: any) {
      console.error('Error saving Shopify token:', error);
      toast.error(error.message || 'Failed to save token');
    } finally {
      setSavingToken(false);
    }
  };

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
            {scopeCount > 0 && (
              <p className="text-xs text-muted-foreground mt-2 pl-6">
                {scopeCount} scopes active
              </p>
            )}
          </div>
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
        )}
      </CardContent>
    </Card>
  );
};

export default ShopifyConnectionStatus;
