/**
 * ChannelAlertsBanner — Shows pending channel alerts on the Dashboard.
 * Supports three alert types: 'new' (brand new channel), 'unlinked' (marketplace exists, not linked),
 * and 'already_linked' (skipped entirely by scanner).
 */

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
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
      const isXeroContactOnly = (a.detection_method === 'xero_contact_standalone' || a.detection_method === 'xero_contact') && (a.order_count === 0 || a.order_count === null);
      if (isXeroContactOnly) return false;
      // Exclude payment gateway deposits
      if (a.alert_type === 'payment_gateway_deposit') return false;
      // Exclude micro-deposits under $5 (gateway noise)
      if (a.alert_type === 'unmatched_deposit' && a.deposit_amount != null && Math.abs(a.deposit_amount) < 5) return false;
      return true;
    }).length;
  };

  const loadAlerts = async () => {
    try {
      // Load payment processor registry to auto-exclude gateways
      const { data: processorData } = await supabase
        .from('payment_processor_registry')
        .select('processor_code, processor_name, detection_keywords');
      const gatewayKeywords = new Set<string>();
      for (const p of (processorData || [])) {
        gatewayKeywords.add((p.processor_name || '').toLowerCase());
        for (const kw of (p.detection_keywords as string[] || [])) {
          gatewayKeywords.add(kw.toLowerCase());
        }
      }

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

      // Auto-reclassify gateway contacts as payment_gateway_deposit alerts
      const alertsData: ChannelAlert[] = [];
      for (const a of rawAlerts) {
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
      <div className="space-y-2">
        <div className="flex justify-end gap-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button size="sm" variant="ghost" onClick={handleRescan} disabled={syncing} className="gap-1 text-xs text-muted-foreground">
                  {syncing ? <RefreshCw className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                  {syncing ? 'Rescanning...' : 'Rescan'}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Re-scan your Xero and Shopify accounts for new marketplaces and deposits</TooltipContent>
            </Tooltip>
          </TooltipProvider>
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
          const connectorNote = getConnectorNote(candidateTags);
          const isNaming = namingAlertId === alert.id;
          const isUnlinked = alert.alert_type === 'unlinked';
          const isLinking = linkingAlertId === alert.id;

          const isUnmatchedDeposit = alert.alert_type === 'unmatched_deposit';
          const isUnknownDeposit = alert.alert_type === 'unknown_deposit';
          const isGatewayDeposit = alert.alert_type === 'payment_gateway_deposit';

          // ─── PAYMENT GATEWAY DEPOSIT — rich evidence card ───
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

          // ─── DEPOSIT ALERTS — curious, not alarming ───
          if (isUnmatchedDeposit || isUnknownDeposit) {
            const depositAmt = alert.deposit_amount
              ? formatCurrency(alert.deposit_amount)
              : formatCurrency(alert.total_revenue);
            const depositDate = alert.deposit_date
              ? new Date(alert.deposit_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
              : null;
            const depositDateFull = alert.deposit_date
              ? new Date(alert.deposit_date).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
              : null;
            const isDetailOpen = expandedAlertId === alert.id;

            return (
              <Card key={alert.id} className="border-primary/20 bg-primary/5">
                <CardContent className="p-0">
                  <div className="flex items-center gap-3 p-4">
                    <Banknote className="h-5 w-5 text-primary shrink-0" />
                    <div className="flex-1 text-sm">
                      {isUnmatchedDeposit ? (
                        <>
                          <p className="font-medium text-foreground">
                            💰 We spotted a possible {displayName} deposit — {depositAmt}{depositDate ? ` on ${depositDate}` : ''}
                          </p>
                          <p className="text-muted-foreground mt-0.5">
                            Upload {displayName} settlements to reconcile it.
                            {alert.match_confidence && (
                              <span className="ml-1 text-xs opacity-60">({alert.match_confidence}% confidence)</span>
                            )}
                          </p>
                        </>
                      ) : (
                        <>
                          <p className="font-medium text-foreground">
                            💰 We found a deposit we couldn't match — {depositAmt}{depositDate ? ` on ${depositDate}` : ''}
                          </p>
                          <p className="text-muted-foreground mt-0.5">
                            Is this a marketplace payment? Set up the marketplace to reconcile it.
                          </p>
                        </>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setExpandedAlertId(isDetailOpen ? null : alert.id)}
                        className="gap-1 text-xs text-muted-foreground"
                      >
                        <Eye className="h-3.5 w-3.5" />
                        {isDetailOpen ? 'Hide' : 'Details'}
                        {isDetailOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleIgnore(alert)} className="gap-1">
                        Not now
                      </Button>
                      <Button size="sm" onClick={() => handleSetup(alert)} className="gap-1">
                        {isUnmatchedDeposit ? `Set up ${displayName}` : 'Identify this deposit'} <ArrowRight className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  {/* ─── Expandable evidence panel ─── */}
                  {isDetailOpen && (
                    <div className="border-t border-primary/10 bg-background/50 px-4 py-3 space-y-3">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Evidence — why we think this is {displayName}
                      </p>
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                        {/* Deposit amount */}
                        <div className="flex items-start gap-2 text-sm">
                          <Banknote className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                          <div>
                            <p className="text-xs text-muted-foreground">Deposit amount</p>
                            <p className="font-semibold text-foreground">{depositAmt}</p>
                          </div>
                        </div>

                        {/* Date */}
                        {depositDateFull && (
                          <div className="flex items-start gap-2 text-sm">
                            <Calendar className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs text-muted-foreground">Transaction date</p>
                              <p className="font-semibold text-foreground">{depositDateFull}</p>
                            </div>
                          </div>
                        )}

                        {/* Bank narration / reference */}
                        {alert.deposit_description && (
                          <div className="flex items-start gap-2 text-sm">
                            <FileText className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs text-muted-foreground">Bank narration / reference</p>
                              <p className="font-semibold text-foreground break-all">{alert.deposit_description}</p>
                            </div>
                          </div>
                        )}

                        {/* Confidence */}
                        {alert.match_confidence && (
                          <div className="flex items-start gap-2 text-sm">
                            <TrendingUp className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                            <div>
                              <p className="text-xs text-muted-foreground">Match confidence</p>
                              <p className="font-semibold text-foreground">{alert.match_confidence}%</p>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {alert.match_confidence >= 80 ? 'High — narration strongly matches known patterns' :
                                 alert.match_confidence >= 65 ? 'Medium — partial keyword match in narration' :
                                 'Low — weak signal, verify manually'}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Detection method detail */}
                      <div className="text-xs text-muted-foreground border-t border-primary/10 pt-2 space-y-1">
                        <p>
                          <span className="font-medium">Source:</span>{' '}
                          {alert.detection_method === 'bank_transaction'
                            ? 'Detected from a bank transaction in your accounting software'
                            : alert.detection_method === 'xero_bank_deposit'
                            ? 'Found in your Xero bank feed'
                            : alert.detection_method === 'xero_contact'
                            ? 'Matched to a Xero contact name'
                            : `Detection method: ${alert.detection_method || 'automatic'}`}
                        </p>
                        {alert.deposit_description && (
                          <p>
                            <span className="font-medium">How we matched:</span>{' '}
                            The bank narration "<span className="font-mono text-foreground">{alert.deposit_description}</span>" contains keywords associated with {displayName}.
                          </p>
                        )}
                        <p className="italic">
                          Review the amount and date above against your {displayName} seller portal to confirm this deposit matches a settlement period.
                        </p>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          }

          // ─── UNLINKED ALERT — marketplace exists, just needs linking ───
          if (isUnlinked) {
            return (
              <Card key={alert.id} className="border-primary/30 bg-primary/5">
                <CardContent className="flex items-center gap-3 p-4">
                  <LinkIcon className="h-5 w-5 text-primary shrink-0" />
                  <div className="flex-1 text-sm">
                    <p className="font-medium text-foreground">
                      🔗 Link Shopify orders to {displayName}
                    </p>
                    <p className="text-muted-foreground mt-0.5">
                      We found {alert.order_count} {displayName} order{alert.order_count !== 1 ? 's' : ''} in Shopify
                      {' '}({formatCurrency(alert.total_revenue)}).
                      You already have {displayName} settlements set up. Link them to enable cross-reference reconciliation.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => handleIgnore(alert)} className="gap-1">
                      Not now
                    </Button>
                    <Button size="sm" onClick={() => handleLinkNow(alert)} disabled={isLinking} className="gap-1">
                      {isLinking ? (
                        <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Linking...</>
                      ) : (
                        <>Link now <ArrowRight className="h-3.5 w-3.5" /></>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          }

          // ─── XERO CONTACT with 0 orders — needs classification, not a channel ───
          const isXeroContactOnly = (alert.detection_method === 'xero_contact_standalone' || alert.detection_method === 'xero_contact') && (alert.order_count === 0 || alert.order_count === null);
          if (isXeroContactOnly) {
            return (
              <Card key={alert.id} className="border-border bg-muted/30">
                <CardContent className="flex items-center gap-3 p-4">
                  <Search className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 text-sm">
                    <p className="font-medium text-foreground">
                      ❓ Xero contact needs classification:{' '}
                      <span className="font-semibold">{displayName}</span>
                    </p>
                    <p className="text-muted-foreground mt-0.5">
                      Found in your Xero contacts but no matching orders. This may be a business expense, personal contact, or inactive marketplace.
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button size="sm" variant="outline" onClick={() => setClassifyingAlert(alert)} className="gap-1 text-xs">
                      Classify <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => {
                      setSetupChannel({
                        source_name: alert.source_name,
                        order_count: alert.order_count || 0,
                        total_revenue: alert.total_revenue || 0,
                        sample_order_names: [],
                        is_new: true,
                      });
                    }} className="gap-1 text-xs">
                      Set up as marketplace
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          }

          // ─── NEW ALERT — brand new channel, needs full setup ───
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

                    {/* Smart help for unknown numeric channel IDs */}
                    {isNumericChannelId(alert.source_name) && shopHandle && isUnknown && (
                      <div className="mt-2 text-xs text-muted-foreground space-y-1 border-t border-amber-200/50 pt-2">
                        <p className="font-medium">❓ We couldn't identify this channel automatically.</p>
                        {connectorNote ? (
                          <p className="italic">{connectorNote}</p>
                        ) : (
                          <p>To find out what it is, check your installed Shopify apps (marketplace connectors like CedCommerce, Codisto, M2E Pro create orders with numeric channel IDs), or open one of these orders in Shopify to check its tags.</p>
                        )}
                        <div className="flex gap-3 mt-1">
                          <a href={`https://admin.shopify.com/store/${shopHandle}/apps`} target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">
                            Search your Shopify apps <ExternalLink className="h-3 w-3" />
                          </a>
                          <a href={`https://admin.shopify.com/store/${shopHandle}/orders`} target="_blank" rel="noopener noreferrer" className="text-primary underline inline-flex items-center gap-0.5">
                            View orders in Shopify <ExternalLink className="h-3 w-3" />
                          </a>
                        </div>
                      </div>
                    )}
                    {/* Tag-detected confirmation for numeric IDs */}
                    {isNumericChannelId(alert.source_name) && isTagDetected && (
                      <p className="text-xs text-green-600 mt-1">
                        ✓ Identified as {alert.detected_label} based on order tags
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
