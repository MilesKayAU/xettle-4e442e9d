import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { Send, Upload, PartyPopper, ArrowRight } from 'lucide-react';

interface Props {
  onComplete: () => void;
  hasXero: boolean;
}

interface ActionItem {
  id: string;
  label: string;
  description: string;
  icon: typeof Send;
  priority: number;
}

export default function SetupStepActions({ onComplete, hasXero }: Props) {
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [allGood, setAllGood] = useState(false);

  useEffect(() => {
    const load = async () => {
      const items: ActionItem[] = [];

      try {
        const [{ data: settlements }, { data: validation }] = await Promise.all([
          supabase.from('settlements').select('id').limit(1),
          supabase.from('marketplace_validation').select('overall_status'),
        ]);

        const hasSettlements = !!(settlements && settlements.length > 0);
        const missingCount = validation?.filter(v =>
          v.overall_status === 'settlement_needed' || v.overall_status === 'missing'
        ).length || 0;
        const readyToPush = validation?.filter(v => v.overall_status === 'ready_to_push').length || 0;

        if (hasXero && (hasSettlements || readyToPush > 0)) {
          items.push({
            id: 'push_xero',
            label: 'Push settlements to Xero',
            description: `${readyToPush || 'Your'} settlement${readyToPush !== 1 ? 's are' : ' is'} ready to push.`,
            icon: Send,
            priority: 1,
          });
        }

        if (missingCount > 0) {
          items.push({
            id: 'upload_missing',
            label: 'Upload missing settlements',
            description: `${missingCount} marketplace${missingCount > 1 ? 's need' : ' needs'} settlement files.`,
            icon: Upload,
            priority: 2,
          });
        }

        if (items.length === 0) {
          setAllGood(true);
        }
      } catch {
        // silently fail
      }

      setActions(items.sort((a, b) => a.priority - b.priority));
    };
    load();
  }, [hasXero]);

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        {allGood ? (
          <>
            <PartyPopper className="h-8 w-8 text-emerald-500 mx-auto" />
            <h2 className="text-xl font-bold text-foreground">Your books look great!</h2>
            <p className="text-sm text-muted-foreground">
              Everything is connected. Head to your dashboard to explore.
            </p>
          </>
        ) : (
          <>
            <h2 className="text-xl font-bold text-foreground">Recommended next steps</h2>
            <p className="text-sm text-muted-foreground">
              Here's what to do next based on your data.
            </p>
          </>
        )}
      </div>

      {actions.length > 0 && (
        <div className="space-y-2">
          {actions.map((action) => {
            const Icon = action.icon;
            return (
              <Card key={action.id} className="border-border hover:border-primary/30 transition-colors cursor-pointer" onClick={onComplete}>
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                      <Icon className="h-4 w-4 text-primary" />
                    </div>
                    <div>
                      <p className="font-medium text-foreground text-sm">{action.label}</p>
                      <p className="text-xs text-muted-foreground">{action.description}</p>
                    </div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground" />
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <Button onClick={onComplete} className="w-full" variant={allGood ? 'default' : 'outline'}>
        Go to Dashboard
      </Button>
    </div>
  );
}
