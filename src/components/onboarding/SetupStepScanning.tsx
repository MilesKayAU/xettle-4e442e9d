import { useState, useEffect, useRef } from 'react';
import { CheckCircle2, Loader2, AlertTriangle, SkipForward } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { provisionAllMarketplaceConnections } from '@/utils/marketplace-token-map';
import { detectCapabilities, callEdgeFunctionSafe, type SyncCapabilities } from '@/utils/sync-capabilities';

interface Props {
  onNext: () => void;
  hasAmazon: boolean;
  hasShopify: boolean;
  hasXero: boolean;
}

interface ScanStep {
  label: string;
  fn: string | null;
  action?: string;
  requiresCapability?: keyof SyncCapabilities;
  /** If this step needs shopify orders to exist first */
  requiresShopifyOrders?: boolean;
}

type StepStatus = 'pending' | 'running' | 'success' | 'skipped' | 'error';

export default function SetupStepScanning({ onNext, hasAmazon, hasShopify, hasXero }: Props) {
  const allSteps: ScanStep[] = [
    // Phase 1 — parallel fetches (run sequentially in UI for progress, but we check caps)
    ...(hasXero ? [{ label: 'Scanning Xero for existing invoices…', fn: 'scan-xero-history', requiresCapability: 'hasXero' as keyof SyncCapabilities }] : []),
    ...(hasAmazon ? [{ label: 'Fetching Amazon settlements…', fn: 'fetch-amazon-settlements', requiresCapability: 'hasAmazon' as keyof SyncCapabilities }] : []),
    ...(hasShopify ? [
      { label: 'Fetching Shopify payouts…', fn: 'fetch-shopify-payouts', requiresCapability: 'hasShopify' as keyof SyncCapabilities },
      { label: 'Fetching Shopify orders…', fn: 'fetch-shopify-orders', requiresCapability: 'hasShopify' as keyof SyncCapabilities },
      { label: 'Scanning sales channels…', fn: 'scan-shopify-channels', requiresCapability: 'hasShopify' as keyof SyncCapabilities, requiresShopifyOrders: true },
    ] : []),
    { label: 'Setting up marketplace tabs…', fn: null, action: 'provision-all' },
    { label: 'Running validation sweep…', fn: 'run-validation-sweep' },
  ];

  const [stepStatuses, setStepStatuses] = useState<StepStatus[]>(allSteps.map(() => 'pending'));
  const [stepMessages, setStepMessages] = useState<string[]>(allSteps.map(() => ''));
  const [currentStep, setCurrentStep] = useState(0);
  const [timedOut, setTimedOut] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const hasStarted = useRef(false);

  const updateStep = (idx: number, status: StepStatus, message?: string) => {
    setStepStatuses(prev => { const n = [...prev]; n[idx] = status; return n; });
    if (message) setStepMessages(prev => { const n = [...prev]; n[idx] = message; return n; });
  };

  useEffect(() => {
    const interval = setInterval(() => setElapsedSeconds(prev => prev + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;
    let cancelled = false;

    const runScans = async () => {
      try {
        // Step 0: Detect real capabilities from DB (not just props)
        const caps = await detectCapabilities();
        if (!caps.userId || !caps.accessToken || cancelled) return;

        let shopifyOrdersFetched = caps.hasShopifyOrders;

        for (let i = 0; i < allSteps.length; i++) {
          if (cancelled) return;
          const step = allSteps[i];
          setCurrentStep(i);

          // Check capability requirement
          if (step.requiresCapability && !caps[step.requiresCapability]) {
            const capName = step.requiresCapability.replace('has', '');
            updateStep(i, 'skipped', `${capName} not connected — skipped`);
            continue;
          }

          // Check if this step needs shopify orders data
          if (step.requiresShopifyOrders && !shopifyOrdersFetched) {
            updateStep(i, 'skipped', 'No Shopify orders to scan yet');
            continue;
          }

          updateStep(i, 'running');

          if (step.action === 'provision-all') {
            try {
              await provisionAllMarketplaceConnections(caps.userId);
              updateStep(i, 'success', 'Marketplace tabs configured');
            } catch (err: any) {
              console.error('[sync] provision failed:', err);
              updateStep(i, 'error', 'Failed to configure tabs');
            }
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
              // Track that shopify orders were fetched
              if (step.fn === 'fetch-shopify-orders') {
                shopifyOrdersFetched = true;
              }
} else {
          // Non-critical: show as success silently — scheduled-sync will retry
          console.warn(`[setup-scan] ${step.fn} non-critical issue:`, result.error);
          updateStep(i, 'success');
        }
          } else {
            // Placeholder step
            await new Promise(r => setTimeout(r, 400));
            updateStep(i, 'success');
          }
        }

        // Write scan completion flags so PostSetupBanner doesn't re-run
        const writeFlag = async (key: string) => {
          await supabase.from('app_settings').upsert(
            { user_id: caps.userId!, key, value: 'true' },
            { onConflict: 'user_id,key' }
          );
        };

        const flagPromises: Promise<void>[] = [];
        if (caps.hasShopify) {
          flagPromises.push(writeFlag('shopify_channel_scan_triggered'));
          flagPromises.push(writeFlag('shopify_scan_completed'));
        }
        if (caps.hasAmazon) {
          flagPromises.push(writeFlag('amazon_scan_completed'));
        }
        if (caps.hasXero) {
          flagPromises.push(writeFlag('xero_scan_completed'));
        }
        await Promise.allSettled(flagPromises);

        if (!cancelled) {
          setTimeout(() => { if (!cancelled) onNext(); }, 1200);
        }
      } catch (err) {
        console.error('[sync] scan orchestration failed:', err);
        if (!cancelled) {
          setTimeout(onNext, 2000);
        }
      }
    };

    runScans();

    const safetyTimeout = setTimeout(() => {
      if (!cancelled) {
        setTimedOut(true);
        setTimeout(() => { if (!cancelled) onNext(); }, 3000);
      }
    }, 90000);

    return () => { cancelled = true; clearTimeout(safetyTimeout); };
  }, []);

  const completedCount = stepStatuses.filter(s => s !== 'pending' && s !== 'running').length;
  const showSlowWarning = elapsedSeconds >= 20 && completedCount < allSteps.length && !timedOut;

  const getStepIcon = (status: StepStatus) => {
    switch (status) {
      case 'success': return <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />;
      case 'skipped': return <SkipForward className="h-4 w-4 text-muted-foreground flex-shrink-0" />;
      case 'error': return <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />;
      case 'running': return <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />;
      default: return <div className="h-4 w-4 rounded-full border border-muted-foreground/30 flex-shrink-0" />;
    }
  };

  return (
    <div className="space-y-6 py-4">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-bold text-foreground">Setting up your account...</h2>
        <p className="text-sm text-muted-foreground">
          We're scanning your connected accounts to auto-detect your marketplaces and build your dashboard.
        </p>
        <p className="text-xs text-muted-foreground">Setup takes about 60 seconds</p>
      </div>

      {/* Circular progress */}
      <div className="flex justify-center">
        <div className="relative h-16 w-16">
          <svg className="h-16 w-16 -rotate-90" viewBox="0 0 64 64">
            <circle cx="32" cy="32" r="28" fill="none" className="stroke-muted" strokeWidth="4" />
            <circle
              cx="32" cy="32" r="28" fill="none"
              className="stroke-primary transition-all duration-700"
              strokeWidth="4" strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 28}`}
              strokeDashoffset={`${2 * Math.PI * 28 * (1 - completedCount / allSteps.length)}`}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-semibold text-muted-foreground">
              {Math.round((completedCount / allSteps.length) * 100)}%
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-sm mx-auto space-y-3">
        {allSteps.map((step, i) => (
          <div
            key={i}
            className={cn(
              'flex items-center gap-3 text-sm transition-all duration-500',
              stepStatuses[i] === 'pending' ? 'opacity-30' : 'opacity-100'
            )}
          >
            {getStepIcon(stepStatuses[i])}
            <div className="flex flex-col">
              <span className={cn(
                'text-foreground',
                stepStatuses[i] === 'skipped' && 'text-muted-foreground line-through'
              )}>
                {stepStatuses[i] === 'skipped'
                  ? stepMessages[i] || step.label
                  : step.label}
              </span>
              {stepStatuses[i] === 'error' && stepMessages[i] && (
                <span className="text-xs text-amber-500">{stepMessages[i]}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {showSlowWarning && (
        <div className="text-center space-y-1 animate-in fade-in duration-500">
          <div className="flex items-center justify-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">
              Still working — this can take up to 60 seconds for large accounts
            </p>
          </div>
          <p className="text-xs text-muted-foreground">Please don't close this window</p>
        </div>
      )}

      {timedOut && (
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-2 text-sm text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            Almost there — just finishing up.
          </div>
          <p className="text-xs text-muted-foreground">We'll keep syncing in the background if needed.</p>
        </div>
      )}
    </div>
  );
}
