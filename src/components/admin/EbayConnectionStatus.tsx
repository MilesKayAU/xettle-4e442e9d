import React, { useState, useEffect, useCallback } from 'react';
import { logger } from '@/utils/logger';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2, ExternalLink, Unplug } from "lucide-react";
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { upsertMarketplaceConnection } from '@/utils/marketplace-connections';
import { useAuth } from '@/contexts/AuthContext';

export default function EbayConnectionStatus() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [connection, setConnection] = useState<any>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const checkStatus = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('ebay-auth', {
        headers: { 'x-action': 'status' },
      });
      if (!error && data) {
        setConnected(data.connected);
        setConnection(data.connection || null);

        // Ensure marketplace_connections row exists via universal helper
        if (data.connected) {
          const { data: { user } } = await supabase.auth.getUser();
          if (user) {
            await upsertMarketplaceConnection({
              userId: user.id,
              marketplaceCode: 'ebay_au',
              marketplaceName: 'eBay Australia',
              connectionType: 'ebay_api',
              connectionStatus: 'active',
              countryCode: 'AU',
            });
        }
      }
    } catch (err) {
      console.warn('[EbayConnectionStatus] status check failed:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    checkStatus();

    // Auto-refresh after returning from eBay callback
    const params = new URLSearchParams(window.location.search);
    if (params.get('connected') === 'ebay') {
      checkStatus();
    }
  }, [checkStatus]);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      logger.debug('[eBay OAuth] Requesting authorize URL...');
      const { data, error } = await supabase.functions.invoke('ebay-auth', {
        headers: { 'x-action': 'authorize' },
      });

      if (error) throw error;
      if (data?.pending) {
        toast.error('eBay API credentials not yet configured');
        return;
      }

      if (data?.authUrl) {
        logger.debug('[eBay OAuth] Opening eBay login in new window...');
        if (data.state) {
          sessionStorage.setItem('ebay_oauth_state', data.state);
        }
        const popup = window.open(data.authUrl, 'ebay_oauth', 'width=600,height=700,scrollbars=yes');
        if (!popup) {
          toast.error('Popup blocked — please allow popups for this site and try again.');
          return;
        }
        // Poll for popup close, then refresh status
        const pollInterval = setInterval(() => {
          if (popup.closed) {
            clearInterval(pollInterval);
            checkStatus();
          }
        }, 500);
      } else {
        throw new Error('No authorization URL returned');
      }
    } catch (err: any) {
      console.error('[eBay OAuth] Authorize failed:', err);
      toast.error(`Failed to start eBay OAuth: ${err.message}`);
    } finally {
      setConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    if (!confirm('Disconnect your eBay account? You can reconnect anytime.')) return;
    setDisconnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('ebay-auth', {
        headers: { 'x-action': 'disconnect' },
      });
      if (error) throw error;
      setConnected(false);
      setConnection(null);
      toast.success('eBay account disconnected');
    } catch (err: any) {
      toast.error(`Disconnect failed: ${err.message}`);
    } finally {
      setDisconnecting(false);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
          <p className="text-sm text-muted-foreground mt-2">Checking eBay connection...</p>
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
              <span className="text-lg">🏷️</span>
              eBay Australia
            </CardTitle>
            <CardDescription className="text-xs">
              Connect your eBay account to auto-import settlement & order data.
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
              {connection.ebay_username && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">eBay User:</span>
                  <span className="font-mono font-medium">{connection.ebay_username}</span>
                </div>
              )}
              {connection.updated_at && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Connected:</span>
                  <span className="text-xs">{new Date(connection.updated_at).toLocaleString()}</span>
                </div>
              )}
              {connection.refresh_token_expires_at && (
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Token expires:</span>
                  <span className="text-xs">{new Date(connection.refresh_token_expires_at).toLocaleDateString()}</span>
                </div>
              )}
            </div>
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
        ) : (
          <div className="space-y-3">
            <div className="bg-muted/30 border border-border rounded-lg p-3 text-sm text-muted-foreground">
              <p className="text-xs">
                Connect your eBay Australia account to sync transaction reports and settlement data.
                Xettle requests <strong>read-only</strong> access to sell.finances and sell.fulfillment scopes.
              </p>
            </div>
            <Button
              size="sm"
              onClick={handleConnect}
              disabled={connecting}
              className="gap-1.5"
            >
              {connecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ExternalLink className="h-3.5 w-3.5" />}
              {connecting ? 'Redirecting...' : 'Connect eBay'}
            </Button>
            <p className="text-[10px] text-muted-foreground">
              You'll be redirected to eBay to authorize read-only access to your seller account.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
