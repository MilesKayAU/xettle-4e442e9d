/**
 * WoolworthsPaymentsView — Mirrors the Woolworths seller portal layout.
 * Groups settlements by Bank Payment ID and shows CSV/PDF upload status,
 * marketplace breakdown, and actions per payment group.
 */

import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  CheckCircle2, XCircle, Upload, ArrowRight, Send, Eye, Package,
  ChevronDown, ChevronUp, CloudUpload, FileText, Loader2, BarChart3,
  AlertTriangle, RefreshCw,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { type UserMarketplace } from './MarketplaceSwitcher';
import { formatAUD, formatSettlementDate } from '@/utils/settlement-engine';
import { useXeroSync } from '@/hooks/use-xero-sync';
import SettlementDetailDrawer from '@/components/shared/SettlementDetailDrawer';
import SettlementStatusBadge from './shared/SettlementStatusBadge';
import MarketplaceProfitCard from '@/components/shared/MarketplaceProfitCard';

// ── Types ─────────────────────────────────────────────────────────────────────

interface SettlementRow {
  id: string;
  settlement_id: string;
  marketplace: string;
  period_start: string;
  period_end: string;
  sales_principal: number | null;
  seller_fees: number | null;
  bank_deposit: number | null;
  status: string | null;
  created_at: string;
  gst_on_income: number | null;
  gst_on_expenses: number | null;
  raw_payload: any;
  source: string | null;
  xero_invoice_number: string | null;
  xero_status: string | null;
  xero_journal_id: string | null;
}

interface ExpectedPayment {
  bank_payment_id: string;
  paid_date: string;
  amount: number;
  csv_uploaded: boolean;
  pdf_uploaded: boolean;
}

interface PaymentGroup {
  bankPaymentId: string;
  paidDate: string | null;
  totalAmount: number;
  expectedAmount: number | null;
  hasCsv: boolean;
  hasPdf: boolean;
  settlements: SettlementRow[];
  marketplaceBreakdown: { code: string; name: string; amount: number; status: string | null }[];
  overallStatus: 'ready_to_push' | 'pushed' | 'gap_detected' | 'upload_csv' | 'upload_pdf' | 'missing';
  isFromExpected: boolean;
}

// ── Marketplace display names ─────────────────────────────────────────────────

const MP_NAMES: Record<string, string> = {
  bigw: 'Big W',
  everyday_market: 'Everyday Market',
  mydeal: 'MyDeal',
  catch: 'Catch',
  woolworths_marketplus: 'Woolworths',
};

// ── Component ─────────────────────────────────────────────────────────────────

interface WoolworthsPaymentsViewProps {
  marketplace: UserMarketplace;
  onSwitchToUpload?: () => void;
  onMarketplacesChanged?: () => void;
}

