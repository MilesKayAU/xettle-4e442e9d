/**
 * OutstandingTab — Shows every Xero invoice "Awaiting Payment" matched against
 * our settlement data and bank deposits. Bookkeeper's primary weekly reconciliation view.
 *
 * Three states per row:
 * 🟢 Green — invoice + settlement + bank deposit all match → "Mark Paid"
 * 🟡 Amber — invoice exists, settlement found, but bank deposit missing or differs → "Investigate"
 * 🔴 Red — invoice in Xero but nothing in our system → "Upload"
 */

import { useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  RefreshCw, CheckCircle2, AlertTriangle, XCircle, Upload, Banknote,
  FileText, Loader2, ChevronDown, ChevronUp, ExternalLink, CreditCard,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface OutstandingRow {
  xero_invoice_id: string;
  xero_invoice_number: string;
  xero_reference: string;
  contact_name: string;
  marketplace: string;
  invoice_date: string | null;
  due_date: string | null;
  amount: number;
  overdue_days: number | null;
  has_settlement: boolean;
  settlement_id: string | null;
  settlement_status: string | null;
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

  const fetchOutstanding = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');

      const resp = await supabase.functions.invoke('fetch-outstanding', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

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
  useState(() => { fetchOutstanding(); });

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
    if (row.match_status.startsWith('gap_')) return <AlertTriangle className="h-4 w-4 text-amber-600" />;
    if (row.match_status === 'no_bank_deposit' && row.has_settlement) return <AlertTriangle className="h-4 w-4 text-amber-600" />;
    return <XCircle className="h-4 w-4 text-destructive" />;
  };

  const getStatusLabel = (row: OutstandingRow) => {
    if (row.match_status === 'balanced') return 'Balanced';
    if (row.match_status.startsWith('gap_')) {
      const gap = row.match_status.replace('gap_', '');
      return `Gap: $${gap}`;
    }
    if (row.match_status === 'no_bank_deposit') return 'No bank deposit';
    return 'No settlement';
  };

  const getRowBgClass = (row: OutstandingRow) => {
    if (row.match_status === 'balanced') return 'bg-green-50/50 dark:bg-green-950/10';
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

      {/* Summary strip */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total outstanding</p>
              <p className="text-xl font-bold text-foreground">{formatAUD(data.total_outstanding)}</p>
              <p className="text-xs text-muted-foreground">{data.invoice_count} invoices</p>
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
              <p className="text-xs text-muted-foreground">Needs attention</p>
              <p className="text-xl font-bold text-amber-600 dark:text-amber-400">
                {data.invoice_count - data.ready_to_reconcile}
              </p>
              <p className="text-xs text-muted-foreground">gaps or missing</p>
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
      {data && data.rows.length === 0 && (
        <Card>
          <CardContent className="p-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-foreground">All clear!</h3>
            <p className="text-sm text-muted-foreground mt-1">No invoices awaiting payment in Xero.</p>
          </CardContent>
        </Card>
      )}

      {/* Main table */}
      {data && data.rows.length > 0 && (
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
              {data.rows.map(row => {
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
                        <div className="flex items-center gap-1.5">
                          {getStatusIcon(row)}
                          <span className="text-xs font-medium">{getStatusLabel(row)}</span>
                        </div>
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
                          {(row.match_status.startsWith('gap_') || row.match_status === 'no_bank_deposit') && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setExpandedRow(isExpanded ? null : row.xero_invoice_id)}
                              className="gap-1 text-xs h-7"
                            >
                              <AlertTriangle className="h-3 w-3" />
                              Investigate
                              {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>

                    {/* Expanded investigation panel */}
                    {isExpanded && (
                      <tr>
                        <td colSpan={9} className="px-6 py-4 bg-muted/20 border-b border-border">
                          <div className="space-y-3">
                            <h4 className="text-sm font-semibold text-foreground">Investigation Details</h4>
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                              <div className="space-y-1">
                                <p className="font-medium text-muted-foreground">Xero Invoice</p>
                                <p>{row.xero_invoice_number} — {row.contact_name}</p>
                                <p>Ref: {row.xero_reference || '—'}</p>
                                <p>Amount: {formatAUD(row.amount)}</p>
                                <p>Date: {row.invoice_date || '—'}</p>
                              </div>
                              <div className="space-y-1">
                                <p className="font-medium text-muted-foreground">Our Settlement</p>
                                {row.has_settlement ? (
                                  <>
                                    <p className="flex items-center gap-1">
                                      <CheckCircle2 className="h-3 w-3 text-green-600" />
                                      Found: {row.settlement_id}
                                    </p>
                                    <p>Status: {row.settlement_status || '—'}</p>
                                  </>
                                ) : (
                                  <p className="flex items-center gap-1 text-destructive">
                                    <XCircle className="h-3 w-3" />
                                    Not in system — upload settlement file
                                  </p>
                                )}
                              </div>
                              <div className="space-y-1">
                                <p className="font-medium text-muted-foreground">Bank Deposit</p>
                                {row.has_bank_deposit && row.bank_match ? (
                                  <>
                                    <p className="flex items-center gap-1">
                                      {row.bank_match.fuzzy ? (
                                        <AlertTriangle className="h-3 w-3 text-amber-600" />
                                      ) : (
                                        <CheckCircle2 className="h-3 w-3 text-green-600" />
                                      )}
                                      {formatAUD(row.bank_match.amount)} on {row.bank_match.date || '—'}
                                    </p>
                                    {row.bank_match.narration && (
                                      <p>Narration: {row.bank_match.narration}</p>
                                    )}
                                    {row.bank_difference != null && row.bank_difference > 0.05 && (
                                      <p className="text-amber-600">Difference: {formatAUD(row.bank_difference)}</p>
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

// Fragment import at top
import { Fragment } from 'react';
