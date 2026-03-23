import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, XCircle, Loader2, Unplug, RefreshCw, Link2 } from "lucide-react";
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

const MIRAKL_MARKETPLACES = [
  { label: 'Bunnings', baseUrl: 'https://marketplace.bunnings.com.au' },
  { label: 'Catch', baseUrl: 'https://marketplace.catch.com.au' },
  { label: 'MyDeal', baseUrl: 'https://marketplace.mydeal.com.au' },
  { label: 'Kogan', baseUrl: 'https://marketplace.kogan.com' },
  { label: 'Decathlon', baseUrl: 'https://marketplace.decathlon.com.au' },
  { label: 'Other', baseUrl: '' },
] as const;

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
  const [selectedMarketplace, setSelectedMarketplace] = useState('Bunnings');
  const [baseUrl, setBaseUrl] = useState(MIRAKL_MARKETPLACES[0].baseUrl);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [sellerCompanyId, setSellerCompanyId] = useState('');

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

  const handleMarketplaceChange = (label: string) => {
    setSelectedMarketplace(label);
    const found = MIRAKL_MARKETPLACES.find(m => m.label === label);
    if (found && found.baseUrl) setBaseUrl(found.baseUrl);
  };

  const handleConnect = async () => {
    if (!baseUrl || !clientId || !clientSecret || !sellerCompanyId) {
      toast.error('Please fill in all fields');
      return;
    }
    setConnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('mirakl-auth', {
        headers: { 'x-action': 'connect' },
        body: {
          base_url: baseUrl,
          client_id: clientId,
          client_secret: clientSecret,
          seller_company_id: sellerCompanyId,
          marketplace_label: selectedMarketplace,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success('Mirakl connection saved');
      setClientId('');
      setClientSecret('');
      await checkStatus();
    } catch (err: any) {
      toast.error(`Connection failed: ${err.message}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect Mirakl? You can reconnect anytime.')) return;
    setDisconnecting(true);
    try {
      const { error } = await supabase.functions.invoke('mirakl-auth', {
        headers: { 'x-action': 'disconnect' },
        body: connection?.id ? { connection_id: connection.id } : {},
      });
      if (error) throw error;
      setConnected(false);
      setConnection(null);
      toast.success('Mirakl disconnected');
    } catch (err: any) {
      toast.error(`Disconnect failed: ${err.message}`);
    } finally {
      setDisconnecting(false);
    }
  };

  const handleFetchNow = async () => {
    setFetching(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-mirakl-settlements');
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const { imported = 0, skipped = 0, empty_skipped = 0 } = data || {};
      const parts = [];
      if (imported > 0) parts.push(`${imported} imported`);
      if (skipped > 0) parts.push(`${skipped} duplicates skipped`);
      if (empty_skipped > 0) parts.push(`${empty_skipped} empty periods skipped`);
      toast.success(parts.length > 0 ? `Done! ${parts.join(', ')}.` : 'All settlements already synced.');
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
          <p className="text-sm text-muted-foreground mt-2">Checking Mirakl connection...</p>
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
              <span className="text-lg">🔗</span>
              Mirakl API Connection
            </CardTitle>
            <CardDescription className="text-xs">
              Connect your Mirakl seller portal to auto-import settlement data.
            </CardDescription>
          </div>
          {connected ? (
            <Badge className="bg-green-100 text-green-800 gap-1">
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
                onClick={handleFetchNow}
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
            <div className="bg-muted/30 border border-border rounded-lg p-3 text-sm text-muted-foreground">
              <p className="text-xs">
                Enter your Mirakl API credentials from your seller portal.
                Xettle requests <strong>read-only</strong> access to your settlement and transaction data.
              </p>
            </div>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Marketplace</Label>
                <Select value={selectedMarketplace} onValueChange={handleMarketplaceChange}>
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {MIRAKL_MARKETPLACES.map(m => (
                      <SelectItem key={m.label} value={m.label} className="text-xs">
                        {m.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {selectedMarketplace === 'Other' && (
                <div>
                  <Label className="text-xs">Base URL</Label>
                  <Input
                    placeholder="https://marketplace.example.com"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    className="font-mono text-xs h-8"
                  />
                </div>
              )}
              <div>
                <Label className="text-xs">Client ID</Label>
                <Input
                  placeholder="Your Mirakl Client ID"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                  className="font-mono text-xs h-8"
                />
              </div>
              <div>
                <Label className="text-xs">Client Secret / API Key</Label>
                <Input
                  type="password"
                  placeholder="Your Mirakl Client Secret or API Key"
                  value={clientSecret}
                  onChange={(e) => setClientSecret(e.target.value)}
                  className="font-mono text-xs h-8"
                />
              </div>
              <div>
                <Label className="text-xs">Seller Company ID</Label>
                <Input
                  placeholder="e.g. 12345"
                  value={sellerCompanyId}
                  onChange={(e) => setSellerCompanyId(e.target.value)}
                  className="font-mono text-xs h-8"
                />
              </div>
            </div>
            <Button
              size="sm"
              onClick={handleConnect}
              disabled={connecting || !baseUrl || !clientId || !clientSecret || !sellerCompanyId}
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
