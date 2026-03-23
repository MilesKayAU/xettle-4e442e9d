import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { CheckCircle2, XCircle, Loader2, Unplug, RefreshCw, Link2, Info, Settings2 } from "lucide-react";
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const BUNNINGS_BASE_URL = 'https://marketplace.bunnings.com.au';


type AuthMode = 'oauth' | 'api_key' | 'both';
type AuthHeaderType = 'auto' | 'bearer' | 'authorization' | 'x-api-key';

interface MiraklConnectionPanelProps {
  onSettlementsAutoFetched?: () => void;
  marketplaceFilter?: string;
}

export default function MiraklConnectionPanel({ onSettlementsAutoFetched, marketplaceFilter }: MiraklConnectionPanelProps) {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [connection, setConnection] = useState<any>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [fetching, setFetching] = useState(false);

  // Form state
  const [selectedMarketplace] = useState('Bunnings');
  const [baseUrl] = useState<string>(BUNNINGS_BASE_URL);
  const [authMode, setAuthMode] = useState<AuthMode>('api_key');
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [sellerCompanyId, setSellerCompanyId] = useState('');
  const [authHeaderType, setAuthHeaderType] = useState<AuthHeaderType>('auto');
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const checkStatus = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('mirakl-auth', {
        headers: { 'x-action': 'status' },
      });
      if (!error && data) {
        setConnected(data.connected);
        setConnection(data.connection || null);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);


  const isFormValid = () => {
    if (!baseUrl) return false;
    if (authMode === 'oauth' || authMode === 'both') {
      if (!clientId || !clientSecret) return false;
    }
    if (authMode === 'api_key' || authMode === 'both') {
      if (!apiKey) return false;
    }
    return true;
  };

  const handleConnect = async () => {
    if (!isFormValid()) {
      toast.error('Please fill in all required fields');
      return;
    }
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('mirakl-auth', {
        headers: { 'x-action': 'connect' },
        body: {
          base_url: baseUrl,
          client_id: clientId || '',
          client_secret: clientSecret || '',
          api_key: apiKey || null,
          auth_mode: authMode,
          auth_header_type: authHeaderType === 'auto' ? null : authHeaderType,
          seller_company_id: sellerCompanyId || 'default',
          marketplace_label: selectedMarketplace,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('Bunnings Marketplace connection saved');
      setClientId('');
      setClientSecret('');
      setApiKey('');
      await checkStatus();
    } catch (err: any) {
      toast.error(`Connection failed: ${err.message}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect Bunnings Marketplace? You can reconnect anytime.')) return;
    setDisconnecting(true);
    try {
      const { error } = await supabase.functions.invoke('mirakl-auth', {
        headers: { 'x-action': 'disconnect' },
        body: connection?.id ? { connection_id: connection.id } : {},
      });
      if (error) throw error;
      setConnected(false);
      setConnection(null);
      toast.success('Bunnings Marketplace disconnected');
    } catch (err: any) {
      toast.error(`Disconnect failed: ${err.message}`);
    } finally {
      setDisconnecting(false);
    }
  };

  const handleFetchNow = async (e?: React.MouseEvent) => {
    e?.preventDefault();
    setFetching(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-mirakl-settlements');
      if (error) throw error;
      if (data?.error) {
        // Surface API-level errors (e.g. 401 Unauthorized) clearly
        const msg = data.error;
        if (msg.includes('401') || msg.toLowerCase().includes('unauthorized')) {
          toast.error('Bunnings API credentials are invalid or expired. Please reconnect with updated credentials.');
        } else {
          toast.error(`Bunnings sync error: ${msg}`);
        }
        return;
      }
      const { imported = 0, skipped = 0, empty_skipped = 0 } = data || {};
      const parts = [];
      if (imported > 0) parts.push(`${imported} imported`);
      if (skipped > 0) parts.push(`${skipped} duplicates skipped`);
      if (empty_skipped > 0) parts.push(`${empty_skipped} empty periods skipped`);
      toast.success(parts.length > 0 ? `Done! ${parts.join(', ')}.` : 'No new Bunnings settlements found.');
      if (imported > 0) onSettlementsAutoFetched?.();
    } catch (err: any) {
      toast.error(`Fetch failed: ${err.message}`);
    } finally {
      setFetching(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-2">Checking Bunnings connection...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <span className="text-lg">🏠</span>
              Bunnings Marketplace Sync
            </CardTitle>
            <CardDescription className="text-xs">
              Auto-import settlement data from Bunnings Marketplace.
            </CardDescription>
          </div>
          {connected ? (
            <Badge className="bg-primary/10 text-primary gap-1">
              <CheckCircle2 className="h-3 w-3" /> Connected
            </Badge>
          ) : (
            <Badge variant="outline" className="text-muted-foreground gap-1">
              <XCircle className="h-3 w-3" /> Not Connected
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {connected && connection ? (
          <div className="space-y-3">
            <div className="bg-muted/50 rounded-lg p-3 space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Marketplace:</span>
                <span className="font-medium">{connection.marketplace_label}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Seller ID:</span>
                <span className="font-mono text-xs">{connection.seller_company_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Auth mode:</span>
                <Badge variant="outline" className="text-[10px] h-5">
                  {connection.auth_mode === 'both' ? 'OAuth + API Key' : connection.auth_mode === 'api_key' ? 'API Key' : 'OAuth'}
                </Badge>
              </div>
              {connection.updated_at && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last updated:</span>
                  <span className="text-xs">{new Date(connection.updated_at).toLocaleString()}</span>
                </div>
              )}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={(e) => handleFetchNow(e)}
                disabled={fetching}
                className="gap-1.5"
              >
                {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {fetching ? 'Fetching...' : 'Fetch Settlements'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
                disabled={disconnecting || fetching}
                className="gap-1.5 text-destructive hover:text-destructive"
              >
                {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5" />}
                Disconnect
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="bg-muted/30 border border-border rounded-lg p-3 text-sm text-muted-foreground space-y-2">
              <p className="text-xs font-medium">How to find your API key:</p>
              <ol className="text-xs list-decimal list-inside space-y-0.5">
                <li>Log into your <strong>Bunnings Marketplace seller portal</strong></li>
                <li>Click your <strong>profile initials</strong> (top right)</li>
                <li>Select <strong>My Settings</strong></li>
                <li>Click the <strong>API Key</strong> tab</li>
                <li>Click <strong>Generate a new API key</strong></li>
                <li>Copy and paste it below</li>
              </ol>
              <p className="text-[10px] text-muted-foreground/70">
                Xettle requests <strong>read-only</strong> access to settlement and transaction data.
              </p>
            </div>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Shop ID <span className="text-muted-foreground font-normal">(optional)</span></Label>
                <Input
                  placeholder="e.g. your Bunnings vendor number or Mirakl shop ID"
                  value={sellerCompanyId}
                  onChange={(e) => setSellerCompanyId(e.target.value)}
                  className="font-mono text-xs h-8"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  Leave blank if you only have one store. You can find this in your seller portal under My Settings → Mirakl seller account.
                </p>
              </div>
              <div>
                <Label className="text-xs font-medium mb-2 block">Auth Method</Label>
                <RadioGroup
                  value={authMode}
                  onValueChange={(v) => {
                    setAuthMode(v as AuthMode);
                    if (v === 'oauth') {
                      setAuthHeaderType('auto');
                      setAdvancedOpen(false);
                    }
                  }}
                  className="flex gap-4"
                >
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="oauth" id="auth-oauth" />
                    <Label htmlFor="auth-oauth" className="text-xs font-normal cursor-pointer">
                      OAuth
                    </Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <RadioGroupItem value="api_key" id="auth-apikey" />
                    <Label htmlFor="auth-apikey" className="text-xs font-normal cursor-pointer">
                      API Key (recommended)
                    </Label>
                  </div>
                </RadioGroup>
              </div>
              {(authMode === 'oauth' || authMode === 'both') && (
                <>
                  <div>
                    <Label className="text-xs">Client ID</Label>
                    <Input
                      placeholder="Your Client ID"
                      value={clientId}
                      onChange={(e) => setClientId(e.target.value)}
                      className="font-mono text-xs h-8"
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Client Secret</Label>
                    <Input
                      type="password"
                      placeholder="Your Client Secret"
                      value={clientSecret}
                      onChange={(e) => setClientSecret(e.target.value)}
                      className="font-mono text-xs h-8"
                    />
                  </div>
                </>
              )}
              {(authMode === 'api_key' || authMode === 'both') && (
                <div>
                  <Label className="text-xs">API Key</Label>
                  <Input
                    type="password"
                    placeholder="e.g. bfb2d8a3-914b-4d8e-828b-3d75199754c5"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    className="font-mono text-xs h-8"
                  />
                  <p className="text-[10px] text-muted-foreground mt-1">
                    Paste the API key generated from your Bunnings seller portal.
                  </p>
                </div>
              )}
              {(authMode === 'api_key' || authMode === 'both') && (
                <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
                  <CollapsibleTrigger asChild>
                    <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground h-6 px-1">
                      <Settings2 className="h-3 w-3" />
                      Advanced
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2">
                    <div>
                      <Label className="text-xs">Header Format</Label>
                      <Select value={authHeaderType} onValueChange={(v) => setAuthHeaderType(v as AuthHeaderType)}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto" className="text-xs">Auto (recommended)</SelectItem>
                          <SelectItem value="bearer" className="text-xs">Authorization: Bearer</SelectItem>
                          <SelectItem value="authorization" className="text-xs">Authorization: key</SelectItem>
                          <SelectItem value="x-api-key" className="text-xs">X-API-KEY: key</SelectItem>
                        </SelectContent>
                      </Select>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        Most marketplaces use the default. Only change if your marketplace requires a specific header format.
                      </p>
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              )}
              <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground bg-muted/20 rounded p-2">
                <Info className="h-3 w-3 mt-0.5 shrink-0" />
                <span>
                  Most Bunnings sellers use a direct <strong>API Key</strong> from the seller portal.
                  If your account uses OAuth credentials (Client ID + Secret), switch to OAuth above.
                </span>
              </div>
            </div>
            <Button
              size="sm"
              onClick={handleConnect}
              disabled={connecting || !isFormValid()}
              className="gap-1.5"
            >
              {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
              {connecting ? 'Connecting...' : 'Connect'}
            </Button>
            <p className="text-[10px] text-muted-foreground">
              Credentials are encrypted and stored securely. No marketplace data is shared with third parties.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
