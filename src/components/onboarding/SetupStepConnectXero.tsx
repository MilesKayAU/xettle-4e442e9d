import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { BookOpen, CheckCircle2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

interface Props {
  onNext: () => void;
  onSkip: () => void;
  hasXero: boolean;
}

export default function SetupStepConnectXero({ onNext, onSkip, hasXero }: Props) {
  const [connecting, setConnecting] = useState(false);

  const handleConnect = async () => {
    setConnecting(true);
    try {
      const redirectUri = 'https://xettle.app/xero/callback';
      const { data, error } = await supabase.functions.invoke('xero-auth', {
        headers: { 'x-action': 'authorize' },
        body: { redirectUri },
      });
      if (error || data?.error) throw new Error(data?.error || 'Failed to get Xero auth URL');
      if (data?.url) {
        if (data.state) sessionStorage.setItem('xero_oauth_state', data.state);
        window.location.href = data.url;
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to start Xero connection');
      setConnecting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-bold text-foreground">Connect your accounting software</h2>
        <p className="text-sm text-muted-foreground">
          Xettle will safely check your existing accounting so we don't duplicate anything.
        </p>
      </div>

      <Card className={`border transition-colors ${hasXero ? 'border-emerald-300 bg-emerald-50/50 dark:border-emerald-800 dark:bg-emerald-900/10' : 'border-border'}`}>
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              <BookOpen className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="font-medium text-foreground">Xero</p>
              {hasXero ? (
                <span className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Connected
                </span>
              ) : (
                <span className="text-[10px] text-muted-foreground">Accounting software</span>
              )}
            </div>
          </div>
          {!hasXero && (
            <Button size="sm" disabled={connecting} onClick={handleConnect}>
              {connecting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Connect Xero'}
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col items-center gap-2">
        <Button onClick={onNext} variant={hasXero ? 'default' : 'outline'} className="w-full">
          {hasXero ? 'Continue' : 'Skip for now'}
        </Button>
        {!hasXero && (
          <button onClick={onSkip} className="text-xs text-muted-foreground hover:text-foreground transition-colors">
            I'll connect later
          </button>
        )}
      </div>
    </div>
  );
}
