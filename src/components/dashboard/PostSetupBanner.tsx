import { useState, useEffect, useRef } from 'react';
import { logger } from '@/utils/logger';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle2, X, Zap, ShoppingCart, BookOpen, ArrowRight, Sparkles, Shield, AlertTriangle, Clock3 } from 'lucide-react';
import { provisionAllMarketplaceConnections } from '@/utils/marketplace-token-map';
import { detectCapabilities, callEdgeFunctionSafe, type SyncCapabilities } from '@/utils/sync-capabilities';

interface Props {
  onSwitchToUpload: () => void;
  hasXero: boolean;
  hasAmazon: boolean;
  hasShopify: boolean;
  onConnectXero?: () => void;
  onConnectAmazon?: () => void;
  onConnectShopify?: () => void;
  onScanComplete?: () => void;
}

const DISMISS_KEY = 'xettle_post_setup_dismissed';

export default function PostSetupBanner({
  onSwitchToUpload,
  hasXero,
  hasAmazon,
  hasShopify,
  onConnectXero,
  onConnectAmazon,
  onConnectShopify,
  onScanComplete,
}: Props) {
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === 'true');
  const [marketplacesFound, setMarketplacesFound] = useState(0);
  const [settlementCount, setSettlementCount] = useState<number | null>(null);

  // Unified scan state
  const [scanPhase, setScanPhase] = useState<'idle' | 'detecting' | 'scanning' | 'done'>('idle');
  const [xeroStatus, setXeroStatus] = useState<'idle' | 'scanning' | 'done' | 'skipped' | 'error'>('idle');
  const [amazonStatus, setAmazonStatus] = useState<'idle' | 'scanning' | 'done' | 'skipped' | 'error' | 'rate_limited'>('idle');
  const [shopifyStatus, setShopifyStatus] = useState<'idle' | 'scanning' | 'done' | 'skipped' | 'error' | 'rate_limited'>('idle');

  const [xeroMessage, setXeroMessage] = useState('');
  const [amazonMessage, setAmazonMessage] = useState('');
  const [shopifyMessage, setShopifyMessage] = useState('');

  const [amazonFound, setAmazonFound] = useState(0);
  const [shopifyChannelsFound, setShopifyChannelsFound] = useState(0);

  const scanTriggered = useRef(false);

  const setAppFlag = async (key: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    await supabase.from('app_settings').upsert(
      { user_id: session.user.id, key, value: 'true' },
      { onConflict: 'user_id,key' }
    );
  };

  // ─── Universal adaptive scan ───────────────────────────────────
  useEffect(() => {
    if (dismissed || scanTriggered.current || (!hasXero && !hasAmazon && !hasShopify)) return;
    scanTriggered.current = true;

    const runAdaptiveScan = async () => {
      setScanPhase('detecting');

      // 1. Detect real capabilities from token tables
      const caps = await detectCapabilities();
      if (!caps.userId || !caps.accessToken) {
        setScanPhase('done');
        return;
      }

      // Check if scans already completed
      const { data: flags } = await supabase
        .from('app_settings')
        .select('key, value')
        .in('key', ['xero_scan_completed', 'amazon_scan_completed', 'shopify_scan_completed']);

      const completedFlags = new Set(flags?.filter(f => f.value === 'true').map(f => f.key) || []);

      setScanPhase('scanning');

      // ─── Phase 1a: Xero audit FIRST (determines sync boundary) ───

      if (hasXero && caps.hasXero && !completedFlags.has('xero_scan_completed')) {
        setXeroStatus('scanning');
        const result = await callEdgeFunctionSafe('scan-xero-history', caps.accessToken!);
        if (result.ok) {
          const data = result.data;
          const found = data?.detected_settlements?.length || data?.marketplaces_created || 0;
          if (found > 0) setMarketplacesFound(prev => Math.max(prev, found));
          setXeroMessage(found > 0
            ? `Found ${found} marketplace${found > 1 ? 's' : ''} in your Xero history`
            : 'No marketplace invoices found in Xero yet');
          setXeroStatus('done');
          await setAppFlag('xero_scan_completed');
        } else {
          const isRateLimit = result.statusCode === 429 || result.error?.includes('429') || result.error?.includes('rate');
          if (isRateLimit) {
            setXeroMessage('Xero API temporarily rate limited — will retry automatically');
            setXeroStatus('done');
          } else {
            setXeroMessage('Xero history scan will retry on next sync — connection is active');
            setXeroStatus('done');
          }
        }
      } else if (hasXero && !caps.hasXero) {
        setXeroStatus('skipped');
        setXeroMessage('Xero token not found — please reconnect');
      } else if (hasXero && completedFlags.has('xero_scan_completed')) {
        setXeroStatus('done');
        setXeroMessage('Xero scan already completed');
      } else if (!hasXero) {
        setXeroStatus('skipped');
      }

      // ─── Read Xero boundary for marketplace sync window ───
      let syncFromBoundary: string | undefined;
      if (hasXero) {
        try {
          const { data: boundaryRow } = await supabase
            .from('app_settings')
            .select('value')
            .eq('key', 'xero_oldest_outstanding_date')
            .maybeSingle();
          if (boundaryRow?.value) {
            syncFromBoundary = boundaryRow.value;
            logger.debug('[sync] Using Xero boundary for marketplace fetch:', syncFromBoundary);
          }
        } catch (err) {
          console.warn('[sync] Failed to read xero_oldest_outstanding_date:', err);
        }
      }

      // ─── Phase 1b: Marketplace fetches (using Xero boundary) ───

      const phase1Promises: Promise<void>[] = [];

      // Amazon scan
      if (hasAmazon && caps.hasAmazon && !completedFlags.has('amazon_scan_completed')) {
        phase1Promises.push((async () => {
          // GUARDRAIL: Check per-user cooldown before attempting Amazon fetch
          const { data: cooldownRow } = await supabase
            .from('app_settings')
            .select('value')
            .eq('key', 'amazon_rate_limit_until')
            .maybeSingle();
          if (cooldownRow?.value) {
            const retryAt = new Date(cooldownRow.value);
            if (retryAt > new Date()) {
              const minutesLeft = Math.ceil((retryAt.getTime() - Date.now()) / 60000);
              setAmazonMessage(`Amazon cooldown active — will retry in ${minutesLeft}m`);
              setAmazonStatus('rate_limited');
              return; // Don't attempt fetch during cooldown
            }
          }

          setAmazonStatus('scanning');
          const opts: any = { headers: { 'x-action': 'smart-sync' } };
          if (syncFromBoundary) {
            opts.body = { sync_from: syncFromBoundary };
          }
          const result = await callEdgeFunctionSafe('fetch-amazon-settlements', caps.accessToken!, opts.body || {}, { headers: opts.headers });
          if (result.ok) {
            const { count } = await supabase
              .from('settlements')
              .select('id', { count: 'exact', head: true })
              .like('marketplace', 'amazon_%');
            const found = count ?? 0;
            setAmazonFound(found);
            setAmazonMessage(found > 0 ? `${found} settlement${found > 1 ? 's' : ''} imported` : 'No settlements found yet');
            setAmazonStatus('done');
            await setAppFlag('amazon_scan_completed');
          } else if (result.rateLimited || result.statusCode === 429 || result.statusCode === 503) {
            setAmazonMessage('Amazon rate limited — scheduled sync will retry shortly');
            setAmazonStatus('rate_limited');
          } else {
            setAmazonMessage('Amazon connection error — check your connection');
            setAmazonStatus('error');
          }
        })());
      } else if (hasAmazon && !caps.hasAmazon) {
        setAmazonStatus('skipped');
        setAmazonMessage('Amazon token not found — please reconnect');
      } else if (hasAmazon && completedFlags.has('amazon_scan_completed')) {
        setAmazonStatus('done');
        const { count } = await supabase.from('settlements').select('id', { count: 'exact', head: true }).like('marketplace', 'amazon_%');
        setAmazonFound(count ?? 0);
        setAmazonMessage(`${count ?? 0} settlements ready`);
      } else if (!hasAmazon) {
        setAmazonStatus('skipped');
      }

      // Shopify scan (sequential: payouts → orders → channels)
      if (hasShopify && caps.hasShopify && !completedFlags.has('shopify_scan_completed')) {
        phase1Promises.push((async () => {
          setShopifyStatus('scanning');

          // Step 1: Payouts (with retry for 503/429)
          let payoutsOk = false;
          for (let attempt = 0; attempt < 3; attempt++) {
            const payoutsBody = syncFromBoundary ? { sync_from: syncFromBoundary } : {};
            const payoutsResult = await callEdgeFunctionSafe('fetch-shopify-payouts', caps.accessToken!, payoutsBody);
            if (payoutsResult.ok) {
              payoutsOk = true;
              break;
            }
            const isRetryable = payoutsResult.statusCode === 503 || payoutsResult.statusCode === 429 || payoutsResult.rateLimited;
            if (isRetryable && attempt < 2) {
              console.warn(`[sync] Shopify payouts ${payoutsResult.statusCode} — retrying in ${(attempt + 1) * 5}s (attempt ${attempt + 1})`);
              setShopifyMessage('Shopify is temporarily unavailable — retrying…');
              setShopifyStatus('rate_limited');
              await new Promise(r => setTimeout(r, (attempt + 1) * 5000));
              setShopifyStatus('scanning');
              continue;
            }
            // Non-retryable or exhausted retries
            if (isRetryable) {
              setShopifyMessage('Shopify temporarily unavailable — scheduled sync will retry shortly');
              setShopifyStatus('rate_limited');
              return;
            }
            setShopifyMessage('Shopify connection error — check your connection');
            setShopifyStatus('error');
            return;
          }

          // Step 2: Orders
          const body = caps.shopDomain ? { shopDomain: caps.shopDomain } : {};
          const ordersResult = await callEdgeFunctionSafe('fetch-shopify-orders', caps.accessToken!, body);
          if (!ordersResult.ok) {
            const isRetryable = ordersResult.statusCode === 503 || ordersResult.statusCode === 429 || ordersResult.rateLimited;
            if (isRetryable) {
              setShopifyMessage('Shopify temporarily unavailable — scheduled sync will retry shortly');
              setShopifyStatus('rate_limited');
              return;
            }
            console.warn('[sync] Shopify orders issue:', ordersResult.error);
          }

          // Step 3: Channel scan — only if orders exist now
          const { count: orderCount } = await supabase
            .from('shopify_orders')
            .select('id', { count: 'exact', head: true });

          if (orderCount && orderCount > 0) {
            await callEdgeFunctionSafe('scan-shopify-channels', caps.accessToken!);
            // Auto-generate settlements from cached orders
            await callEdgeFunctionSafe('auto-generate-shopify-settlements', caps.accessToken!, { days: 60 });
          } else {
            console.warn('[sync] Skipping scan-shopify-channels — no orders found');
          }

          // Count results
          const { count: channelCount } = await supabase
            .from('shopify_sub_channels')
            .select('id', { count: 'exact', head: true });
          setShopifyChannelsFound(channelCount ?? 0);
          setShopifyMessage(channelCount && channelCount > 0
            ? `${channelCount} sales channel${channelCount > 1 ? 's' : ''} detected`
            : 'Payouts synced');
          setShopifyStatus('done');
          await setAppFlag('shopify_scan_completed');
        })());
      } else if (hasShopify && !caps.hasShopify) {
        setShopifyStatus('skipped');
        setShopifyMessage('Shopify token not found — please reconnect');
      } else if (hasShopify && completedFlags.has('shopify_scan_completed')) {
        setShopifyStatus('done');
        const { count } = await supabase.from('shopify_sub_channels').select('id', { count: 'exact', head: true });
        setShopifyChannelsFound(count ?? 0);
        setShopifyMessage('Shopify scan already completed');
      } else if (!hasShopify) {
        setShopifyStatus('skipped');
      }

      // Wait for all marketplace fetches to complete
      await Promise.allSettled(phase1Promises);

      // Nothing pending: skip heavy follow-up work on every dashboard mount
      if (phase1Promises.length === 0 && !hasXero) {
        setScanPhase('done');
        return;
      }

      // ─── Phase 2: Provision all marketplace connections ───
      if (caps.userId) {
        try {
          await provisionAllMarketplaceConnections(caps.userId);
        } catch (err) {
          console.error('[sync] provision failed:', err);
        }
      }

      // ─── Phase 3: One-shot Xero coverage refresh for new users ───
      if (hasXero && caps.hasXero) {
        await callEdgeFunctionSafe('sync-xero-status', caps.accessToken!);
      }

      // ─── Phase 4: Validation sweep ───
      await callEdgeFunctionSafe('run-validation-sweep', caps.accessToken!);

      setScanPhase('done');
      onScanComplete?.();
    };

    runAdaptiveScan().catch(err => {
      console.error('[sync] adaptive scan failed:', err);
      setScanPhase('done');
    });
  }, [hasXero, hasAmazon, hasShopify, dismissed]);

  // ─── Polling for live counts ───────────────────────────────────
  useEffect(() => {
    if (dismissed) return;
    const poll = async () => {
      try {
        const { count } = await supabase
          .from('settlements')
          .select('id', { count: 'exact', head: true });
        setSettlementCount(count ?? 0);
      } catch (err) {
        console.warn('[poll] settlement count error:', err);
      }
    };

    poll();

    // Only poll while actively scanning; stop background polling once done.
    if (scanPhase === 'done') return;

    const interval = setInterval(poll, 30000);
    return () => clearInterval(interval);
  }, [dismissed, scanPhase]);

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, 'true');
    setDismissed(true);
  };

  const hasAnyConnection = hasXero || hasAmazon || hasShopify;
  const allConnected = hasXero && hasAmazon && hasShopify;
  const isActivelyScanning = scanPhase === 'detecting' || scanPhase === 'scanning';

  if (dismissed) return null;

  // Auto-dismiss when fully synced with enough data
  const allScansTerminal =
    (xeroStatus === 'done' || xeroStatus === 'skipped') &&
    (amazonStatus === 'done' || amazonStatus === 'skipped' || amazonStatus === 'rate_limited') &&
    (shopifyStatus === 'done' || shopifyStatus === 'skipped');
  // Hide the entire banner once all scans are done or if scan phase is still running
  // but all individual statuses have resolved (e.g. from stored completion flags)
  if (allScansTerminal && (scanPhase === 'done' || scanPhase === 'scanning')) return null;

  const connectedCount = [hasXero, hasAmazon, hasShopify].filter(Boolean).length;

  const renderStatusIcon = (status: string) => {
    switch (status) {
      case 'scanning': return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary inline mr-1.5" />;
      case 'done': return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 inline mr-1.5" />;
      case 'rate_limited': return <Clock3 className="h-3.5 w-3.5 text-amber-500 inline mr-1.5" />;
      case 'error': return <AlertTriangle className="h-3.5 w-3.5 text-destructive inline mr-1.5" />;
      case 'skipped': return null;
      default: return null;
    }
  };

  const missingChannels = [
    {
      key: 'xero',
      connected: hasXero,
      label: 'Xero',
      icon: BookOpen,
      color: 'text-[hsl(var(--chart-3))]',
      bgColor: 'bg-[hsl(var(--chart-3)/0.1)]',
      borderColor: 'border-[hsl(var(--chart-3)/0.2)]',
      description: 'We\'ll scan your Xero history to find existing marketplace invoices and pre-build your account automatically.',
      onConnect: onConnectXero,
    },
    {
      key: 'amazon',
      connected: hasAmazon,
      label: 'Amazon',
      icon: ShoppingCart,
      color: 'text-[hsl(var(--chart-1))]',
      bgColor: 'bg-[hsl(var(--chart-1)/0.1)]',
      borderColor: 'border-[hsl(var(--chart-1)/0.2)]',
      description: 'Our AI auto-imports your settlements every cycle, detects fee patterns, and builds your marketplace — zero manual setup.',
      onConnect: onConnectAmazon,
    },
    {
      key: 'shopify',
      connected: hasShopify,
      label: 'Shopify',
      icon: Zap,
      color: 'text-[hsl(var(--chart-2))]',
      bgColor: 'bg-[hsl(var(--chart-2)/0.1)]',
      borderColor: 'border-[hsl(var(--chart-2)/0.2)]',
      description: 'We auto-detect your sales channels, sync payouts, and combine everything with your other data — no configuration needed.',
      onConnect: onConnectShopify,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Section A: Active Scanning Status */}
      {hasAnyConnection && (
        <Card className="border-primary/20 bg-primary/5 relative overflow-hidden">
          {isActivelyScanning && (
            <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary/40 via-primary to-primary/40 animate-pulse" />
          )}
          <button
            onClick={handleDismiss}
            className="absolute top-3 right-3 text-muted-foreground hover:text-foreground z-10"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
          <CardContent className="p-5">
            <div className="flex items-start gap-4">
              <div className="relative flex-shrink-0 mt-0.5">
                {isActivelyScanning ? (
                  <Loader2 className="h-6 w-6 text-primary animate-spin" />
                ) : (
                  <CheckCircle2 className="h-6 w-6 text-emerald-500" />
                )}
              </div>
              <div className="space-y-2 flex-1">
                <h3 className="text-base font-semibold text-foreground">
                  {isActivelyScanning
                    ? scanPhase === 'detecting' ? 'Checking your connections…' : 'Checking for new marketplaces and deposits…'
                    : 'Scan complete!'
                  }
                </h3>
                {isActivelyScanning && (
                  <p className="text-xs text-muted-foreground">
                    This runs automatically in the background — your data is ready to use.
                  </p>
                )}
                <div className="space-y-1.5">
                  {hasXero && xeroStatus !== 'skipped' && (
                    <p className="text-sm text-foreground">
                      {renderStatusIcon(xeroStatus)}
                      {xeroStatus === 'scanning'
                        ? 'Scanning your Xero history to auto-detect marketplaces…'
                        : xeroMessage || 'Xero scan complete.'}
                    </p>
                  )}
                  {hasXero && xeroStatus === 'skipped' && xeroMessage && (
                    <p className="text-sm text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5 inline mr-1.5" />
                      {xeroMessage}
                    </p>
                  )}
                  {hasAmazon && amazonStatus !== 'skipped' && (
                    <p className={`text-sm ${amazonStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {renderStatusIcon(amazonStatus)}
                      {amazonStatus === 'scanning'
                        ? amazonFound > 0
                          ? `Importing Amazon settlements — ${amazonFound} found so far…`
                          : 'Importing your Amazon settlements…'
                        : amazonMessage
                          ? amazonStatus === 'done'
                            ? `✅ ${amazonMessage}`
                            : amazonMessage
                          : 'Amazon scan complete.'}
                    </p>
                  )}
                  {hasAmazon && amazonStatus === 'skipped' && amazonMessage && (
                    <p className="text-sm text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5 inline mr-1.5" />
                      {amazonMessage}
                    </p>
                  )}
                  {hasShopify && shopifyStatus !== 'skipped' && (
                    <p className={`text-sm ${shopifyStatus === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
                      {renderStatusIcon(shopifyStatus)}
                      {shopifyStatus === 'scanning'
                        ? shopifyChannelsFound > 0
                          ? `Syncing Shopify — detected ${shopifyChannelsFound} sales channel${shopifyChannelsFound > 1 ? 's' : ''} so far…`
                          : 'Syncing your Shopify payouts and detecting sales channels…'
                        : shopifyMessage
                          ? shopifyStatus === 'done'
                            ? `✅ ${shopifyMessage}`
                            : shopifyMessage
                          : 'Shopify sync complete.'}
                    </p>
                  )}
                  {hasShopify && shopifyStatus === 'skipped' && shopifyMessage && (
                    <p className="text-sm text-amber-600 dark:text-amber-400">
                      <AlertTriangle className="h-3.5 w-3.5 inline mr-1.5" />
                      {shopifyMessage}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">
                    Read-only — we never push or change anything in your Xero, Amazon, or Shopify accounts.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Section B: Connect More Channels — gamified progress */}
      {!allConnected && (
        <Card className="border-border bg-card relative overflow-hidden">
          <button
            onClick={handleDismiss}
            className="absolute top-3 right-3 text-muted-foreground hover:text-foreground z-10"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
          <CardContent className="p-5 space-y-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center h-9 w-9 rounded-full bg-primary/10">
                  <Sparkles className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-base font-semibold text-foreground">
                    {connectedCount === 0 ? 'Connect your accounts' : 'Connect more to unlock full automation'}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    The more you connect, the less you do manually. Our AI combines all your data automatically.
                  </p>
                </div>
              </div>
            </div>

            {/* Progress bar */}
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>{connectedCount} of 3 connected</span>
                <span>{Math.round((connectedCount / 3) * 100)}% automated</span>
              </div>
              <div className="h-2 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-700"
                  style={{ width: `${(connectedCount / 3) * 100}%` }}
                />
              </div>
            </div>

            {/* Channel cards */}
            <div className="grid gap-3 sm:grid-cols-3">
              {missingChannels.map(ch => {
                const Icon = ch.icon;
                return (
                  <div
                    key={ch.key}
                    className={`rounded-lg border p-4 transition-all ${
                      ch.connected
                        ? 'border-emerald-500/30 bg-emerald-500/5'
                        : `${ch.borderColor} ${ch.bgColor} hover:shadow-md cursor-pointer`
                    }`}
                    onClick={!ch.connected ? ch.onConnect : undefined}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <Icon className={`h-5 w-5 ${ch.connected ? 'text-emerald-500' : ch.color}`} />
                      <span className={`font-semibold text-sm ${ch.connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'}`}>
                        {ch.label}
                      </span>
                      {ch.connected && <CheckCircle2 className="h-4 w-4 text-emerald-500 ml-auto" />}
                    </div>
                    {!ch.connected ? (
                      <>
                        <p className="text-xs text-muted-foreground mb-3 line-clamp-2">{ch.description}</p>
                        <Button size="sm" variant="outline" className="w-full text-xs gap-1.5" onClick={ch.onConnect}>
                          Connect {ch.label} <ArrowRight className="h-3 w-3" />
                        </Button>
                      </>
                    ) : (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400">Connected ✓</p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* CSV fallback */}
            {connectedCount === 0 && (
              <div className="text-center pt-2">
                <Button variant="ghost" size="sm" onClick={onSwitchToUpload} className="text-xs text-muted-foreground">
                  Or upload a CSV settlement file manually
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
