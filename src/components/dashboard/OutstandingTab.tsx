/**
 * OutstandingTab — Shows every Xero invoice "Awaiting Payment" matched against
 * our settlement data and bank deposits. Bookkeeper's primary weekly reconciliation view.
 *
 * Five bank-match states per row:
 * STATE 1 — suggestion_high: High confidence match found, confirm or reject
 * STATE 2 — suggestion_multiple: Multiple candidates, user picks one
 * STATE 3 — no_bank_deposit: No match found, manual reconciliation
 * STATE 4 — confirmed_manual: User manually confirmed a deposit
 * STATE 5 — confirmed / balanced: Deposit matched and confirmed
 *
 * Payment verification states (PayPal, Shopify Payments, etc.):
 * ✅ "Payment confirmed" (green)
 * ⚠️ "Confirm payment match" (amber)
 * 🔗 "Find in Xero →" (grey)
 * 🔧 "Manually confirmed" (blue)
 * ❓ "No feed detected" (yellow — links to settings)
 *
 * PAYMENT VERIFICATION LAYER ONLY
 * Payment matching never creates accounting entries.
 * No invoice. No journal. No Xero push.
 * Settlements are the only accounting source.
 * See: architecture rule #11
 */

import { useState, useCallback, useEffect, Fragment, useMemo } from 'react';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  RefreshCw, CheckCircle2, AlertTriangle, XCircle, Upload, Banknote,
  FileText, Loader2, ChevronDown, ChevronUp, ExternalLink, CreditCard,
  MinusCircle, Clock3, Search, ArrowRight,
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

interface BankCandidate {
  transaction_id: string;
  amount: number;
  date: string;
  reference: string;
  narration: string;
  bank_account_name: string;
  confidence: 'high' | 'medium' | 'low';
  score: number;
  match_type: string;
}

interface BankTxn {
  transaction_id: string;
  amount: number;
  date: string | null;
  reference: string;
  narration: string;
  bank_account_name: string;
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
    confirmed?: boolean;
  } | null;
  bank_difference: number | null;
  match_status: string;
  // Aggregate / suggestion fields
  aggregate_group_id?: string | null;
  aggregate_sum?: number | null;
  aggregate_settlement_count?: number | null;
  aggregate_candidates?: BankCandidate[];
  bank_match_method?: string | null;
  bank_match_confidence?: string | null;
  bank_match_confirmed_at?: string | null;
  recent_bank_txns?: BankTxn[];
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

const formatDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '—';

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
  const [confirming, setConfirming] = useState<Set<string>>(new Set());
  const [manualPickerOpen, setManualPickerOpen] = useState<string | null>(null);

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

  useEffect(() => { fetchOutstanding(); }, []);

  // ─── Confirm bank match (writes to settlements table) ───
  // Nothing is marked as matched until user explicitly confirms.
  // Auto-detection is always a SUGGESTION.
  const confirmBankMatch = useCallback(async (
    row: OutstandingRow,
    bankTxId: string,
    matchedAmount: number,
    method: 'suggested' | 'manual',
    confidence: 'high' | 'medium' | 'low',
  ) => {
    if (!row.settlement_id) return;
    setConfirming(prev => new Set(prev).add(row.xero_invoice_id));
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error('Not authenticated');

      // Nothing is marked as matched until user explicitly confirms.
      // Auto-detection is always a SUGGESTION.
      const { error } = await supabase
        .from('settlements')
        .update({
          bank_tx_id: bankTxId,
          bank_match_amount: matchedAmount,
          bank_match_method: method,
          bank_match_confidence: confidence,
          bank_match_confirmed_at: new Date().toISOString(),
          bank_match_confirmed_by: session.user.id,
        })
        .eq('settlement_id', row.settlement_id)
        .eq('user_id', session.user.id);

      if (error) throw error;

      toast.success(`✓ Deposit confirmed for ${row.xero_invoice_number}`);

      // Update local state to reflect confirmation
      setData(prev => {
        if (!prev) return null;
        return {
          ...prev,
          rows: prev.rows.map(r =>
            r.xero_invoice_id === row.xero_invoice_id
              ? { ...r, match_status: method === 'manual' ? 'confirmed_manual' : 'confirmed', has_bank_deposit: true, bank_match_method: method, bank_match_confirmed_at: new Date().toISOString() }
              : r
          ),
          bank_deposit_found: prev.bank_deposit_found + 1,
          ready_to_reconcile: prev.ready_to_reconcile + 1,
        };
      });
      setManualPickerOpen(null);
    } catch (err: any) {
      toast.error(`Failed to confirm match: ${err.message}`);
    } finally {
      setConfirming(prev => {
        const next = new Set(prev);
        next.delete(row.xero_invoice_id);
        return next;
      });
    }
  }, []);

  // ─── Reject suggestion → drops to "no match" ───
  const rejectSuggestion = useCallback((row: OutstandingRow) => {
    setData(prev => {
      if (!prev) return null;
      return {
        ...prev,
        rows: prev.rows.map(r =>
          r.xero_invoice_id === row.xero_invoice_id
            ? { ...r, match_status: 'no_bank_deposit', aggregate_candidates: [] }
            : r
        ),
      };
    });
  }, []);

  // ─── Reset confirmed match ───
  const resetMatch = useCallback(async (row: OutstandingRow) => {
    if (!row.settlement_id) return;
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('settlements')
        .update({
          bank_tx_id: null,
          bank_match_amount: null,
          bank_match_method: null,
          bank_match_confidence: null,
          bank_match_confirmed_at: null,
          bank_match_confirmed_by: null,
        })
        .eq('settlement_id', row.settlement_id)
        .eq('user_id', session.user.id);

      if (error) throw error;
      toast.success('Match reset — you can re-select a deposit');
      fetchOutstanding(); // Refresh to get fresh candidates
    } catch (err: any) {
      toast.error(`Failed to reset: ${err.message}`);
    }
  }, [fetchOutstanding]);

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
      r => selected.has(r.xero_invoice_id) && (r.match_status === 'balanced' || r.match_status === 'confirmed')
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
    const balancedIds = data.rows.filter(r => r.match_status === 'balanced' || r.match_status === 'confirmed').map(r => r.xero_invoice_id);
    const allSelected = balancedIds.every(id => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(balancedIds));
  };

  const isAmazon = (row: OutstandingRow) => row.marketplace?.toLowerCase().includes('amazon');

  // ─── Status rendering helpers ───
  const getStatusIcon = (row: OutstandingRow) => {
    if (row.match_status === 'balanced' || row.match_status === 'confirmed') return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    if (row.match_status === 'confirmed_manual') return <CheckCircle2 className="h-4 w-4 text-blue-600" />;
    if (row.match_status === 'suggestion_high' || row.match_status === 'suggestion_multiple') return <AlertTriangle className="h-4 w-4 text-amber-600" />;
    if (row.is_pre_boundary && row.match_status === 'no_settlement') return <MinusCircle className="h-4 w-4 text-muted-foreground" />;
    if (row.match_status.startsWith('gap_')) return <AlertTriangle className="h-4 w-4 text-amber-600" />;
    if (row.match_status === 'no_bank_deposit' && row.has_settlement) {
      if (isAmazon(row)) return <Clock3 className="h-4 w-4 text-muted-foreground" />;
      return <AlertTriangle className="h-4 w-4 text-amber-600" />;
    }
    return <XCircle className="h-4 w-4 text-destructive" />;
  };

  const getStatusLabel = (row: OutstandingRow) => {
    if (row.match_status === 'balanced') return 'Balanced';
    if (row.match_status === 'confirmed') return 'Deposit confirmed ✓';
    if (row.match_status === 'confirmed_manual') return 'Confirmed manually ✓';
    if (row.match_status === 'suggestion_high') return 'Likely match found';
    if (row.match_status === 'suggestion_multiple') return 'Possible matches';
    if (row.is_pre_boundary && row.match_status === 'no_settlement') return 'Pre-boundary';
    if (row.match_status.startsWith('gap_')) {
      const gap = row.match_status.replace('gap_', '');
      return `Gap: $${gap}`;
    }
    if (row.match_status === 'no_bank_deposit') {
      return isAmazon(row) ? 'No deposit found' : 'No bank deposit';
    }
    return 'No settlement';
  };

  const getRowBgClass = (row: OutstandingRow) => {
    if (row.match_status === 'balanced' || row.match_status === 'confirmed') return 'bg-green-50/50 dark:bg-green-950/10';
    if (row.match_status === 'confirmed_manual') return 'bg-blue-50/50 dark:bg-blue-950/10';
    if (row.match_status === 'suggestion_high' || row.match_status === 'suggestion_multiple') return 'bg-amber-50/50 dark:bg-amber-950/10';
    if (row.is_pre_boundary && row.match_status === 'no_settlement') return '';
    if (row.match_status === 'no_bank_deposit' && isAmazon(row)) return '';
    if (row.match_status.startsWith('gap_') || row.match_status === 'no_bank_deposit') return 'bg-amber-50/50 dark:bg-amber-950/10';
    return 'bg-red-50/50 dark:bg-red-950/10';
  };

  // ─── Inline bank match action panel (rendered below row when needed) ───
  const renderBankMatchPanel = (row: OutstandingRow) => {
    const isConfirmingRow = confirming.has(row.xero_invoice_id);

    // STATE 5: Confirmed (any method)
    if (row.match_status === 'confirmed' || row.match_status === 'confirmed_manual') {
      return (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-green-800 dark:text-green-300">
              Deposit matched ✓
            </p>
            {row.bank_match && (
              <p className="text-xs text-green-700 dark:text-green-400">
                {formatAUD(row.bank_match.amount)} on {formatDate(row.bank_match.date)}
              </p>
            )}
            {row.bank_match_method === 'manual' && (
              <Badge variant="outline" className="text-[10px] mt-1 text-blue-600 border-blue-300">Manually confirmed</Badge>
            )}
          </div>
          <button
            onClick={() => resetMatch(row)}
            className="text-xs text-muted-foreground hover:text-foreground underline"
          >
            not right? change →
          </button>
        </div>
      );
    }

    // STATE 1: High confidence suggestion
    if (row.match_status === 'suggestion_high' && row.aggregate_candidates?.length) {
      const best = row.aggregate_candidates[0];
      return (
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 space-y-2">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            We found a likely deposit match based on amount and date.
          </p>
          <div className="flex items-center gap-4 text-xs bg-background rounded p-2 border border-border">
            <span className="min-w-[60px]">{formatDate(best.date)}</span>
            <span className="font-mono font-bold">{formatAUD(best.amount)}</span>
            <span className="text-muted-foreground truncate flex-1">{best.narration || best.reference || '—'}</span>
            {best.bank_account_name && <span className="text-muted-foreground text-[10px] shrink-0">{best.bank_account_name}</span>}
            <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700">{best.confidence} confidence</Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Batched deposit across {row.aggregate_settlement_count} settlements totalling {formatAUD(row.aggregate_sum || 0)}
          </p>
          <div className="flex gap-2">
            <Button
              size="sm"
              onClick={() => confirmBankMatch(row, best.transaction_id, best.amount, 'suggested', best.confidence)}
              disabled={isConfirmingRow}
              className="gap-1.5 text-xs h-7"
            >
              {isConfirmingRow ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Confirm match
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => rejectSuggestion(row)}
              className="gap-1.5 text-xs h-7"
            >
              <XCircle className="h-3 w-3" />
              Not this one
            </Button>
          </div>
        </div>
      );
    }

    // STATE 2: Multiple candidates
    if (row.match_status === 'suggestion_multiple' && row.aggregate_candidates?.length) {
      return (
        <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 space-y-2">
          <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
            We found possible deposit matches
          </p>
          <p className="text-xs text-muted-foreground">
            Select the correct deposit for this batch of {row.aggregate_settlement_count} settlements ({formatAUD(row.aggregate_sum || 0)})
          </p>
          <div className="space-y-1.5">
            {row.aggregate_candidates.map((c, i) => (
              <div key={c.transaction_id} className="flex items-center gap-3 text-xs bg-background rounded p-2 border border-border hover:border-primary/50 transition-colors">
                <span className="min-w-[60px]">{formatDate(c.date)}</span>
                <span className="font-mono font-bold min-w-[80px]">{formatAUD(c.amount)}</span>
                <span className="text-muted-foreground truncate flex-1">{c.narration || c.reference || '—'}</span>
                {c.bank_account_name && <span className="text-muted-foreground text-[10px] shrink-0">{c.bank_account_name}</span>}
                <Badge variant="outline" className="text-[10px] shrink-0">{c.confidence}</Badge>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => confirmBankMatch(row, c.transaction_id, c.amount, 'suggested', c.confidence)}
                  disabled={isConfirmingRow}
                  className="text-xs h-6 px-2"
                >
                  {isConfirmingRow ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Select'}
                </Button>
              </div>
            ))}
          </div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => rejectSuggestion(row)}
            className="text-xs h-7 text-muted-foreground"
          >
            None of these are correct
          </Button>
        </div>
      );
    }

    // STATE 3: No match found (Amazon)
    if (row.match_status === 'no_bank_deposit' && isAmazon(row)) {
      const isPickerOpen = manualPickerOpen === row.xero_invoice_id;
      return (
        <div className="p-3 rounded-lg bg-muted/30 border border-border space-y-2">
          <div className="flex items-center gap-2">
            <Clock3 className="h-4 w-4 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No deposit found yet</p>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => window.open('https://go.xero.com/Bank/BankAccounts.aspx', '_blank')}
              className="gap-1.5 text-xs h-7"
            >
              <ExternalLink className="h-3 w-3" />
              Reconcile in Xero →
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setManualPickerOpen(isPickerOpen ? null : row.xero_invoice_id)}
              className="gap-1.5 text-xs h-7"
            >
              <Search className="h-3 w-3" />
              I'll find it manually →
            </Button>
          </div>

          {/* Manual picker: show recent Amazon bank transactions */}
          {isPickerOpen && row.recent_bank_txns && row.recent_bank_txns.length > 0 && (
            <div className="mt-2 space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Recent Amazon deposits:</p>
              {row.recent_bank_txns.map(txn => (
                  <div key={txn.transaction_id} className="flex items-center gap-3 text-xs bg-background rounded p-2 border border-border hover:border-primary/50 transition-colors">
                    <span className="min-w-[60px]">{formatDate(txn.date)}</span>
                    <span className="font-mono font-bold min-w-[80px]">{formatAUD(txn.amount)}</span>
                    <span className="text-muted-foreground truncate flex-1">{txn.narration || txn.reference || '—'}</span>
                    {txn.bank_account_name && <span className="text-muted-foreground text-[10px] shrink-0">{txn.bank_account_name}</span>}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => confirmBankMatch(row, txn.transaction_id, txn.amount, 'manual', 'low')}
                    disabled={isConfirmingRow}
                    className="text-xs h-6 px-2"
                  >
                    {isConfirmingRow ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Select'}
                  </Button>
                </div>
              ))}
            </div>
          )}
          {isPickerOpen && (!row.recent_bank_txns || row.recent_bank_txns.length === 0) && (
            <p className="text-xs text-muted-foreground mt-2">No recent Amazon bank transactions found in Xero.</p>
          )}
        </div>
      );
    }

    return null;
  };

  // ─── Loading state ───
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

  const balancedCount = data?.rows.filter(r => r.match_status === 'balanced' || r.match_status === 'confirmed').length || 0;
  const selectedBalancedCount = data?.rows.filter(
    r => selected.has(r.xero_invoice_id) && (r.match_status === 'balanced' || r.match_status === 'confirmed')
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

      {/* Filter toggle */}
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
              <p className={`text-xl font-bold ${
                data.bank_deposit_found === 0 && filteredRows.every(r => r.has_bank_deposit || isAmazon(r))
                  ? 'text-muted-foreground'
                  : 'text-foreground'
              }`}>{data.bank_deposit_found}</p>
              <p className="text-xs text-muted-foreground">
                {data.bank_deposit_found === 0 && filteredRows.every(r => r.has_bank_deposit || isAmazon(r))
                  ? 'Amazon uses batched deposits'
                  : `of ${data.invoice_count}`}
              </p>
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
                const isBalanced = row.match_status === 'balanced' || row.match_status === 'confirmed';
                const hasSuggestion = row.match_status === 'suggestion_high' || row.match_status === 'suggestion_multiple';

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
                          <p>{formatDate(row.invoice_date)}</p>
                          {row.overdue_days != null && row.overdue_days > 0 && (
                            <p className="text-destructive font-medium">{row.overdue_days}d overdue</p>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <span className="font-mono font-medium text-foreground">{formatAUD(row.amount)}</span>
                          {row.currency_code && row.currency_code !== 'AUD' && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 font-semibold border-amber-300 text-amber-700 dark:text-amber-400">
                              {row.currency_code}
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-center">
                        {row.has_settlement ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600 inline" />
                        ) : row.is_pre_boundary ? (
                          <MinusCircle className="h-4 w-4 text-muted-foreground inline" />
                        ) : (
                          <XCircle className="h-4 w-4 text-destructive inline" />
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {row.match_status === 'confirmed' || row.match_status === 'balanced' ? (
                          <CheckCircle2 className="h-4 w-4 text-green-600 inline" />
                        ) : row.match_status === 'confirmed_manual' ? (
                          <CheckCircle2 className="h-4 w-4 text-blue-600 inline" />
                        ) : hasSuggestion ? (
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <AlertTriangle className="h-4 w-4 text-amber-600 inline" />
                            </TooltipTrigger>
                            <TooltipContent className="text-xs">Suggested match — needs your confirmation</TooltipContent>
                          </Tooltip>
                        ) : row.has_bank_deposit ? (
                          row.bank_match?.fuzzy ? (
                            <AlertTriangle className="h-4 w-4 text-amber-600 inline" />
                          ) : (
                            <CheckCircle2 className="h-4 w-4 text-green-600 inline" />
                          )
                        ) : row.is_pre_boundary ? (
                          <MinusCircle className="h-4 w-4 text-muted-foreground inline" />
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
                          {row.match_status === 'no_settlement' && row.is_pre_boundary && (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => window.open(`https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${row.xero_invoice_id}`, '_blank')}
                              className="gap-1 text-xs h-7"
                            >
                              <ExternalLink className="h-3 w-3" />
                              View in Xero →
                            </Button>
                          )}
                          {row.match_status === 'no_settlement' && !row.is_pre_boundary && (
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

                            {/* Bank match action panel (5 states) */}
                            {(hasSuggestion || row.match_status === 'confirmed' || row.match_status === 'confirmed_manual' || (row.match_status === 'no_bank_deposit' && isAmazon(row))) && (
                              <div className="mb-3">
                                {renderBankMatchPanel(row)}
                              </div>
                            )}

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
                                    {row.bank_match.confirmed && (
                                      <Badge variant="outline" className="text-[10px] text-green-600 border-green-300">User confirmed</Badge>
                                    )}
                                    {row.bank_match.narration && (
                                      <p className="text-muted-foreground">Narration: {row.bank_match.narration}</p>
                                    )}
                                    {row.bank_difference != null && row.bank_difference > 0.05 && (
                                      <p className="text-amber-600 font-medium">Difference: {formatAUD(row.bank_difference)}</p>
                                    )}
                                  </>
                                ) : (
                                  <p className="flex items-center gap-1 text-muted-foreground">
                                    <Clock3 className="h-3 w-3" />
                                    {isAmazon(row) ? 'Amazon batches deposits — check suggestions above' : 'No matching bank deposit found in Xero'}
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
