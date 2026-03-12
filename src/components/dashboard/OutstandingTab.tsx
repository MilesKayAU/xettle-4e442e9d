/**
 * OutstandingTab — Shows every Xero invoice "Awaiting Payment" matched against
 * our settlement data and bank deposits. Bookkeeper's primary weekly reconciliation view.
 *
 * Three states per row:
 * 🟢 Green — invoice + settlement + bank deposit all match → "Mark Paid"
 * 🟡 Amber — invoice exists, settlement found, but bank deposit missing or differs → "Investigate"
 * 🔴 Red — invoice in Xero but nothing in our system → "Upload"
 */

import { useState, useCallback, useEffect, Fragment, useMemo } from 'react';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  RefreshCw, CheckCircle2, AlertTriangle, XCircle, Upload, Banknote,
  FileText, Loader2, ChevronDown, ChevronUp, ExternalLink, CreditCard, MinusCircle,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface SettlementEvidence {
  settlement_id: string;
  source: string;
  marketplace: string;
  period_start: string;
  period_end: string;
  bank_deposit: number;
  net_ex_gst: number;
  sales_principal: number;
  seller_fees: number;
  fba_fees: number;
  refunds: number;
  reimbursements: number;
  gst_on_income: number;
  is_split_month: boolean;
  split_part: number | null;
  split_net: number | null;
  bank_verified: boolean;
  xero_status: string | null;
  xero_invoice_number: string | null;
  status: string;
}

interface OutstandingRow {
  xero_invoice_id: string;
  xero_invoice_number: string;
  xero_reference: string;
  contact_name: string;
  marketplace: string;
  is_marketplace: boolean;
  invoice_date: string | null;
  due_date: string | null;
  amount: number;
  currency_code?: string;
  is_pre_boundary?: boolean;
  overdue_days: number | null;
  has_settlement: boolean;
  settlement_id: string | null;
  settlement_status: string | null;
  settlement_evidence: SettlementEvidence | null;
  has_bank_deposit: boolean;
  bank_match: {
    amount: number;
    date: string | null;
    reference: string;
    narration: string;
    transaction_id: string;
    fuzzy?: boolean;
  } | null;
  bank_difference: number | null;
  match_status: string;
}

interface OutstandingSummary {
  total_outstanding: number;
  invoice_count: number;
  matched_with_settlement: number;
  bank_deposit_found: number;
  ready_to_reconcile: number;
  rows: OutstandingRow[];
}

interface Props {
  onSwitchToUpload: () => void;
}

const formatAUD = (n: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n);

const MARKETPLACE_LABELS: Record<string, string> = {
  amazon_au: 'Amazon AU',
  shopify_payments: 'Shopify',
  kogan: 'Kogan',
  bigw: 'Big W',
  bunnings: 'Bunnings',
  mydeal: 'MyDeal',
  catch: 'Catch',
  ebay_au: 'eBay',
  unknown: 'Unknown',
};

