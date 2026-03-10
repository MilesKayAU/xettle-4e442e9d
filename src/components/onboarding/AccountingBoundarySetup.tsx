import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { CalendarIcon, CheckCircle2, Loader2, AlertTriangle, ShieldCheck, ChevronDown, ArrowRight, Upload, AlertCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { MARKETPLACE_LABELS, triggerValidationSweep } from '@/utils/settlement-engine';

interface DetectedSettlement {
  marketplace: string;
  last_recorded_date: string;
  last_amount: number;
  source: 'invoice' | 'bank_transaction' | 'journal';
  reference?: string;
  xero_id?: string;
}

interface ScanResult {
  hasXero: boolean;
  accounting_boundary_date: string | null;
  detected_settlements: DetectedSettlement[];
  confidence: 'high' | 'medium' | 'low';
  confidence_reason: string;
}

interface MarketplaceStatus {
  marketplace_code: string;
  marketplace_name: string;
  hasSettlements: boolean;
}

interface AccountingBoundarySetupProps {
  onComplete: () => void;
  onConnectXero?: () => void;
  onGoToUpload?: () => void;
  xeroConnected?: boolean;
}

type DateOption = 'recommended' | 'today' | 'custom';

function sourceLabel(source: string): string {
  switch (source) {
    case 'invoice': return 'Invoice';
    case 'bank_transaction': return 'Bank Deposit';
    case 'journal': return 'Journal';
    default: return source;
  }
}

function ConfidenceBadge({ confidence }: { confidence: 'high' | 'medium' | 'low' }) {
  const config = {
    high: { className: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300', label: 'High confidence', desc: 'Detected Xettle settlement journals' },
    medium: { className: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300', label: 'Medium confidence', desc: 'Detected marketplace invoices in Xero' },
    low: { className: 'bg-muted text-muted-foreground', label: 'Low confidence', desc: 'Detected bank deposits only' },
  };
  const c = config[confidence];
  return (
    <div className="flex items-center gap-2 mt-2">
      <Badge variant="secondary" className={cn('text-xs font-medium', c.className)}>{c.label}</Badge>
      <span className="text-xs text-muted-foreground">{c.desc}</span>
    </div>
  );
}

export default function AccountingBoundarySetup({
  onComplete,
  onConnectXero,
  onGoToUpload,
  xeroConnected = false,
}: AccountingBoundarySetupProps) {
  const [state, setState] = useState<'scanning' | 'detected' | 'no_history' | 'no_xero' | 'confirmed' | 'next_steps'>('scanning');
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [dateOption, setDateOption] = useState<DateOption>('recommended');
  const [customDate, setCustomDate] = useState<Date | undefined>();
  const [saving, setSaving] = useState(false);
  const [confirmedDate, setConfirmedDate] = useState<string | null>(null);
  const [marketplaceStatuses, setMarketplaceStatuses] = useState<MarketplaceStatus[]>([]);
  const [detectionOpen, setDetectionOpen] = useState(false);

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

  async function loadMarketplaceStatuses() {
    try {
      const [connectionsRes, settlementsRes] = await Promise.all([
        supabase.from('marketplace_connections').select('marketplace_code, marketplace_name'),
        supabase.from('settlements').select('marketplace').not('marketplace', 'is', null),
      ]);

      const connections = connectionsRes.data || [];
      const settledCodes = new Set((settlementsRes.data || []).map(s => s.marketplace));

      setMarketplaceStatuses(
        connections.map(c => ({
          marketplace_code: c.marketplace_code,
          marketplace_name: c.marketplace_name,
          hasSettlements: settledCodes.has(c.marketplace_code),
        }))
      );
    } catch (e) {
      console.error('Failed to load marketplace statuses:', e);
    }
  }

  async function handleConfirm() {
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const boundaryDate = getSelectedDate();
      const source = getSource();

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

      setConfirmedDate(boundaryDate);
      setState('confirmed');
      toast.success(`Accounting boundary set to ${format(new Date(boundaryDate), 'dd MMM yyyy')}`);

      // Load marketplace statuses for next step
      await loadMarketplaceStatuses();

      // Show confirmed banner briefly, then transition to next steps
      setTimeout(() => setState('next_steps'), 2500);
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

  // ─── Confirmed Banner (Change 7) ─────────────────────────────────────────
  if (state === 'confirmed') {
    return (
      <Card className="border-border border-emerald-200 dark:border-emerald-800">
        <CardContent className="py-8">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-6 w-6 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
            <div className="space-y-1">
              <h3 className="text-lg font-semibold">Accounting boundary set: {confirmedDate ? format(new Date(confirmedDate), 'dd MMM yyyy') : ''}</h3>
              <p className="text-sm text-muted-foreground">
                No settlements before this date will ever be pushed to Xero automatically.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ─── Next Steps (Change 8) ───────────────────────────────────────────────
  if (state === 'next_steps') {
    const detected = scanResult?.detected_settlements || [];
    const detectedCodes = new Set(detected.map(d => d.marketplace));

    return (
      <Card className="border-border">
        <CardContent className="py-8 space-y-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-lg font-semibold">Your accounting boundary is set ✅</h3>
              <p className="text-sm text-muted-foreground mt-1">
                We found these marketplaces in your account:
              </p>
            </div>
          </div>

          <div className="space-y-2">
            {marketplaceStatuses.length > 0 ? (
              marketplaceStatuses.map(m => {
                const hasDetection = detectedCodes.has(m.marketplace_code) || m.hasSettlements;
                return (
                  <div key={m.marketplace_code} className="flex items-center gap-2 text-sm">
                    {hasDetection ? (
                      <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                    ) : (
                      <AlertCircle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                    )}
                    <span className="font-medium">
                      {MARKETPLACE_LABELS[m.marketplace_code] || m.marketplace_name}
                    </span>
                    <span className="text-muted-foreground text-xs">
                      {hasDetection ? '(active — settlements detected)' : '(orders found — settlement needed)'}
                    </span>
                  </div>
                );
              })
            ) : (
              <p className="text-sm text-muted-foreground">No marketplace connections found yet.</p>
            )}
          </div>

          {marketplaceStatuses.some(m => !m.hasSettlements && !detectedCodes.has(m.marketplace_code)) && (
            <p className="text-sm text-muted-foreground">
              Upload settlement files for the marketplaces marked ⚠️ to reconcile your payouts.
            </p>
          )}

          <div className="flex gap-3">
            {onGoToUpload && (
              <Button onClick={onGoToUpload}>
                <Upload className="h-4 w-4 mr-2" />
                Go to Smart Upload
              </Button>
            )}
            <Button variant="outline" onClick={onComplete}>
              Skip for now <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
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
            <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 mt-0.5 flex-shrink-0" />
            <div>
              <h3 className="text-lg font-semibold">No existing marketplace settlements found</h3>
              <p className="text-sm text-muted-foreground mt-1">
                This looks like a fresh start.
              </p>
            </div>
          </div>

          <div>
            <p className="text-sm font-medium mb-3">Where should Xettle begin automation?</p>
            <DateSelector
              dateOption={dateOption}
              setDateOption={setDateOption}
              customDate={customDate}
              setCustomDate={setCustomDate}
              recommendedDate={null}
              todayRecommended
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

  // ─── Boundary Detected ───────────────────────────────────────────────────
  const boundaryFormatted = scanResult?.accounting_boundary_date
    ? format(new Date(scanResult.accounting_boundary_date), 'dd MMM yyyy')
    : 'today';

  return (
    <Card className="border-border">
      <CardContent className="py-8 space-y-6">
        {/* Header — Change 1: subtitle + Change 2: confidence badge */}
        <div className="flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
          <div>
            <h3 className="text-lg font-semibold">We analysed your Xero account ✅</h3>
            <p className="text-sm text-muted-foreground mt-1">
              We scanned your Xero invoices and journals to detect the most recent marketplace settlements already recorded.
            </p>
            {scanResult?.confidence && (
              <ConfidenceBadge confidence={scanResult.confidence} />
            )}
          </div>
        </div>

        {/* Change 3: Table with Source column */}
        {scanResult?.detected_settlements && scanResult.detected_settlements.length > 0 && (
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Marketplace</TableHead>
                  <TableHead>Last Settlement Recorded</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Source</TableHead>
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
                    <TableCell className="text-muted-foreground text-sm">
                      {sourceLabel(s.source)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Change 6: How we detected this */}
        {scanResult?.detected_settlements && scanResult.detected_settlements.length > 0 && (
          <Collapsible open={detectionOpen} onOpenChange={setDetectionOpen}>
            <CollapsibleTrigger className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors cursor-pointer">
              <span>How we detected this</span>
              <ChevronDown className={cn('h-4 w-4 transition-transform', detectionOpen && 'rotate-180')} />
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-4">
              {scanResult.detected_settlements.map((s) => (
                <div key={s.marketplace} className="border-l-2 border-muted pl-4 space-y-0.5">
                  <p className="text-sm font-medium">
                    {MARKETPLACE_LABELS[s.marketplace] || s.marketplace}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Detected from {sourceLabel(s.source)}
                    {s.reference ? ` ${s.reference}` : ''}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Date: {format(new Date(s.last_recorded_date), 'dd MMM yyyy')}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Amount: ${s.last_amount.toLocaleString('en-AU', { minimumFractionDigits: 2 })}
                  </p>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}

        {/* Change 4: Prominent boundary date card */}
        <div className="rounded-lg border border-primary/30 bg-primary/5 p-5 space-y-2">
          <p className="text-sm font-medium text-primary">Automation Start Date</p>
          <p className="text-2xl font-bold">{boundaryFormatted}</p>
          <p className="text-sm text-muted-foreground">
            Everything before this date is already recorded in Xero.
            Xettle will only automate settlements after this point.
          </p>
        </div>

        {/* Change 5: Improved decision section */}
        <div>
          <p className="text-sm font-medium mb-3">Where should Xettle begin automation?</p>
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

// ─── Shared Date Selector (Change 5 — improved labels) ────────────────────

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
      className="space-y-4"
    >
      {recommendedDate && (
        <div className="flex items-start gap-3">
          <RadioGroupItem value="recommended" id="recommended" className="mt-0.5" />
          <div>
            <Label htmlFor="recommended" className="cursor-pointer font-medium">
              Start from {format(new Date(recommendedDate), 'dd MMM yyyy')}{' '}
              <span className="text-xs text-muted-foreground">(recommended)</span>
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">
              Continue from your latest settlement in Xero.
            </p>
          </div>
        </div>
      )}

      <div className="flex items-start gap-3">
        <RadioGroupItem value="today" id="today" className="mt-0.5" />
        <div>
          <Label htmlFor="today" className="cursor-pointer font-medium">
            Start from today only
            {todayRecommended && (
              <span className="text-xs text-muted-foreground ml-1">(recommended)</span>
            )}
          </Label>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ignore historical records, begin fresh.
          </p>
        </div>
      </div>

      <div className="flex items-start gap-3">
        <RadioGroupItem value="custom" id="custom" className="mt-0.5" />
        <div className="space-y-2">
          <Label htmlFor="custom" className="cursor-pointer font-medium">
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
