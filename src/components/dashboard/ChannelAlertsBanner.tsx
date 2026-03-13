/**
 * ChannelAlertsBanner — Shows pending channel alerts on the Dashboard.
 * Supports three alert types: 'new' (brand new channel), 'unlinked' (marketplace exists, not linked),
 * and 'already_linked' (skipped entirely by scanner).
 */

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Search, X, ArrowRight, ChevronDown, ChevronUp, RefreshCw, ExternalLink, Tag, Link as LinkIcon, Banknote, Eye, Calendar, FileText, TrendingUp } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import SubChannelSetupModal from '@/components/shopify/SubChannelSetupModal';
import GatewayDepositEvidence from '@/components/dashboard/GatewayDepositEvidence';
import ContactClassificationModal from '@/components/dashboard/ContactClassificationModal';
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
  alert_type?: string; // 'new' | 'unlinked' | 'already_linked' | 'unmatched_deposit' | 'unknown_deposit' | 'payment_gateway_deposit'
  deposit_amount?: number | null;
  deposit_date?: string | null;
  deposit_description?: string | null;
  match_confidence?: number | null;
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

/** Known marketplace label-to-code mappings (mirrors edge function) */
const LABEL_TO_CODE: Record<string, string> = {
  mydeal: 'mydeal',
  'my deal': 'mydeal',
  bunnings: 'bunnings',
  kogan: 'kogan',
  'big w': 'bigw',
  bigw: 'bigw',
  'everyday market': 'everyday_market',
  catch: 'catch',
  ebay: 'ebay',
  'tiktok shop': 'tiktok_shop',
  amazon: 'amazon_au',
};

function resolveMarketplaceCode(label: string | null, sourceName: string): string | null {
  if (label) {
    const code = LABEL_TO_CODE[label.toLowerCase().trim()];
    if (code) return code;
  }
  const code = LABEL_TO_CODE[sourceName.toLowerCase().trim()];
  if (code) return code;
  return null;
}

const MARKETPLACE_CODE_ALIASES: Record<string, string[]> = {
  everyday_market: ['woolworths'],
  woolworths: ['everyday_market'],
  ebay: ['ebay_au'],
  ebay_au: ['ebay'],
};

function expandMarketplaceCodes(codes: string[]): Set<string> {
  const expanded = new Set<string>();
  for (const code of codes) {
    const normalized = (code || '').toLowerCase().trim();
    if (!normalized) continue;
    expanded.add(normalized);
    for (const alias of MARKETPLACE_CODE_ALIASES[normalized] || []) {
      expanded.add(alias);
    }
  }
  return expanded;
}