export default function OutstandingTab({ onSwitchToUpload }: Props) {
  const [data, setData] = useState<OutstandingSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState<Set<string>>(new Set());
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [showNonMarketplace, setShowNonMarketplace] = useState(false);

  // Filter rows based on marketplace toggle
  const filteredRows = useMemo(() => {
    if (!data) return [];
    if (showNonMarketplace) return data.rows;
    return data.rows.filter(r => r.is_marketplace !== false);
  }, [data, showNonMarketplace]);

  const nonMarketplaceCount = useMemo(() => {
    if (!data) return 0;
    return data.rows.filter(r => r.is_marketplace === false).length;
  }, [data]);

  const filteredTotal = useMemo(() => {
    return filteredRows.reduce((sum, r) => sum + r.amount, 0);
  }, [filteredRows]);

  const [noXeroConnection, setNoXeroConnection] = useState(false);

  const fetchOutstanding = useCallback(async () => {
    setLoading(true);
    setNoXeroConnection(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');

      const resp = await supabase.functions.invoke('fetch-outstanding', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      // Handle "No Xero connection" gracefully — supabase.functions.invoke
      // puts non-2xx responses in resp.error, not resp.data
      const noXeroMsg = resp.data?.error || resp.error?.message || '';
      if (typeof noXeroMsg === 'string' && noXeroMsg.includes('No Xero connection')) {
        setNoXeroConnection(true);
        setHasLoaded(true);
        return;
      }

      if (resp.error) throw resp.error;
      setData(resp.data as OutstandingSummary);
      setHasLoaded(true);
      setSelected(new Set());
    } catch (err: any) {
      toast.error(`Failed to fetch outstanding: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // Auto-load on mount
  useEffect(() => { fetchOutstanding(); }, []);

  const applyPayment = useCallback(async (row: OutstandingRow) => {
    if (!row.has_bank_deposit || !row.bank_match) return;

    setApplying(prev => new Set(prev).add(row.xero_invoice_id));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');

      const resp = await supabase.functions.invoke('apply-xero-payment', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: {
          invoice_id: row.xero_invoice_id,
          bank_transaction_id: row.bank_match.transaction_id,
          amount: row.amount,
          date: row.bank_match.date || row.invoice_date,
          settlement_id: row.settlement_id,
        },
      });

      if (resp.error) throw resp.error;
      if (!resp.data?.success) throw new Error(resp.data?.error || 'Payment failed');

      toast.success(`✓ ${row.xero_invoice_number} marked as paid`);

      // Remove from list
      setData(prev => prev ? {
        ...prev,
        rows: prev.rows.filter(r => r.xero_invoice_id !== row.xero_invoice_id),
        invoice_count: prev.invoice_count - 1,
        total_outstanding: prev.total_outstanding - row.amount,
        ready_to_reconcile: prev.ready_to_reconcile - 1,
      } : null);
    } catch (err: any) {
      toast.error(`Failed: ${err.message}`);
    } finally {
      setApplying(prev => {
        const next = new Set(prev);
        next.delete(row.xero_invoice_id);
        return next;
      });
    }
  }, []);

  const handleBulkApply = useCallback(async () => {
    if (!data) return;
    const balancedSelected = data.rows.filter(
      r => selected.has(r.xero_invoice_id) && r.match_status === 'balanced'
    );
    if (balancedSelected.length === 0) {
      toast.error('No balanced invoices selected');
      return;
    }

    setBulkApplying(true);
    let success = 0;
    for (const row of balancedSelected) {
      try {
        await applyPayment(row);
        success++;
      } catch {}
    }
    setBulkApplying(false);
    if (success > 0) toast.success(`${success} invoice${success > 1 ? 's' : ''} marked as paid`);
  }, [data, selected, applyPayment]);

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!data) return;
    const balancedIds = data.rows.filter(r => r.match_status === 'balanced').map(r => r.xero_invoice_id);
    const allSelected = balancedIds.every(id => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(balancedIds));
  };

  const getStatusIcon = (row: OutstandingRow) => {
    if (row.match_status === 'balanced') return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    if (row.is_pre_boundary && row.match_status === 'no_settlement') return <MinusCircle className="h-4 w-4 text-muted-foreground" />;
    if (row.match_status.startsWith('gap_')) return <AlertTriangle className="h-4 w-4 text-amber-600" />;
    if (row.match_status === 'no_bank_deposit' && row.has_settlement) return <AlertTriangle className="h-4 w-4 text-amber-600" />;
    return <XCircle className="h-4 w-4 text-destructive" />;
  };

  const getStatusLabel = (row: OutstandingRow) => {
    if (row.match_status === 'balanced') return 'Balanced';
    if (row.is_pre_boundary && row.match_status === 'no_settlement') return 'Pre-boundary';
    if (row.match_status.startsWith('gap_')) {
      const gap = row.match_status.replace('gap_', '');
      return `Gap: $${gap}`;
    }
    if (row.match_status === 'no_bank_deposit') return 'No bank deposit';
    return 'No settlement';
  };

  const getRowBgClass = (row: OutstandingRow) => {
    if (row.match_status === 'balanced') return 'bg-green-50/50 dark:bg-green-950/10';
    if (row.is_pre_boundary && row.match_status === 'no_settlement') return '';
    if (row.match_status.startsWith('gap_') || row.match_status === 'no_bank_deposit') return 'bg-amber-50/50 dark:bg-amber-950/10';
    return 'bg-red-50/50 dark:bg-red-950/10';
  };

  // Not loaded yet — show loading
  if (!hasLoaded && loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Outstanding</h2>
          <p className="text-muted-foreground mt-1">Syncing with Xero to find invoices awaiting payment...</p>
        </div>
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </div>
    );
  }

  // No Xero connection — show helpful message
  if (noXeroConnection) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Outstanding</h2>
          <p className="text-muted-foreground mt-1">
            Xero invoices awaiting payment — matched against your settlements and bank deposits.
          </p>
        </div>
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="h-12 w-12 text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-semibold text-foreground mb-2">No Xero Connection</h3>
            <p className="text-muted-foreground max-w-md">
              Connect your Xero account to see outstanding invoices. Go to the <strong>Setup</strong> tab to link Xero, 
              then return here to reconcile your marketplace settlements.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const balancedCount = data?.rows.filter(r => r.match_status === 'balanced').length || 0;
  const selectedBalancedCount = data?.rows.filter(
    r => selected.has(r.xero_invoice_id) && r.match_status === 'balanced'
  ).length || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Outstanding</h2>
          <p className="text-muted-foreground mt-1">
            Xero invoices awaiting payment — matched against your settlements and bank deposits.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchOutstanding}
          disabled={loading}
          className="gap-1.5"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Sync with Xero
        </Button>
      </div>

      {/* Filter toggle for non-marketplace invoices */}
      {data && nonMarketplaceCount > 0 && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Switch
            checked={showNonMarketplace}
            onCheckedChange={setShowNonMarketplace}
          />
          <span>Show {nonMarketplaceCount} non-marketplace invoice{nonMarketplaceCount > 1 ? 's' : ''}</span>
        </div>
      )}

      {/* Summary strip */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total outstanding</p>
              <p className="text-xl font-bold text-foreground">{formatAUD(filteredTotal)}</p>
              <p className="text-xs text-muted-foreground">{filteredRows.length} invoices</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Settlement found</p>
              <p className="text-xl font-bold text-foreground">{data.matched_with_settlement}</p>
              <p className="text-xs text-muted-foreground">of {data.invoice_count}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Bank deposit found</p>
              <p className="text-xl font-bold text-foreground">{data.bank_deposit_found}</p>
              <p className="text-xs text-muted-foreground">of {data.invoice_count}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Ready to reconcile</p>
              <p className="text-xl font-bold text-green-600 dark:text-green-400">{data.ready_to_reconcile}</p>
              <p className="text-xs text-muted-foreground">balanced</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <p className="text-xs text-muted-foreground">Awaiting payment</p>
                    <p className="text-xl font-bold text-amber-600 dark:text-amber-400">
                      {data.invoice_count - data.ready_to_reconcile}
                    </p>
                    <p className="text-xs text-muted-foreground">to action</p>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[220px] text-center">
                  Xero invoices awaiting payment — approve and reconcile these in Xero
                </TooltipContent>
              </Tooltip>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Bulk action bar */}
      {data && balancedCount > 0 && (
        <div className="flex items-center gap-3 py-2 px-3 rounded-lg bg-muted/50 border border-border">
          <Checkbox
            checked={selectedBalancedCount === balancedCount && balancedCount > 0}
            onCheckedChange={toggleSelectAll}
          />
          <span className="text-sm text-muted-foreground">
            {selectedBalancedCount > 0
              ? `${selectedBalancedCount} balanced invoice${selectedBalancedCount > 1 ? 's' : ''} selected`
              : `Select balanced invoices to mark as paid`}
          </span>
          {selectedBalancedCount > 0 && (
            <Button
              size="sm"
              onClick={handleBulkApply}
              disabled={bulkApplying}
              className="gap-1.5 ml-auto"
            >
              {bulkApplying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
              Mark {selectedBalancedCount} as paid
            </Button>
          )}
        </div>
      )}

      {/* No data */}
      {data && filteredRows.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-foreground">All clear!</h3>
            <p className="text-sm text-muted-foreground mt-1">No invoices awaiting payment in Xero.</p>
          </CardContent>
        </Card>
      )}

      {/* Main table */}
      {data && filteredRows.length > 0 && (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b border-border">
                <th className="w-10 px-3 py-2.5"></th>
                <th className="text-left font-medium text-muted-foreground px-3 py-2.5">Invoice</th>
                <th className="text-left font-medium text-muted-foreground px-3 py-2.5">Marketplace</th>
                <th className="text-left font-medium text-muted-foreground px-3 py-2.5">Date</th>
                <th className="text-right font-medium text-muted-foreground px-3 py-2.5">Amount</th>
                <th className="text-center font-medium text-muted-foreground px-3 py-2.5">Settlement</th>
                <th className="text-center font-medium text-muted-foreground px-3 py-2.5">Bank</th>
                <th className="text-left font-medium text-muted-foreground px-3 py-2.5">Status</th>
                <th className="text-right font-medium text-muted-foreground px-3 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody>
              {filteredRows.map(row => {
                const isExpanded = expandedRow === row.xero_invoice_id;
                const isApplying = applying.has(row.xero_invoice_id);
                const isBalanced = row.match_status === 'balanced';

                return (
                  <Fragment key={row.xero_invoice_id}>
                    <tr className={`border-b border-border/50 ${getRowBgClass(row)} hover:bg-muted/30 transition-colors`}>
                      <td className="px-3 py-2">
                        {isBalanced && (
                          <Checkbox
                            checked={selected.has(row.xero_invoice_id)}
                            onCheckedChange={() => toggleSelect(row.xero_invoice_id)}
                          />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div>
                          <p className="font-medium text-foreground">{row.xero_invoice_number}</p>
                          <p className="text-xs text-muted-foreground font-mono truncate max-w-[180px]">
                            {row.xero_reference || '—'}
                          </p>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <Badge variant="secondary" className="text-xs">
                          {MARKETPLACE_LABELS[row.marketplace] || row.marketplace}
                        </Badge>
                      </td>
                      <td className="px-3 py-2">
                        <div className="text-xs">
                          <p>{row.invoice_date ? new Date(row.invoice_date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '—'}</p>
                          {row.overdue_days != null && row.overdue_days > 0 && (
                            <p className="text-destructive font-medium">{row.overdue_days}d overdue</p>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-medium text-foreground">
                        {formatAUD(row.amount)}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {row.has_settlement ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600 inline" />
                        ) : (
                          <XCircle className="h-4 w-4 text-destructive inline" />
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {row.has_bank_deposit ? (
                          row.bank_match?.fuzzy ? (
                            <AlertTriangle className="h-4 w-4 text-amber-600 inline" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4 text-green-600 inline" />
                          )
                        ) : (
                          <XCircle className="h-4 w-4 text-destructive inline" />
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1.5">
                              {getStatusIcon(row)}
                              <span className="text-xs font-medium">{getStatusLabel(row)}</span>
                            </div>
                          </TooltipTrigger>
                          {row.is_pre_boundary && row.match_status === 'no_settlement' && (
                            <TooltipContent side="left" className="max-w-[220px] text-center">
                              Created before Xettle was connected — managed directly in Xero
                            </TooltipContent>
                          )}
                        </Tooltip>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center gap-1.5 justify-end">
                          {isBalanced && (
                            <Button
                              size="sm"
                              onClick={() => applyPayment(row)}
                              disabled={isApplying}
                              className="gap-1 text-xs h-7"
                            >
                              {isApplying ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <CreditCard className="h-3 w-3" />
                              )}
                              Mark Paid
                            </Button>
                          )}
                          {row.match_status === 'no_settlement' && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={onSwitchToUpload}
                              className="gap-1 text-xs h-7"
                            >
                              <Upload className="h-3 w-3" />
                              Upload
                            </Button>
                          )}
                          {/* Evidence / Investigate — available for any non-no_settlement row */}
                          {row.match_status !== 'no_settlement' && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => setExpandedRow(isExpanded ? null : row.xero_invoice_id)}
                              className="gap-1 text-xs h-7"
                            >
                              <FileText className="h-3 w-3" />
                              {row.has_settlement ? 'Evidence' : 'Details'}
                              {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Expanded evidence panel */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={9} className="px-6 py-4 bg-muted/20 border-b border-border">
                          <div className="space-y-3">
                            <h4 className="text-sm font-semibold text-foreground">Match Evidence</h4>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                              {/* Xero Invoice */}
                              <div className="space-y-1.5 p-3 rounded-lg bg-background border border-border">
                                <p className="font-semibold text-muted-foreground flex items-center gap-1.5">
                                  <ExternalLink className="h-3 w-3" /> Xero Invoice
                                </p>
                                <p className="font-medium">{row.xero_invoice_number} — {row.contact_name}</p>
                                <p>Ref: <span className="font-mono">{row.xero_reference || '—'}</span></p>
                                <p>Amount: <span className="font-bold">{formatAUD(row.amount)}</span></p>
                                <p>Date: {row.invoice_date || '—'}</p>
                              </div>

                              {/* Settlement Evidence */}
                              <div className="space-y-1.5 p-3 rounded-lg bg-background border border-border">
                                <p className="font-semibold text-muted-foreground flex items-center gap-1.5">
                                  <FileText className="h-3 w-3" /> Settlement Data
                                </p>
                                {row.settlement_evidence ? (
                                  <>
                                    <p className="flex items-center gap-1">
                                      <CheckCircle2 className="h-3 w-3 text-green-600" />
                                      <span className="font-medium">
                                        {row.settlement_evidence.source === 'api' ? '🔗 Amazon API' : 
                                         row.settlement_evidence.source === 'csv' ? '📄 Uploaded CSV' : '✏️ Manual'}
                                      </span>
                                    </p>
                                    <p className="font-mono text-[10px] text-muted-foreground">{row.settlement_evidence.settlement_id}</p>
                                    <p>Period: {row.settlement_evidence.period_start} → {row.settlement_evidence.period_end}</p>
                                    {row.settlement_evidence.is_split_month && (
                                      <Badge variant="outline" className="text-[10px]">
                                        Split-month Part {row.settlement_evidence.split_part}
                                      </Badge>
                                    )}
                                    <div className="border-t border-border pt-1.5 mt-1.5 space-y-0.5">
                                      <p>Sales: <span className="font-medium text-green-600">{formatAUD(Math.abs(row.settlement_evidence.sales_principal))}</span></p>
                                      <p>Fees: <span className="font-medium text-destructive">{formatAUD(Math.abs(row.settlement_evidence.seller_fees + row.settlement_evidence.fba_fees))}</span></p>
                                      <p>Refunds: <span className="font-medium">{formatAUD(Math.abs(row.settlement_evidence.refunds))}</span></p>
                                      <p>Net ex GST: <span className="font-bold">{formatAUD(row.settlement_evidence.split_net ?? row.settlement_evidence.net_ex_gst)}</span></p>
                                      <p>Bank deposit: <span className="font-bold">{formatAUD(row.settlement_evidence.bank_deposit)}</span></p>
                                    </div>
                                    {row.settlement_evidence.bank_verified && (
                                      <p className="flex items-center gap-1 text-green-600 mt-1">
                                        <Banknote className="h-3 w-3" /> Bank verified ✓
                                      </p>
                                    )}
                                  </>
                                ) : (
                                  <p className="flex items-center gap-1 text-destructive">
                                    <XCircle className="h-3 w-3" />
                                    Not in system — upload settlement file
                                  </p>
                                )}
                              </div>

                              {/* Bank Deposit */}
                              <div className="space-y-1.5 p-3 rounded-lg bg-background border border-border">
                                <p className="font-semibold text-muted-foreground flex items-center gap-1.5">
                                  <Banknote className="h-3 w-3" /> Bank Deposit (Xero)
                                </p>
                                {row.has_bank_deposit && row.bank_match ? (
                                  <>
                                    <p className="flex items-center gap-1">
                                      {row.bank_match.fuzzy ? (
                                        <AlertTriangle className="h-3 w-3 text-amber-600" />
                                      ) : (
                                        <CheckCircle2 className="h-3 w-3 text-green-600" />
                                      )}
                                      <span className="font-bold">{formatAUD(row.bank_match.amount)}</span> on {row.bank_match.date || '—'}
                                    </p>
                                    {row.bank_match.fuzzy && (
                                      <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">Fuzzy match</Badge>
                                    )}
                                    {row.bank_match.narration && (
                                      <p className="text-muted-foreground">Narration: {row.bank_match.narration}</p>
                                    )}
                                    {row.bank_difference != null && row.bank_difference > 0.05 && (
                                      <p className="text-amber-600 font-medium">Difference: {formatAUD(row.bank_difference)}</p>
                                    )}
                                  </>
                                ) : (
                                  <p className="flex items-center gap-1 text-destructive">
                                    <XCircle className="h-3 w-3" />
                                    No matching bank deposit found in Xero
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
