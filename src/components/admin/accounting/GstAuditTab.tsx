
import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AlertTriangle, RefreshCw, Loader2, ChevronRight, ChevronDown, ShieldAlert, Search, Eye, ChevronLeft, FileText, Filter, Download } from 'lucide-react';
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

interface VarianceSample {
  settlement_id: string;
  marketplace: string;
  period_start?: string;
  period_end?: string;
  status?: string;
  xero_invoice_id?: string | null;
  gst_contribution: number;
  note?: string;
}

interface LineSample {
  settlement_id: string;
  line_type: string;
  description?: string;
  amount: number;
  gst_amount?: number | null;
  note?: string;
}

interface VarianceLine {
  code: string;
  label: string;
  amount: number;
  confidence: 'high' | 'medium' | 'low';
  evidence_level: 'settlement' | 'line';
  evidence?: {
    settlement_ids?: string[];
    marketplace_codes?: string[];
    settlement_count?: number;
    sample?: VarianceSample[];
    line_samples?: LineSample[];
    notes?: string[];
  };
}

interface VarianceResult {
  success: boolean;
  period_start: string;
  period_end: string;
  marketplace_gst_total_estimate: number | null;
  xero_gst: number | null;
  difference: number | null;
  variance_lines: VarianceLine[];
  explained_total: number;
  unexplained_remainder: number | null;
  confidence_score: number;
  confidence_label: string;
  confidence_reasons: string[];
  xero_source_mode: 'tax_summary' | 'xettle_invoices_only' | 'unavailable';
}

interface EvidenceRow {
  settlement_id: string;
  marketplace: string;
  period_start: string;
  period_end: string;
  status: string;
  bank_verified: boolean | null;
  xero_invoice_id: string | null;
  xero_invoice_number: string | null;
  marketplace_gst_estimate: number | null;
  gst_contribution: number;
  issues: string[];
}

interface EvidenceResult {
  success: boolean;
  variance_code: string;
  rows: EvidenceRow[];
  next_cursor: string | null;
  totals: { gst_contribution_total: number; settlement_count_total: number };
  line_samples?: LineSample[];
}

type EvidenceFilter = 'all' | 'not_pushed' | 'unclassified' | 'top_contributors';

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
  return <Badge variant={variant} className="text-xs">{label} ({score})</Badge>;
}

const MARKETPLACE_LABELS: Record<string, string> = {
  amazon_au: 'Amazon AU', shopify: 'Shopify', bunnings: 'Bunnings',
  woolworths: 'Woolworths', ebay_au: 'eBay AU', catch_au: 'Catch', unknown: 'Unknown',
};

const ISSUE_LABELS: Record<string, string> = {
  NOT_PUSHED: 'Not pushed', UNCLASSIFIED_LINES: 'Unclassified', NOT_BANK_VERIFIED: 'Not bank verified',
};

const FILTER_OPTIONS: { key: EvidenceFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'not_pushed', label: 'Not pushed' },
  { key: 'unclassified', label: 'Unclassified' },
  { key: 'top_contributors', label: 'Top contributors' },
];

