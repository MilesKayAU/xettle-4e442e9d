/**
 * AutomationSettingsPanel — DEPRECATED
 * 
 * This panel has been superseded by RailPostingSettings which provides
 * per-marketplace posting controls, Draft/Authorised mode, and batch throttling.
 * 
 * Kept as a redirect to avoid broken navigation references.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ArrowRight, Settings } from 'lucide-react';

interface AutomationSettingsPanelProps {
  userTier: 'free' | 'starter' | 'pro';
}

export default function AutomationSettingsPanel({ userTier }: AutomationSettingsPanelProps) {
  const scrollToPostingSettings = () => {
    // Scroll to the RailPostingSettings section in the Settings page
    const el = document.getElementById('posting-mode-section');
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Settings className="h-4 w-4 text-primary" />
          Automation Controls
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-border bg-muted/30 p-4 text-center space-y-3">
          <p className="text-sm text-muted-foreground">
            Automation settings have moved to <strong className="text-foreground">Organisation Posting Mode</strong> for per-marketplace control.
          </p>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={scrollToPostingSettings}>
            Go to Posting Settings
            <ArrowRight className="h-3.5 w-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
