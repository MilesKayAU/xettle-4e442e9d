import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, Sparkles, Zap, Rocket, Crown, ArrowRight } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';

const UPLOAD_COUNT_KEY = 'xettle_manual_upload_count';
const NUDGE_EVERY = 5;

export function getManualUploadCount(): number {
  try { return parseInt(localStorage.getItem(UPLOAD_COUNT_KEY) || '0', 10); } catch { return 0; }
}

export function incrementManualUploadCount(): number {
  const count = getManualUploadCount() + 1;
  try { localStorage.setItem(UPLOAD_COUNT_KEY, String(count)); } catch {}
  return count;
}

export function shouldShowUpgradeNudge(): boolean {
  const count = getManualUploadCount();
  return count > 0 && count % NUDGE_EVERY === 0;
}

/** Small card showing current plan + upgrade CTA for Settings tab */
export function CurrentPlanCard({ isPaid, userTier = 'free' }: { isPaid: boolean; userTier?: 'free' | 'starter' | 'pro' }) {
  const uploadCount = getManualUploadCount();
  const tierLabel = userTier === 'pro' ? 'Pro' : userTier === 'starter' ? 'Starter' : 'Free';

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Your Plan
          </CardTitle>
          <Badge variant={isPaid ? 'default' : 'secondary'} className={isPaid ? '' : 'bg-muted text-muted-foreground'}>
            {tierLabel}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {!isPaid ? (
          <>
            <div className="text-sm text-muted-foreground space-y-1.5">
              <p>You're on the <strong className="text-foreground">Free plan</strong> — manual upload & push with full features.</p>
              {uploadCount > 0 && (
                <p className="text-xs">
                  You've manually uploaded <strong className="text-foreground">{uploadCount}</strong> settlement{uploadCount !== 1 ? 's' : ''} so far.
                </p>
              )}
            </div>
            <div className="bg-muted/50 rounded-lg p-3 space-y-2">
              <p className="text-sm font-medium text-foreground flex items-center gap-1.5">
                <Rocket className="h-4 w-4 text-primary" />
                Upgrade to automate
              </p>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li className="flex items-center gap-1.5">
                  <Check className="h-3 w-3 text-primary" />
                  Starter ($129/yr) — Auto-fetch from Amazon, no more TSV downloads
                </li>
                <li className="flex items-center gap-1.5">
                  <Check className="h-3 w-3 text-primary" />
                  Pro ($229/yr) — Daily auto-push to Xero, fully hands-off
                </li>
              </ul>
            </div>
            <Button size="sm" className="w-full" asChild>
              <Link to="/pricing">
                View Plans
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Link>
            </Button>
          </>
        ) : userTier === 'starter' ? (
          <div className="text-sm text-muted-foreground space-y-2">
            <p>You have access to Amazon SP-API auto-fetch and manual Xero push.</p>
            <div className="bg-muted/50 rounded-lg p-3 space-y-1">
              <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
                <Crown className="h-3.5 w-3.5 text-primary" />
                Upgrade to Pro ($229/yr)
              </p>
              <p className="text-xs text-muted-foreground">Daily auto-push to Xero, email notifications, fully hands-off.</p>
            </div>
            <Button size="sm" variant="outline" className="w-full" asChild>
              <Link to="/pricing">
                View Plans
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Link>
            </Button>
          </div>
        ) : (
          <div className="text-sm text-muted-foreground">
            <p>You're on <strong className="text-foreground">Pro</strong> — full automation with auto-fetch and auto-push to Xero.</p>
            <Button size="sm" variant="outline" className="mt-2" asChild>
              <Link to="/pricing">
                View all plans
                <ArrowRight className="h-3.5 w-3.5 ml-1" />
              </Link>
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Dialog that pops up every 5 manual uploads nudging the user to upgrade */
export function UpgradeNudgeDialog({
  open,
  onOpenChange,
  uploadCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  uploadCount: number;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-primary" />
            You've uploaded {uploadCount} settlements manually!
          </DialogTitle>
          <DialogDescription>
            That's a lot of downloading and uploading. Want to automate it?
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div className="flex items-start gap-3 p-3 rounded-lg bg-primary/5 border border-primary/10">
            <Rocket className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">Starter — $129/year</p>
              <p className="text-xs text-muted-foreground">
                Connect Amazon SP-API and auto-fetch settlements. Never download a TSV file again.
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 border border-border">
            <Crown className="h-5 w-5 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-foreground">Pro — $229/year</p>
              <p className="text-xs text-muted-foreground">
                Everything auto-fetches AND auto-pushes to Xero daily. Open your laptop, books are done.
              </p>
            </div>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="flex-1">
            Maybe later
          </Button>
          <Button asChild className="flex-1">
            <Link to="/pricing">
              View Plans
              <ArrowRight className="h-3.5 w-3.5 ml-1" />
            </Link>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
