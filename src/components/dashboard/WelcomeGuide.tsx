import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { X, Upload, ArrowRight, Link, FileSpreadsheet, BarChart3, Send } from 'lucide-react';
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

  const steps = [
    {
      number: 1,
      title: 'Upload',
      icon: <FileSpreadsheet className="h-6 w-6" />,
      description: 'Upload a settlement CSV from Amazon, Shopify, Bunnings, or any marketplace.',
    },
    {
      number: 2,
      title: 'Review',
      icon: <BarChart3 className="h-6 w-6" />,
      description: 'We break it down into fees, refunds, sales & GST — ready for your accountant.',
    },
    {
      number: 3,
      title: 'Push',
      icon: <Send className="h-6 w-6" />,
      description: 'One click sends it to Xero as a perfectly formatted journal entry.',
    },
  ];

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
              Get your marketplace accounting sorted in 3 simple steps.
            </p>
          </div>

          {/* 3 Steps */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {steps.map((step, i) => (
              <div key={step.number} className="relative">
                <div className="flex flex-col items-center text-center p-5 rounded-xl border border-border/50 bg-card/50 backdrop-blur-sm space-y-3 h-full">
                  <div className="flex items-center justify-center h-12 w-12 rounded-full bg-primary/10 text-primary">
                    {step.icon}
                  </div>
                  <div className="space-y-1">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      Step {step.number}
                    </span>
                    <h4 className="font-semibold text-foreground text-base">{step.title}</h4>
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    {step.description}
                  </p>
                </div>
                {/* Arrow between steps on desktop */}
                {i < steps.length - 1 && (
                  <div className="hidden md:flex absolute -right-3 top-1/2 -translate-y-1/2 z-10">
                    <ArrowRight className="h-5 w-5 text-muted-foreground/40" />
                  </div>
                )}
              </div>
            ))}
          </div>

          {/* Pro tips */}
          <div className="space-y-2 text-sm">
            <div className="flex items-start gap-2 text-muted-foreground">
              <span className="text-base leading-none mt-0.5">💡</span>
              <span>
                <strong className="text-foreground">Connect Amazon or Shopify</strong> to auto-fetch settlements — no more manual downloads.
              </span>
            </div>
            <div className="flex items-start gap-2 text-muted-foreground">
              <span className="text-base leading-none mt-0.5">💡</span>
              <span>
                <strong className="text-foreground">Connect Xero</strong> to push journal entries with one click.
              </span>
            </div>
          </div>

          {/* CTAs */}
          <div className="flex flex-wrap gap-3">
            <Button onClick={onUpload} className="gap-2">
              <Upload className="h-4 w-4" />
              Upload your first settlement
            </Button>
            <Button variant="outline" onClick={onConnectStore} className="gap-2">
              <Link className="h-4 w-4" />
              Connect a store
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
