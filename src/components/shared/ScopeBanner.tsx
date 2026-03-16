/**
 * ScopeBanner — Sitewide banner showing AU-validated scope status.
 *
 * Displays until the user acknowledges the scope consent.
 * Shows on dashboard, upload, settings, and push screens.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, Shield, CheckCircle2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { getScopeConsent, acknowledgeScopeConsent } from '@/actions/scopeConsent';
import type { ScopeConsent } from '@/policy/supportPolicy';

interface ScopeBannerProps {
  /** If true, shows compact inline version */
  compact?: boolean;
}

export default function ScopeBanner({ compact }: ScopeBannerProps) {
  const [consent, setConsent] = useState<ScopeConsent | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getScopeConsent().then(setConsent);
  }, []);

  const handleAcknowledge = useCallback(async () => {
    setSaving(true);
    const result = await acknowledgeScopeConsent();
    if (result.success) {
      setConsent({ acknowledged: true, acknowledgedAt: new Date().toISOString(), version: 'scope-v1-au-validated' });
      setShowModal(false);
    }
    setSaving(false);
  }, []);

  if (!consent || consent.acknowledged) return null;

  if (compact) {
    return (
      <div className="flex items-center gap-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-3 py-1.5">
        <Shield className="h-3.5 w-3.5 shrink-0" />
        <span>AU-validated scope — <button className="underline font-medium" onClick={() => setShowModal(true)}>review &amp; acknowledge</button></span>
      </div>
    );
  }

  return (
    <>
      <div className="bg-amber-500/10 border-b border-amber-300/30 px-4 py-2.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-sm">
          <Shield className="h-4 w-4 text-amber-600 shrink-0" />
          <span className="text-foreground">
            Xettle is <strong>validated for Australian GST</strong> and AU marketplace settlement formats.
            International marketplaces may work but require manual review.
          </span>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowModal(true)} className="shrink-0 text-xs">
          Review scope
        </Button>
      </div>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Xettle Supported Scope
            </DialogTitle>
            <DialogDescription>
              Please review and acknowledge the following before proceeding.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-3">
              <TierExplanation
                tier="Supported"
                badgeVariant="default"
                description="AU-validated rails with Australian GST handling. Full automation available (auto-post, DRAFT and AUTHORISED)."
              />
              <TierExplanation
                tier="Experimental"
                badgeVariant="secondary"
                description="International rails or non-standard currencies. Auto-post creates DRAFT only. AUTHORISED status blocked. Manual review required."
              />
              <TierExplanation
                tier="Unsupported"
                badgeVariant="destructive"
                description="Unknown rails or formats. Auto-post blocked. Manual push as DRAFT only after acknowledgement."
              />
            </div>

            <div className="border-t pt-3">
              <label className="flex items-start gap-2 cursor-pointer">
                <Checkbox
                  checked={checked}
                  onCheckedChange={(v) => setChecked(!!v)}
                  className="mt-0.5"
                />
                <span className="text-sm leading-relaxed">
                  I understand that Xettle is validated for <strong>Australian GST and AU marketplace settlements</strong>.
                  International marketplaces may work but require manual review.
                  I am responsible for confirming tax and accounting correctness for non-AU rails.
                </span>
              </label>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowModal(false)}>Later</Button>
            <Button onClick={handleAcknowledge} disabled={!checked || saving}>
              <CheckCircle2 className="h-4 w-4 mr-1" />
              {saving ? 'Saving…' : 'Acknowledge'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function TierExplanation({ tier, badgeVariant, description }: {
  tier: string;
  badgeVariant: 'default' | 'secondary' | 'destructive';
  description: string;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <Badge variant={badgeVariant} className="text-[10px] mt-0.5 shrink-0">{tier}</Badge>
      <p className="text-xs text-muted-foreground leading-relaxed">{description}</p>
    </div>
  );
}
