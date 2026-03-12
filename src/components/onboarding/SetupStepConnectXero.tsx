import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { BookOpen, CheckCircle2, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  onNext: () => void;
  onSkip: () => void;
  hasXero: boolean;
  onFireBackgroundScan?: (fnName: string) => void;
}

export default function SetupStepConnectXero({ onNext, onSkip, hasXero, onFireBackgroundScan }: Props) {
  const [connecting, setConnecting] = useState(false);
  const [showSkipWarning, setShowSkipWarning] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const redirectUri = 'https://xettle.app/xero/callback';
      const { data, error } = await supabase.functions.invoke('xero-auth', {
        headers: { 
          'x-action': 'authorize',
          'x-redirect-uri': redirectUri,
        },
        body: { redirectUri },
      });
      if (error || data?.error) throw new Error(data?.error || 'Failed to get Xero auth URL');
      const authUrl = data?.authUrl || data?.url;
      if (authUrl) {
        if (data.state) sessionStorage.setItem('xero_oauth_state', data.state);
        window.location.href = authUrl;
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to start Xero connection');
      setConnecting(false);
    }
  };

  const handleContinue = () => {
    // Fire background scan if Xero is connected
    if (hasXero && onFireBackgroundScan) {
      onFireBackgroundScan('scan-xero-history');
    }
    onNext();
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-bold text-foreground">First, connect your Xero account</h2>
        <p className="text-sm text-muted-foreground">
          Xettle pushes your marketplace settlements directly to Xero. This is the core of what we do.
        </p>
      </div>

      <Card className={`border-2 transition-colors ${hasXero ? 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-900/10' : 'border-primary/30 hover:border-primary/50'}`}>
        <CardContent className="p-6 flex flex-col items-center gap-4">
          <div className="h-14 w-14 rounded-xl bg-primary/10 flex items-center justify-center">
            {hasXero ? (
              <CheckCircle2 className="h-7 w-7 text-emerald-500" />
            ) : (
              <BookOpen className="h-7 w-7 text-primary" />
            )}
          </div>
          {hasXero ? (
            <div className="text-center">
              <p className="font-semibold text-foreground">Xero Connected</p>
              <p className="text-xs text-emerald-600 dark:text-emerald-400">Your accounting is linked and ready</p>
            </div>
          ) : (
            <>
              <div className="text-center">
                <p className="font-semibold text-foreground">Xero</p>
                <p className="text-xs text-muted-foreground">Accounting software</p>
              </div>
              <Button size="lg" disabled={connecting} onClick={handleConnect} className="w-full max-w-xs">
                {connecting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Connect Xero
              </Button>
            </>
          )}
        </CardContent>
      </Card>

      {/* Trust signal */}
      <p className="text-xs text-muted-foreground text-center">
        Xettle never changes your Xero data without your explicit approval.
      </p>

      {/* Actions */}
      <div className="flex flex-col items-center gap-2">
        {hasXero ? (
          <Button onClick={handleContinue} className="w-full">
            Continue
          </Button>
        ) : (
          <>
            {showSkipWarning ? (
              <Card className="w-full border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-900/10">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
                    <p className="text-sm text-foreground">
                      Without Xero, settlements can't be pushed to your accounts. You can connect it anytime in Settings.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => setShowSkipWarning(false)}>
                      Go back
                    </Button>
                    <Button variant="ghost" size="sm" className="flex-1 text-muted-foreground" onClick={onSkip}>
                      Skip anyway
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ) : (
              <button
                onClick={() => setShowSkipWarning(true)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                I'll connect Xero later →
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
