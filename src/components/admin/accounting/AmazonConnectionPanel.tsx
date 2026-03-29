import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2, ExternalLink, Unplug, RefreshCw, Lock, KeyRound } from "lucide-react";
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { parseSettlementTSV, type ParserOptions } from '@/utils/settlement-parser';
import { AMAZON_REGIONS, DEFAULT_AMAZON_REGION, getAmazonRegionLabel, type AmazonRegion } from '@/constants/amazon-regions';

interface AmazonConnectionPanelProps {
  onSettlementsAutoFetched?: () => void;
  onRequestSettings?: () => void;
  isPaid?: boolean;
  gstRate?: number;
  syncCutoffDate?: string;
  onFetchStateChange?: (fetching: boolean, progress: string | null) => void;
}

export default function AmazonConnectionPanel({ onSettlementsAutoFetched, onRequestSettings, isPaid = false, gstRate = 10, syncCutoffDate, onFetchStateChange }: AmazonConnectionPanelProps) {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [connection, setConnection] = useState<any>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [fetchProgress, setFetchProgress] = useState<{ current: number; total: number; status: string } | null>(null);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [showManualToken, setShowManualToken] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [manualSellerId, setManualSellerId] = useState('');
  const [savingToken, setSavingToken] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<AmazonRegion>(DEFAULT_AMAZON_REGION);

  const checkStatus = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('amazon-auth', {
        headers: { 'x-action': 'status' },
      });
      if (!error && data) {
        setConnected(data.connected);
        setConnection(data.connection);
        if (data.connection?.updated_at) {
          setLastSync(data.connection.updated_at);
        }
        // Pre-fill seller ID from existing connection
        if (data.connection?.selling_partner_id) {
          setManualSellerId(data.connection.selling_partner_id);
        }
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

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const currentOrigin = window.location.origin;
      const redirectUri = `${currentOrigin}/amazon/callback`;

      const { data, error } = await supabase.functions.invoke('amazon-auth', {
        headers: { 'x-action': 'authorize' },
        body: {
          redirect_uri: redirectUri,
          marketplace_id: selectedRegion.marketplaceId,
          region: selectedRegion.region,
        },
      });

      if (error) throw error;
      if (data?.pending) {
        toast.error('SP-API credentials not yet configured');
        return;
      }
      if (data?.authUrl) {
        if (data.state) {
          sessionStorage.setItem('amazon_oauth_state', data.state);
        }
        window.location.href = data.authUrl;
      } else {
        throw new Error('No authorization URL returned');
      }
    } catch (err: any) {
      toast.error(`Failed to start Amazon OAuth: ${err.message}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect your Amazon account? You can reconnect anytime.')) return;
    setDisconnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('amazon-auth', {
        headers: { 'x-action': 'disconnect' },
      });
      if (error) throw error;
      setConnected(false);
      setConnection(null);
      setLastSync(null);
      toast.success('Amazon account disconnected');
    } catch (err: any) {
      toast.error(`Disconnect failed: ${err.message}`);
    } finally {
      setDisconnecting(false);
    }
  };

  const handleTestConnection = async () => {
    setFetching(true);
    onFetchStateChange?.(true, 'Testing Amazon connection...');
    try {
      const { data, error } = await supabase.functions.invoke('amazon-auth', {
        headers: { 'x-action': 'status' },
      });
      if (error) throw error;
      if (data?.connected) {
        toast.success('Amazon connection is working ✓');
      } else {
        toast.error('Amazon connection test failed — token may be expired');
      }
    } catch (err: any) {
      toast.error(`Connection test failed: ${err.message}`);
    } finally {
      setFetching(false);
      onFetchStateChange?.(false, null);
    }
  };

  const handleSaveManualToken = async () => {
    if (!manualToken.trim() || !manualSellerId.trim()) {
      toast.error('Please enter both Seller ID and Refresh Token');
      return;
    }
    setSavingToken(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('amazon_tokens')
        .upsert({
          user_id: user.id,
          selling_partner_id: manualSellerId.trim(),
          marketplace_id: selectedRegion.marketplaceId,
          region: selectedRegion.region,
          refresh_token: manualToken.trim(),
          access_token: null,
          expires_at: null,
        } as any, { onConflict: 'user_id,selling_partner_id' });

      if (error) throw error;

      toast.success('Amazon token saved successfully');
      setManualToken('');
      setShowManualToken(false);
      await checkStatus();
    } catch (err: any) {
      console.error('Amazon connection error:', err);
      let errorMessage = 'Failed to connect to Amazon. Please try again.';
      if (err?.status === 401 || err?.status === 403) {
        errorMessage = 'Connection failed: Check your SP-API credentials.';
      } else if (err?.message?.includes('timed out')) {
        errorMessage = 'Connection timed out. Check your network or try again.';
      } else if (err?.message) {
        errorMessage = `Save failed: ${err.message}`;
      }
      toast.error(errorMessage);
    } finally {
      setSavingToken(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-2">Checking Amazon connection...</p>
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
              <span className="text-lg">📦</span>
              Amazon Seller Central
            </CardTitle>
            <CardDescription className="text-xs">
              Connect your Amazon account to auto-import settlement reports via SP-API.
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
                <span className="text-muted-foreground">Seller ID:</span>
                <span className="font-mono font-medium">{connection.selling_partner_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Marketplace:</span>
                <span className="font-mono">{getAmazonRegionLabel(connection.marketplace_id)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Region:</span>
                <span className="font-mono uppercase">{connection.region}</span>
              </div>
              {lastSync && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Last sync:</span>
                  <span className="text-xs">{new Date(lastSync).toLocaleString()}</span>
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleTestConnection}
                  disabled={fetching}
                  className="gap-1.5"
                >
                  {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                  {fetching ? 'Testing...' : 'Test Connection'}
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
          </div>
        ) : !isPaid ? (
          <div className="space-y-3">
            <div className="bg-muted/30 border border-border rounded-lg p-3 text-sm text-muted-foreground flex items-start gap-2">
              <Lock className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-foreground">Starter Plan Feature</p>
                <p className="text-xs mt-0.5">
                  Auto-import settlement reports directly from Amazon Seller Central. Upgrade to Starter ($129/yr) or Pro ($229/yr) to unlock.
                </p>
              </div>
            </div>
            <Button size="sm" disabled className="gap-1.5 opacity-60">
              <ExternalLink className="h-3.5 w-3.5" />
              Connect Amazon (Paid Plan)
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="bg-muted/30 border border-border rounded-lg p-3 text-sm text-muted-foreground">
              <p className="text-xs">
                Connect your Seller Central account to auto-import settlement reports — no more manual CSV downloads.
                Xettle requests <strong>read-only</strong> access to your Finance & Accounting data.
              </p>
            </div>
            {/* Region selector */}
            <div>
              <Label className="text-xs">Amazon Marketplace</Label>
              <Select
                value={selectedRegion.marketplaceId}
                onValueChange={(val) => {
                  const region = AMAZON_REGIONS.find(r => r.marketplaceId === val);
                  if (region) setSelectedRegion(region);
                }}
              >
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AMAZON_REGIONS.map((r) => (
                    <SelectItem key={r.marketplaceId} value={r.marketplaceId} className="text-xs">
                      {r.flag} {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleConnect}
                disabled={connecting}
                className="gap-1.5"
              >
                {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
                {connecting ? 'Redirecting...' : 'Connect Amazon'}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowManualToken(!showManualToken)}
                className="gap-1.5"
              >
                <KeyRound className="h-3.5 w-3.5" />
                Manual Token
              </Button>
            </div>
            {showManualToken && (
              <div className="border border-border rounded-lg p-4 space-y-3 bg-muted/20">
                <p className="text-xs text-muted-foreground font-medium">
                  Paste a refresh token from the SP-API Solution Provider Portal to connect without OAuth.
                </p>
                <div className="space-y-2">
                  <div>
                    <Label htmlFor="seller-id" className="text-xs">Selling Partner ID</Label>
                    <Input
                      id="seller-id"
                      placeholder="e.g. A1B2C3D4E5F6G7"
                      value={manualSellerId}
                      onChange={(e) => setManualSellerId(e.target.value)}
                      className="font-mono text-xs h-8"
                    />
                  </div>
                  <div>
                    <Label htmlFor="refresh-token" className="text-xs">Refresh Token</Label>
                    <Input
                      id="refresh-token"
                      type="password"
                      placeholder="Atzr|..."
                      value={manualToken}
                      onChange={(e) => setManualToken(e.target.value)}
                      className="font-mono text-xs h-8"
                    />
                  </div>
                </div>
                <Button
                  size="sm"
                  onClick={handleSaveManualToken}
                  disabled={savingToken || !manualToken.trim() || !manualSellerId.trim()}
                  className="gap-1.5"
                >
                  {savingToken ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  Save & Connect
                </Button>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground">
              OAuth redirects to Amazon to authorize. Manual token is for testing with SP-API portal credentials.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}