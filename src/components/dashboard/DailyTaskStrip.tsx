import { useDashboardTaskCounts, type SetupWarning } from '@/hooks/useDashboardTaskCounts';
import { Settings, FileText, Send, CheckCircle2, AlertTriangle, ArrowRight, Info, Upload } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from '@/components/ui/tooltip';

interface DailyTaskStripProps {
  onNavigate: (view: string, subTab?: string) => void;
  onScrollToActionCentre?: () => void;
}

const STAGES = [
  {
    key: 'setup',
    label: 'Setup required',
    icon: Settings,
    color: 'text-destructive',
    bgColor: 'bg-destructive/10',
    borderColor: 'border-destructive/30',
    tooltip: 'Configuration steps blocking Xero posting — connect Xero, acknowledge scope, complete account mappings.',
  },
  {
    key: 'review',
    label: 'Needs review',
    icon: FileText,
    color: 'text-amber-500',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
    tooltip: 'Settlements ingested but not yet marked ready to push. Review data and confirm before posting.',
  },
  {
    key: 'post',
    label: 'Ready to post',
    icon: Send,
    color: 'text-primary',
    bgColor: 'bg-primary/10',
    borderColor: 'border-primary/30',
    tooltip: 'Settlements verified and eligible to push to Xero. Open the Action Centre to review and send.',
  },
  {
    key: 'recon',
    label: 'Awaiting reconciliation',
    icon: CheckCircle2,
    color: 'text-blue-500',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
    tooltip: 'Settlements pushed to Xero — waiting for bank feed match and payment verification.',
  },
  {
    key: 'alerts',
    label: 'Alerts',
    icon: AlertTriangle,
    color: 'text-destructive',
    bgColor: 'bg-destructive/10',
    borderColor: 'border-destructive/30',
    tooltip: 'Reconciliation mismatches, missing settlements, or partial matches that need attention.',
  },
] as const;

function SetupWarningList({ warnings }: { warnings: SetupWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="col-span-full rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3">
      <p className="text-xs font-semibold text-destructive mb-1.5">Setup issues blocking posting:</p>
      <ul className="space-y-1">
        {warnings.map(w => (
          <li key={w.key} className="text-xs text-muted-foreground flex items-start gap-1.5">
            <span className={w.severity === 'blocking' ? 'text-destructive' : 'text-amber-500'}>•</span>
            <span>{w.message}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function DailyTaskStrip({ onNavigate, onScrollToActionCentre }: DailyTaskStripProps) {
  const {
    setupRequired,
    setupWarnings,
    needsReview,
    readyToPost,
    awaitingReconciliation,
    alerts,
    loading,
  } = useDashboardTaskCounts();

  if (loading) return null;

  const countMap: Record<string, number> = {
    setup: setupRequired,
    review: needsReview,
    post: readyToPost,
    recon: awaitingReconciliation,
    alerts,
  };

  const clickMap: Record<string, () => void> = {
    setup: () => onNavigate('settings'),
    review: () => onNavigate('settlements', 'overview'),
    post: () => onScrollToActionCentre?.() ?? onNavigate('home'),
    recon: () => onNavigate('settlements', 'outstanding'),
    alerts: () => onNavigate('settlements', 'reconciliation'),
  };

  const totalActions = Object.values(countMap).reduce((a, b) => a + b, 0);
  if (totalActions === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-3">
        <CheckCircle2 className="h-4 w-4 text-green-500" />
        <span className="text-sm font-medium text-foreground">All caught up — nothing needs attention right now</span>
      </div>
    );
  }

  return (
    <TooltipProvider delayDuration={300}>
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Today's Tasks</h3>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {STAGES.map(stage => {
            const count = countMap[stage.key];
            const hasItems = count > 0;
            const Icon = stage.icon;
            return (
              <Tooltip key={stage.key}>
                <TooltipTrigger asChild>
                  <button
                    onClick={clickMap[stage.key]}
                    className={`group relative flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-all hover:shadow-sm ${
                      hasItems
                        ? `${stage.bgColor} ${stage.borderColor} hover:shadow-md`
                        : 'bg-card border-border opacity-60'
                    }`}
                  >
                    <Icon className={`h-5 w-5 shrink-0 ${hasItems ? stage.color : 'text-green-500'}`} />
                    <div className="min-w-0 flex-1">
                      <div className={`text-lg font-bold leading-none ${hasItems ? 'text-foreground' : 'text-muted-foreground'}`}>
                        {hasItems ? count : '✓'}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5 truncate">{stage.label}</div>
                    </div>
                    {hasItems && (
                      <ArrowRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                    )}
                    <Info className="h-3 w-3 text-muted-foreground/40 absolute top-1.5 right-1.5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-xs text-xs">
                  {stage.tooltip}
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
        {setupWarnings.length > 0 && <SetupWarningList warnings={setupWarnings} />}
      </div>
    </TooltipProvider>
  );
}
