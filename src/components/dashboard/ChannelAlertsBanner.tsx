/**
 * ChannelAlertsBanner — Shows pending channel alerts on the Dashboard.
 * Uses intelligent tag-based detection: detected_label, candidate_tags, detection_method.
 */

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, X, ArrowRight, ChevronDown, ChevronUp, RefreshCw, ExternalLink, Tag } from 'lucide-react';
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
  detection_method?: string;
  detected_label?: string;
  candidate_tags?: string[];
}

interface ChannelAlertsBannerProps {
  onAlertCountChange?: (count: number) => void;
}

/** Check if a source_name is a numeric Shopify channel ID */
function isNumericChannelId(name: string): boolean {
  return /^\d{6,}$/.test(name.trim());
}

const KNOWN_CONNECTOR_APPS: Record<string, string> = {
  'cedcommerce': 'Orders managed via CedCommerce — check which marketplace in your CedCommerce dashboard',
  'codisto': 'Orders managed via Codisto/Linnworks',
  'm2e pro': 'Orders managed via M2E Pro (eBay/Amazon connector)',
  'shopify markets': 'International orders via Shopify Markets',
};

function getConnectorNote(candidateTags: string[]): string | null {
  if (!candidateTags.length) return null;
  const joined = candidateTags.join(' ').toLowerCase();
  for (const [key, note] of Object.entries(KNOWN_CONNECTOR_APPS)) {
    if (joined.includes(key)) return note;
  }
  return null;
}

/** Get the best display name for an alert */
function getDisplayName(alert: ChannelAlert): string {
  if (alert.detected_label) return alert.detected_label;
  if (isNumericChannelId(alert.source_name)) return `Unknown channel (ID: ${alert.source_name})`;
  return alert.source_name.charAt(0).toUpperCase() + alert.source_name.slice(1);
}