export default function GstAuditTab() {
  const [summaries, setSummaries] = useState<Record<string, GstSummaryRow>>({});
  const [loading, setLoading] = useState(true);
  const [refreshingPeriod, setRefreshingPeriod] = useState<string | null>(null);
  const [selectedPeriod, setSelectedPeriod] = useState<GstSummaryRow | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [variance, setVariance] = useState<VarianceResult | null>(null);
  const [varianceLoading, setVarianceLoading] = useState(false);
  const [settlementDetail, setSettlementDetail] = useState<EvidenceRow | null>(null);
  const [detailModalOpen, setDetailModalOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

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

  useEffect(() => { loadCachedSummaries(); }, [loadCachedSummaries]);

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
    for (const p of periods) { await refreshPeriod(p.start, p.end); }
    setLoading(false);
  }, [periods, refreshPeriod]);

  const loadVariance = useCallback(async (periodStart: string, periodEnd: string) => {
    setVarianceLoading(true);
    setVariance(null);
    try {
      const { data, error } = await supabase.functions.invoke('generate-gst-variance', {
        body: { period_start: periodStart, period_end: periodEnd },
      });
      if (error) throw error;
      setVariance(data as VarianceResult);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load variance analysis');
    } finally {
      setVarianceLoading(false);
    }
  }, []);

  const openDrilldown = useCallback((row: GstSummaryRow) => {
    setSelectedPeriod(row);
    setDrawerOpen(true);
    setVariance(null);
    loadVariance(row.period_start, row.period_end);
  }, [loadVariance]);

  const openSettlementDetail = useCallback((row: EvidenceRow) => {
    setSettlementDetail(row);
    setDetailModalOpen(true);
  }, []);

  const exportReconciliationPack = useCallback(async () => {
    if (!selectedPeriod) return;
    setExporting(true);
    try {
      const { data, error } = await supabase.functions.invoke('generate-gst-audit-pack', {
        body: {
          period_start: selectedPeriod.period_start,
          period_end: selectedPeriod.period_end,
          include_line_evidence: false,
        },
      });
      if (error) throw error;

      // data comes back as a Blob or raw response
      const blob = data instanceof Blob ? data : new Blob([data], { type: 'application/zip' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `gst-reconciliation-pack_${selectedPeriod.period_start}_to_${selectedPeriod.period_end}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success('Reconciliation pack downloaded');
    } catch (err: any) {
      toast.error(err.message || 'Failed to export reconciliation pack');
    } finally {
      setExporting(false);
    }
  }, [selectedPeriod]);

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
              <RefreshCw className="h-3.5 w-3.5" /> Refresh All
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
                const marketplaceGst = row ? row.marketplace_gst_on_sales_estimate - row.marketplace_refund_gst_estimate : null;
                return (
                  <TableRow key={key} className={`cursor-pointer hover:bg-muted/50 transition-colors ${row ? '' : 'opacity-60'}`} onClick={() => row && openDrilldown(row)}>
                    <TableCell className="font-medium text-sm">{p.label}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{row ? formatAUD(marketplaceGst) : '—'}</TableCell>
                    <TableCell className="text-right font-mono text-sm">{row ? formatAUD(row.xero_gst) : '—'}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {row?.difference !== null && row?.difference !== undefined ? (
                        <span className={Math.abs(row.difference) < 1 ? 'text-green-600' : Math.abs(row.difference) < 50 ? 'text-amber-600' : 'text-destructive'}>
                          {row.difference >= 0 ? '+' : ''}{formatAUD(row.difference)}
                        </span>
                      ) : '—'}
                    </TableCell>
                    <TableCell>{row ? <ConfidenceBadge label={row.confidence_label} score={row.confidence_score} /> : '—'}</TableCell>
                    <TableCell>
                      {isRefreshing ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : (
                        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => { e.stopPropagation(); refreshPeriod(p.start, p.end); }}>
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
                <div className="flex items-center justify-between">
                  <div>
                    <SheetTitle>GST Audit — {selectedPeriod.period_start} to {selectedPeriod.period_end}</SheetTitle>
                    <SheetDescription>Detailed breakdown by marketplace and settlement</SheetDescription>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={exportReconciliationPack}
                    disabled={exporting}
                    className="gap-1.5 shrink-0"
                  >
                    {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                    Export pack
                  </Button>
                </div>
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
                  <CardHeader className="pb-2"><CardTitle className="text-sm">GST Summary (Estimates)</CardTitle></CardHeader>
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
                      <SummaryLine label="Net Marketplace GST (est.)" value={selectedPeriod.marketplace_gst_on_sales_estimate - selectedPeriod.marketplace_refund_gst_estimate} bold />
                    </div>
                    <div className="border-t pt-1 mt-1">
                      <SummaryLine label="Xero GST" value={selectedPeriod.xero_gst} bold />
                      <SummaryLine label="Difference" value={selectedPeriod.difference} diff />
                    </div>
                  </CardContent>
                </Card>

                {/* ── VARIANCE ANALYSIS ── */}
                <VarianceAnalysisCard
                  variance={variance}
                  loading={varianceLoading}
                  onRefresh={() => selectedPeriod && loadVariance(selectedPeriod.period_start, selectedPeriod.period_end)}
                  periodStart={selectedPeriod.period_start}
                  periodEnd={selectedPeriod.period_end}
                  onSettlementClick={openSettlementDetail}
                />

                {/* Per-Marketplace Breakdown */}
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">By Marketplace</CardTitle></CardHeader>
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
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Contributing Settlements</CardTitle></CardHeader>
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
                              <TableCell><StatusBadge status={s.status} /></TableCell>
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
                      <AlertTriangle className="h-4 w-4 text-amber-500" /> Problem Indicators
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs space-y-1.5">
                    <ProblemRow label="Settlements not pushed to Xero" count={(selectedPeriod.breakdown?.settlements || []).filter(s => !['pushed_to_xero', 'reconciled_in_xero', 'bank_verified'].includes(s.status)).length} />
                    <ProblemRow label="Settlements not bank verified" count={(selectedPeriod.breakdown?.settlements || []).filter(s => s.status !== 'bank_verified').length} />
                    <ProblemRow label="Unclassified GST items" count={selectedPeriod.marketplace_unknown_gst > 0 ? 1 : 0} amount={selectedPeriod.marketplace_unknown_gst} />
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>

      {/* ── Settlement Detail Modal ── */}
      <SettlementDetailModal row={settlementDetail} open={detailModalOpen} onOpenChange={setDetailModalOpen} />
    </div>
  );
}

// ─── Variance Analysis Card ──────────────────────────────────────────

function VarianceAnalysisCard({
  variance, loading, onRefresh, periodStart, periodEnd, onSettlementClick,
}: {
  variance: VarianceResult | null;
  loading: boolean;
  onRefresh: () => void;
  periodStart: string;
  periodEnd: string;
  onSettlementClick: (row: EvidenceRow) => void;
}) {
  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center gap-3">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Analyzing variance…</span>
        </CardContent>
      </Card>
    );
  }

  if (!variance) {
    return (
      <Card>
        <CardContent className="py-6 text-center">
          <Search className="h-6 w-6 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm text-muted-foreground">Variance analysis unavailable</p>
          <Button variant="outline" size="sm" onClick={onRefresh} className="mt-2 gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-primary/20">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Search className="h-4 w-4 text-primary" /> Explain the Difference
          </CardTitle>
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onRefresh}>
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
        </div>
        <CardDescription className="text-xs">
          Variance analysis — {variance.xero_source_mode === 'xettle_invoices_only' ? 'Xettle invoices (fallback)' : variance.xero_source_mode === 'tax_summary' ? 'Xero Tax Summary' : 'Xero data unavailable'}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {variance.variance_lines.length > 0 ? (
          <div className="space-y-0.5">
            {variance.variance_lines.map((line) => (
              <VarianceLineRow
                key={line.code}
                line={line}
                periodStart={periodStart}
                periodEnd={periodEnd}
                onSettlementClick={onSettlementClick}
              />
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground py-2">No variance components identified.</p>
        )}

        {/* Explained / Unexplained totals */}
        <div className="border-t pt-2 space-y-1">
          <div className="flex justify-between items-center text-sm">
            <span className="font-medium">Explained difference</span>
            <span className="font-mono font-medium">{formatAUD(variance.explained_total)}</span>
          </div>
          <div className="flex justify-between items-center text-sm">
            <span className={`font-medium ${variance.unexplained_remainder !== null && Math.abs(variance.unexplained_remainder) >= 1 ? 'text-destructive' : 'text-muted-foreground'}`}>
              Unexplained remainder
            </span>
            <span className={`font-mono font-medium ${variance.unexplained_remainder !== null && Math.abs(variance.unexplained_remainder) >= 1 ? 'text-destructive' : 'text-muted-foreground'}`}>
              {formatAUD(variance.unexplained_remainder)}
            </span>
          </div>
        </div>

        {/* Confidence */}
        <div className="border-t pt-2 space-y-2">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium">Variance Confidence:</span>
            <ConfidenceBadge label={variance.confidence_label} score={variance.confidence_score} />
          </div>
          {variance.confidence_reasons.length > 0 && (
            <ul className="space-y-1">
              {variance.confidence_reasons.map((reason, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                  <span className="text-muted-foreground/60 mt-0.5">•</span>
                  <span>{reason}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Variance Line Row (with evidence expander + pagination + filters + line samples) ────

function VarianceLineRow({
  line, periodStart, periodEnd, onSettlementClick,
}: {
  line: VarianceLine;
  periodStart: string;
  periodEnd: string;
  onSettlementClick: (row: EvidenceRow) => void;
}) {
  const [open, setOpen] = useState(false);
  const [evidenceRows, setEvidenceRows] = useState<EvidenceRow[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceTotals, setEvidenceTotals] = useState<{ gst_contribution_total: number; settlement_count_total: number } | null>(null);
  const [lineSamples, setLineSamples] = useState<LineSample[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [activeFilter, setActiveFilter] = useState<EvidenceFilter>('all');
  const [expandedSettlement, setExpandedSettlement] = useState<string | null>(null);

  const hasEvidence = line.evidence && (
    (line.evidence.settlement_count && line.evidence.settlement_count > 0) ||
    (line.evidence.settlement_ids && line.evidence.settlement_ids.length > 0) ||
    (line.evidence.sample && line.evidence.sample.length > 0) ||
    (line.evidence.notes && line.evidence.notes.length > 0)
  );

  const evidenceCount = line.evidence?.settlement_count || line.evidence?.settlement_ids?.length || 0;
  const isLineDriven = line.evidence_level === 'line';

  const confidenceColor = line.confidence === 'high' ? 'text-green-600' : line.confidence === 'medium' ? 'text-amber-600' : 'text-destructive';

  const buildFilters = useCallback((filter: EvidenceFilter) => {
    if (filter === 'all') return undefined;
    return {
      only_not_pushed: filter === 'not_pushed',
      only_unclassified: filter === 'unclassified',
      top_contributors: filter === 'top_contributors',
    };
  }, []);

  const loadEvidence = useCallback(async (cursor: string | null = null, filter: EvidenceFilter = activeFilter, append = false) => {
    if (!append) setEvidenceLoading(true);
    else setLoadingMore(true);

    try {
      const { data, error } = await supabase.functions.invoke('fetch-gst-variance-evidence', {
        body: {
          period_start: periodStart,
          period_end: periodEnd,
          variance_code: line.code,
          settlement_ids: line.evidence?.settlement_ids,
          cursor,
          limit: 25,
          filters: buildFilters(filter),
        },
      });
      if (error) throw error;
      const result = data as EvidenceResult;
      if (append) {
        setEvidenceRows(prev => [...prev, ...result.rows]);
      } else {
        setEvidenceRows(result.rows);
      }
      setEvidenceTotals(result.totals);
      setNextCursor(result.next_cursor);
      if (result.line_samples) setLineSamples(result.line_samples);
    } catch {
      toast.error('Failed to load evidence details');
    } finally {
      setEvidenceLoading(false);
      setLoadingMore(false);
    }
  }, [periodStart, periodEnd, line.code, line.evidence?.settlement_ids, activeFilter, buildFilters]);

  const handleToggle = useCallback((isOpen: boolean) => {
    setOpen(isOpen);
    if (isOpen && evidenceRows.length === 0 && hasEvidence) {
      loadEvidence(null, 'all', false);
    }
  }, [evidenceRows.length, hasEvidence, loadEvidence]);

  const handleFilterChange = useCallback((filter: EvidenceFilter) => {
    setActiveFilter(filter);
    setEvidenceRows([]);
    setNextCursor(null);
    setExpandedSettlement(null);
    loadEvidence(null, filter, false);
  }, [loadEvidence]);

  const handleLoadMore = useCallback(() => {
    if (nextCursor) loadEvidence(nextCursor, activeFilter, true);
  }, [nextCursor, activeFilter, loadEvidence]);

  // Line samples for an expanded settlement row
  const getSettlementLineSamples = useCallback((settlementId: string) => {
    return lineSamples.filter(ls => ls.settlement_id === settlementId);
  }, [lineSamples]);

  return (
    <Collapsible open={open} onOpenChange={handleToggle}>
      <CollapsibleTrigger asChild>
        <button className="w-full flex items-center justify-between py-2 px-2 rounded hover:bg-muted/50 transition-colors text-left group">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            {hasEvidence ? (
              open ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />
            ) : <span className="w-3" />}
            <span className="text-xs truncate">{line.label}</span>
            <Badge variant="outline" className={`text-[9px] px-1 py-0 ${confidenceColor} border-current`}>{line.confidence}</Badge>
            {evidenceCount > 0 && (
              <Badge variant="secondary" className="text-[9px] px-1.5 py-0">
                {evidenceCount} settlement{evidenceCount !== 1 ? 's' : ''}
              </Badge>
            )}
            {isLineDriven && (
              <Badge variant="outline" className="text-[9px] px-1 py-0 text-primary border-primary/30">
                <FileText className="h-2.5 w-2.5 mr-0.5" />line
              </Badge>
            )}
          </div>
          <span className={`font-mono text-xs font-medium shrink-0 ml-2 ${line.amount >= 0 ? 'text-foreground' : 'text-destructive'}`}>
            {line.amount >= 0 ? '+' : ''}{formatAUD(line.amount)}
          </span>
        </button>
      </CollapsibleTrigger>
      {hasEvidence && (
        <CollapsibleContent>
          <div className="ml-2 mr-2 mb-2 border rounded-md bg-muted/30">
            {/* Notes */}
            {line.evidence?.notes?.map((note, i) => (
              <p key={i} className="text-[11px] text-muted-foreground px-3 pt-2">{note}</p>
            ))}

            {/* Quick Filters */}
            <div className="flex items-center gap-1 px-3 pt-2 pb-1">
              <Filter className="h-3 w-3 text-muted-foreground mr-1" />
              {FILTER_OPTIONS.map(opt => (
                <Button
                  key={opt.key}
                  variant={activeFilter === opt.key ? 'default' : 'outline'}
                  size="sm"
                  className="h-5 text-[9px] px-1.5 py-0"
                  onClick={() => handleFilterChange(opt.key)}
                >
                  {opt.label}
                </Button>
              ))}
            </div>

            {/* Evidence table */}
            {evidenceLoading ? (
              <div className="flex items-center justify-center py-4 gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                <span className="text-xs text-muted-foreground">Loading evidence…</span>
              </div>
            ) : evidenceRows.length > 0 ? (
              <div className="max-h-80 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-[10px] py-1.5 w-5"></TableHead>
                      <TableHead className="text-[10px] py-1.5">Settlement</TableHead>
                      <TableHead className="text-[10px] py-1.5">Marketplace</TableHead>
                      <TableHead className="text-[10px] py-1.5">Status</TableHead>
                      <TableHead className="text-[10px] py-1.5">Xero</TableHead>
                      <TableHead className="text-[10px] py-1.5 text-right">GST Contrib.</TableHead>
                      <TableHead className="text-[10px] py-1.5">Flags</TableHead>
                      <TableHead className="text-[10px] py-1.5 w-8"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {evidenceRows.map((row) => {
                      const settlementLines = isLineDriven ? getSettlementLineSamples(row.settlement_id) : [];
                      const isExpanded = expandedSettlement === row.settlement_id;
                      return (
                        <>
                          <TableRow key={row.settlement_id} className="cursor-pointer hover:bg-muted/50">
                            <TableCell className="py-1 px-1">
                              {isLineDriven && settlementLines.length > 0 && (
                                <button onClick={(e) => { e.stopPropagation(); setExpandedSettlement(isExpanded ? null : row.settlement_id); }}>
                                  {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                                </button>
                              )}
                            </TableCell>
                            <TableCell className="text-[10px] font-mono py-1" onClick={() => onSettlementClick(row)}>
                              {row.settlement_id.length > 14 ? `${row.settlement_id.slice(0, 12)}…` : row.settlement_id}
                            </TableCell>
                            <TableCell className="text-[10px] py-1">{MARKETPLACE_LABELS[row.marketplace] || row.marketplace}</TableCell>
                            <TableCell className="py-1"><StatusBadge status={row.status} /></TableCell>
                            <TableCell className="text-[10px] py-1 font-mono">{row.xero_invoice_number || (row.xero_invoice_id ? '✓' : '—')}</TableCell>
                            <TableCell className="text-[10px] py-1 text-right font-mono font-medium">
                              <span className={row.gst_contribution >= 0 ? 'text-foreground' : 'text-destructive'}>
                                {row.gst_contribution >= 0 ? '+' : ''}{formatAUD(row.gst_contribution)}
                              </span>
                            </TableCell>
                            <TableCell className="py-1">
                              <div className="flex gap-0.5 flex-wrap">
                                {row.issues.map(issue => (
                                  <Badge key={issue} variant="outline" className="text-[8px] px-1 py-0 text-amber-600 border-amber-300">
                                    {ISSUE_LABELS[issue] || issue}
                                  </Badge>
                                ))}
                              </div>
                            </TableCell>
                            <TableCell className="py-1">
                              <button onClick={() => onSettlementClick(row)}>
                                <Eye className="h-3 w-3 text-muted-foreground" />
                              </button>
                            </TableCell>
                          </TableRow>
                          {/* Line-level evidence nested row */}
                          {isExpanded && settlementLines.length > 0 && (
                            <TableRow key={`${row.settlement_id}-lines`} className="bg-muted/20">
                              <TableCell colSpan={8} className="py-0 px-0">
                                <div className="pl-8 pr-2 py-1.5 border-l-2 border-primary/20 ml-2">
                                  <p className="text-[9px] font-medium text-muted-foreground mb-1">Line items contributing to this variance:</p>
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead className="text-[9px] py-1">Type</TableHead>
                                        <TableHead className="text-[9px] py-1">Description</TableHead>
                                        <TableHead className="text-[9px] py-1 text-right">Amount</TableHead>
                                        <TableHead className="text-[9px] py-1 text-right">GST</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {settlementLines.map((ls, idx) => (
                                        <TableRow key={idx}>
                                          <TableCell className="text-[9px] py-0.5 font-mono">{ls.line_type}</TableCell>
                                          <TableCell className="text-[9px] py-0.5 truncate max-w-[120px]">{ls.description || '—'}</TableCell>
                                          <TableCell className="text-[9px] py-0.5 text-right font-mono">{formatAUD(ls.amount)}</TableCell>
                                          <TableCell className="text-[9px] py-0.5 text-right font-mono">{formatAUD(ls.gst_amount)}</TableCell>
                                        </TableRow>
                                      ))}
                                    </TableBody>
                                  </Table>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      );
                    })}
                  </TableBody>
                </Table>

                {/* Totals + Pagination */}
                <div className="flex justify-between items-center px-3 py-2 border-t text-[10px]">
                  <span className="font-medium">
                    {evidenceRows.length} of {evidenceTotals?.settlement_count_total || 0} settlement{(evidenceTotals?.settlement_count_total || 0) !== 1 ? 's' : ''}
                    {' · '}Total: <span className="font-mono">{formatAUD(evidenceTotals?.gst_contribution_total)}</span>
                  </span>
                  {nextCursor && (
                    <Button
                      variant="outline" size="sm"
                      className="h-5 text-[9px] px-2 gap-1"
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                    >
                      {loadingMore ? <Loader2 className="h-2.5 w-2.5 animate-spin" /> : <ChevronRight className="h-2.5 w-2.5" />}
                      Load more
                    </Button>
                  )}
                </div>
              </div>
            ) : !evidenceLoading && evidenceRows.length === 0 ? (
              <p className="text-[11px] text-muted-foreground px-3 py-3">No matching settlements found.</p>
            ) : null}
          </div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

// ─── Settlement Detail Modal ─────────────────────────────────────────

function SettlementDetailModal({
  row, open, onOpenChange,
}: {
  row: EvidenceRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  if (!row) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-sm flex items-center gap-2">
            <Eye className="h-4 w-4" /> Settlement Detail
          </DialogTitle>
          <DialogDescription className="text-xs">
            Read-only view — GST audit context
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm">
          <div className="grid grid-cols-2 gap-2">
            <DetailField label="Settlement ID" value={row.settlement_id} mono />
            <DetailField label="Marketplace" value={MARKETPLACE_LABELS[row.marketplace] || row.marketplace} />
            <DetailField label="Period" value={`${row.period_start} → ${row.period_end}`} />
            <DetailField label="Status" value={row.status} badge />
            <DetailField label="Xero Invoice" value={row.xero_invoice_number || row.xero_invoice_id || 'Not linked'} mono />
            <DetailField label="Bank Verified" value={row.bank_verified ? 'Yes' : 'No'} />
          </div>

          <div className="border-t pt-2 space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Marketplace GST (est.)</span>
              <span className="font-mono font-medium">{formatAUD(row.marketplace_gst_estimate)}</span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">GST Contribution (this variance)</span>
              <span className={`font-mono font-medium ${row.gst_contribution >= 0 ? 'text-foreground' : 'text-destructive'}`}>
                {row.gst_contribution >= 0 ? '+' : ''}{formatAUD(row.gst_contribution)}
              </span>
            </div>
          </div>

          {row.issues.length > 0 && (
            <div className="border-t pt-2">
              <p className="text-xs font-medium mb-1.5">Issues</p>
              <div className="flex gap-1 flex-wrap">
                {row.issues.map(issue => (
                  <Badge key={issue} variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                    {ISSUE_LABELS[issue] || issue}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          <p className="text-[10px] text-muted-foreground italic border-t pt-2">
            This is an estimate for audit purposes only. Confirm final figures in Xero.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DetailField({ label, value, mono, badge }: { label: string; value: string; mono?: boolean; badge?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      {badge ? (
        <StatusBadge status={value} />
      ) : (
        <p className={`text-xs font-medium ${mono ? 'font-mono' : ''} truncate`}>{value}</p>
      )}
    </div>
  );
}

// ─── Shared helpers ──────────────────────────────────────────────────

function SummaryLine({ label, value, bold, negative, muted, warn, diff }: {
  label: string; value: number | null | undefined;
  bold?: boolean; negative?: boolean; muted?: boolean; warn?: boolean; diff?: boolean;
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
        {value !== null && value !== undefined ? (diff && value >= 0 ? `+${formatAUD(value)}` : formatAUD(negative ? -Math.abs(value) : value)) : '—'}
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
  if (count === 0) return <div className="flex items-center gap-2 text-green-700"><span>✓</span><span>{label}: None</span></div>;
  return (
    <div className="flex items-center gap-2 text-amber-700">
      <AlertTriangle className="h-3 w-3 shrink-0" />
      <span>{label}: {count}{amount ? ` (${formatAUD(amount)})` : ''}</span>
    </div>
  );
}
