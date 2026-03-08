import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckCircle2, XCircle, Loader2, ExternalLink, Unplug } from "lucide-react";
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export default function AmazonConnectionPanel() {
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [connection, setConnection] = useState<any>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  useEffect(() => {
    checkStatus();
  }, []);

  const checkStatus = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('amazon-auth', {
        headers: { 'x-action': 'status' },
      });
      if (!error && data) {
        setConnected(data.connected);
        setConnection(data.connection);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      const { data, error } = await supabase.functions.invoke('amazon-auth', {
        headers: { 'x-action': 'disconnect' },
      });
      if (error) throw error;
      setConnected(false);
      setConnection(null);
      toast.success('Amazon account disconnected');
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
                <span className="font-mono">{connection.marketplace_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Region:</span>
                <span className="font-mono uppercase">{connection.region}</span>
              </div>
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
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-800">
              <p className="font-medium mb-1">⏳ Awaiting SP-API Approval</p>
              <p className="text-xs text-amber-700">
                Your Amazon Developer registration is under review. Once approved, you'll be able to connect your 
                Seller Central account here to auto-import settlement reports — no more manual CSV downloads.
              </p>
            </div>
            <Button
              disabled
              size="sm"
              className="gap-1.5 opacity-60"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Connect Amazon (Coming Soon)
            </Button>
            <p className="text-[10px] text-muted-foreground">
              This will redirect you to Amazon to authorize Xettle to access your settlement data (read-only).
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}