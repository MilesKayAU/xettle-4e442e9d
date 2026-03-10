import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CalendarIcon, ShieldCheck, RefreshCw, Pencil } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import AccountingBoundarySetup from '@/components/onboarding/AccountingBoundarySetup';

interface AccountingBoundarySettingsProps {
  xeroConnected: boolean;
  onConnectXero?: () => void;
}

export default function AccountingBoundarySettings({
  xeroConnected,
  onConnectXero,
}: AccountingBoundarySettingsProps) {
  const [boundaryDate, setBoundaryDate] = useState<string | null>(null);
  const [boundarySource, setBoundarySource] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [showSetup, setShowSetup] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [customDate, setCustomDate] = useState<Date | undefined>();

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

  if (loading) return null;

  // Show full setup wizard if no boundary set or user triggered re-scan
  if (!boundaryDate || showSetup) {
    return (
      <AccountingBoundarySetup
        xeroConnected={xeroConnected}
        onConnectXero={onConnectXero}
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
      <CardContent className="py-4 px-5">
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
      </CardContent>
    </Card>
  );
}
