/**
 * ChannelAlertsBanner — Shows pending channel alerts on the Dashboard.
 * Queries channel_alerts where status = 'pending' and shows actionable banners.
 * If shopify_orders is empty, shows a one-time "Sync now" prompt.
 */

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Search, X, ArrowRight, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import SubChannelSetupModal from '@/components/shopify/SubChannelSetupModal';
import type { DetectedSubChannel } from '@/utils/sub-channel-detection';
import { toast } from 'sonner';

interface ChannelAlert {
  id: string;
  source_name: string;
  order_count: number;
  total_revenue: number;
  status: string;
  first_seen_at: string;
}

interface ChannelAlertsBannerProps {
  onAlertCountChange?: (count: number) => void;
}

export default function ChannelAlertsBanner({ onAlertCountChange }: ChannelAlertsBannerProps) {
  const [alerts, setAlerts] = useState<ChannelAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [setupChannel, setSetupChannel] = useState<DetectedSubChannel | null>(null);
  const [needsInitialSync, setNeedsInitialSync] = useState(false);
  const [syncDismissed, setSyncDismissed] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadAlerts = async () => {
    try {
      const { data, error } = await supabase
        .from('channel_alerts' as any)
        .select('*')
        .eq('status', 'pending')
        .order('order_count', { ascending: false });

      if (error) throw error;
      const alertsData = (data || []) as unknown as ChannelAlert[];
      setAlerts(alertsData);
      onAlertCountChange?.(alertsData.length);

      // If no alerts, check if shopify_orders is empty (needs initial sync)
      if (alertsData.length === 0) {
        // Check if user has a Shopify token
        const { data: tokens } = await supabase
          .from('shopify_tokens')
          .select('id')
          .limit(1);

        if (tokens && tokens.length > 0) {
          // Has Shopify connected — check if orders table is populated
          const { count } = await supabase
            .from('shopify_orders' as any)
            .select('id', { count: 'exact', head: true }) as any;

          if (count === 0 || count === null) {
            setNeedsInitialSync(true);
          }
        }
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAlerts();
  }, []);

  const handleSyncNow = async () => {
    setSyncing(true);
    try {
      // Get user's Shopify token to find shop domain
      const { data: tokenRow } = await supabase
        .from('shopify_tokens')
        .select('shop_domain')
        .limit(1)
        .maybeSingle();

      if (!tokenRow?.shop_domain) {
        toast.error('No Shopify store connected.');
        return;
      }

      const { data: session } = await supabase.auth.getSession();
      if (!session?.session?.access_token) {
        toast.error('Please log in first.');
        return;
      }

      toast.info('Syncing Shopify orders — this may take a moment...');

      const { data, error } = await supabase.functions.invoke('fetch-shopify-orders', {
        body: { shopDomain: tokenRow.shop_domain },
      });

      console.log('[ChannelAlertsBanner] fetch-shopify-orders response:', { data, error });
      if (error) throw error;
      if (data?.error) throw new Error(data.error + (data.detail ? `: ${data.detail}` : ''));

      toast.success(`Synced ${data?.count || 0} orders. Scanning for channels...`);
      setNeedsInitialSync(false);

      // Now trigger a channel scan
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.functions.invoke('scan-shopify-channels', {
          body: { userId: user.id },
        });
      }

      // Reload alerts
      await loadAlerts();
    } catch (err: any) {
      toast.error(`Sync failed: ${err.message || 'Unknown error'}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleIgnore = async (alert: ChannelAlert) => {
    await supabase
      .from('channel_alerts' as any)
      .update({ status: 'ignored', actioned_at: new Date().toISOString() } as any)
      .eq('id', alert.id);

    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('shopify_sub_channels' as any).upsert({
        user_id: user.id,
        source_name: alert.source_name,
        marketplace_label: alert.source_name,
        settlement_type: 'shopify_payments',
        ignored: true,
      } as any, { onConflict: 'user_id,source_name' } as any);
    }

    setAlerts(prev => prev.filter(a => a.id !== alert.id));
    onAlertCountChange?.(alerts.length - 1);
    toast.info(`"${alert.source_name}" ignored — you can re-enable in Settings.`);
  };

  const handleSetup = (alert: ChannelAlert) => {
    setSetupChannel({
      source_name: alert.source_name,
      order_count: alert.order_count,
      total_revenue: alert.total_revenue,
      sample_order_names: [],
      is_new: true,
    });
  };

  const handleSetupComplete = async () => {
    if (setupChannel) {
      await supabase
        .from('channel_alerts' as any)
        .update({ status: 'actioned', actioned_at: new Date().toISOString() } as any)
        .eq('source_name', setupChannel.source_name);

      setAlerts(prev => prev.filter(a => a.source_name !== setupChannel.source_name));
      onAlertCountChange?.(alerts.length - 1);
    }
    setSetupChannel(null);
  };

  if (loading) return null;

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(amount);

  // Show "needs initial sync" prompt
  if (needsInitialSync && !syncDismissed && alerts.length === 0) {
    return (
      <Card className="border-primary/30 bg-primary/5">
        <CardContent className="flex items-center gap-3 p-4">
          <Search className="h-5 w-5 text-primary shrink-0" />
          <div className="flex-1 text-sm">
            <p className="font-medium text-foreground">
              🔍 To detect sales channels, sync your Shopify orders once.
            </p>
            <p className="text-muted-foreground mt-0.5">
              We'll scan for eBay, TikTok Shop, Facebook, and other channels automatically.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" variant="ghost" onClick={() => setSyncDismissed(true)}>
              <X className="h-3.5 w-3.5" />
            </Button>
            <Button size="sm" onClick={handleSyncNow} disabled={syncing} className="gap-1">
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing...' : 'Sync now'}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (alerts.length === 0) return null;

  // Collapsed view when 3+ alerts
  if (alerts.length >= 3 && !expanded) {
    return (
      <Card className="border-amber-500/30 bg-amber-500/5">
        <CardContent className="flex items-center justify-between p-4">
          <div className="flex items-center gap-3">
            <Search className="h-5 w-5 text-amber-600" />
            <p className="text-sm font-medium">
              {alerts.length} new sales channels detected in Shopify
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setExpanded(true)} className="gap-1">
            Review now <ChevronDown className="h-3.5 w-3.5" />
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {alerts.length >= 3 && (
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => setExpanded(false)} className="gap-1 text-xs">
              Collapse <ChevronUp className="h-3 w-3" />
            </Button>
          </div>
        )}
        {alerts.map(alert => (
          <Card key={alert.id} className="border-amber-500/30 bg-amber-500/5">
            <CardContent className="flex items-center gap-3 p-4">
              <Search className="h-5 w-5 text-amber-600 shrink-0" />
              <div className="flex-1 text-sm">
                <p className="font-medium text-foreground">
                  🔍 New sales channel detected in Shopify:{' '}
                  <span className="font-semibold">{alert.source_name}</span>
                </p>
                <p className="text-muted-foreground mt-0.5">
                  {alert.order_count} order{alert.order_count !== 1 ? 's' : ''} totalling{' '}
                  {formatCurrency(alert.total_revenue)}.
                  Set up tracking to see this in your settlements and reports.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button size="sm" variant="outline" onClick={() => handleIgnore(alert)} className="gap-1">
                  <X className="h-3.5 w-3.5" /> Ignore
                </Button>
                <Button size="sm" onClick={() => handleSetup(alert)} className="gap-1">
                  Set up tracking <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {setupChannel && (
        <SubChannelSetupModal
          channel={setupChannel}
          open={!!setupChannel}
          onClose={() => setSetupChannel(null)}
          onComplete={handleSetupComplete}
        />
      )}
    </>
  );
}
