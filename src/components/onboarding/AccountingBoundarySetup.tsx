import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { CalendarIcon, CheckCircle2, Loader2, AlertTriangle, ShieldCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { MARKETPLACE_LABELS } from '@/utils/settlement-engine';

interface DetectedSettlement {
  marketplace: string;
  last_recorded_date: string;
  last_amount: number;
  source: 'invoice' | 'bank_transaction';
}

interface ScanResult {
  hasXero: boolean;
  accounting_boundary_date: string | null;
  detected_settlements: DetectedSettlement[];
  confidence: 'high' | 'medium' | 'low';
  confidence_reason: string;
}

interface AccountingBoundarySetupProps {
  onComplete: () => void;
  onConnectXero?: () => void;
  xeroConnected?: boolean;
}

type DateOption = 'recommended' | 'today' | 'custom';

export default function AccountingBoundarySetup({
  onComplete,
  onConnectXero,
  xeroConnected = false,
}: AccountingBoundarySetupProps) {
  const [state, setState] = useState<'scanning' | 'detected' | 'no_history' | 'no_xero'>('scanning');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [dateOption, setDateOption] = useState<DateOption>('recommended');
  const [customDate, setCustomDate] = useState<Date | undefined>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!xeroConnected) {
      setState('no_xero');
      setDateOption('today');
      return;
    }
    runScan();
  }, [xeroConnected]);

  async function runScan() {
    setState('scanning');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        setState('no_xero');
        return;
      }

      const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
      const res = await fetch(
        `https://${projectId}.supabase.co/functions/v1/scan-xero-history`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({}),
        }
      );

      const data: ScanResult = await res.json();

      if (!data.hasXero) {
        setState('no_xero');
        setDateOption('today');
        return;
      }

      setScanResult(data);

      if (data.detected_settlements.length > 0 && data.accounting_boundary_date) {
        setState('detected');
        setDateOption('recommended');
      } else {
        setState('no_history');
        setDateOption('today');
      }
    } catch (err) {
      console.error('Scan failed:', err);
      setState('no_history');
      setDateOption('today');
    }
  }

  function getSelectedDate(): string {
    if (dateOption === 'recommended' && scanResult?.accounting_boundary_date) {
      return scanResult.accounting_boundary_date;
    }
    if (dateOption === 'custom' && customDate) {
      return customDate.toISOString().split('T')[0];
    }
    return new Date().toISOString().split('T')[0];
  }

  function getSource(): string {
    if (dateOption === 'recommended' && scanResult?.accounting_boundary_date) return 'xero_scan';
    if (dateOption === 'custom') return 'manual';
    return 'today';
  }

  async function handleConfirm() {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const boundaryDate = getSelectedDate();
      const source = getSource();

      // Upsert boundary date
      const settings = [
        { key: 'accounting_boundary_date', value: boundaryDate },
        { key: 'accounting_boundary_source', value: source },
        { key: 'xero_scan_results', value: JSON.stringify(scanResult?.detected_settlements || []) },
      ];

      for (const s of settings) {
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

      toast.success(`Accounting boundary set to ${format(new Date(boundaryDate), 'dd MMM yyyy')}`);
      onComplete();
    } catch (err) {
      console.error('Failed to save boundary:', err);
      toast.error('Failed to save accounting boundary');
    } finally {
      setSaving(false);
    }
  }

  // ─── Scanning State ──────────────────────────────────────────────────────
  if (state === 'scanning') {
    return (
      <Card className="border-border">
        <CardContent className="py-10 text-center space-y-4">
          <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto" />
          <div>
            <h3 className="text-lg font-semibold">Analysing your Xero account...</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Checking for existing marketplace settlements
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ─── No Xero Connected ───────────────────────────────────────────────────
  if (state === 'no_xero') {
    return (
      <Card className="border-border">
        <CardContent className="py-8 space-y-6">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-lg font-semibold">Connect Xero first</h3>
              <p className="text-sm text-muted-foreground mt-1">
                Connect Xero to detect your accounting boundary automatically.
              </p>
            </div>
          </div>

          {onConnectXero && (
            <Button onClick={onConnectXero} className="w-full sm:w-auto">
              Connect Xero →
            </Button>
          )}

          <div className="border-t border-border pt-4">
            <p className="text-sm text-muted-foreground mb-3">Or choose manually:</p>
            <DateSelector
              dateOption={dateOption}
              setDateOption={setDateOption}
              customDate={customDate}
              setCustomDate={setCustomDate}
              recommendedDate={null}
            />
          </div>

          <Button onClick={handleConfirm} disabled={saving || (dateOption === 'custom' && !customDate)} className="w-full sm:w-auto">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Continue without Xero scan →
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ─── No History Found ────────────────────────────────────────────────────
  if (state === 'no_history') {
    return (
      <Card className="border-border">
        <CardContent className="py-8 space-y-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-green-600 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-lg font-semibold">No existing marketplace settlements found</h3>
              <p className="text-sm text-muted-foreground mt-1">
                This looks like a fresh start. Choose your start date:
              </p>
            </div>
          </div>

          <DateSelector
            dateOption={dateOption}
            setDateOption={setDateOption}
            customDate={customDate}
            setCustomDate={setCustomDate}
            recommendedDate={null}
            todayRecommended
          />

          <Button onClick={handleConfirm} disabled={saving || (dateOption === 'custom' && !customDate)}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
            Confirm & continue →
          </Button>
        </CardContent>
      </Card>
    );
  }

  // ─── Boundary Detected ───────────────────────────────────────────────────
  return (
    <Card className="border-border">
      <CardContent className="py-8 space-y-6">
        <div className="flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-lg font-semibold">We analysed your Xero account ✅</h3>
            <p className="text-sm text-muted-foreground mt-1">
              Latest marketplace settlements found:
            </p>
            {scanResult?.confidence && (
              <p className="text-xs text-muted-foreground mt-1 italic">
                Confidence: {scanResult.confidence} — {scanResult.confidence_reason}
              </p>
            )}
          </div>
        </div>

        {/* Detected settlements table */}
        {scanResult?.detected_settlements && scanResult.detected_settlements.length > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Marketplace</TableHead>
                  <TableHead>Last Recorded</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {scanResult.detected_settlements.map((s) => (
                  <TableRow key={s.marketplace}>
                    <TableCell className="font-medium">
                      {MARKETPLACE_LABELS[s.marketplace] || s.marketplace}
                    </TableCell>
                    <TableCell>
                      {format(new Date(s.last_recorded_date), 'dd MMM yyyy')}
                    </TableCell>
                    <TableCell className="text-right">
                      ${s.last_amount.toLocaleString('en-AU', { minimumFractionDigits: 2 })}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        <div className="bg-muted/50 rounded-lg p-4 text-sm">
          <p>
            Xettle will begin automation from{' '}
            <span className="font-semibold">
              {scanResult?.accounting_boundary_date
                ? format(new Date(scanResult.accounting_boundary_date), 'dd MMM yyyy')
                : 'today'}
            </span>{' '}
            onward. Earlier records will remain unchanged.
          </p>
        </div>

        <div>
          <p className="text-sm font-medium mb-3">Choose your start date:</p>
          <DateSelector
            dateOption={dateOption}
            setDateOption={setDateOption}
            customDate={customDate}
            setCustomDate={setCustomDate}
            recommendedDate={scanResult?.accounting_boundary_date || null}
          />
        </div>

        <Button onClick={handleConfirm} disabled={saving || (dateOption === 'custom' && !customDate)}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
          Confirm & continue →
        </Button>
      </CardContent>
    </Card>
  );
}

// ─── Shared Date Selector ──────────────────────────────────────────────────

function DateSelector({
  dateOption,
  setDateOption,
  customDate,
  setCustomDate,
  recommendedDate,
  todayRecommended = false,
}: {
  dateOption: DateOption;
  setDateOption: (v: DateOption) => void;
  customDate: Date | undefined;
  setCustomDate: (d: Date | undefined) => void;
  recommendedDate: string | null;
  todayRecommended?: boolean;
}) {
  return (
    <RadioGroup
      value={dateOption}
      onValueChange={(v) => setDateOption(v as DateOption)}
      className="space-y-3"
    >
      {recommendedDate && (
        <div className="flex items-center gap-3">
          <RadioGroupItem value="recommended" id="recommended" />
          <Label htmlFor="recommended" className="cursor-pointer">
            Start from {format(new Date(recommendedDate), 'dd MMM yyyy')}{' '}
            <span className="text-xs text-muted-foreground">(recommended)</span>
          </Label>
        </div>
      )}

      <div className="flex items-center gap-3">
        <RadioGroupItem value="today" id="today" />
        <Label htmlFor="today" className="cursor-pointer">
          Start from today only
          {todayRecommended && (
            <span className="text-xs text-muted-foreground ml-1">(recommended)</span>
          )}
        </Label>
      </div>

      <div className="flex items-start gap-3">
        <RadioGroupItem value="custom" id="custom" className="mt-0.5" />
        <div className="space-y-2">
          <Label htmlFor="custom" className="cursor-pointer">
            Choose custom date
          </Label>
          {dateOption === 'custom' && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className={cn(
                    'w-[200px] justify-start text-left font-normal',
                    !customDate && 'text-muted-foreground'
                  )}
                >
                  <CalendarIcon className="mr-2 h-4 w-4" />
                  {customDate ? format(customDate, 'dd MMM yyyy') : 'Pick a date'}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={customDate}
                  onSelect={setCustomDate}
                  initialFocus
                  className="p-3 pointer-events-auto"
                />
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>
    </RadioGroup>
  );
}
