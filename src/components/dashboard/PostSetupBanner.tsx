import { useState, useEffect, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle2, X, Zap, ShoppingCart, BookOpen, ArrowRight, Sparkles, Shield } from 'lucide-react';

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

  // Xero scan state
  const [scanning, setScanning] = useState(false);
  const [scanComplete, setScanComplete] = useState(false);
  const [scanResult, setScanResult] = useState<{ marketplaces_created?: number; confidence?: string } | null>(null);
  const scanTriggered = useRef(false);

  // Amazon scan state
  const [amazonScanning, setAmazonScanning] = useState(false);
  const [amazonScanComplete, setAmazonScanComplete] = useState(false);
  const [amazonFound, setAmazonFound] = useState(0);
  const amazonScanTriggered = useRef(false);

  // Shopify scan state
  const [shopifyScanning, setShopifyScanning] = useState(false);
  const [shopifyScanComplete, setShopifyScanComplete] = useState(false);
  const [shopifyChannelsFound, setShopifyChannelsFound] = useState(0);
  const shopifyScanTriggered = useRef(false);

  // Helper to call edge function
  const callEdgeFunction = async (name: string, body: Record<string, unknown> = {}) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) throw new Error('No session');
    const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
    const res = await fetch(
      `https://${projectId}.supabase.co/functions/v1/${name}`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`,
        },
        body: JSON.stringify(body),
      }
    );
    if (!res.ok) throw new Error(`${name} failed: ${res.status}`);
    return res.json();
  };

  const setAppFlag = async (key: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return;
    const { data: existing } = await supabase
      .from('app_settings')
      .select('id')
      .eq('key', key)
      .maybeSingle();
    if (existing) {
      await supabase.from('app_settings').update({ value: 'true' }).eq('id', existing.id);
    } else {
      await supabase.from('app_settings').insert({
        user_id: session.user.id,
        key,
        value: 'true',
      });
    }
  };

  // ─── Xero auto-scan ────────────────────────────────────────────
  useEffect(() => {
    if (!hasXero || dismissed || scanTriggered.current) return;
    scanTriggered.current = true;

    const triggerScan = async () => {
      try {
        const { data: scanFlag } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'xero_scan_completed')
          .maybeSingle();

        if (scanFlag?.value) {
          setScanComplete(true);
          return;
        }

        setScanning(true);
        const data = await callEdgeFunction('scan-xero-history');
        setScanResult(data);
        setScanComplete(true);
        if (data.marketplaces_created > 0 || data.detected_settlements?.length > 0) {
          setMarketplacesFound(data.detected_settlements?.length || data.marketplaces_created || 0);
        }
        await callEdgeFunction('run-validation-sweep').catch(() => {});
        onScanComplete?.();
      } catch (err) {
        console.error('Xero scan trigger failed:', err);
      } finally {
        setScanning(false);
      }
    };

    triggerScan();
  }, [hasXero, dismissed]);

  // ─── Amazon auto-scan ──────────────────────────────────────────
  useEffect(() => {
    if (!hasAmazon || dismissed || amazonScanTriggered.current) return;
    amazonScanTriggered.current = true;

    const triggerScan = async () => {
      try {
        const { data: scanFlag } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'amazon_scan_completed')
          .maybeSingle();

        if (scanFlag?.value) {
          setAmazonScanComplete(true);
          return;
        }

        setAmazonScanning(true);
        await callEdgeFunction('fetch-amazon-settlements');

        // Count what was imported
        const { count } = await supabase
          .from('settlements')
          .select('id', { count: 'exact', head: true })
          .eq('marketplace', 'amazon_au');
        setAmazonFound(count ?? 0);

        await setAppFlag('amazon_scan_completed');
        setAmazonScanComplete(true);
        await callEdgeFunction('run-validation-sweep').catch(() => {});
        onScanComplete?.();
      } catch (err) {
        console.error('Amazon scan trigger failed:', err);
      } finally {
        setAmazonScanning(false);
      }
    };

    triggerScan();
  }, [hasAmazon, dismissed]);

  // ─── Shopify auto-scan ─────────────────────────────────────────
  useEffect(() => {
    if (!hasShopify || dismissed || shopifyScanTriggered.current) return;
    shopifyScanTriggered.current = true;

    const triggerScan = async () => {
      try {
        const { data: scanFlag } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'shopify_scan_completed')
          .maybeSingle();

        if (scanFlag?.value) {
          setShopifyScanComplete(true);
          return;
        }

        setShopifyScanning(true);

        // Run in sequence: payouts → orders → channel scan
        await callEdgeFunction('fetch-shopify-payouts').catch(e => console.warn('fetch-shopify-payouts:', e));
        await callEdgeFunction('fetch-shopify-orders').catch(e => console.warn('fetch-shopify-orders:', e));
        await callEdgeFunction('scan-shopify-channels').catch(e => console.warn('scan-shopify-channels:', e));

        // Count discovered channels
        const { count } = await supabase
          .from('shopify_sub_channels')
          .select('id', { count: 'exact', head: true });
        setShopifyChannelsFound(count ?? 0);

        await setAppFlag('shopify_scan_completed');
        setShopifyScanComplete(true);
        await callEdgeFunction('run-validation-sweep').catch(() => {});
        onScanComplete?.();
      } catch (err) {
        console.error('Shopify scan trigger failed:', err);
      } finally {
        setShopifyScanning(false);
      }
    };

    triggerScan();
  }, [hasShopify, dismissed]);

  // ─── Polling for live counts ───────────────────────────────────
  useEffect(() => {
    if (dismissed) return;
    const poll = async () => {
      try {
        const { data } = await supabase
          .from('marketplace_connections')
          .select('id')
          .eq('connection_type', 'auto_detected');
        if (data) setMarketplacesFound(prev => Math.max(prev, data.length));

        const { count } = await supabase
          .from('settlements')
          .select('id', { count: 'exact', head: true });
        setSettlementCount(count ?? 0);

        if (hasAmazon && amazonScanning) {
          const { count: amzCount } = await supabase
            .from('settlements')
            .select('id', { count: 'exact', head: true })
            .eq('marketplace', 'amazon_au');
          setAmazonFound(amzCount ?? 0);
        }

        if (hasShopify && shopifyScanning) {
          const { count: shopCount } = await supabase
            .from('shopify_sub_channels')
            .select('id', { count: 'exact', head: true });
          setShopifyChannelsFound(shopCount ?? 0);
        }
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 10000);
    return () => clearInterval(interval);
  }, [dismissed, amazonScanning, shopifyScanning, hasAmazon, hasShopify]);

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, 'true');
    setDismissed(true);
  };

  const hasAnyConnection = hasXero || hasAmazon || hasShopify;
  const isFreshAccount = !hasAnyConnection && settlementCount === 0;
  const allConnected = hasXero && hasAmazon && hasShopify;

  if (dismissed) return null;

  const allScansComplete = (!hasXero || scanComplete) && (!hasAmazon || amazonScanComplete) && (!hasShopify || shopifyScanComplete);
  if (allConnected && allScansComplete && marketplacesFound > 0 && settlementCount !== null && settlementCount > 3) return null;

  const connectedCount = [hasXero, hasAmazon, hasShopify].filter(Boolean).length;
  const isActivelyScanning = scanning || amazonScanning || shopifyScanning || (hasXero && !scanComplete) || (hasAmazon && !amazonScanComplete) || (hasShopify && !shopifyScanComplete);

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
                    ? 'Xettle is scanning your accounts…'
                    : 'Scan complete!'
                  }
                </h3>
                <div className="space-y-1">
                  {hasXero && (
                    <p className="text-sm text-foreground">
                      {scanning
                        ? 'Scanning your Xero history to auto-detect marketplaces and build them into your dashboard.'
                        : scanComplete
                          ? marketplacesFound > 0
                            ? `We found ${marketplacesFound} marketplace${marketplacesFound > 1 ? 's' : ''} in your Xero and set them up for you.`
                            : scanResult?.confidence === 'low' || !scanResult?.confidence
                              ? 'No marketplace invoices found in Xero yet — upload a settlement file to get started.'
                              : 'Xero scan complete — your marketplaces are ready.'
                          : 'Preparing to scan your Xero…'
                      }
                    </p>
                  )}
                  {hasAmazon && (
                    <p className="text-sm text-muted-foreground">
                      {amazonScanning
                        ? amazonFound > 0
                          ? `Importing your Amazon settlements — ${amazonFound} found so far…`
                          : 'Importing your Amazon settlements…'
                        : amazonScanComplete
                          ? amazonFound > 0
                            ? `✅ ${amazonFound} Amazon settlement${amazonFound > 1 ? 's' : ''} imported and ready.`
                            : 'Amazon scan complete — no settlements found yet.'
                          : 'Preparing to scan Amazon…'}
                    </p>
                  )}
                  {hasShopify && (
                    <p className="text-sm text-muted-foreground">
                      {shopifyScanning
                        ? shopifyChannelsFound > 0
                          ? `Syncing Shopify — detected ${shopifyChannelsFound} sales channel${shopifyChannelsFound > 1 ? 's' : ''} so far…`
                          : 'Syncing your Shopify payouts and detecting sales channels…'
                        : shopifyScanComplete
                          ? shopifyChannelsFound > 0
                            ? `✅ ${shopifyChannelsFound} Shopify sales channel${shopifyChannelsFound > 1 ? 's' : ''} detected and synced.`
                            : 'Shopify sync complete — payouts imported.'
                          : 'Preparing to scan Shopify…'}
                    </p>
                  )}
                </div>

                {marketplacesFound > 0 && isActivelyScanning && (
                  <div className="flex items-center gap-2 mt-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                    <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">
                      ✨ Found {marketplacesFound} marketplace{marketplacesFound > 1 ? 's' : ''} so far
                    </p>
                  </div>
                )}

                <div className="flex items-center gap-2 pt-1">
                  <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                  <p className="text-xs text-muted-foreground">
                    Read-only — we never push or change anything in your Xero, Amazon, or Shopify accounts. Everything is built inside Xettle for you.
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

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                {[hasXero, hasAmazon, hasShopify].map((connected, i) => (
                  <div
                    key={i}
                    className={`h-2.5 w-2.5 rounded-full transition-all ${
                      connected ? 'bg-primary scale-110' : 'bg-muted-foreground/20'
                    }`}
                  />
                ))}
              </div>
              <span className="text-xs font-medium text-muted-foreground">
                {connectedCount} of 3 connected
              </span>
              {connectedCount > 0 && connectedCount < 3 && (
                <span className="text-xs text-primary font-medium">
                  — keep going!
                </span>
              )}
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {missingChannels.filter(c => !c.connected).map((channel) => {
                const Icon = channel.icon;
                return (
                  <div
                    key={channel.key}
                    className={`rounded-xl border-2 ${channel.borderColor} ${channel.bgColor} p-4 space-y-3 transition-all hover:shadow-md`}
                  >
                    <div className="flex items-center gap-2">
                      <Icon className={`h-5 w-5 ${channel.color}`} />
                      <span className="font-semibold text-foreground">{channel.label}</span>
                    </div>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {channel.description}
                    </p>
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={channel.onConnect}
                    >
                      Connect {channel.label}
                      <ArrowRight className="h-4 w-4 ml-1" />
                    </Button>
                  </div>
                );
              })}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <Shield className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
              <p className="text-xs text-muted-foreground">
                We only read your data to build your marketplaces inside Xettle. Nothing is ever pushed or changed in your accounts.
              </p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
