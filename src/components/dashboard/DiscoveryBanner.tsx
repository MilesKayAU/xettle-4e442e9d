import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle2, Search } from 'lucide-react';

interface DiscoveryBannerProps {
  onDiscoveryComplete: () => void;
}

interface DetectedChannel {
  marketplace_code: string;
  marketplace_name: string;
}

export default function DiscoveryBanner({ onDiscoveryComplete }: DiscoveryBannerProps) {
  const [status, setStatus] = useState<'running' | 'complete' | 'hidden'>('running');
  const [detectedChannels, setDetectedChannels] = useState<DetectedChannel[]>([]);
  const startTime = useState(() => Date.now())[0];

  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    const MAX_POLL_MS = 120_000; // 2 minutes max

    const poll = async () => {
      // Timeout: stop polling after 2 minutes and treat as complete
      if (Date.now() - startTime > MAX_POLL_MS) {
        console.warn('[DiscoveryBanner] Polling timeout — treating as complete');
        clearInterval(interval);
        setStatus('complete');
        setTimeout(() => {
          onDiscoveryComplete();
          setStatus('hidden');
        }, 1500);
        return;
      }

      const { data: setting } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'xero_discovery_status')
        .maybeSingle();

      if (setting?.value === 'complete') {
        setStatus('complete');
        clearInterval(interval);

        // Fetch detected channels
        const { data: channels } = await supabase
          .from('marketplace_connections')
          .select('marketplace_code, marketplace_name')
          .in('connection_status', ['suggested', 'active']);

        if (channels && channels.length > 0) {
          setDetectedChannels(channels);
        }

        // Brief delay then notify parent
        setTimeout(() => {
          onDiscoveryComplete();
          setStatus('hidden');
        }, 3000);
        return;
      }

      // While running, check for suggested channels appearing
      const { data: suggested } = await supabase
        .from('marketplace_connections')
        .select('marketplace_code, marketplace_name')
        .eq('connection_status', 'suggested');

      if (suggested && suggested.length > 0) {
        setDetectedChannels(suggested);
      }
    };

    poll();
    interval = setInterval(poll, 3000);

    return () => clearInterval(interval);
  }, [onDiscoveryComplete, startTime]);

  if (status === 'hidden') return null;

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 px-5 py-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-500">
      <div className="flex items-start gap-4">
        <div className="flex-shrink-0 mt-0.5">
          {status === 'running' ? (
            <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Loader2 className="h-5 w-5 text-primary animate-spin" />
            </div>
          ) : (
            <div className="h-10 w-10 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
            </div>
          )}
        </div>

        <div className="flex-1 space-y-2">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              {status === 'running'
                ? 'Analysing your Xero account…'
                : 'Analysis complete!'
              }
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              {status === 'running'
                ? 'Scanning your invoices and contacts for marketplace patterns.'
                : 'We found your sales channels. Connect them below to start reconciling.'
              }
            </p>
          </div>

          {detectedChannels.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {detectedChannels.map(ch => (
                <span
                  key={ch.marketplace_code}
                  className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                >
                  <CheckCircle2 className="h-3 w-3" />
                  {ch.marketplace_name}
                </span>
              ))}
            </div>
          )}

          {status === 'running' && detectedChannels.length === 0 && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Search className="h-3 w-3" />
              <span>Checking last 90 days of activity…</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
