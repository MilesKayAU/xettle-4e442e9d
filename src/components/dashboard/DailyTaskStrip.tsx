import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { FileText, Send, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';

interface DailyTaskStripProps {
  onNavigate: (view: string, subTab?: string) => void;
  onScrollToActionCentre?: () => void;
}

interface TaskCounts {
  filesToReview: number;
  readyToPush: number;
  awaitingReconciliation: number;
  reconAlerts: number;
  backfillGaps: number;
}

export default function DailyTaskStrip({ onNavigate, onScrollToActionCentre }: DailyTaskStripProps) {
  const [counts, setCounts] = useState<TaskCounts>({ filesToReview: 0, readyToPush: 0, awaitingReconciliation: 0, reconAlerts: 0, backfillGaps: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        // Use marketplace_validation as source of truth (same as Overview page)
        const [valRes, reconAlerts] = await Promise.all([
          supabase.from('marketplace_validation').select('overall_status, settlement_id'),
          supabase.from('marketplace_validation').select('id', { count: 'exact', head: true })
            .in('overall_status', ['missing', 'partial']),
        ]);

        // Filter out already_recorded and shopify_auto analytics-only records (same as ValidationSweep)
        const valRows = (valRes.data || []).filter(r =>
          r.overall_status !== 'already_recorded' &&
          !(r.settlement_id && r.settlement_id.startsWith('shopify_auto_'))
        );
        // Count using same logic as ValidationSweep
        let filesToReview = 0;
        let readyToPush = 0;
        let awaitingReconciliation = 0;
        valRows.forEach(r => {
          const s = r.overall_status;
          if (s === 'settlement_needed' || s === 'missing') filesToReview++;
          else if (s === 'ready_to_push') readyToPush++;
          else if (s === 'pushed_to_xero' || s === 'synced_external') awaitingReconciliation++;
        });

        setCounts({
          filesToReview,
          readyToPush,
          awaitingReconciliation,
          reconAlerts: reconAlerts.count ?? 0,
          backfillGaps: 0, // Will be populated by coverage map logic post-onboarding
        });
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) return null;

  const totalActions = counts.filesToReview + counts.readyToPush + counts.awaitingReconciliation + counts.reconAlerts;
  if (totalActions === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3">
        <CheckCircle2 className="h-4 w-4 text-green-500" />
        <span className="text-sm font-medium text-foreground">All caught up — nothing needs attention right now</span>
      </div>
    );
  }

  const tasks = [
    {
      key: 'review',
      label: 'Upload needed',
      count: counts.filesToReview,
      icon: FileText,
      color: 'text-amber-500',
      bgColor: 'bg-amber-500/10',
      borderColor: 'border-amber-500/30',
      onClick: () => onNavigate('settlements', 'overview'),
    },
    {
      key: 'push',
      label: 'Ready to push',
      count: counts.readyToPush,
      icon: Send,
      color: 'text-primary',
      bgColor: 'bg-primary/10',
      borderColor: 'border-primary/30',
      onClick: () => onScrollToActionCentre?.() ?? onNavigate('dashboard'),
    },
    {
      key: 'recon',
      label: 'Awaiting reconciliation',
      count: counts.awaitingReconciliation,
      icon: CheckCircle2,
      color: 'text-blue-500',
      bgColor: 'bg-blue-500/10',
      borderColor: 'border-blue-500/30',
      onClick: () => onNavigate('outstanding'),
    },
    {
      key: 'alerts',
      label: 'Recon alerts',
      count: counts.reconAlerts,
      icon: AlertTriangle,
      color: 'text-destructive',
      bgColor: 'bg-destructive/10',
      borderColor: 'border-destructive/30',
      onClick: () => onNavigate('settlements', 'reconciliation'),
    },
  ];

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Today's Tasks</h3>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {tasks.map(task => {
          const Icon = task.icon;
          const hasItems = task.count > 0;
          return (
            <button
              key={task.key}
              onClick={task.onClick}
              className={`group relative flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-all hover:shadow-sm ${
                hasItems
                  ? `${task.bgColor} ${task.borderColor} hover:shadow-md`
                  : 'bg-card border-border opacity-60'
              }`}
            >
              <Icon className={`h-5 w-5 shrink-0 ${hasItems ? task.color : 'text-green-500'}`} />
              <div className="min-w-0 flex-1">
                <div className={`text-lg font-bold leading-none ${hasItems ? 'text-foreground' : 'text-muted-foreground'}`}>
                  {hasItems ? task.count : '✓'}
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 truncate">{task.label}</div>
              </div>
              {hasItems && (
                <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
