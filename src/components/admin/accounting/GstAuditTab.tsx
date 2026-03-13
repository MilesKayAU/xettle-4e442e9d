
import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { AlertTriangle, RefreshCw, Loader2, ChevronRight, ShieldAlert, Info } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import LoadingSpinner from '@/components/ui/loading-spinner';

const formatAUD = (n: number | null | undefined) => {
  if (n === null || n === undefined) return '—';
  const prefix = n < 0 ? '-$' : '$';
  return `${prefix}${Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

interface GstSummaryRow {
  period_start: string;
  period_end: string;
  marketplace_sales_ex_gst: number;
  marketplace_gst_on_sales_estimate: number;
  marketplace_fees_ex_gst: number;
  marketplace_gst_on_fees_estimate: number;
  marketplace_refund_gst_estimate: number;
  marketplace_adjustment_gst_estimate: number;
  marketplace_tax_collected_by_platform: number;
  marketplace_unknown_gst: number;
  xero_gst: number | null;
  difference: number | null;
  confidence_score: number;
  confidence_label: string;
  notes: string[];
  breakdown: {
    marketplaces: Record<string, {
      gst_on_sales: number;
      gst_on_fees: number;
      revenue_ex_gst: number;
      fees_ex_gst: number;
      refund_gst: number;
      settlement_count: number;
    }>;
    settlements: Array<{
      settlement_id: string;
      marketplace: string;
      period_start: string;
      period_end: string;
      status: string;
      bank_deposit: number;
      gst_on_sales: number;
      gst_on_fees: number;
      refund_gst: number;
    }>;
  };
}

function getMonthPeriods(count: number = 12): { start: string; end: string; label: string }[] {
  const periods: { start: string; end: string; label: string }[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const start = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    const end = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const label = d.toLocaleString('en-AU', { month: 'short', year: 'numeric' });
    periods.push({ start, end, label });
  }
  return periods;
}

function ConfidenceBadge({ label, score }: { label: string; score: number }) {
  const variant = label === 'High' ? 'default' : label === 'Medium' ? 'secondary' : 'destructive';
  return (
    <Badge variant={variant} className="text-xs">
      {label} ({score})
    </Badge>
  );
}

const MARKETPLACE_LABELS: Record<string, string> = {
  amazon_au: 'Amazon AU',
  shopify: 'Shopify',
  bunnings: 'Bunnings',
  woolworths: 'Woolworths',
  ebay_au: 'eBay AU',
  catch_au: 'Catch',
  unknown: 'Unknown',
};

export default function GstAuditTab() {
  const [summaries, setSummaries] = useState<Record<string, GstSummaryRow>>({});
  const [loading, setLoading] = useState(true);
  const [refreshingPeriod, setRefreshingPeriod] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<GstSummaryRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const periods = getMonthPeriods(12);

  const loadCachedSummaries = useCallback(async () => {
    try {
      const { data, error } = await (supabase as any)
        .from('gst_audit_summary')
        .select('*')
        .order('period_start', { ascending: false });

      if (error) throw error;

      const map: Record<string, GstSummaryRow> = {};
      for (const row of (data || []) as any[]) {
        const key = `${row.period_start}_${row.period_end}`;
        map[key] = {
          ...row,
          notes: Array.isArray(row.notes) ? row.notes as string[] : [],
          breakdown: (row.breakdown && typeof row.breakdown === 'object') ? row.breakdown as any : { marketplaces: {}, settlements: [] },
        };
      }
      setSummaries(map);
    } catch {
      toast.error('Failed to load GST audit data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadCachedSummaries();
  }, [loadCachedSummaries]);

  const refreshPeriod = useCallback(async (periodStart: string, periodEnd: string) => {
    const key = `${periodStart}_${periodEnd}`;
    setRefreshingPeriod(key);
    try {
      const { data, error } = await supabase.functions.invoke('generate-gst-summary', {
        body: { period_start: periodStart, period_end: periodEnd },
      });
      if (error) throw error;
      setSummaries(prev => ({ ...prev, [key]: data }));
      toast.success(`GST audit refreshed for ${periodStart}`);
    } catch (err: any) {
      toast.error(err.message || 'Failed to generate GST summary');
    } finally {
      setRefreshingPeriod(null);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    setLoading(true);
    for (const p of periods) {
      await refreshPeriod(p.start, p.end);
    }
    setLoading(false);
  }, [periods, refreshPeriod]);

  const openDrilldown = (row: GstSummaryRow) => {
    setSelectedPeriod(row);
    setDrawerOpen(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner />
        <span className="ml-3 text-sm text-muted-foreground">Loading GST audit data...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* ── Mandatory Disclaimer ── */}
      <Alert variant="destructive" className="border-amber-300 bg-amber-50 text-amber-900 [&>svg]:text-amber-600">
        <ShieldAlert className="h-5 w-5" />
        <AlertTitle className="font-semibold">Marketplace GST Audit — Estimate Only</AlertTitle>
        <AlertDescription className="text-sm mt-1 space-y-1">
          <p>This report compares GST estimated from marketplace settlement data (Amazon, Shopify, etc.) with GST recorded in Xero.</p>
          <p>It is intended as a <strong>reconciliation aid only</strong>.</p>
          <p>These figures are <strong>estimates</strong> and do not replace official BAS reporting.</p>
          <p>Always review results with your accountant and confirm final GST figures in Xero before lodging BAS with the ATO.</p>
        </AlertDescription>
      </Alert>

      {/* ── Summary Table ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base">Monthly GST Comparison</CardTitle>
              <CardDescription className="text-xs mt-1">Marketplace-derived GST estimates vs Xero records</CardDescription>
            </div>
            <Button variant="outline" size="sm" onClick={refreshAll} disabled={loading} className="gap-1.5">
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh All
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Marketplace GST (est.)</TableHead>
                <TableHead className="text-right">Xero GST</TableHead>
                <TableHead className="text-right">Difference</TableHead>
                <TableHead>Confidence</TableHead>
                <TableHead className="w-10"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {periods.map(p => {
                const key = `${p.start}_${p.end}`;
                const row = summaries[key];
                const isRefreshing = refreshingPeriod === key;
                const marketplaceGst = row
                  ? row.marketplace_gst_on_sales_estimate - row.marketplace_refund_gst_estimate
                  : null;

                return (
                  <TableRow
                    key={key}
                    className={`cursor-pointer hover:bg-muted/50 transition-colors ${row ? '' : 'opacity-60'}`}
                    onClick={() => row && openDrilldown(row)}
                  >
                    <TableCell className="font-medium text-sm">{p.label}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {row ? formatAUD(marketplaceGst) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {row ? formatAUD(row.xero_gst) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {row?.difference !== null && row?.difference !== undefined ? (
                        <span className={Math.abs(row.difference) < 1 ? 'text-green-600' : Math.abs(row.difference) < 50 ? 'text-amber-600' : 'text-destructive'}>
                          {row.difference >= 0 ? '+' : ''}{formatAUD(row.difference)}
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell>
                      {row ? <ConfidenceBadge label={row.confidence_label} score={row.confidence_score} /> : '—'}
                    </TableCell>
                    <TableCell>
                      {isRefreshing ? (
                        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7"
                          onClick={(e) => {
                            e.stopPropagation();
                            refreshPeriod(p.start, p.end);
                          }}
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* ── Drilldown Drawer ── */}
      <Sheet open={drawerOpen} onOpenChange={setDrawerOpen}>
        <SheetContent className="sm:max-w-xl overflow-y-auto">
          {selectedPeriod && (
            <>
              <SheetHeader>
                <SheetTitle>
                  GST Audit — {selectedPeriod.period_start} to {selectedPeriod.period_end}
                </SheetTitle>
                <SheetDescription>
                  Detailed breakdown by marketplace and settlement
                </SheetDescription>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                {/* Confidence & Warnings */}
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium">Confidence:</span>
                    <ConfidenceBadge label={selectedPeriod.confidence_label} score={selectedPeriod.confidence_score} />
                  </div>
                  {selectedPeriod.notes.length > 0 && (
                    <div className="space-y-1">
                      {selectedPeriod.notes.map((note, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-amber-700 bg-amber-50 rounded px-2 py-1.5">
                          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                          <span>{note}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* GST Summary Buckets */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">GST Summary (Estimates)</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-1 text-sm">
                    <SummaryLine label="GST on Sales" value={selectedPeriod.marketplace_gst_on_sales_estimate} />
                    <SummaryLine label="GST on Fees" value={selectedPeriod.marketplace_gst_on_fees_estimate} negative />
                    <SummaryLine label="Refund GST" value={selectedPeriod.marketplace_refund_gst_estimate} negative />
                    <SummaryLine label="Adjustment GST" value={selectedPeriod.marketplace_adjustment_gst_estimate} />
                    <SummaryLine label="Tax Collected by Platform" value={selectedPeriod.marketplace_tax_collected_by_platform} muted />
                    {selectedPeriod.marketplace_unknown_gst > 0 && (
                      <SummaryLine label="Unclassified GST" value={selectedPeriod.marketplace_unknown_gst} warn />
                    )}
                    <div className="border-t pt-1 mt-1">
                      <SummaryLine
                        label="Net Marketplace GST (est.)"
                        value={selectedPeriod.marketplace_gst_on_sales_estimate - selectedPeriod.marketplace_refund_gst_estimate}
                        bold
                      />
                    </div>
                    <div className="border-t pt-1 mt-1">
                      <SummaryLine label="Xero GST" value={selectedPeriod.xero_gst} bold />
                      <SummaryLine label="Difference" value={selectedPeriod.difference} diff />
                    </div>
                  </CardContent>
                </Card>

                {/* Per-Marketplace Breakdown */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">By Marketplace</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead className="text-xs">Marketplace</TableHead>
                          <TableHead className="text-xs text-right">GST Sales</TableHead>
                          <TableHead className="text-xs text-right">GST Fees</TableHead>
                          <TableHead className="text-xs text-right">Refund GST</TableHead>
                          <TableHead className="text-xs text-right">Settlements</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.entries(selectedPeriod.breakdown?.marketplaces || {}).map(([code, mp]) => (
                          <TableRow key={code}>
                            <TableCell className="text-xs font-medium">{MARKETPLACE_LABELS[code] || code}</TableCell>
                            <TableCell className="text-xs text-right font-mono">{formatAUD(mp.gst_on_sales)}</TableCell>
                            <TableCell className="text-xs text-right font-mono">{formatAUD(mp.gst_on_fees)}</TableCell>
                            <TableCell className="text-xs text-right font-mono">{formatAUD(mp.refund_gst)}</TableCell>
                            <TableCell className="text-xs text-right">{mp.settlement_count}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </CardContent>
                </Card>

                {/* Contributing Settlements */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Contributing Settlements</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="max-h-80 overflow-y-auto">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Settlement</TableHead>
                            <TableHead className="text-xs">Marketplace</TableHead>
                            <TableHead className="text-xs">Status</TableHead>
                            <TableHead className="text-xs text-right">GST Sales</TableHead>
                            <TableHead className="text-xs text-right">Deposit</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {(selectedPeriod.breakdown?.settlements || []).map((s) => (
                            <TableRow key={s.settlement_id}>
                              <TableCell className="text-xs font-mono">{s.settlement_id.slice(0, 12)}…</TableCell>
                              <TableCell className="text-xs">{MARKETPLACE_LABELS[s.marketplace] || s.marketplace}</TableCell>
                              <TableCell>
                                <StatusBadge status={s.status} />
                              </TableCell>
                              <TableCell className="text-xs text-right font-mono">{formatAUD(s.gst_on_sales)}</TableCell>
                              <TableCell className="text-xs text-right font-mono">{formatAUD(s.bank_deposit)}</TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </CardContent>
                </Card>

                {/* Problem Indicators */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-500" />
                      Problem Indicators
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs space-y-1.5">
                    <ProblemRow
                      label="Settlements not pushed to Xero"
                      count={(selectedPeriod.breakdown?.settlements || []).filter(s =>
                        !['pushed_to_xero', 'reconciled_in_xero', 'bank_verified'].includes(s.status)
                      ).length}
                    />
                    <ProblemRow
                      label="Settlements not bank verified"
                      count={(selectedPeriod.breakdown?.settlements || []).filter(s => s.status !== 'bank_verified').length}
                    />
                    <ProblemRow
                      label="Unclassified GST items"
                      count={selectedPeriod.marketplace_unknown_gst > 0 ? 1 : 0}
                      amount={selectedPeriod.marketplace_unknown_gst}
                    />
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function SummaryLine({
  label,
  value,
  bold,
  negative,
  muted,
  warn,
  diff,
}: {
  label: string;
  value: number | null | undefined;
  bold?: boolean;
  negative?: boolean;
  muted?: boolean;
  warn?: boolean;
  diff?: boolean;
}) {
  let color = 'text-foreground';
  if (muted) color = 'text-muted-foreground';
  if (warn) color = 'text-amber-600';
  if (diff && value !== null && value !== undefined) {
    color = Math.abs(value) < 1 ? 'text-green-600' : Math.abs(value) < 50 ? 'text-amber-600' : 'text-destructive';
  }

  return (
    <div className={`flex justify-between items-center py-0.5 ${bold ? 'font-semibold' : ''}`}>
      <span className={color}>{label}</span>
      <span className={`font-mono ${color}`}>
        {value !== null && value !== undefined ? (
          diff && value >= 0 ? `+${formatAUD(value)}` : formatAUD(negative ? -Math.abs(value) : value)
        ) : '—'}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    bank_verified: { label: 'Bank ✓', variant: 'default' },
    reconciled_in_xero: { label: 'Reconciled', variant: 'default' },
    pushed_to_xero: { label: 'Pushed', variant: 'secondary' },
    ingested: { label: 'Ingested', variant: 'outline' },
    saved: { label: 'Saved', variant: 'outline' },
  };
  const info = map[status] || { label: status, variant: 'outline' as const };
  return <Badge variant={info.variant} className="text-[10px] px-1.5">{info.label}</Badge>;
}

function ProblemRow({ label, count, amount }: { label: string; count: number; amount?: number }) {
  if (count === 0) {
    return (
      <div className="flex items-center gap-2 text-green-700">
        <span>✓</span>
        <span>{label}: None</span>
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-amber-700">
      <AlertTriangle className="h-3 w-3 shrink-0" />
      <span>{label}: {count}{amount ? ` (${formatAUD(amount)})` : ''}</span>
    </div>
  );
}
