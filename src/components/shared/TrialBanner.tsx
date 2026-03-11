import React from 'react';
import { Link } from 'react-router-dom';
import { Clock, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { TrialStatus } from '@/hooks/use-trial-status';

interface TrialBannerProps {
  status: TrialStatus;
  daysRemaining: number | null;
}

export default function TrialBanner({ status, daysRemaining }: TrialBannerProps) {
  if (status === 'expiring' && daysRemaining !== null) {
    return (
      <div className="bg-amber-500/10 border-b border-amber-300/30 px-4 py-2.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          <Clock className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="text-foreground">
            ⏰ Your free trial ends in <strong>{daysRemaining} day{daysRemaining !== 1 ? 's' : ''}</strong> — upgrade to Pro to keep API sync, auto-push, and AI features.
          </span>
        </div>
        <Button size="sm" asChild className="shrink-0">
          <Link to="/pricing">Upgrade now →</Link>
        </Button>
      </div>
    );
  }

  if (status === 'expired') {
    return (
      <div className="bg-muted border-b border-border px-4 py-2.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          <Lock className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-foreground">
            🔒 Your trial has ended. You are now on the Free plan — CSV upload and manual Xero push still work.
          </span>
        </div>
        <Button size="sm" asChild className="shrink-0">
          <Link to="/pricing">Upgrade to Pro →</Link>
        </Button>
      </div>
    );
  }

  return null;
}
