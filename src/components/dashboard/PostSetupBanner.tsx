import { useState, useEffect } from 'react';
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
}: Props) {
  const [dismissed, setDismissed] = useState(() => sessionStorage.getItem(DISMISS_KEY) === 'true');
  const [marketplacesFound, setMarketplacesFound] = useState(0);
  const [settlementCount, setSettlementCount] = useState<number | null>(null);

  // Poll for auto-detected marketplaces when scanning
  useEffect(() => {
    if (dismissed) return;
    const poll = async () => {
      try {
        const { data } = await supabase
          .from('marketplace_connections')
          .select('id')
          .eq('connection_type', 'auto_detected');
        if (data) setMarketplacesFound(data.length);

        const { count } = await supabase
          .from('settlements')
          .select('id', { count: 'exact', head: true });
        setSettlementCount(count ?? 0);
      } catch {}
    };
    poll();
    const interval = setInterval(poll, 10000);
    return () => clearInterval(interval);
  }, [dismissed]);

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISS_KEY, 'true');
    setDismissed(true);
  };

  // Show when: any connection exists, or no connections but no settlements yet (fresh account)
  const hasAnyConnection = hasXero || hasAmazon || hasShopify;
  const isFreshAccount = !hasAnyConnection && settlementCount === 0;
  const allConnected = hasXero && hasAmazon && hasShopify;

  // Don't show if dismissed, or if user has all connections + marketplaces found
  if (dismissed) return null;
  if (!hasAnyConnection && !isFreshAccount) return null;
  if (allConnected && marketplacesFound > 0 && settlementCount !== null && settlementCount > 3) return null;

  const connectedCount = [hasXero, hasAmazon, hasShopify].filter(Boolean).length;

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
          {/* Subtle animated gradient bar */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-primary/40 via-primary to-primary/40 animate-pulse" />
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
                <Loader2 className="h-6 w-6 text-primary animate-spin" />
              </div>
              <div className="space-y-2 flex-1">
                <h3 className="text-base font-semibold text-foreground">
                  Xettle is scanning your accounts…
                </h3>
                <div className="space-y-1">
                  {hasXero && (
                    <p className="text-sm text-foreground">
                      Scanning your Xero history to auto-detect marketplaces and build them into your dashboard.
                    </p>
                  )}
                  {hasAmazon && (
                    <p className="text-sm text-muted-foreground">
                      Importing your Amazon settlements — they'll appear in your Settlements tab shortly.
                    </p>
                  )}
                  {hasShopify && (
                    <p className="text-sm text-muted-foreground">
                      Syncing your Shopify payouts and detecting sales channels automatically.
                    </p>
                  )}
                </div>

                {marketplacesFound > 0 && (
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
            {/* Header with progress */}
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

            {/* Progress dots */}
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

            {/* Channel cards */}
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

            {/* Reassurance */}
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
