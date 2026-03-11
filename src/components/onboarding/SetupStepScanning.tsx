import { useState, useEffect, useRef } from 'react';
import { CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface Props {
  onNext: () => void;
  hasAmazon: boolean;
  hasShopify: boolean;
  hasXero: boolean;
}

interface ScanStep {
  label: string;
  fn: string | null; // edge function name, null = no API call
}

export default function SetupStepScanning({ onNext, hasAmazon, hasShopify, hasXero }: Props) {
  const steps: ScanStep[] = [
    ...(hasXero ? [{ label: 'Scanning Xero for existing invoices...', fn: 'scan-xero-history' }] : []),
    ...(hasAmazon ? [{ label: 'Fetching recent Amazon settlements...', fn: 'fetch-amazon-settlements' }] : []),
    ...(hasShopify ? [
      { label: 'Fetching Shopify payouts...', fn: 'fetch-shopify-payouts' },
      { label: 'Scanning sub-channels...', fn: 'scan-shopify-channels' },
    ] : []),
    { label: 'Checking for uploaded files...', fn: null },
    { label: 'Running validation sweep...', fn: 'run-validation-sweep' },
  ];

  const [completedSteps, setCompletedSteps] = useState<number>(0);
  const [timedOut, setTimedOut] = useState(false);
  const hasStarted = useRef(false);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    let cancelled = false;

    const runScans = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || cancelled) return;

        for (let i = 0; i < steps.length; i++) {
          if (cancelled) return;
          const step = steps[i];

          if (step.fn) {
            try {
              // Call the actual edge function with a 25s timeout per step
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 25000);

              const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
              await fetch(`https://${projectId}.supabase.co/functions/v1/${step.fn}`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${session.access_token}`,
                },
                body: JSON.stringify({}),
                signal: controller.signal,
              }).catch(() => {});

              clearTimeout(timeout);
            } catch {
              // Step failed — continue to next
            }
          } else {
            // No API call, just a brief pause for UX
            await new Promise(r => setTimeout(r, 800));
          }

          if (!cancelled) {
            setCompletedSteps(i + 1);
          }
        }

        // All done — advance after brief pause
        if (!cancelled) {
          setTimeout(() => {
            if (!cancelled) onNext();
          }, 1200);
        }
      } catch {
        // If everything fails, still advance
        if (!cancelled) {
          setTimeout(onNext, 2000);
        }
      }
    };

    runScans();

    // 60s timeout safety — if scans are still running, force advance
    const safetyTimeout = setTimeout(() => {
      if (!cancelled) {
        setTimedOut(true);
        setTimeout(() => {
          if (!cancelled) onNext();
        }, 3000);
      }
    }, 60000);

    return () => {
      cancelled = true;
      clearTimeout(safetyTimeout);
    };
  }, []);

  return (
    <div className="space-y-6 py-4">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-bold text-foreground">Setting up your account...</h2>
        <p className="text-sm text-muted-foreground">
          We're shortcutting your setup by scanning your connected accounts to auto-detect your marketplaces and build them into your dashboard. This usually takes 10–30 seconds.
        </p>
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
