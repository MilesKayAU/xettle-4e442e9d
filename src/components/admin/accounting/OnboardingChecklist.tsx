import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Circle, ChevronDown, ChevronUp, ArrowRight, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface SetupStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
  actionLabel?: string;
  onAction?: () => void;
  optional?: boolean;
}

interface OnboardingChecklistProps {
  xeroConnected: boolean;
  accountsVerified: boolean;
  hasSettlements: boolean;
  onGoToSettings: () => void;
  onConnectXero: () => void;
}

export default function OnboardingChecklist({
  xeroConnected,
  accountsVerified,
  hasSettlements,
  onGoToSettings,
  onConnectXero,
}: OnboardingChecklistProps) {
  const [dismissed, setDismissed] = useState(false);
  const [expanded, setExpanded] = useState(true);

  // Check if user has dismissed the checklist
  useEffect(() => {
    const checkDismissed = async () => {
      try {
        const { data } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'onboarding_dismissed')
          .maybeSingle();
        if (data?.value === 'true') setDismissed(true);
      } catch {}
    };
    checkDismissed();
  }, []);

  const steps: SetupStep[] = [
    {
      id: 'xero',
      title: 'Connect to Xero',
      description: 'Link your Xero organisation so settlements can be pushed as invoices.',
      completed: xeroConnected,
      actionLabel: xeroConnected ? 'Connected ✓' : 'Go to Settings',
      onAction: onGoToSettings,
      optional: true,
    },
    {
      id: 'accounts',
      title: 'Verify account codes',
      description: 'Check that Xero has the right chart of accounts for Amazon settlements.',
      completed: accountsVerified || !xeroConnected,
      actionLabel: xeroConnected ? (accountsVerified ? 'Verified ✓' : 'Go to Settings') : 'Connect Xero first',
      onAction: onGoToSettings,
      optional: true,
    },
    {
      id: 'upload',
      title: 'Upload your first settlement',
      description: 'Download a Flat File V2 from Seller Central → All Statements, then upload it here.',
      completed: hasSettlements,
      actionLabel: hasSettlements ? 'Done ✓' : 'Upload tab above',
    },
  ];

  const completedCount = steps.filter(s => s.completed).length;
  const allDone = completedCount === steps.length;

  // Auto-dismiss when all steps are complete
  if (allDone && !dismissed) {
    // Don't show if everything is done
  }

  // If dismissed or all done, don't show
  if (dismissed) return null;

  const handleDismiss = async () => {
    setDismissed(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data: existing } = await supabase
        .from('app_settings')
        .select('id')
        .eq('key', 'onboarding_dismissed')
        .eq('user_id', user.id)
        .maybeSingle();
      if (existing) {
        await supabase.from('app_settings').update({ value: 'true' }).eq('key', 'onboarding_dismissed').eq('user_id', user.id);
      } else {
        await supabase.from('app_settings').insert({ user_id: user.id, key: 'onboarding_dismissed', value: 'true' });
      }
    } catch {}
  };

  return (
    <Card className="border-2 border-primary/20 bg-primary/5">
      <CardContent className="py-4 px-5">
        {/* Header */}
        <div className="flex items-center justify-between">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-3 text-left flex-1"
          >
            <div className="flex items-center justify-center h-8 w-8 rounded-full bg-primary/10 text-primary text-sm font-bold flex-shrink-0">
              {completedCount}/{steps.length}
            </div>
            <div>
              <h3 className="text-sm font-semibold">
                {allDone ? '🎉 Setup complete!' : 'Get started with Xettle'}
              </h3>
              <p className="text-xs text-muted-foreground">
                {allDone
                  ? 'You\'re all set. You can dismiss this banner.'
                  : `${completedCount} of ${steps.length} steps complete`}
              </p>
            </div>
            {expanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground ml-auto" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground ml-auto" />
            )}
          </button>
          <Button variant="ghost" size="icon" className="h-7 w-7 ml-2" onClick={handleDismiss} title="Dismiss">
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Progress bar */}
        <div className="mt-3 h-1.5 bg-muted rounded-full overflow-hidden">
          <div
            className="h-full bg-primary rounded-full transition-all duration-500"
            style={{ width: `${(completedCount / steps.length) * 100}%` }}
          />
        </div>

        {/* Steps */}
        {expanded && (
          <div className="mt-4 space-y-3">
            {steps.map((step) => (
              <div
                key={step.id}
                className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
                  step.completed
                    ? 'bg-background/50 border-border/50'
                    : 'bg-background border-border'
                }`}
              >
                <div className="mt-0.5">
                  {step.completed ? (
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  ) : (
                    <Circle className="h-5 w-5 text-muted-foreground/40" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={`text-sm font-medium ${step.completed ? 'text-muted-foreground line-through' : ''}`}>
                      {step.title}
                    </p>
                    {step.optional && (
                      <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">Optional</span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
                </div>
                {!step.completed && step.onAction && (
                  <Button variant="outline" size="sm" className="text-xs gap-1 flex-shrink-0" onClick={step.onAction}>
                    {step.actionLabel} <ArrowRight className="h-3 w-3" />
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
