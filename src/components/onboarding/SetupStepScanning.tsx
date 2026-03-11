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

export default function SetupStepScanning({ onNext, hasAmazon, hasShopify, hasXero }: Props) {
  const steps = [
    ...(hasXero ? ['Scanning Xero for existing invoices...'] : []),
    ...(hasAmazon ? ['Fetching recent Amazon settlements...'] : []),
    ...(hasShopify ? ['Fetching Shopify payouts...', 'Scanning sub-channels...'] : []),
    'Checking for uploaded files...',
    'Detecting gaps...',
  ];

  const [completedSteps, setCompletedSteps] = useState<number>(0);
  const [timedOut, setTimedOut] = useState(false);
  const hasStarted = useRef(false);

  useEffect(() => {
    if (hasStarted.current) return;
    hasStarted.current = true;

    // Call validation sweep
    const runSweep = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
        fetch(`https://${projectId}.supabase.co/functions/v1/run-validation-sweep`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({}),
        }).catch(() => {});
      } catch {}
    };
    runSweep();

    // Animate steps progressively
    const interval = setInterval(() => {
      setCompletedSteps(prev => {
        if (prev >= steps.length) {
          clearInterval(interval);
          return prev;
        }
        return prev + 1;
      });
    }, 1500);

    // Auto-advance after all steps animate + buffer
    const autoAdvance = setTimeout(() => {
      onNext();
    }, steps.length * 1500 + 1000);

    // 30s timeout safety
    const timeout = setTimeout(() => {
      setTimedOut(true);
      setTimeout(onNext, 2000);
    }, 30000);

    return () => {
      clearInterval(interval);
      clearTimeout(autoAdvance);
      clearTimeout(timeout);
    };
  }, []);

  return (
    <div className="space-y-6 py-4">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-bold text-foreground">Scanning your data...</h2>
        <p className="text-sm text-muted-foreground">
          This usually takes a few seconds.
        </p>
      </div>

      <div className="max-w-sm mx-auto space-y-3">
        {steps.map((label, i) => (
          <div
            key={i}
            className={cn(
              'flex items-center gap-3 text-sm transition-all duration-500',
              i < completedSteps ? 'opacity-100' : 'opacity-30'
            )}
          >
            {i < completedSteps ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
            ) : (
              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground flex-shrink-0" />
            )}
            <span className="text-foreground">{label}</span>
          </div>
        ))}
      </div>

      {timedOut && (
        <div className="text-center space-y-1">
          <div className="flex items-center justify-center gap-2 text-sm text-amber-600 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" />
            Scanning is taking longer than expected.
          </div>
          <p className="text-xs text-muted-foreground">We'll continue in the background.</p>
        </div>
      )}
    </div>
  );
}
