import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, ShieldCheck, RefreshCw, Pencil, Loader2, CheckCircle2, Zap } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import AccountingBoundarySetup from '@/components/onboarding/AccountingBoundarySetup';

interface AccountingBoundarySettingsProps {
  xeroConnected: boolean;
  onConnectXero?: () => void;
  onGoToUpload?: () => void;
}

export default function AccountingBoundarySettings({
  xeroConnected,
  onConnectXero,
  onGoToUpload,
}: AccountingBoundarySettingsProps) {
  const [boundaryDate, setBoundaryDate] = useState<string | null>(null);
  const [boundarySource, setBoundarySource] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSetup, setShowSetup] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [customDate, setCustomDate] = useState<Date | undefined>();
  const [sweepRunning, setSweepRunning] = useState(false);
  const [sweepResult, setSweepResult] = useState<any>(null);

  const loadBoundary = useCallback(async () => {
    setLoading(true);
    try {
      const { data: dateRow } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'accounting_boundary_date')
        .maybeSingle();

      const { data: sourceRow } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'accounting_boundary_source')
        .maybeSingle();

      setBoundaryDate(dateRow?.value || null);
      setBoundarySource(sourceRow?.value || null);
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBoundary();
  }, [loadBoundary]);

  async function handleManualDateChange(date: Date | undefined) {
    if (!date) return;

    // BUILD 1 — Reject future boundary dates
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    if (date > today) {
      toast.error('Boundary date cannot be in the future — this would hide all your transactions');
      return;
    }

    setCustomDate(date);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const dateStr = date.toISOString().split('T')[0];

      for (const s of [
        { key: 'accounting_boundary_date', value: dateStr },
        { key: 'accounting_boundary_source', value: 'manual' },
      ]) {
        const { data: existing } = await supabase
          .from('app_settings')
          .select('id')
          .eq('key', s.key)
          .eq('user_id', user.id)
          .maybeSingle();

        if (existing) {
          await supabase.from('app_settings').update({ value: s.value }).eq('key', s.key).eq('user_id', user.id);
        } else {
          await supabase.from('app_settings').insert({ user_id: user.id, key: s.key, value: s.value });
        }
      }

      setBoundaryDate(dateStr);
      setBoundarySource('manual');
      setShowDatePicker(false);
      toast.success(`Boundary updated to ${format(date, 'dd MMM yyyy')}`);
    } catch {
      toast.error('Failed to update boundary');
    }
  }

  async function handleRunSweep() {
    setSweepRunning(true);
    setSweepResult(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error('Not authenticated');
        return;
      }

      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/run-validation-sweep`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({}),
        }
      );

      const data = await res.json();
      if (data.success) {
        const detail = data.details?.[0];
        setSweepResult(detail || data);
        toast.success(`Validation sweep complete — ${detail?.marketplaces_checked || 0} marketplaces checked`);
      } else {
        toast.error(data.error || 'Status refresh failed');
      }
    } catch (err) {
      console.error('Status refresh failed:', err);
      toast.error('Failed to refresh status');
    } finally {
      setSweepRunning(false);
    }
  }

  if (loading) return null;

  // Show full setup wizard if no boundary set or user triggered re-scan
  if (!boundaryDate || showSetup) {
    return (
      <AccountingBoundarySetup
        xeroConnected={xeroConnected}
        onConnectXero={onConnectXero}
        onGoToUpload={onGoToUpload}
        onComplete={() => {
          setShowSetup(false);
          loadBoundary();
        }}
      />
    );
  }

  const sourceLabel =
    boundarySource === 'xero_scan' ? 'Xero scan' :
    boundarySource === 'manual' ? 'Manual' : 'Today';

  return (
    <Card className="border-border">
      <CardContent className="py-4 px-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 text-primary flex-shrink-0" />
            <div>
              <h4 className="text-sm font-semibold">Accounting Boundary</h4>
              <p className="text-xs text-muted-foreground mt-0.5">
                Current boundary:{' '}
                <span className="font-medium text-foreground">
                  {format(new Date(boundaryDate), 'dd MMM yyyy')}
                </span>
                {' · '}Set by: {sourceLabel}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="text-xs gap-1.5"
              onClick={handleRunSweep}
              disabled={sweepRunning}
            >
              {sweepRunning ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Zap className="h-3 w-3" />
              )}
              {sweepRunning ? 'Refreshing...' : 'Refresh Status'}
            </Button>
            {xeroConnected && (
              <Button
                variant="outline"
                size="sm"
                className="text-xs gap-1.5"
                onClick={() => setShowSetup(true)}
              >
                <RefreshCw className="h-3 w-3" />
                Re-scan Xero
              </Button>
            )}
            <Popover open={showDatePicker} onOpenChange={setShowDatePicker}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" className="text-xs gap-1.5">
                  <Pencil className="h-3 w-3" />
                  Change date
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="end">
                <Calendar
                  mode="single"
                  selected={customDate || new Date(boundaryDate)}
                  onSelect={handleManualDateChange}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          </div>
        </div>

        {/* Sweep Result Summary */}
        {sweepResult && (
          <div className="flex items-center gap-4 text-xs border-t border-border pt-3 flex-wrap">
            <div className="flex items-center gap-1">
              <CheckCircle2 className="h-3 w-3 text-emerald-500" />
              <span>{sweepResult.complete || 0} complete</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-primary" />
              <span>{sweepResult.ready_to_push || 0} ready to push</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-amber-500" />
              <span>{sweepResult.settlement_needed || 0} need settlement</span>
            </div>
            {(sweepResult.gap_detected || 0) > 0 && (
              <div className="flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-destructive" />
                <span>{sweepResult.gap_detected} gaps</span>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
