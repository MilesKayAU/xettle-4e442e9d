import { useState, useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle2, AlertTriangle, Loader2, ArrowRight, Search, PartyPopper, SkipForward, Upload, Clock3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { provisionAllMarketplaceConnections } from '@/utils/marketplace-token-map';
import { detectCapabilities, callEdgeFunctionSafe, type SyncCapabilities } from '@/utils/sync-capabilities';
import { MARKETPLACE_LABELS } from '@/utils/settlement-engine';

interface Props {
  onNext: () => void;
  hasXero?: boolean;
  hasAmazon?: boolean;
  hasShopify?: boolean;
}

interface ScanStep {
  label: string;
  fn: string | null;
  action?: string;
  requiresCapability?: keyof SyncCapabilities;
  requiresShopifyOrders?: boolean;
  flagKey?: string;
}

type StepStatus = 'pending' | 'running' | 'success' | 'skipped' | 'rate_limited' | 'error';

interface PhaseBData {
  amazonCount: number;
  shopifyPayoutCount: number;
  channelsDetected: string[];
  xeroRecords: number;
  uploadNeeded: number;
  readyToPush: number;
}

const SCAN_TIMEOUT_MS = 180_000; // 3 minutes
const POLL_INTERVAL_MS = 5_000;

export default function SetupStepResults({ onNext, hasXero, hasAmazon, hasShopify }: Props) {
  const [phase, setPhase] = useState<'scanning' | 'complete'>('scanning');
  const [stepStatuses, setStepStatuses] = useState<StepStatus[]>([]);
  const [stepMessages, setStepMessages] = useState<string[]>([]);
  const [progressPercent, setProgressPercent] = useState(0);
  const [phaseBData, setPhaseBData] = useState<PhaseBData | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  const hasStarted = useRef(false);
  const scanStartTime = useRef(Date.now());
  const stepStatusesRef = useRef<StepStatus[]>([]);

  const hasAnyApi = hasXero || hasAmazon || hasShopify;

  // Build scan steps dynamically
  const allSteps: ScanStep[] = [
    ...(hasXero ? [{ label: 'Scanning Xero history…', fn: 'scan-xero-history', requiresCapability: 'hasXero' as keyof SyncCapabilities, flagKey: 'xero_scan_completed' }] : []),
    ...(hasAmazon ? [{ label: 'Fetching Amazon settlements…', fn: 'fetch-amazon-settlements', requiresCapability: 'hasAmazon' as keyof SyncCapabilities, flagKey: 'amazon_scan_completed' }] : []),
    ...(hasShopify ? [
      { label: 'Syncing Shopify payouts…', fn: 'fetch-shopify-payouts', requiresCapability: 'hasShopify' as keyof SyncCapabilities, flagKey: 'shopify_scan_completed' },
      { label: 'Fetching Shopify orders…', fn: 'fetch-shopify-orders', requiresCapability: 'hasShopify' as keyof SyncCapabilities },
      { label: 'Detecting sales channels (BigW, MyDeal, Kogan…)', fn: 'scan-shopify-channels', requiresCapability: 'hasShopify' as keyof SyncCapabilities, requiresShopifyOrders: true },
    ] : []),
    ...(hasAnyApi ? [{ label: 'Setting up marketplace tabs…', fn: null, action: 'provision-all' }] : []),
    { label: 'Building your marketplace picture…', fn: 'run-validation-sweep' },
  ];

  // Initialize statuses
  useEffect(() => {
    setStepStatuses(allSteps.map(() => 'pending'));
    setStepMessages(allSteps.map(() => ''));
  }, []);

  const updateStep = useCallback((idx: number, status: StepStatus, message?: string) => {
    setStepStatuses(prev => { const n = [...prev]; n[idx] = status; stepStatusesRef.current = n; return n; });
    if (message) setStepMessages(prev => { const n = [...prev]; n[idx] = message; return n; });
  }, []);

  // Run scans
  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    scanStartTime.current = Date.now();

    if (!hasAnyApi) {
      // No APIs - skip straight to complete
      setStepStatuses(allSteps.map(() => 'success'));
      setProgressPercent(100);
      loadPhaseBData().then(() => setPhase('complete'));
      return;
    }

    let cancelled = false;

    const runScans = async () => {
      try {
        const caps = await detectCapabilities();
        if (!caps.userId || !caps.accessToken || cancelled) return;

        let shopifyOrdersFetched = caps.hasShopifyOrders;

        for (let i = 0; i < allSteps.length; i++) {
          if (cancelled) return;
          const step = allSteps[i];

          // Check capability
          if (step.requiresCapability && !caps[step.requiresCapability]) {
            updateStep(i, 'skipped', 'Not connected');
            updateProgress(i + 1);
            continue;
          }

          if (step.requiresShopifyOrders && !shopifyOrdersFetched) {
            updateStep(i, 'skipped', 'No orders to scan yet');
            updateProgress(i + 1);
            continue;
          }

          updateStep(i, 'running');

          if (step.action === 'provision-all') {
            try {
              await provisionAllMarketplaceConnections(caps.userId);
              updateStep(i, 'success', 'Marketplace tabs configured');
            } catch {
              updateStep(i, 'error', 'Failed to configure tabs');
            }
            updateProgress(i + 1);
            continue;
          }

          if (step.fn) {
            const body: Record<string, unknown> = {};
            const headers: Record<string, string> = {};
            if (step.fn === 'fetch-shopify-orders' && caps.shopDomain) {
              body.shopDomain = caps.shopDomain;
              body.channelDetectionOnly = true;
            }
            if (step.fn === 'fetch-amazon-settlements') {
              headers['x-action'] = 'smart-sync';
            }

            const result = await callEdgeFunctionSafe(step.fn, caps.accessToken, body, { headers });

            if (result.ok) {
              updateStep(i, 'success');
              if (step.fn === 'fetch-shopify-orders') shopifyOrdersFetched = true;
              // Write completion flag
              if (step.flagKey) {
            try {
                await supabase.from('app_settings').upsert(
                  { user_id: caps.userId!, key: step.flagKey, value: 'true' },
                  { onConflict: 'user_id,key' }
                );
              } catch {}
              }
            } else if (result.rateLimited || result.statusCode === 429) {
              updateStep(i, 'rate_limited', 'Rate limited — retrying automatically in background');
            } else {
              updateStep(i, 'error', result.error || 'Failed');
            }
          } else {
            await new Promise(r => setTimeout(r, 400));
            updateStep(i, 'success');
          }

          updateProgress(i + 1);
        }

        // Write remaining flags
        const writeFlag = async (key: string) => {
          try {
            await supabase.from('app_settings').upsert(
              { user_id: caps.userId!, key, value: 'true' },
              { onConflict: 'user_id,key' }
            );
          } catch {}
        };

        if (caps.hasShopify) {
          await writeFlag('shopify_channel_scan_triggered');
          await writeFlag('shopify_scan_completed');
        }
        if (caps.hasXero) await writeFlag('xero_scan_completed');

        // Check if any step ended in rate_limited — don't mark as fully complete
        let hasRateLimited = false;
        setStepStatuses(prev => { hasRateLimited = prev.some(s => s === 'rate_limited'); return prev; });
        if (caps.hasAmazon && !hasRateLimited) {
          await writeFlag('amazon_scan_completed');
        }

        if (!cancelled) {
          setProgressPercent(100);
          await loadPhaseBData();
          if (hasRateLimited) {
            // Stay in scanning phase but show a "still syncing" message
            setTimedOut(true);
          } else {
            setPhase('complete');
          }
        }
      } catch (err) {
        console.error('[results] scan orchestration failed:', err);
        if (!cancelled) {
          setProgressPercent(100);
          await loadPhaseBData();
          setPhase('complete');
        }
      }
    };

    runScans();

    // 3 minute timeout
    const timeout = setTimeout(() => {
      if (!cancelled && phase === 'scanning') {
        setTimedOut(true);
        setProgressPercent(100);
        loadPhaseBData().then(() => setPhase('complete'));
      }
    }, SCAN_TIMEOUT_MS);

    return () => { cancelled = true; clearTimeout(timeout); };
  }, []);

  const updateProgress = (completedSteps: number) => {
    const total = allSteps.length;
    setProgressPercent(Math.min(Math.round((completedSteps / total) * 100), 99));
  };

  const loadPhaseBData = async (): Promise<void> => {
    try {
      const [settlementsRes, subChannelsRes, xeroMatchesRes, validationRes] = await Promise.all([
        supabase.from('settlements').select('marketplace', { count: 'exact' }),
        supabase.from('shopify_sub_channels').select('marketplace_label, order_count').eq('ignored', false),
        supabase.from('xero_accounting_matches').select('id', { count: 'exact' }),
        supabase.from('marketplace_validation').select('overall_status'),
      ]);

      const amazonCount = settlementsRes.data?.filter(s => s.marketplace === 'amazon_au').length || 0;
      const shopifyPayoutCount = settlementsRes.data?.filter(s => s.marketplace === 'shopify_payments').length || 0;
      const channelsDetected = subChannelsRes.data?.map(c => `${c.marketplace_label} (${c.order_count || 0} orders)`) || [];
      const xeroRecords = xeroMatchesRes.count || 0;

      const uploadNeeded = validationRes.data?.filter(v =>
        v.overall_status === 'missing' || v.overall_status === 'settlement_needed'
      ).length || 0;
      const readyToPush = validationRes.data?.filter(v => v.overall_status === 'ready_to_push').length || 0;

      setPhaseBData({
        amazonCount,
        shopifyPayoutCount,
        channelsDetected,
        xeroRecords,
        uploadNeeded,
        readyToPush,
      });
    } catch {
      setPhaseBData({
        amazonCount: 0, shopifyPayoutCount: 0, channelsDetected: [],
        xeroRecords: 0, uploadNeeded: 0, readyToPush: 0,
      });
    }
  };

  const getStepIcon = (status: StepStatus) => {
    switch (status) {
      case 'success': return <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />;
      case 'skipped': return <SkipForward className="h-4 w-4 text-muted-foreground flex-shrink-0" />;
      case 'rate_limited': return <Clock3 className="h-4 w-4 text-amber-500 flex-shrink-0" />;
      case 'error': return <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />;
      case 'running': return <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />;
      default: return <div className="h-4 w-4 rounded-full border border-muted-foreground/30 flex-shrink-0" />;
    }
  };

  // ═══════════════════════════════════════════
  // Phase A — Scanning in progress
  // ═══════════════════════════════════════════
  if (phase === 'scanning') {
    return (
      <div className="space-y-6">
        <div className="text-center space-y-2">
          <Search className="h-8 w-8 text-primary mx-auto" />
          <h2 className="text-xl font-bold text-foreground">
            {hasAnyApi ? "Scanning your accounts…" : "Setting things up…"}
          </h2>
           <p className="text-sm text-muted-foreground">
            {hasAnyApi
              ? "This takes 2–15 minutes depending on your account size."
              : "Almost done — just finalising your setup."
            }
          </p>
          {hasAnyApi && (
            <p className="text-xs text-muted-foreground">
              Larger accounts with many orders or invoices may take longer. You can leave and come back — we'll notify you when it's ready.
            </p>
          )}
        </div>

        {/* Progress bar */}
        <div className="space-y-1">
          <Progress value={progressPercent} className="h-2" />
          <p className="text-xs text-muted-foreground text-right">{progressPercent}%</p>
        </div>

        {/* Scan steps */}
        <div className="max-w-sm mx-auto space-y-3">
          {allSteps.map((step, i) => (
            <div
              key={i}
              className={cn(
                'flex items-center gap-3 text-sm transition-all duration-500',
                (stepStatuses[i] || 'pending') === 'pending' ? 'opacity-30' : 'opacity-100'
              )}
            >
              {getStepIcon(stepStatuses[i] || 'pending')}
              <div className="flex flex-col">
                <span className={cn(
                  'text-foreground',
                  (stepStatuses[i] || 'pending') === 'skipped' && 'text-muted-foreground line-through'
                )}>
                  {(stepStatuses[i] || 'pending') === 'skipped'
                    ? stepMessages[i] || step.label
                    : step.label}
                </span>
                {((stepStatuses[i] || 'pending') === 'error' || (stepStatuses[i] || 'pending') === 'rate_limited') && stepMessages[i] && (
                  <span className="text-xs text-amber-500">{stepMessages[i]}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div className="flex gap-3">
          <Button variant="outline" onClick={onNext} className="flex-1">
            Go to Dashboard — I'll watch it update <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </div>
      </div>
    );
  }

  // ═══════════════════════════════════════════
  // Phase B — Scan complete
  // ═══════════════════════════════════════════
  const data = phaseBData;
  const totalFound = (data?.amazonCount || 0) + (data?.shopifyPayoutCount || 0);
  const hasResults = totalFound > 0 || (data?.channelsDetected?.length || 0) > 0 || (data?.xeroRecords || 0) > 0;

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <PartyPopper className="h-8 w-8 text-emerald-500 mx-auto" />
        <h2 className="text-xl font-bold text-foreground">
          {hasResults ? "Here's what we found" : "You're all set up!"}
        </h2>
        {timedOut && (
          <p className="text-xs text-amber-600 dark:text-amber-400">
            Most scans complete — some may still be finishing. Your dashboard will update automatically.
          </p>
        )}
      </div>

      {/* Summary stats */}
      {hasResults && (
        <div className="grid grid-cols-2 gap-3">
          {totalFound > 0 && (
            <Card className="border-border">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-foreground">{totalFound}</p>
                <p className="text-xs text-muted-foreground">Settlements found</p>
              </CardContent>
            </Card>
          )}
          {(data?.readyToPush || 0) > 0 && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4 text-center">
                <p className="text-2xl font-bold text-primary">{data!.readyToPush}</p>
                <p className="text-xs text-muted-foreground">Ready to push</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Per-source breakdown */}
      <div className="space-y-2">
        {(data?.amazonCount || 0) > 0 && (
          <div className="flex items-center gap-3 text-sm">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
            <span className="text-foreground">Amazon AU: {data!.amazonCount} settlement{data!.amazonCount > 1 ? 's' : ''} fetched</span>
          </div>
        )}
        {(data?.shopifyPayoutCount || 0) > 0 && (
          <div className="flex items-center gap-3 text-sm">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
            <span className="text-foreground">Shopify: {data!.shopifyPayoutCount} payout{data!.shopifyPayoutCount > 1 ? 's' : ''} synced</span>
          </div>
        )}
        {(data?.channelsDetected?.length || 0) > 0 && (
          <div className="flex items-center gap-3 text-sm">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
            <span className="text-foreground">Sales channels detected: {data!.channelsDetected.join(', ')}</span>
          </div>
        )}
        {(data?.xeroRecords || 0) > 0 && (
          <div className="flex items-center gap-3 text-sm">
            <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
            <span className="text-foreground">Xero: {data!.xeroRecords} existing record{data!.xeroRecords > 1 ? 's' : ''} found</span>
          </div>
        )}
        {(data?.uploadNeeded || 0) > 0 && (
          <div className="flex items-center gap-3 text-sm">
            <Upload className="h-4 w-4 text-amber-500 flex-shrink-0" />
            <span className="text-muted-foreground">Upload needed: {data!.uploadNeeded} marketplace{data!.uploadNeeded > 1 ? 's' : ''}</span>
          </div>
        )}
        {!hasResults && hasAnyApi && (
          <Card className="border-primary/20 bg-primary/5">
            <CardContent className="p-3">
              <p className="text-sm text-muted-foreground">
                Your accounts are connected and syncing. Data will appear on your dashboard as scans complete — this can take a few minutes for large accounts.
              </p>
            </CardContent>
          </Card>
        )}
        {!hasResults && !hasAnyApi && (
          <p className="text-sm text-muted-foreground text-center">
            Upload settlement CSVs from your dashboard — you can connect APIs anytime from Settings.
          </p>
        )}
      </div>

      <Button onClick={onNext} className="w-full">
        Go to Dashboard <ArrowRight className="h-4 w-4 ml-1" />
      </Button>
    </div>
  );
}