function isXeroContactOnlyAlert(alert: Pick<ChannelAlert, 'detection_method' | 'order_count'>): boolean {
  return (alert.detection_method === 'xero_contact_standalone' || alert.detection_method === 'xero_contact')
    && (alert.order_count === 0 || alert.order_count === null);
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
  const [scanAlreadyTriggered, setScanAlreadyTriggered] = useState(false);
  const [syncDismissed, setSyncDismissed] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [shopDomain, setShopDomain] = useState<string | null>(null);
  const [autoRefreshCount, setAutoRefreshCount] = useState(0);
  const [namingAlertId, setNamingAlertId] = useState<string | null>(null);
  const [customName, setCustomName] = useState('');
  const [linkingAlertId, setLinkingAlertId] = useState<string | null>(null);
  const [expandedAlertId, setExpandedAlertId] = useState<string | null>(null);
  const [classifyingAlert, setClassifyingAlert] = useState<ChannelAlert | null>(null);

  /** Count only genuinely actionable alerts for badge display */
  const getActionableCount = (alertList: ChannelAlert[], excludeId?: string) => {
    return alertList.filter(a => {
      if (excludeId && a.id === excludeId) return false;
      // Exclude unclassified Xero contacts (info-only)
      if (isXeroContactOnlyAlert(a)) return false;
      // Exclude payment gateway deposits
      if (a.alert_type === 'payment_gateway_deposit') return false;
      // Exclude micro-deposits under $5 (gateway noise)
      if (a.alert_type === 'unmatched_deposit' && a.deposit_amount != null && Math.abs(a.deposit_amount) < 5) return false;
      return true;
    }).length;
  };

  const loadAlerts = async () => {
    try {
      const [processorRes, connectionsRes, settlementsRes, fingerprintRes, subChannelsRes] = await Promise.all([
        supabase.from('payment_processor_registry').select('processor_code, processor_name, detection_keywords'),
        supabase.from('marketplace_connections').select('marketplace_code').eq('connection_status', 'active'),
        supabase.from('settlements').select('marketplace').not('marketplace', 'is', null),
        supabase.from('marketplace_file_fingerprints').select('marketplace_code'),
        supabase.from('shopify_sub_channels').select('marketplace_code').eq('ignored', false).not('marketplace_code', 'is', null),
      ]);

      const processorData = processorRes.data || [];

      const gatewayKeywords = new Set<string>();
      for (const p of processorData) {
        gatewayKeywords.add((p.processor_name || '').toLowerCase());
        for (const kw of (p.detection_keywords as string[] || [])) {
          gatewayKeywords.add(kw.toLowerCase());
        }
      }

      const configuredCodes = expandMarketplaceCodes([
        ...(connectionsRes.data || []).map((c: any) => c.marketplace_code),
        ...(settlementsRes.data || []).map((s: any) => s.marketplace),
        ...(fingerprintRes.data || []).map((f: any) => f.marketplace_code),
        ...(subChannelsRes.data || []).map((s: any) => s.marketplace_code),
      ]);

      const { data, error } = await supabase
        .from('channel_alerts' as any)
        .select('*')
        .eq('status', 'pending')
        .neq('alert_type', 'unknown_deposit')  // Never show raw unmatched bank transactions
        .order('order_count', { ascending: false });

      if (error) throw error;
      const rawAlerts = ((data || []) as any[]).map((a: any) => ({
        ...a,
        candidate_tags: typeof a.candidate_tags === 'string'
          ? JSON.parse(a.candidate_tags)
          : a.candidate_tags || [],
      })) as ChannelAlert[];

      // Auto-resolve stale Xero contact alerts for marketplaces already configured by user
      const staleConfiguredXeroAlerts = rawAlerts.filter(a =>
        isXeroContactOnlyAlert(a) && configuredCodes.has((a.source_name || '').toLowerCase().trim())
      );

      if (staleConfiguredXeroAlerts.length > 0) {
        const staleIds = staleConfiguredXeroAlerts.map(a => a.id);
        await supabase
          .from('channel_alerts' as any)
          .update({ status: 'auto_resolved_existing_marketplace', actioned_at: new Date().toISOString() } as any)
          .in('id', staleIds as any)
          .eq('status', 'pending');
      }

      const scopedAlerts = rawAlerts.filter(a => !staleConfiguredXeroAlerts.some(s => s.id === a.id));

      // Auto-reclassify gateway contacts as payment_gateway_deposit alerts
      const alertsData: ChannelAlert[] = [];
      for (const a of scopedAlerts) {
        const name = (a.source_name || '').toLowerCase();
        const label = (a.detected_label || '').toLowerCase();
        const isGateway = gatewayKeywords.has(name) || gatewayKeywords.has(label) ||
          [...gatewayKeywords].some(kw => name.includes(kw) || label.includes(kw));
        if (isGateway && a.alert_type !== 'payment_gateway_deposit') {
          // Auto-dismiss gateway contacts silently
          await supabase
            .from('channel_alerts' as any)
            .update({ status: 'auto_classified_gateway', actioned_at: new Date().toISOString() } as any)
            .eq('id', a.id);
          continue;
        }
        alertsData.push(a);
      }

      setAlerts(alertsData);
      // Badge count: only genuinely actionable items
      onAlertCountChange?.(getActionableCount(alertsData));

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
            // Check if scan was already triggered during onboarding
            const { data: flagRow } = await supabase
              .from('app_settings')
              .select('value')
              .eq('key', 'shopify_channel_scan_triggered')
              .maybeSingle();

            if (flagRow?.value === 'true') {
              setScanAlreadyTriggered(true);
            }
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

  // Auto-refresh when scan was triggered during onboarding but orders haven't arrived yet
  useEffect(() => {
    if (!scanAlreadyTriggered || !needsInitialSync || autoRefreshCount >= 4) return;
    const timer = setTimeout(async () => {
      await loadAlerts();
      setAutoRefreshCount(prev => prev + 1);
    }, 15000); // retry every 15s, up to 4 times (1 minute)
    return () => clearTimeout(timer);
  }, [scanAlreadyTriggered, needsInitialSync, autoRefreshCount]);

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
        body: { shopDomain: tokenRow.shop_domain, channelDetectionOnly: true },
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
    onAlertCountChange?.(getActionableCount(alerts, alert.id));
    toast.info(`"${getDisplayName(alert)}" ignored — you can re-enable in Settings.`);
  };

  /** Mark a gateway deposit as "included in Shopify payout" — confirmed by bookkeeper */
  const handleConfirmGatewayIncluded = async (alert: ChannelAlert) => {
    await supabase
      .from('channel_alerts' as any)
      .update({
        status: 'confirmed_included',
        actioned_at: new Date().toISOString(),
      } as any)
      .eq('id', alert.id);

    setAlerts(prev => prev.filter(a => a.id !== alert.id));
    onAlertCountChange?.(getActionableCount(alerts, alert.id));
    toast.success(`${getDisplayName(alert)} deposit confirmed as included in your Shopify Payments payout.`);
  };

  const handleSetup = (alert: ChannelAlert) => {
    const hasDetectedLabel = !!alert.detected_label;

    // Resolve detected_label to a marketplace code for auto-selection
    const resolvedCode = hasDetectedLabel
      ? resolveMarketplaceCode(alert.detected_label, alert.source_name)
      : undefined;

    setSetupChannel({
      source_name: alert.source_name,
      order_count: alert.order_count,
      total_revenue: alert.total_revenue,
      sample_order_names: [],
      is_new: true,
      ...(hasDetectedLabel ? { suggested_label: alert.detected_label } : {}),
      ...(resolvedCode ? { suggested_code: resolvedCode } : {}),
      ...(isNumericChannelId(alert.source_name) ? { is_numeric_id: true } : {}),
      candidate_tags: alert.candidate_tags || [],
      detection_method: alert.detection_method || undefined,
    });
  };

  /** Link an unlinked channel — creates sub_channel record, marks alert actioned */
  const handleLinkNow = async (alert: ChannelAlert) => {
    setLinkingAlertId(alert.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { toast.error('Please log in first.'); return; }

      const displayName = getDisplayName(alert);
      const marketplaceCode = resolveMarketplaceCode(alert.detected_label, alert.source_name);

      // Create shopify_sub_channels record
      await supabase.from('shopify_sub_channels' as any).upsert({
        user_id: user.id,
        source_name: alert.source_name,
        marketplace_label: displayName,
        marketplace_code: marketplaceCode,
        settlement_type: 'separate_file',
        ignored: false,
        order_count: alert.order_count,
        total_revenue: alert.total_revenue,
      } as any, { onConflict: 'user_id,source_name' } as any);

      // Mark alert as actioned
      await supabase
        .from('channel_alerts' as any)
        .update({ status: 'actioned', actioned_at: new Date().toISOString() } as any)
        .eq('id', alert.id);

      setAlerts(prev => prev.filter(a => a.id !== alert.id));
      onAlertCountChange?.(getActionableCount(alerts, alert.id));
      toast.success(`${displayName} orders are now linked to your ${displayName} settlements. Cross-reference reconciliation is enabled.`);
    } catch (err: any) {
      toast.error(`Failed to link: ${err.message || 'Unknown error'}`);
    } finally {
      setLinkingAlertId(null);
    }
  };

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
      onAlertCountChange?.(getActionableCount(alerts.filter(a => a.source_name !== setupChannel.source_name)));
    }
    setSetupChannel(null);
  };

  if (loading) return null;

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(amount);

  const shopHandle = shopDomain?.replace('.myshopify.com', '') || '';

  // Show "needs initial sync" prompt
  if (needsInitialSync && !syncDismissed && alerts.length === 0) {
    // If scan was already triggered during onboarding, show "still syncing" message
    if (scanAlreadyTriggered) {
      return (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="flex items-center gap-3 p-4">
            <RefreshCw className="h-5 w-5 text-primary shrink-0 animate-spin" />
            <div className="flex-1 text-sm">
              <p className="font-medium text-foreground">
                Channel scan in progress — orders are still syncing
              </p>
              <p className="text-muted-foreground mt-0.5">
                This usually takes 30–60 seconds. We'll detect your sales channels automatically.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => { loadAlerts(); }} className="gap-1 shrink-0">
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </CardContent>
        </Card>
      );
    }

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
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button size="sm" variant="ghost" onClick={handleRescan} disabled={syncing} className="gap-1.5 text-xs text-muted-foreground">
                {syncing ? <RefreshCw className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                {syncing ? 'Refreshing...' : 'Refresh feeds'}
              </Button>
            </TooltipTrigger>
            <TooltipContent className="text-xs">Checks Shopify/Amazon/Xero connections and updates statuses</TooltipContent>
          </Tooltip>
        </TooltipProvider>
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
              {alerts.length} sales channel alert{alerts.length !== 1 ? 's' : ''} in Shopify
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
      <div className="space-y-3">
        <div className="flex justify-end gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="ghost" onClick={handleRescan} disabled={syncing} className="gap-1 text-xs text-muted-foreground">
                  {syncing ? <RefreshCw className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                   {syncing ? 'Refreshing...' : 'Refresh feeds'}
                </Button>
              </TooltipTrigger>
              <TooltipContent className="text-xs">Checks Shopify/Amazon/Xero connections and updates statuses</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* ─── Group alerts by type ─── */}
        {(() => {
          const unlinkedAlerts = alerts.filter(a => a.alert_type === 'unlinked');
          const xeroContactAlerts = alerts.filter(a => isXeroContactOnlyAlert(a));
          const depositAlerts = alerts.filter(a => a.alert_type === 'unmatched_deposit' || a.alert_type === 'unknown_deposit' || a.alert_type === 'payment_gateway_deposit');
          const newChannelAlerts = alerts.filter(a => {
            if (a.alert_type === 'unlinked') return false;
            if (a.alert_type === 'unmatched_deposit' || a.alert_type === 'unknown_deposit' || a.alert_type === 'payment_gateway_deposit') return false;
            if (isXeroContactOnlyAlert(a)) return false;
            return true;
          });

          return (
            <>
              {/* ─── Section 1: Marketplace Connections (unlinked + new channels) ─── */}
              {(unlinkedAlerts.length > 0 || newChannelAlerts.length > 0) && (
                <AlertSection
                  icon={<LinkIcon className="h-4 w-4 text-primary" />}
                  title="Link Shopify orders to marketplaces"
                  count={unlinkedAlerts.length + newChannelAlerts.length}
                  defaultOpen={true}
                >
                  <div className="space-y-2">
                    {unlinkedAlerts.map(alert => {
                      const displayName = getDisplayName(alert);
                      const isLinking = linkingAlertId === alert.id;
                      return (
                        <div key={alert.id} className="flex items-center justify-between py-2 px-1 border-b border-border/30 last:border-0">
                          <div className="flex-1 text-sm">
                            <span className="font-medium text-foreground">{displayName}</span>
                            <span className="text-muted-foreground ml-2">
                              {alert.order_count} order{alert.order_count !== 1 ? 's' : ''} · {formatCurrency(alert.total_revenue)}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Button size="sm" variant="ghost" onClick={() => handleIgnore(alert)} className="h-7 px-2 text-xs text-muted-foreground">
                              Not now
                            </Button>
                            <Button size="sm" onClick={() => handleLinkNow(alert)} disabled={isLinking} className="h-7 gap-1 text-xs">
                              {isLinking ? <><RefreshCw className="h-3 w-3 animate-spin" /> Linking...</> : <>Link now <ArrowRight className="h-3 w-3" /></>}
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                    {newChannelAlerts.map(alert => {
                      const displayName = getDisplayName(alert);
                      const isUnknown = alert.detection_method === 'unknown' || (!alert.detected_label && isNumericChannelId(alert.source_name));
                      const isNaming = namingAlertId === alert.id;
                      return (
                        <div key={alert.id} className="py-2 px-1 border-b border-border/30 last:border-0 space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="flex-1 text-sm">
                              <span className="font-medium text-foreground">🔍 {displayName}</span>
                              <span className="text-muted-foreground ml-2">
                                {alert.order_count} order{alert.order_count !== 1 ? 's' : ''} · {formatCurrency(alert.total_revenue)}
                              </span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {isUnknown && !isNaming && (
                                <Button size="sm" variant="outline" onClick={() => { setNamingAlertId(alert.id); setCustomName(''); }} className="h-7 text-xs">Name it</Button>
                              )}
                              <Button size="sm" variant="ghost" onClick={() => handleIgnore(alert)} className="h-7 px-2 text-xs text-muted-foreground">
                                <X className="h-3 w-3" />
                              </Button>
                              <Button size="sm" onClick={() => handleSetup(alert)} className="h-7 gap-1 text-xs">
                                Set up <ArrowRight className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                          {isNaming && (
                            <div className="flex items-center gap-2 ml-4">
                              <Input value={customName} onChange={e => setCustomName(e.target.value)} placeholder="e.g. Kogan, Big W" className="h-7 text-sm max-w-xs" onKeyDown={e => e.key === 'Enter' && handleNameChannel(alert)} autoFocus />
                              <Button size="sm" onClick={() => handleNameChannel(alert)} disabled={!customName.trim()} className="h-7 text-xs">Save</Button>
                              <Button size="sm" variant="ghost" onClick={() => setNamingAlertId(null)} className="h-7 text-xs">Cancel</Button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </AlertSection>
              )}

              {/* ─── Section 2: Accounting Classification ─── */}
              {xeroContactAlerts.length > 0 && (
                <AlertSection
                  icon={<Search className="h-4 w-4 text-muted-foreground" />}
                  title="Xero contacts requiring classification"
                  count={xeroContactAlerts.length}
                  defaultOpen={false}
                >
                  <div className="space-y-1">
                    {xeroContactAlerts.map(alert => {
                      const displayName = getDisplayName(alert);
                      return (
                        <div key={alert.id} className="flex items-center justify-between py-2 px-1 border-b border-border/30 last:border-0">
                          <div className="text-sm">
                            <span className="font-medium text-foreground">{displayName}</span>
                            <span className="text-muted-foreground ml-2 text-xs">Found in Xero · no matching orders</span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Button size="sm" variant="outline" onClick={() => setClassifyingAlert(alert)} className="h-7 text-xs gap-1">
                              Classify
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => {
                              setSetupChannel({
                                source_name: alert.source_name,
                                order_count: alert.order_count || 0,
                                total_revenue: alert.total_revenue || 0,
                                sample_order_names: [],
                                is_new: true,
                              });
                            }} className="h-7 text-xs">
                              Set up as marketplace
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </AlertSection>
              )}

              {/* ─── Section 3: Deposit Detection ─── */}
              {depositAlerts.length > 0 && (
                <AlertSection
                  icon={<Banknote className="h-4 w-4 text-primary" />}
                  title="Bank deposits found — set up marketplaces to reconcile"
                  count={depositAlerts.length}
                  defaultOpen={false}
                >
                  <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
                    We found payments in your bank feed that match known marketplace patterns. 
                    To track and reconcile these, set up each marketplace below — this lets Xettle match 
                    settlement files to bank deposits and push accurate entries to Xero.
                  </p>
                  <div className="space-y-2">
                    {depositAlerts.map(alert => {
                      const displayName = getDisplayName(alert);
                      const isGatewayDeposit = alert.alert_type === 'payment_gateway_deposit';

                      if (isGatewayDeposit) {
                        return (
                          <GatewayDepositEvidence
                            key={alert.id}
                            alertId={alert.id}
                            gatewayName={displayName}
                            depositAmount={alert.deposit_amount || alert.total_revenue}
                            depositDate={alert.deposit_date || null}
                            depositDescription={alert.deposit_description || null}
                            matchConfidence={alert.match_confidence || null}
                            onDismiss={() => handleIgnore(alert)}
                            onConfirmIncluded={() => handleConfirmGatewayIncluded(alert)}
                            formatCurrency={formatCurrency}
                          />
                        );
                      }

                      const depositAmt = alert.deposit_amount
                        ? formatCurrency(alert.deposit_amount)
                        : formatCurrency(alert.total_revenue);
                      const depositDate = alert.deposit_date
                        ? new Date(alert.deposit_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
                        : null;

                      return (
                        <div key={alert.id} className="flex items-center justify-between py-2 px-1 border-b border-border/30 last:border-0">
                          <div className="text-sm">
                            <span className="font-medium text-foreground">{displayName} deposit</span>
                            <span className="text-muted-foreground ml-2">
                              {depositAmt}{depositDate ? ` on ${depositDate}` : ''}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Button size="sm" variant="outline" onClick={() => handleIgnore(alert)} className="h-7 text-xs">
                              Not now
                            </Button>
                            <Button size="sm" onClick={() => handleSetup(alert)} className="h-7 gap-1 text-xs">
                              Set up {displayName} <ArrowRight className="h-3 w-3" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </AlertSection>
              )}
            </>
          );
        })()}
      </div>

      {setupChannel && (
        <SubChannelSetupModal
          channel={setupChannel}
          open={!!setupChannel}
          onClose={() => setSetupChannel(null)}
          onComplete={handleSetupComplete}
        />
      )}

      {classifyingAlert && (
        <ContactClassificationModal
          open={!!classifyingAlert}
          onClose={() => setClassifyingAlert(null)}
          contactName={getDisplayName(classifyingAlert)}
          alertId={classifyingAlert.id}
          onClassified={async (alertId) => {
            await supabase
              .from('channel_alerts' as any)
              .update({ status: 'classified', actioned_at: new Date().toISOString() } as any)
              .eq('id', alertId);
            setAlerts(prev => prev.filter(a => a.id !== alertId));
            onAlertCountChange?.(getActionableCount(alerts, alertId));
            setClassifyingAlert(null);
          }}
        />
      )}
    </>
  );
}

// ─── Grouped alert section with collapsible ─────────────────────────
function AlertSection({
  icon,
  title,
  count,
  defaultOpen,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  defaultOpen: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card className="border-border">
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger asChild>
          <button className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/30 transition-colors">
            {icon}
            <span className="text-sm font-semibold text-foreground flex-1">{title}</span>
            <Badge variant="secondary" className="text-xs">{count}</Badge>
            {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-4 pb-3">
            {children}
          </div>
        </CollapsibleContent>
      </Collapsible>
    </Card>
  );
}
