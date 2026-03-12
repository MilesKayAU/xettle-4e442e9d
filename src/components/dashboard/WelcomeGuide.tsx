import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { X, Upload, ArrowRight, Link, Zap, FileSpreadsheet, BarChart3, Send, Sparkles, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface WelcomeGuideProps {
  onUpload: () => void;
  onConnectStore: () => void;
}

export default function WelcomeGuide({ onUpload, onConnectStore }: WelcomeGuideProps) {
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'welcome_guide_dismissed')
        .maybeSingle();
      setDismissed(data?.value === 'true');
    })();
  }, []);

  const handleDismiss = async () => {
    setDismissed(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    await supabase.from('app_settings').upsert({
      user_id: user.id,
      key: 'welcome_guide_dismissed',
      value: 'true',
    }, { onConflict: 'user_id,key' });
  };

  if (dismissed === null || dismissed) return null;

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-accent/5 relative overflow-hidden">
      <button
        onClick={handleDismiss}
        className="absolute top-4 right-4 text-muted-foreground hover:text-foreground transition-colors z-10"
        aria-label="Dismiss welcome guide"
      >
        <X className="h-4 w-4" />
      </button>

      <CardContent className="py-8 px-6 md:px-8">
        <div className="space-y-6">
          {/* Header */}
          <div>
            <h3 className="text-xl font-bold text-foreground">
              Welcome to Xettle — here's how it works
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Most sellers use <strong className="text-foreground">both together</strong> — APIs for automated imports, file uploads for everything else.
            </p>
          </div>

          {/* Two paths */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Automated path */}
            <div className="relative rounded-xl border border-primary/30 bg-primary/5 p-5 space-y-4">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary/15 text-primary">
                  <Zap className="h-4 w-4" />
                </div>
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-primary">Recommended</span>
                  <h4 className="font-semibold text-foreground text-base leading-tight">Automated</h4>
                </div>
              </div>
              <div className="space-y-2.5">
                <div className="flex items-start gap-2.5">
                  <div className="flex items-center justify-center h-5 w-5 rounded-full bg-primary/10 text-primary flex-shrink-0 mt-0.5">
                    <span className="text-xs font-bold">1</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    <strong className="text-foreground">Connect</strong> your Amazon, Shopify, and Xero accounts
                  </p>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="flex items-center justify-center h-5 w-5 rounded-full bg-primary/10 text-primary flex-shrink-0 mt-0.5">
                    <span className="text-xs font-bold">2</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    <strong className="text-foreground">We fetch</strong> settlements, detect channels, and match fees — automatically
                  </p>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="flex items-center justify-center h-5 w-5 rounded-full bg-primary/10 text-primary flex-shrink-0 mt-0.5">
                    <span className="text-xs font-bold">3</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    <strong className="text-foreground">One click</strong> pushes perfectly formatted journals to Xero
                  </p>
                </div>
              </div>
              <Button onClick={onConnectStore} size="sm" className="gap-2 w-full">
                <Link className="h-4 w-4" />
                Connect your accounts
              </Button>
            </div>

            {/* Traditional path */}
            <div className="relative rounded-xl border border-border/50 bg-card/50 p-5 space-y-4">
              <div className="flex items-center gap-2">
                <div className="flex items-center justify-center h-8 w-8 rounded-full bg-muted text-muted-foreground">
                  <FileSpreadsheet className="h-4 w-4" />
                </div>
                <div>
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Manual</span>
                  <h4 className="font-semibold text-foreground text-base leading-tight">CSV Upload</h4>
                </div>
              </div>
              <div className="space-y-2.5">
                <div className="flex items-start gap-2.5">
                  <div className="flex items-center justify-center h-5 w-5 rounded-full bg-muted text-muted-foreground flex-shrink-0 mt-0.5">
                    <span className="text-xs font-bold">1</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    <strong className="text-foreground">Upload</strong> a settlement CSV from any marketplace
                  </p>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="flex items-center justify-center h-5 w-5 rounded-full bg-muted text-muted-foreground flex-shrink-0 mt-0.5">
                    <span className="text-xs font-bold">2</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    <strong className="text-foreground">We parse</strong> fees, refunds, sales & GST — ready for your accountant
                  </p>
                </div>
                <div className="flex items-start gap-2.5">
                  <div className="flex items-center justify-center h-5 w-5 rounded-full bg-muted text-muted-foreground flex-shrink-0 mt-0.5">
                    <span className="text-xs font-bold">3</span>
                  </div>
                  <p className="text-sm text-muted-foreground">
                    <strong className="text-foreground">Push</strong> to Xero or export as a formatted CSV
                  </p>
                </div>
              </div>
              <Button onClick={onUpload} variant="outline" size="sm" className="gap-2 w-full">
                <Upload className="h-4 w-4" />
                Upload a settlement file
              </Button>
            </div>
          </div>

          {/* Tip */}
          <div className="flex items-start gap-2 text-sm text-muted-foreground">
            <span className="text-base leading-none mt-0.5">💡</span>
            <span>
              <strong className="text-foreground">Best of both:</strong> Connect your APIs for automatic imports, then upload CSVs for marketplaces we don't yet support — Xettle learns new formats instantly.
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