export default function WoolworthsPaymentsView({ marketplace, onSwitchToUpload, onMarketplacesChanged }: WoolworthsPaymentsViewProps) {
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [expectedPayments, setExpectedPayments] = useState<ExpectedPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedPayment, setExpandedPayment] = useState<string | null>(null);
  const [drawerSettlementId, setDrawerSettlementId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [accountingBoundary, setAccountingBoundary] = useState<string | null>(null);
  const [preBoundaryOpen, setPreBoundaryOpen] = useState(false);

  const WOOLWORTHS_CODES = ['bigw', 'everyday_market', 'mydeal', 'catch', 'woolworths_marketplus'];

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);

      // Fetch accounting boundary
      const { data: boundaryRow } = await supabase
        .from('app_settings')
        .select('value')
        .eq('user_id', user.id)
        .eq('key', 'accounting_boundary_date')
        .maybeSingle();
      if (boundaryRow?.value) setAccountingBoundary(boundaryRow.value);

      // Fetch all woolworths-family settlements
      const { data: sRows, error } = await supabase
        .from('settlements')
        .select('id, settlement_id, marketplace, period_start, period_end, sales_principal, seller_fees, bank_deposit, status, created_at, raw_payload, source, xero_invoice_number, xero_status, xero_journal_id')
        .eq('user_id', user.id)
        .in('marketplace', WOOLWORTHS_CODES)
        .eq('is_hidden', false)
        .order('period_end', { ascending: false });

      if (error) {
        console.error('[WoolworthsPaymentsView] load error:', error);
        toast.error('Failed to load settlements');
      }
      setSettlements((sRows as SettlementRow[]) || []);

      // Fetch expected payments
      const { data: epRows } = await supabase
        .from('expected_woolworths_payments')
        .select('bank_payment_id, paid_date, amount, csv_uploaded, pdf_uploaded')
        .eq('user_id', user.id)
        .order('paid_date', { ascending: false });
      setExpectedPayments((epRows as ExpectedPayment[]) || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const { pushing, handlePushToXero, handleRefreshXero, refreshingXero, toStandardSettlement } = useXeroSync({ loadSettlements: loadData });

  // ── Group settlements by Bank Payment ID ────────────────────────────────────

  const paymentGroups = useMemo<PaymentGroup[]>(() => {
    // Extract bankPaymentRef from settlement_id (format: "{ref}_{marketplace}")
    const groupMap = new Map<string, SettlementRow[]>();

    for (const s of settlements) {
      const parts = s.settlement_id.split('_');
      const ref = parts[0]; // Bank Payment ID
      if (!ref || !/^\d+$/.test(ref)) {
        // Not a Woolworths-format ID — use full settlement_id
        if (!groupMap.has(s.settlement_id)) groupMap.set(s.settlement_id, []);
        groupMap.get(s.settlement_id)!.push(s);
        continue;
      }
      if (!groupMap.has(ref)) groupMap.set(ref, []);
      groupMap.get(ref)!.push(s);
    }

    // Build groups from actual settlements
    const groups: PaymentGroup[] = [];
    const seenIds = new Set<string>();

    for (const [ref, setts] of groupMap) {
      seenIds.add(ref);
      const ep = expectedPayments.find(e => e.bank_payment_id === ref);

      const breakdown = setts.map(s => ({
        code: s.marketplace,
        name: MP_NAMES[s.marketplace] || s.marketplace,
        amount: s.bank_deposit || 0,
        status: s.status,
      }));

      const totalAmount = setts.reduce((sum, s) => sum + (s.bank_deposit || 0), 0);
      const hasCsv = setts.length > 0; // If we have settlements, CSV was uploaded
      const hasPdf = false; // TODO: detect PDF from metadata
      const allPushed = setts.every(s => ['pushed_to_xero', 'reconciled_in_xero', 'bank_verified', 'already_recorded'].includes(s.status || ''));
      const anyGap = setts.some(s => s.status === 'gap_detected' || s.status === 'push_failed');

      let overallStatus: PaymentGroup['overallStatus'] = 'ready_to_push';
      if (allPushed) overallStatus = 'pushed';
      else if (anyGap) overallStatus = 'gap_detected';

      // Determine date from first settlement
      const paidDate = setts[0]?.period_end || ep?.paid_date || null;

      groups.push({
        bankPaymentId: ref,
        paidDate,
        totalAmount: Math.round(totalAmount * 100) / 100,
        expectedAmount: ep?.amount ?? null,
        hasCsv,
        hasPdf,
        settlements: setts,
        marketplaceBreakdown: breakdown,
        overallStatus,
        isFromExpected: false,
      });
    }

    // Add expected payments that we don't have settlements for
    for (const ep of expectedPayments) {
      if (seenIds.has(ep.bank_payment_id)) continue;
      groups.push({
        bankPaymentId: ep.bank_payment_id,
        paidDate: ep.paid_date,
        totalAmount: ep.amount,
        expectedAmount: ep.amount,
        hasCsv: false,
        hasPdf: false,
        settlements: [],
        marketplaceBreakdown: [],
        overallStatus: 'missing',
        isFromExpected: true,
      });
    }

    // Sort by paid date descending (newest first)
    groups.sort((a, b) => {
      if (!a.paidDate && !b.paidDate) return 0;
      if (!a.paidDate) return 1;
      if (!b.paidDate) return -1;
      return b.paidDate.localeCompare(a.paidDate);
    });

    return groups;
  }, [settlements, expectedPayments]);

  // Split into boundary groups
  const { activeGroups, preBoundaryGroups } = useMemo(() => {
    if (!accountingBoundary) return { activeGroups: paymentGroups, preBoundaryGroups: [] };
    const active: PaymentGroup[] = [];
    const pre: PaymentGroup[] = [];
    for (const g of paymentGroups) {
      if (g.paidDate && g.paidDate < accountingBoundary) {
        pre.push(g);
      } else {
        active.push(g);
      }
    }
    return { activeGroups: active, preBoundaryGroups: pre };
  }, [paymentGroups, accountingBoundary]);

  // ── Status helpers ──────────────────────────────────────────────────────────

  function getStatusBadge(status: PaymentGroup['overallStatus']) {
    switch (status) {
      case 'pushed':
        return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800 text-[11px]">Pushed to Xero</Badge>;
      case 'ready_to_push':
        return <Badge className="bg-primary/10 text-primary border-primary/20 text-[11px]">Ready to Push</Badge>;
      case 'gap_detected':
        return <Badge variant="outline" className="text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700 text-[11px]"><AlertTriangle className="h-3 w-3 mr-1" />Gap Detected</Badge>;
      case 'upload_csv':
        return <Badge variant="outline" className="text-destructive text-[11px]">Upload CSV + PDF</Badge>;
      case 'upload_pdf':
        return <Badge variant="outline" className="text-amber-600 text-[11px]">Upload PDF</Badge>;
      case 'missing':
        return <Badge variant="outline" className="text-muted-foreground text-[11px]">Not Uploaded</Badge>;
    }
  }

  function getActionButton(group: PaymentGroup) {
    if (group.overallStatus === 'missing' || group.overallStatus === 'upload_csv') {
      return (
        <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={onSwitchToUpload}>
          <Upload className="h-3 w-3" /> Upload
        </Button>
      );
    }
    if (group.overallStatus === 'ready_to_push' && group.settlements.length > 0) {
      return (
        <Button
          size="sm"
          className="gap-1.5 text-xs"
          disabled={pushing}
          onClick={async () => {
            for (const s of group.settlements) {
              if (['pushed_to_xero', 'reconciled_in_xero', 'bank_verified', 'already_recorded'].includes(s.status || '')) continue;
              const std = toStandardSettlement(s);
              if (std) await handlePushToXero(std);
            }
          }}
        >
          <Send className="h-3 w-3" /> Push to Xero
        </Button>
      );
    }
    if (group.overallStatus === 'pushed') {
      return <span className="text-xs text-muted-foreground">Complete</span>;
    }
    return null;
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const renderPaymentRow = (group: PaymentGroup) => {
    const isExpanded = expandedPayment === group.bankPaymentId;
    return (
      <React.Fragment key={group.bankPaymentId}>
        <TableRow
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => setExpandedPayment(isExpanded ? null : group.bankPaymentId)}
        >
          <TableCell className="font-mono font-medium text-sm">{group.bankPaymentId}</TableCell>
          <TableCell className="text-sm text-muted-foreground">
            {group.paidDate ? formatSettlementDate(group.paidDate) : '—'}
          </TableCell>
          <TableCell className="text-sm font-semibold tabular-nums text-right">
            {formatAUD(group.totalAmount)}
          </TableCell>
          <TableCell className="text-center">
            {group.hasCsv
              ? <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto" />
              : <XCircle className="h-4 w-4 text-destructive/60 mx-auto" />}
          </TableCell>
          <TableCell className="text-center">
            {group.hasPdf
              ? <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto" />
              : <XCircle className="h-4 w-4 text-destructive/60 mx-auto" />}
          </TableCell>
          <TableCell>
            {group.marketplaceBreakdown.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {group.marketplaceBreakdown.map(b => (
                  <span key={b.code} className="text-[11px] text-muted-foreground">
                    {b.name} {formatAUD(b.amount)}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </TableCell>
          <TableCell>{getStatusBadge(group.overallStatus)}</TableCell>
          <TableCell className="text-right">
            <div className="flex items-center justify-end gap-2">
              {getActionButton(group)}
              {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </TableCell>
        </TableRow>
        {isExpanded && group.settlements.length > 0 && (
          <TableRow>
            <TableCell colSpan={8} className="bg-muted/30 p-0">
              <div className="px-6 py-3 space-y-2">
                {group.settlements.map(s => (
                  <div key={s.settlement_id} className="flex items-center justify-between py-1.5 px-3 rounded-md bg-background border border-border/50">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-medium text-foreground">{MP_NAMES[s.marketplace] || s.marketplace}</span>
                      <SettlementStatusBadge status={s.status || 'saved'} />
                      {s.xero_invoice_number && (
                        <span className="text-[10px] text-muted-foreground">#{s.xero_invoice_number}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-mono tabular-nums">{formatAUD(s.bank_deposit || 0)}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDrawerSettlementId(s.settlement_id);
                          setDrawerOpen(true);
                        }}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </TableCell>
          </TableRow>
        )}
      </React.Fragment>
    );
  };

  const needsAttentionCount = activeGroups.filter(g => g.overallStatus !== 'pushed').length;
  const readyCount = activeGroups.filter(g => g.overallStatus === 'ready_to_push').length;
  const missingCount = activeGroups.filter(g => g.overallStatus === 'missing').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Woolworths Group Payments
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5">
              <FileText className="h-2.5 w-2.5" /> File upload
            </Badge>
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Upload your Woolworths MarketPlus zip or CSV — Xettle splits across BigW, Everyday Market & MyDeal automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={refreshingXero}
            onClick={handleRefreshXero}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${refreshingXero ? 'animate-spin' : ''}`} />
            Audit Xero
          </Button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="py-3 px-4">
          <p className="text-xs text-muted-foreground">Total Payments</p>
          <p className="text-xl font-bold tabular-nums">{activeGroups.length}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4">
          <p className="text-xs text-muted-foreground">Ready to Push</p>
          <p className="text-xl font-bold tabular-nums text-primary">{readyCount}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4">
          <p className="text-xs text-muted-foreground">Needs Upload</p>
          <p className="text-xl font-bold tabular-nums text-amber-600">{missingCount}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4">
          <p className="text-xs text-muted-foreground">Needs Attention</p>
          <p className="text-xl font-bold tabular-nums text-destructive">{needsAttentionCount}</p>
        </CardContent></Card>
      </div>

      {/* Payments Table */}
      {activeGroups.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <TooltipProvider>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">Payment ID</TableHead>
                    <TableHead>Paid Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-center w-[60px]">CSV</TableHead>
                    <TableHead className="text-center w-[60px]">PDF</TableHead>
                    <TableHead>Breakdown</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right w-[140px]">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeGroups.map(renderPaymentRow)}
                </TableBody>
              </Table>
            </TooltipProvider>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed border-2 border-primary/30">
          <CardContent className="py-12 flex flex-col items-center justify-center text-center gap-3">
            <Package className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="font-semibold text-foreground">No Woolworths payments found</p>
              <p className="text-sm text-muted-foreground mt-1">
                Upload your Woolworths MarketPlus zip file to get started.
              </p>
            </div>
            {onSwitchToUpload && (
              <Button className="gap-2 mt-2" onClick={onSwitchToUpload}>
                <Upload className="h-4 w-4" /> Upload Files
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Pre-boundary payments (collapsed) */}
      {preBoundaryGroups.length > 0 && (
        <Collapsible open={preBoundaryOpen} onOpenChange={setPreBoundaryOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between text-muted-foreground">
              <span className="text-xs">Pre-{accountingBoundary} — managed by prior system ({preBoundaryGroups.length} payments)</span>
              {preBoundaryOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Payment ID</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-center">CSV</TableHead>
                      <TableHead className="text-center">PDF</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preBoundaryGroups.map(g => (
                      <TableRow key={g.bankPaymentId} className="text-muted-foreground">
                        <TableCell className="font-mono text-xs">{g.bankPaymentId}</TableCell>
                        <TableCell className="text-xs">{g.paidDate ? formatSettlementDate(g.paidDate) : '—'}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{formatAUD(g.totalAmount)}</TableCell>
                        <TableCell className="text-center">{g.hasCsv ? <CheckCircle2 className="h-3 w-3 text-emerald-500 mx-auto" /> : <XCircle className="h-3 w-3 text-muted-foreground mx-auto" />}</TableCell>
                        <TableCell className="text-center">{g.hasPdf ? <CheckCircle2 className="h-3 w-3 text-emerald-500 mx-auto" /> : <XCircle className="h-3 w-3 text-muted-foreground mx-auto" />}</TableCell>
                        <TableCell>{getStatusBadge(g.overallStatus)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Upload prompt */}
      {onSwitchToUpload && activeGroups.length > 0 && (
        <Card className="border-dashed border-2 border-primary/30 hover:border-primary/50 transition-colors cursor-pointer bg-muted/30 rounded-xl" onClick={onSwitchToUpload}>
          <CardContent className="py-6 px-8 flex flex-col items-center justify-center text-center gap-2">
            <CloudUpload className="h-8 w-8 text-primary" />
            <p className="text-sm font-bold text-foreground">Upload Woolworths payment files</p>
            <p className="text-xs text-muted-foreground">
              Drop your zip file or CSV + PDF — Xettle splits across marketplaces automatically
            </p>
            <Button size="sm" className="gap-2 mt-1">
              <Upload className="h-4 w-4" /> Smart Upload <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Profit Analysis */}
      {currentUserId && (
        <div className="space-y-3">
          <h4 className="text-base font-semibold text-foreground flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            Profit Analysis
          </h4>
          <MarketplaceProfitCard marketplaceCode={marketplace.marketplace_code} userId={currentUserId} />
        </div>
      )}

      {/* Settlement Detail Drawer */}
      <SettlementDetailDrawer
        settlementId={drawerSettlementId}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setDrawerSettlementId(null); }}
      />
    </div>
  );
}
