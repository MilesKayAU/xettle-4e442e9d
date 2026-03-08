import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2, ExternalLink, Unplug, RefreshCw, Lock, KeyRound } from "lucide-react";
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { parseSettlementTSV, type ParserOptions } from '@/utils/settlement-parser';

interface AmazonConnectionPanelProps {
  onSettlementsAutoFetched?: () => void;
  isPaid?: boolean;
  gstRate?: number;
}

export default function AmazonConnectionPanel({ onSettlementsAutoFetched, isPaid = false, gstRate = 10 }: AmazonConnectionPanelProps) {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [connection, setConnection] = useState<any>(null);
  const [disconnecting, setDisconnecting] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [lastSync, setLastSync] = useState<string | null>(null);
  const [showManualToken, setShowManualToken] = useState(false);
  const [manualToken, setManualToken] = useState('');
  const [manualSellerId, setManualSellerId] = useState('');
  const [savingToken, setSavingToken] = useState(false);

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
      // Get the OAuth URL from the edge function
      const currentOrigin = window.location.origin;
      const redirectUri = `${currentOrigin}/amazon/callback`;
      
      const { data, error } = await supabase.functions.invoke('amazon-auth', {
        headers: { 'x-action': 'authorize' },
        body: { redirect_uri: redirectUri },
      });

      if (error) throw error;
      if (data?.pending) {
        toast.error('SP-API credentials not yet configured');
        return;
      }
      if (data?.authUrl) {
        // Store state for CSRF validation
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

  const handleFetchNow = async () => {
    setFetching(true);
    try {
      const { data, error } = await supabase.functions.invoke('fetch-amazon-settlements', {
        headers: { 'x-action': 'list' },
        body: {},
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const reports = data?.reports || [];
      if (reports.length === 0) {
        toast.info('No new settlement reports found on Amazon');
        return;
      }

      toast.success(`Found ${reports.length} settlement report(s). Downloading...`);

      // Download each report (with delay to avoid rate limiting)
      let downloadedCount = 0;
      for (let i = 0; i < reports.length; i++) {
        const report = reports[i];
        if (!report.reportDocumentId) continue;
        // Wait 3 seconds between downloads to respect rate limits
        if (i > 0) await new Promise(r => setTimeout(r, 3000));
        try {
          const { data: dlData, error: dlError } = await supabase.functions.invoke('fetch-amazon-settlements', {
            headers: { 'x-action': 'download' },
            body: { reportDocumentId: report.reportDocumentId },
          });

          if (dlError || dlData?.error) {
            console.error('Failed to download report:', report.reportId, dlData?.error || dlError);
            continue;
          }

          downloadedCount++;
        } catch (dlErr) {
          console.error('Download error:', dlErr);
        }
      }

      if (downloadedCount > 0) {
        toast.success(`Downloaded ${downloadedCount} settlement report(s). They'll appear in your Upload tab for review.`);
        onSettlementsAutoFetched?.();
      }

      // Update last sync time
      setLastSync(new Date().toISOString());
    } catch (err: any) {
      toast.error(`Fetch failed: ${err.message}`);
    } finally {
      setFetching(false);
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
          marketplace_id: 'A39IBJ37TRP1C6',
          region: 'fe',
          refresh_token: manualToken.trim(),
          access_token: null,
          expires_at: null,
        } as any, { onConflict: 'user_id,selling_partner_id' });

      if (error) throw error;

      toast.success('Amazon token saved successfully');
      setManualToken('');
      setManualSellerId('');
      setShowManualToken(false);
      await checkStatus();
    } catch (err: any) {
      toast.error(`Save failed: ${err.message}`);
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
                <span className="font-mono">{connection.marketplace_id === 'A39IBJ37TRP1C6' ? 'Amazon AU' : connection.marketplace_id}</span>
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
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleFetchNow}
                disabled={fetching}
                className="gap-1.5"
              >
                {fetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                {fetching ? 'Fetching...' : 'Fetch Now'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleDisconnect}
                disabled={disconnecting}
                className="gap-1.5 text-destructive hover:text-destructive"
              >
                {disconnecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Unplug className="h-3.5 w-3.5" />}
                Disconnect
              </Button>
            </div>
          </div>
        ) : !isPaid ? (
          <div className="space-y-3">
            <div className="bg-muted/30 border border-border rounded-lg p-3 text-sm text-muted-foreground flex items-start gap-2">
              <Lock className="h-4 w-4 mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-medium text-foreground">Paid Feature</p>
                <p className="text-xs mt-0.5">
                  Auto-import settlement reports directly from Amazon Seller Central. Upgrade to a paid plan to unlock this feature.
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