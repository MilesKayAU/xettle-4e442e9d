import { useState, useEffect, useRef } from 'react';
import { CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { provisionAllMarketplaceConnections } from '@/utils/marketplace-token-map';

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
}

export default function SetupStepScanning({ onNext, hasAmazon, hasShopify, hasXero }: Props) {
  const steps: ScanStep[] = [
    ...(hasXero ? [{ label: 'Scanning Xero for existing invoices...', fn: 'scan-xero-history' }] : []),
    ...(hasAmazon ? [{ label: 'Fetching recent Amazon settlements...', fn: 'fetch-amazon-settlements' }] : []),
    ...(hasShopify ? [
      { label: 'Fetching Shopify payouts...', fn: 'fetch-shopify-payouts' },
      { label: 'Fetching Shopify orders...', fn: 'fetch-shopify-orders' },
      { label: 'Scanning sub-channels...', fn: 'scan-shopify-channels' },
    ] : []),
    { label: 'Setting up marketplace tabs...', fn: null, action: 'provision-all' },
    { label: 'Checking for uploaded files...', fn: null },
    { label: 'Running validation sweep...', fn: 'run-validation-sweep' },
  ];

  const [completedSteps, setCompletedSteps] = useState<number>(0);
  const [timedOut, setTimedOut] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const hasStarted = useRef(false);

  // Elapsed time counter
  useEffect(() => {
    const interval = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    let cancelled = false;

    const runScans = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || cancelled) return;

        // Pre-fetch shopDomain for Shopify order calls
        let shopDomain: string | null = null;
        if (hasShopify) {
          const { data: tokenRow } = await supabase
            .from('shopify_tokens')
            .select('shop_domain')
            .single();
          shopDomain = tokenRow?.shop_domain ?? null;
        }

        for (let i = 0; i < steps.length; i++) {
          if (cancelled) return;
          const step = steps[i];

          if (step.action === 'provision-all') {
            // Dynamic provisioning: tokens + sub-channels + ghost cleanup
            try {
              await provisionAllMarketplaceConnections(session.user.id);
            } catch {
              // continue
            }
            await new Promise(r => setTimeout(r, 400));
          } else if (step.fn) {
            try {
              const controller = new AbortController();
              const timeoutMs = step.fn === 'fetch-shopify-orders' ? 60000 : 45000;
              const timeout = setTimeout(() => controller.abort(), timeoutMs);

              // Pass shopDomain for fetch-shopify-orders
              const body = step.fn === 'fetch-shopify-orders' && shopDomain
                ? { shopDomain }
                : {};

              const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
              await fetch(`https://${projectId}.supabase.co/functions/v1/${step.fn}`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${session.access_token}`,
                },
                body: JSON.stringify(body),
                signal: controller.signal,
              }).catch(() => {});

              clearTimeout(timeout);
            } catch {
              // Step failed — if it was fetch-shopify-orders, fire a background retry
              if (step.fn === 'fetch-shopify-orders' && shopDomain) {
                const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
                fetch(`https://${projectId}.supabase.co/functions/v1/fetch-shopify-orders`, {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${session.access_token}`,
                  },
                  body: JSON.stringify({ shopDomain }),
                }).catch(() => {});
              }
            }
          } else {
            await new Promise(r => setTimeout(r, 800));
          }

          if (!cancelled) {
            setCompletedSteps(i + 1);
          }
        }

        // Write flag so Dashboard knows scan was already triggered
        if (hasShopify) {
          await supabase.from('app_settings').upsert(
            { user_id: session.user.id, key: 'shopify_channel_scan_triggered', value: 'true' },
            { onConflict: 'user_id,key' }
          ).then(() => {});
        }

        if (!cancelled) {
          setTimeout(() => {
            if (!cancelled) onNext();
          }, 1200);
        }
      } catch {
        if (!cancelled) {
          setTimeout(onNext, 2000);
        }
      }
    };

    runScans();

    const safetyTimeout = setTimeout(() => {
      if (!cancelled) {
        setTimedOut(true);
        setTimeout(() => {
          if (!cancelled) onNext();
        }, 3000);
      }
    }, 90000);

    return () => {
      cancelled = true;
      clearTimeout(safetyTimeout);
    };
  }, []);

  const showSlowWarning = elapsedSeconds >= 20 && completedSteps < steps.length && !timedOut;

  return (
    <div className="space-y-6 py-4">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-bold text-foreground">Setting up your account...</h2>
        <p className="text-sm text-muted-foreground">
          We're shortcutting your setup by scanning your connected accounts to auto-detect your marketplaces and build them into your dashboard.
        </p>
        <p className="text-xs text-muted-foreground">
          Setup takes about 60 seconds
        </p>
      </div>

      {/* Circular progress indicator */}
      <div className="flex justify-center">
        <div className="relative h-16 w-16">
          <svg className="h-16 w-16 -rotate-90" viewBox="0 0 64 64">
            <circle
              cx="32" cy="32" r="28"
              fill="none"
              className="stroke-muted"
              strokeWidth="4"
            />
            <circle
              cx="32" cy="32" r="28"
              fill="none"
              className="stroke-primary transition-all duration-700"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 28}`}
              strokeDashoffset={`${2 * Math.PI * 28 * (1 - completedSteps / steps.length)}`}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-xs font-semibold text-muted-foreground">
              {Math.round((completedSteps / steps.length) * 100)}%
            </span>
          </div>
        </div>
      </div>

      <div className="max-w-sm mx-auto space-y-3">
        {steps.map((step, i) => (
          <div
            key={i}
            className={cn(
              'flex items-center gap-3 text-sm transition-all duration-500',
              i < completedSteps ? 'opacity-100' : i === completedSteps ? 'opacity-70' : 'opacity-30'
            )}
          >
            {i < completedSteps ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
            ) : i === completedSteps ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />
            ) : (
              <div className="h-4 w-4 rounded-full border border-muted-foreground/30 flex-shrink-0" />
            )}
            <span className="text-foreground">{step.label}</span>
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