export default function ChannelAlertsBanner({ onAlertCountChange }: ChannelAlertsBannerProps) {
  const [alerts, setAlerts] = useState<ChannelAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(true);
  const [setupChannel, setSetupChannel] = useState<DetectedSubChannel | null>(null);
  const [needsInitialSync, setNeedsInitialSync] = useState(false);
  const [syncDismissed, setSyncDismissed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [shopDomain, setShopDomain] = useState<string | null>(null);
  // For inline user-naming of unknown channels
  const [namingAlertId, setNamingAlertId] = useState<string | null>(null);
  const [customName, setCustomName] = useState('');

  const loadAlerts = async () => {
    try {
      const { data, error } = await supabase
        .from('channel_alerts' as any)
        .select('*')
        .eq('status', 'pending')
        .order('order_count', { ascending: false });

      if (error) throw error;
      const alertsData = ((data || []) as any[]).map((a: any) => ({
        ...a,
        candidate_tags: typeof a.candidate_tags === 'string'
          ? JSON.parse(a.candidate_tags)
          : a.candidate_tags || [],
      })) as ChannelAlert[];
      setAlerts(alertsData);
      onAlertCountChange?.(alertsData.length);

      if (alertsData.length === 0) {
        const { data: tokens } = await supabase
          .from('shopify_tokens')
          .select('id, shop_domain')
          .limit(1);

        if (tokens && tokens.length > 0) {
          setShopDomain(tokens[0].shop_domain);
          const { count } = await supabase
            .from('shopify_orders' as any)
            .select('id', { count: 'exact', head: true }) as any;

          if (count === 0 || count === null) {
            setNeedsInitialSync(true);
          }
        }
      } else {
        const { data: tokens } = await supabase
          .from('shopify_tokens')
          .select('shop_domain')
          .limit(1);
        if (tokens?.[0]) setShopDomain(tokens[0].shop_domain);
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

      if (error) throw error;
      if (data?.error) throw new Error(data.error + (data.detail ? `: ${data.detail}` : ''));

      toast.success(`Synced ${data?.count || 0} orders. Scanning for channels...`);
      setNeedsInitialSync(false);

      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.functions.invoke('scan-shopify-channels', {
          body: { userId: user.id },
        });
      }

      await loadAlerts();
    } catch (err: any) {
      toast.error(`Sync failed: ${err.message || 'Unknown error'}`);
    } finally {
      setSyncing(false);
    }
  };

  const handleRescan = async () => {
    setSyncing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error('Please log in first.'); return; }

      toast.info('Re-scanning channels...');
      await supabase.functions.invoke('scan-shopify-channels', {
        body: { userId: user.id },
      });

      await loadAlerts();
      toast.success('Channel scan complete.');
    } catch (err: any) {
      toast.error(`Scan failed: ${err.message || 'Unknown error'}`);
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
    toast.info(`"${getDisplayName(alert)}" ignored — you can re-enable in Settings.`);
  };

  const handleSetup = (alert: ChannelAlert) => {
    const displayName = getDisplayName(alert);
    const hasDetectedLabel = !!alert.detected_label;

    setSetupChannel({
      source_name: alert.source_name,
      order_count: alert.order_count,
      total_revenue: alert.total_revenue,
      sample_order_names: [],
      is_new: true,
      ...(hasDetectedLabel ? { suggested_label: alert.detected_label } : {}),
      ...(isNumericChannelId(alert.source_name) ? { is_numeric_id: true } : {}),
      candidate_tags: alert.candidate_tags || [],
    });
  };

  /** User names an unknown channel inline */
  const handleNameChannel = async (alert: ChannelAlert) => {
    if (!customName.trim()) return;
    await supabase
      .from('channel_alerts' as any)
      .update({ detected_label: customName.trim() } as any)
      .eq('id', alert.id);

    setAlerts(prev => prev.map(a =>
      a.id === alert.id ? { ...a, detected_label: customName.trim() } : a
    ));
    setNamingAlertId(null);
    setCustomName('');
    toast.success(`Channel identified as "${customName.trim()}". Click "Set up tracking" to continue.`);
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

  const shopHandle = shopDomain?.replace('.myshopify.com', '') || '';

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

  if (alerts.length === 0) {
    return (
      <div className="flex items-center justify-end">
        <Button size="sm" variant="ghost" onClick={handleRescan} disabled={syncing} className="gap-1.5 text-xs text-muted-foreground">
          {syncing ? <RefreshCw className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          {syncing ? 'Rescanning...' : 'Rescan channels'}
        </Button>
      </div>
    );
  }

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
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={handleRescan} disabled={syncing} className="gap-1 text-xs text-muted-foreground">
            {syncing ? <RefreshCw className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
            {syncing ? 'Rescanning...' : 'Rescan'}
          </Button>
          {alerts.length >= 3 && (
            <Button size="sm" variant="ghost" onClick={() => setExpanded(false)} className="gap-1 text-xs">
              Collapse <ChevronUp className="h-3 w-3" />
            </Button>
          )}
        </div>
        {alerts.map(alert => {
          const displayName = getDisplayName(alert);
          const isUnknown = alert.detection_method === 'unknown' || (!alert.detected_label && isNumericChannelId(alert.source_name));
          const isTagDetected = alert.detection_method === 'tag';
          const candidateTags = alert.candidate_tags || [];
          const isNaming = namingAlertId === alert.id;

          return (
            <Card key={alert.id} className="border-amber-500/30 bg-amber-500/5">
              <CardContent className="flex flex-col gap-2 p-4">
                <div className="flex items-center gap-3">
                  <Search className="h-5 w-5 text-amber-600 shrink-0" />
                  <div className="flex-1 text-sm">
                    <p className="font-medium text-foreground">
                      🔍 New sales channel detected:{' '}
                      <span className="font-semibold">{displayName}</span>
                      {isTagDetected && (
                        <span className="ml-1.5 text-xs font-normal text-muted-foreground">(detected from order tags)</span>
                      )}
                    </p>
                    <p className="text-muted-foreground mt-0.5">
                      {alert.order_count} order{alert.order_count !== 1 ? 's' : ''} totalling{' '}
                      {formatCurrency(alert.total_revenue)}.
                      {isUnknown ? (
                        <> Can you identify this marketplace?</>
                      ) : (
                        <> Set up tracking to see this in your settlements and reports.</>
                      )}
                    </p>

                    {/* Show candidate tags for unknown channels */}
                    {isUnknown && candidateTags.length > 0 && (
                      <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                        <Tag className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="text-xs text-muted-foreground">Tags found:</span>
                        {candidateTags.slice(0, 6).map(tag => (
                          <span key={tag} className="text-xs bg-muted px-1.5 py-0.5 rounded font-medium">
                            {tag}
                          </span>
                        ))}
                        {candidateTags.length > 6 && (
                          <span className="text-xs text-muted-foreground">+{candidateTags.length - 6} more</span>
                        )}
                      </div>
                    )}

                    {/* Shopify admin link for numeric IDs */}
                    {isNumericChannelId(alert.source_name) && shopHandle && (
                      <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                        Not sure what this is?{' '}
                        <a
                          href={`https://admin.shopify.com/store/${shopHandle}/settings/sales_channels`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-primary underline inline-flex items-center gap-0.5"
                        >
                          Check your Sales Channels settings <ExternalLink className="h-3 w-3" />
                        </a>
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {isUnknown && !isNaming && (
                      <Button size="sm" variant="outline" onClick={() => { setNamingAlertId(alert.id); setCustomName(''); }} className="gap-1 text-xs">
                        Name it
                      </Button>
                    )}
                    <Button size="sm" variant="outline" onClick={() => handleIgnore(alert)} className="gap-1">
                      <X className="h-3.5 w-3.5" /> Ignore
                    </Button>
                    <Button size="sm" onClick={() => handleSetup(alert)} className="gap-1">
                      Set up tracking <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>

                {/* Inline naming input for unknown channels */}
                {isNaming && (
                  <div className="flex items-center gap-2 ml-8">
                    <Input
                      value={customName}
                      onChange={e => setCustomName(e.target.value)}
                      placeholder="e.g. Kogan, Big W, Pinduoduo"
                      className="h-8 text-sm max-w-xs"
                      onKeyDown={e => e.key === 'Enter' && handleNameChannel(alert)}
                      autoFocus
                    />
                    <Button size="sm" variant="default" onClick={() => handleNameChannel(alert)} disabled={!customName.trim()} className="h-8 text-xs">
                      Save
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setNamingAlertId(null)} className="h-8 text-xs">
                      Cancel
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
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
