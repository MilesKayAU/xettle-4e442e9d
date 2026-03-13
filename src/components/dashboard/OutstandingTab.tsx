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
import TablePaginationBar, { DEFAULT_PAGE_SIZE } from '@/components/shared/TablePaginationBar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import {
  RefreshCw, CheckCircle2, AlertTriangle, XCircle, Upload, Banknote,
  FileText, Loader2, ChevronDown, ChevronUp, ExternalLink, CreditCard,
  MinusCircle, Clock3, Search, ArrowRight, Shield, Link2, ShoppingBag,
} from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ACCOUNTING_RULES } from '@/constants/accounting-rules';

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
  // Payment verification (Rule #11 — verification only, never accounting)
  payment_verifications?: PaymentVerificationState[];
}

interface PaymentVerificationCandidate {
  transaction_id: string;
  amount: number;
  date: string;
  narration: string;
  bank_account_name: string;
  gateway_code: string;
  order_count: number;
  confidence: 'high' | 'medium' | 'low';
  score: number;
}

interface PaymentVerificationState {
  gateway_code: string;
  gateway_label: string;
  status: 'confirmed' | 'suggestion' | 'no_match' | 'manual' | 'no_feed';
  candidates?: PaymentVerificationCandidate[];
  confirmed_amount?: number;
  confirmed_date?: string;
  confirmed_method?: string;
}

interface OutstandingSummary {
  total_outstanding: number;
  invoice_count: number;
  matched_with_settlement: number;
  bank_deposit_found: number;
  ready_to_reconcile: number;
  rows: OutstandingRow[];
  sync_info?: {
    bank_feed_empty?: boolean;
    bank_txn_count_cached?: number;
    bank_cache_range?: { min: string; max: string } | null;
    matched_settlement_count?: number;
    settlement_count_total?: number;
    candidates_generated?: number;
    source?: string;
    invoice_source?: string;
    bank_transactions_source?: string;
    bank_cache_last_refreshed_at?: string | null;
    bank_cache_stale?: boolean;
    bank_cache_query_error?: boolean;
    lookback_days_effective?: number;
    force_recompute_used?: boolean;
    missing_settlement_ids?: string[];
    mapping_status?: {
      has_any_mapping?: boolean;
      missing_marketplaces?: string[];
      used_default_for?: string[];
    };
  };
}

interface Props {
  onSwitchToUpload: () => void;
}

const GATEWAY_LABELS: Record<string, string> = {
  paypal: 'PayPal',
  shopify_payments: 'Shopify Payments',
  manual_gateway: 'Manual',
};

const formatAUD = (n: number) =>
  new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n);

const formatDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '—';

const MARKETPLACE_LABELS: Record<string, string> = {
  amazon_au: 'Amazon AU',
  amazon_us: 'Amazon US',
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
  const [rescanning, setRescanning] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState<Set<string>>(new Set());
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [bulkApplying, setBulkApplying] = useState(false);
  const [showNonMarketplace, setShowNonMarketplace] = useState(false);
  const [confirming, setConfirming] = useState<Set<string>>(new Set());
  const [manualPickerOpen, setManualPickerOpen] = useState<string | null>(null);
  const [backfilling, setBackfilling] = useState(false);
  const [paymentVerifications, setPaymentVerifications] = useState<Record<string, PaymentVerificationCandidate[]>>({});
  const [depositCoverage, setDepositCoverage] = useState<Record<string, {
    siblings: Array<{ settlement_id: string; match_amount: number; confidence_score: number; period_start?: string; period_end?: string; marketplace?: string }>;
    depositAmount: number;
    depositDate: string | null;
    confidence: number;
    matchMethod: string;
  }>>({});

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

  const [outPage, setOutPage] = useState(1);
  const outTotalPages = Math.max(1, Math.ceil(filteredRows.length / DEFAULT_PAGE_SIZE));
  const safeOutPage = Math.min(outPage, outTotalPages);
  const paginatedRows = useMemo(() => {
    const start = (safeOutPage - 1) * DEFAULT_PAGE_SIZE;
    return filteredRows.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [filteredRows, safeOutPage]);
  useEffect(() => { setOutPage(1); }, [showNonMarketplace]);

  const [noXeroConnection, setNoXeroConnection] = useState(false);
  const [connectedMarketplaces, setConnectedMarketplaces] = useState<{ amazon: boolean; shopify: boolean }>({ amazon: false, shopify: false });

  // Check which marketplace APIs are connected
  useEffect(() => {
    const checkConnections = async () => {
      const [amazonRes, shopifyRes] = await Promise.all([
        supabase.from('amazon_tokens').select('id', { count: 'exact', head: true }),
        supabase.from('shopify_tokens').select('id', { count: 'exact', head: true }),
      ]);
      setConnectedMarketplaces({
        amazon: (amazonRes.count || 0) > 0,
        shopify: (shopifyRes.count || 0) > 0,
      });
    };
    checkConnections();
  }, []);

  const fetchOutstanding = useCallback(async (options?: { runSync?: boolean }) => {
    setLoading(true);
    setNoXeroConnection(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');

      if (options?.runSync) {
        const syncResp = await supabase.functions.invoke('sync-xero-status', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });

        // Treat sync failure as actionable — surface no-connection explicitly
        if (syncResp.error) {
          console.warn(`[OutstandingTab] sync-xero-status error: ${syncResp.error.message}`);
        }
        if (syncResp.data?.success === false) {
          const syncError = syncResp.data?.error || '';
          if (typeof syncError === 'string' && (syncError.includes('No Xero connection') || syncError.includes('Unauthorized'))) {
            setNoXeroConnection(true);
            setHasLoaded(true);
            setLoading(false);
            return;
          }
        }
      }

      const resp = await supabase.functions.invoke('fetch-outstanding', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      // Check for structured no_xero_connection signal from fetch-outstanding
      if (resp.data?.sync_info?.no_xero_connection === true) {
        setNoXeroConnection(true);
        setHasLoaded(true);
        return;
      }

      const noXeroMsg = resp.data?.error || resp.error?.message || '';
      if (typeof noXeroMsg === 'string' && noXeroMsg.includes('No Xero connection')) {
        setNoXeroConnection(true);
        setHasLoaded(true);
        return;
      }

      if (resp.error) throw resp.error;
      if ((resp.data as { source?: string })?.source === 'cache_fallback') {
        toast.warning('Xero is temporarily rate limited — showing cached outstanding data while background sync continues.');
      }

      setData(resp.data as OutstandingSummary);
      setHasLoaded(true);
      setSelected(new Set());
    } catch (err: any) {
      toast.error(`Failed to fetch outstanding: ${err.message}`);
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Re-scan matches: force recompute with bounded lookback ───
  const rescanMatches = useCallback(async () => {
    setRescanning(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error('Not authenticated');

      const resp = await supabase.functions.invoke('fetch-outstanding', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { force_recompute: true, lookback_days: 90 },
      });

      if (resp.data?.sync_info?.no_xero_connection === true) {
        setNoXeroConnection(true);
        setHasLoaded(true);
        setRescanning(false);
        return;
      }

      if (resp.error) throw resp.error;

      const result = resp.data as OutstandingSummary;
      setData(result);
      setHasLoaded(true);
      setSelected(new Set());

      const matched = result.sync_info?.matched_settlement_count || 0;
      const candidates = result.sync_info?.candidates_generated || 0;
      toast.success(`Re-scan complete — ${matched} matched, ${candidates} suggested`);

      if (result.sync_info?.bank_feed_empty) {
        // Existing banner will show
      } else if (result.sync_info?.bank_cache_stale) {
        toast.warning('Bank feed cache is stale — run bank sync or check connection.');
      }
    } catch (err: any) {
      toast.error(`Re-scan failed: ${err.message}`);
    } finally {
      setRescanning(false);
    }
  }, []);

  // ─── Evidence-triggered backfill for missing settlements ───
  const triggerBackfill = useCallback(async (missingIds: string[]) => {
    if (missingIds.length === 0 || backfilling) return;
    setBackfilling(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const resp = await supabase.functions.invoke('fetch-amazon-settlements', {
        headers: { Authorization: `Bearer ${session.access_token}`, 'x-action': 'backfill' },
        body: { missing_settlement_ids: missingIds },
      });

      if (resp.data?.backfilled > 0) {
        toast.success(`Found ${resp.data.backfilled} missing settlement${resp.data.backfilled > 1 ? 's' : ''} — refreshing…`);
        await fetchOutstanding({ runSync: false });
      } else {
        toast.info('Settlement reports not found in Amazon — they may be older than 270 days.');
      }
    } catch (err: any) {
      console.error('[backfill] error:', err);
    } finally {
      setBackfilling(false);
    }
  }, [backfilling, fetchOutstanding]);

  // Auto-trigger backfill when missing settlement IDs detected
  useEffect(() => {
    const missingIds = data?.sync_info?.missing_settlement_ids;
    if (missingIds && missingIds.length > 0 && hasLoaded && !backfilling) {
      triggerBackfill(missingIds);
    }
  }, [data?.sync_info?.missing_settlement_ids, hasLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // On mount, fetch cached data only — sync only when user clicks "Sync with Xero"
  // This prevents Xero API rate-limit death spirals (see RCA: ~43 calls per mount)
  useEffect(() => { fetchOutstanding({ runSync: false }); }, [fetchOutstanding]);

  // ─── Fetch payment verification candidates (Rule #11 — verification only) ───
  // PAYMENT VERIFICATION LAYER ONLY
  // This never creates accounting entries. No invoice. No journal. No Xero push.
  // Settlements are the only accounting source.
  const fetchPaymentVerifications = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      const resp = await supabase.functions.invoke('verify-payment-matches', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (resp.data?.candidates) {
        setPaymentVerifications(resp.data.candidates);
      }
    } catch {
      // Non-blocking — payment verification is optional
    }
  }, []);

  useEffect(() => {
    if (hasLoaded && data) {
      fetchPaymentVerifications();
    }
  }, [hasLoaded, data, fetchPaymentVerifications]);

  // ─── Lazy-load deposit coverage when a row is expanded ───
  // Only fetches deposit_group_id data when rowExpanded === true (never preloads)
  useEffect(() => {
    if (!expandedRow || !data) return;
    const row = data.rows.find(r => r.xero_invoice_id === expandedRow);
    if (!row?.settlement_id || depositCoverage[row.settlement_id]) return;

    const fetchCoverage = async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) return;

        // Step 1: Get this settlement's payment verification to find deposit_group_id
        const { data: pv } = await supabase
          .from('payment_verifications')
          .select('deposit_group_id, match_amount, confidence_score, match_method, transaction_date')
          .eq('settlement_id', row.settlement_id!)
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (!pv?.deposit_group_id) return;

        // Step 2: Fetch all siblings sharing this deposit_group_id
        const { data: siblings } = await supabase
          .from('payment_verifications')
          .select('settlement_id, match_amount, confidence_score')
          .eq('deposit_group_id', pv.deposit_group_id)
          .eq('user_id', session.user.id);

        if (!siblings || siblings.length === 0) return;

        // Step 3: Get settlement details for each sibling
        const siblingIds = siblings.map(s => s.settlement_id);
        const { data: settlementDetails } = await supabase
          .from('settlements')
          .select('settlement_id, period_start, period_end, marketplace, bank_deposit')
          .in('settlement_id', siblingIds)
          .eq('user_id', session.user.id);

        const enriched = siblings.map(s => {
          const detail = settlementDetails?.find(d => d.settlement_id === s.settlement_id);
          return {
            ...s,
            period_start: detail?.period_start || undefined,
            period_end: detail?.period_end || undefined,
            marketplace: detail?.marketplace || undefined,
            bank_deposit: detail?.bank_deposit || 0,
          };
        });

        setDepositCoverage(prev => ({
          ...prev,
          [row.settlement_id!]: {
            siblings: enriched,
            depositAmount: pv.match_amount || 0,
            depositDate: pv.transaction_date || null,
            confidence: pv.confidence_score || 0,
            matchMethod: pv.match_method || 'unknown',
          },
        }));
      } catch {
        // Non-blocking
      }
    };

    fetchCoverage();
  }, [expandedRow, data, depositCoverage]);

  // ─── Confirm payment verification (writes to payment_verifications table) ───
  // Nothing is marked as matched until user explicitly confirms.
  // Auto-detection is always a SUGGESTION.
  const confirmPaymentVerification = useCallback(async (
    settlementId: string,
    gatewayCode: string,
    txnId: string,
    amount: number,
    method: 'suggested' | 'manual',
    confidence: 'high' | 'medium' | 'low',
    orderCount: number,
    narration: string,
    transactionDate: string,
  ) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('payment_verifications')
        .upsert({
          user_id: session.user.id,
          settlement_id: settlementId,
          gateway_code: gatewayCode,
          xero_tx_id: txnId,
          match_amount: amount,
          match_method: method,
          match_confidence: confidence,
          match_confirmed_at: new Date().toISOString(),
          match_confirmed_by: session.user.id,
          order_count: orderCount,
          narration,
          transaction_date: transactionDate,
        }, { onConflict: 'settlement_id,gateway_code,user_id' });

      if (error) throw error;
      toast.success(`✓ ${GATEWAY_LABELS[gatewayCode] || gatewayCode} payment verified`);
    } catch (err: any) {
      toast.error(`Failed to confirm: ${err.message}`);
    }
  }, []);

  // ─── Render payment verification badges for a row ───
  const renderPaymentVerificationBadges = (row: OutstandingRow) => {
    if (!row.settlement_id) return null;

    const badges: JSX.Element[] = [];
    for (const [gatewayCode, candidates] of Object.entries(paymentVerifications)) {
      if (!candidates || candidates.length === 0) continue;

      const label = GATEWAY_LABELS[gatewayCode] || gatewayCode;

      // Check if already confirmed
      // For now, show suggestion badges for all candidates
      if (candidates.length === 1 && candidates[0].confidence === 'high') {
        const c = candidates[0];
        badges.push(
          <div key={gatewayCode} className="flex items-center gap-1.5 text-xs">
            <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 dark:text-amber-400 gap-1">
              <Shield className="h-2.5 w-2.5" />
              {label}: {c.order_count} orders · {formatAUD(c.amount)}
            </Badge>
            <Button
              size="sm"
              variant="outline"
              onClick={() => confirmPaymentVerification(
                row.settlement_id!, gatewayCode, c.transaction_id,
                c.amount, 'suggested', c.confidence, c.order_count,
                c.narration, c.date
              )}
              className="text-[10px] h-5 px-1.5"
            >
              Confirm
            </Button>
          </div>
        );
      } else if (candidates.length > 0) {
        badges.push(
          <Badge key={gatewayCode} variant="outline" className="text-[10px] border-muted text-muted-foreground gap-1">
            <Shield className="h-2.5 w-2.5" />
            {label}: {candidates.length} possible match{candidates.length > 1 ? 'es' : ''}
          </Badge>
        );
      }
    }

    if (badges.length === 0) return null;

    return (
      <div className="flex flex-wrap gap-1 mt-1">
        {badges}
      </div>
    );
  };

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
    if (row.match_status === 'unsupported_marketplace') return <AlertTriangle className="h-4 w-4 text-muted-foreground" />;
    if (row.match_status === 'settlement_not_ingested') return <Clock3 className="h-4 w-4 text-amber-500" />;
    if (row.is_pre_boundary && row.match_status === 'no_settlement') return <MinusCircle className="h-4 w-4 text-muted-foreground" />;
    if (row.match_status === 'awaiting_sync') return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
    if ((row.match_status || '').startsWith('gap_')) return <AlertTriangle className="h-4 w-4 text-amber-600" />;
    if (row.match_status === 'no_bank_deposit' && row.has_settlement) {
      return <Clock3 className="h-4 w-4 text-muted-foreground" />;
    }
    return <XCircle className="h-4 w-4 text-destructive" />;
  };

   const getStatusLabel = (row: OutstandingRow) => {
    if (row.match_status === 'balanced') return 'Balanced';
    if (row.match_status === 'confirmed') return 'Deposit confirmed ✓';
    if (row.match_status === 'confirmed_manual') return 'Confirmed manually ✓';
    if (row.match_status === 'suggestion_high') return 'Likely match found';
    if (row.match_status === 'suggestion_multiple') return 'Possible matches';
    if (row.match_status === 'unsupported_marketplace') return `${MARKETPLACE_LABELS[row.marketplace] || row.marketplace} not connected`;
    if (row.match_status === 'settlement_not_ingested') return 'Settlement not imported';
    if (row.is_pre_boundary && row.match_status === 'no_settlement') return 'Pre-boundary';
    if (row.match_status === 'awaiting_sync') return 'Syncing settlement…';
    if ((row.match_status || '').startsWith('gap_')) {
      const gap = row.match_status.replace('gap_', '');
      return `Gap: $${gap}`;
    }
    if (row.match_status === 'no_bank_deposit' && row.has_settlement) {
      return 'Awaiting deposit';
    }
    if (row.match_status === 'no_bank_deposit') return 'No deposit found';
    return 'No settlement';
  };

  const getRowBgClass = (row: OutstandingRow) => {
    if (row.match_status === 'balanced' || row.match_status === 'confirmed') return 'bg-green-50/50 dark:bg-green-950/10';
    if (row.match_status === 'confirmed_manual') return 'bg-blue-50/50 dark:bg-blue-950/10';
    if (row.match_status === 'suggestion_high' || row.match_status === 'suggestion_multiple') return 'bg-amber-50/50 dark:bg-amber-950/10';
    if (row.match_status === 'unsupported_marketplace') return 'bg-muted/30';
    if (row.match_status === 'settlement_not_ingested') return 'bg-amber-50/30 dark:bg-amber-950/10';
    if (row.is_pre_boundary && row.match_status === 'no_settlement') return '';
    if (row.match_status === 'awaiting_sync') return 'bg-blue-50/30 dark:bg-blue-950/10';
    if (row.match_status === 'no_bank_deposit' && isAmazon(row)) return '';
    if ((row.match_status || '').startsWith('gap_') || row.match_status === 'no_bank_deposit') return 'bg-amber-50/50 dark:bg-amber-950/10';
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

    // STATE 3: No match found (Amazon — settlement verified, awaiting batched deposit)
    if (row.match_status === 'no_bank_deposit' && isAmazon(row)) {
      const isPickerOpen = manualPickerOpen === row.xero_invoice_id;
      return (
        <div className="p-3 rounded-lg bg-muted/30 border border-border space-y-2">
          <div className="flex items-center gap-2">
            {row.has_settlement ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <p className="text-sm text-foreground font-medium">Settlement verified ✓</p>
                <span className="text-xs text-muted-foreground">— awaiting batched Amazon deposit</span>
              </>
            ) : (
              <>
                <Clock3 className="h-4 w-4 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">No deposit found yet</p>
              </>
            )}
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
        <div className="flex items-center gap-2">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={rescanMatches}
                disabled={rescanning || loading}
                className="gap-1.5"
              >
                <Search className={`h-4 w-4 ${rescanning ? 'animate-pulse' : ''}`} />
                {rescanning ? 'Scanning…' : 'Re-scan matches'}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Rebuild suggestions from the last 90 days</p>
            </TooltipContent>
          </Tooltip>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchOutstanding({ runSync: true })}
            disabled={loading || rescanning}
            className="gap-1.5"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Sync with Xero
          </Button>
        </div>
      </div>

      {/* Smart marketplace connection prompt */}
      {data && data.invoice_count > 0 && data.matched_with_settlement < data.invoice_count * 0.5 && (() => {
        // Detect which marketplaces are in outstanding invoices but missing settlements
        const unmatchedMarketplaces = new Map<string, number>();
        for (const row of data.rows) {
          if (!row.has_settlement && row.is_marketplace) {
            const mkt = row.marketplace || 'unknown';
            unmatchedMarketplaces.set(mkt, (unmatchedMarketplaces.get(mkt) || 0) + 1);
          }
        }

        const hasAmazonUnmatched = unmatchedMarketplaces.has('amazon_au');
        const hasShopifyUnmatched = unmatchedMarketplaces.has('shopify_payments');
        const amazonCount = unmatchedMarketplaces.get('amazon_au') || 0;
        const shopifyCount = unmatchedMarketplaces.get('shopify_payments') || 0;
        const amazonConnected = connectedMarketplaces.amazon;
        const shopifyConnected = connectedMarketplaces.shopify;
        const otherUnmatched = [...unmatchedMarketplaces.entries()].filter(([k]) => k !== 'amazon_au' && k !== 'shopify_payments');

        if (unmatchedMarketplaces.size === 0) return null;

        // If all unmatched marketplaces are already connected, show "syncing" state
        const allConnected = (!hasAmazonUnmatched || amazonConnected) && (!hasShopifyUnmatched || shopifyConnected) && otherUnmatched.length === 0;

        if (allConnected) {
          return (
            <div className="flex items-start gap-3 p-4 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20">
              <Loader2 className="h-5 w-5 text-blue-600 dark:text-blue-400 animate-spin shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-blue-800 dark:text-blue-300">
                  Fetching settlement data from connected marketplaces
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-400 mt-0.5">
                  {hasAmazonUnmatched && amazonConnected ? `Amazon (${amazonCount} invoices) ` : ''}
                  {hasShopifyUnmatched && shopifyConnected ? `Shopify (${shopifyCount} invoices) ` : ''}
                  — settlements will automatically match as they arrive. Refresh shortly.
                </p>
              </div>
            </div>
          );
        }

        // Otherwise, prompt to connect missing marketplaces
        return (
          <div className="p-4 rounded-lg border border-primary/30 bg-primary/5 space-y-3">
            <div className="flex items-start gap-3">
              <Link2 className="h-5 w-5 text-primary shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-sm font-medium text-foreground">
                  Xero sync complete — {data.invoice_count} outstanding invoices found
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Connect your marketplace accounts to automatically match settlement data against these invoices.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 ml-8">
              {hasAmazonUnmatched && !amazonConnected && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/30"
                  onClick={() => { window.location.href = '/setup?connect=amazon'; }}
                >
                  <ShoppingBag className="h-3.5 w-3.5 text-amber-600" />
                  Connect Amazon ({amazonCount} invoice{amazonCount > 1 ? 's' : ''} waiting)
                </Button>
              )}
              {hasAmazonUnmatched && amazonConnected && (
                <Badge variant="outline" className="text-xs border-emerald-300 text-emerald-700 dark:text-emerald-400 gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Amazon connected — syncing {amazonCount} invoice{amazonCount > 1 ? 's' : ''}
                </Badge>
              )}
              {hasShopifyUnmatched && !shopifyConnected && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs border-emerald-300 hover:bg-emerald-50 dark:hover:bg-emerald-950/30"
                  onClick={() => { window.location.href = '/setup?connect=shopify'; }}
                >
                  <ShoppingBag className="h-3.5 w-3.5 text-emerald-600" />
                  Connect Shopify ({shopifyCount} invoice{shopifyCount > 1 ? 's' : ''} waiting)
                </Button>
              )}
              {hasShopifyUnmatched && shopifyConnected && (
                <Badge variant="outline" className="text-xs border-emerald-300 text-emerald-700 dark:text-emerald-400 gap-1">
                  <CheckCircle2 className="h-3 w-3" /> Shopify connected — syncing {shopifyCount} invoice{shopifyCount > 1 ? 's' : ''}
                </Badge>
              )}
              {otherUnmatched.length > 0 && (
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5 text-xs"
                  onClick={onSwitchToUpload}
                >
                  <Upload className="h-3.5 w-3.5" />
                  Upload settlements for {otherUnmatched.map(([k, v]) => `${MARKETPLACE_LABELS[k] || k} (${v})`).join(', ')}
                </Button>
              )}
            </div>
          </div>
        );
      })()}

      {/* Bank feed diagnostic banners */}
      {data?.sync_info?.bank_cache_query_error && data.invoice_count > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <XCircle className="h-4 w-4 shrink-0" />
          <span>
            <strong>Bank feed unavailable</strong> — there was an error reading cached bank transactions. Try syncing again.
          </span>
        </div>
      )}
      {data?.sync_info?.mapping_status && !data.sync_info.mapping_status.has_any_mapping && data.invoice_count > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-300">
          <Banknote className="h-4 w-4 shrink-0" />
          <span className="flex-1">
            <strong>Payout account setup needed</strong> — select where each marketplace pays you in Xero to match deposits accurately.
            Invoices and settlements are still visible below.
          </span>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={() => window.dispatchEvent(new CustomEvent('xettle:open-settings'))}
          >
            Go to Settings
          </Button>
        </div>
      )}
      {!data?.sync_info?.bank_cache_query_error && data?.sync_info?.bank_feed_empty && data?.sync_info?.mapping_status?.has_any_mapping !== false && data.invoice_count > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          <span>
            <strong>No bank feed data found</strong> — bank deposit matching requires bank transactions to be synced from your accounting software.
            Check your bank feed connection in Settings.
          </span>
        </div>
      )}
      {!data?.sync_info?.bank_cache_query_error && !data?.sync_info?.bank_feed_empty && data?.sync_info?.bank_cache_stale && data.invoice_count > 0 && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 text-sm text-amber-800 dark:text-amber-300">
          <Clock3 className="h-4 w-4 shrink-0" />
          <span>
            <strong>Bank feed data is stale</strong> — last refreshed {data.sync_info.bank_cache_last_refreshed_at
              ? new Date(data.sync_info.bank_cache_last_refreshed_at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
              : 'unknown'}. Sync bank transactions to get latest deposit matches.
          </span>
        </div>
      )}

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
      {data && (() => {
        const verifiedCount = filteredRows.filter(r =>
          r.settlement_status === 'verified_payout' ||
          (r.match_status === 'confirmed' && r.bank_match_confirmed_at)
        ).length;
        const depositMatchedCount = filteredRows.filter(r =>
          r.settlement_status === 'deposit_matched' ||
          r.match_status === 'suggestion_high'
        ).length;

        return (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total outstanding</p>
              <p className="text-xl font-bold text-foreground">{formatAUD(filteredTotal)}</p>
              <p className="text-xs text-muted-foreground">{filteredRows.length} invoices</p>
            </CardContent>
          </Card>
          <Card className={data.matched_with_settlement === data.invoice_count ? 'border-emerald-200 dark:border-emerald-800' : ''}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Settlement found</p>
              <p className={`text-xl font-bold ${data.matched_with_settlement === data.invoice_count ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'}`}>
                {data.matched_with_settlement}
              </p>
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
              <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{data.ready_to_reconcile}</p>
              <p className="text-xs text-muted-foreground">balanced</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div>
                    <p className="text-xs text-muted-foreground">Verified payouts</p>
                    <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                      {verifiedCount}
                    </p>
                    <p className="text-xs text-muted-foreground">of {data.invoice_count}</p>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="max-w-[220px] text-center">
                  Settlements with confirmed bank deposits
                </TooltipContent>
              </Tooltip>
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
        );
      })()}

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
            <p className="text-sm text-muted-foreground mt-1">No marketplace invoices awaiting payment in Xero.</p>
            <p className="text-xs text-muted-foreground mt-2">
              This means all invoices are either paid, or settlements haven't been pushed to Xero yet.
              Check the <strong>Settlements</strong> tab to push any unsent settlements.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Main table */}
      {data && filteredRows.length > 0 && (
        <>
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
              {paginatedRows.map(row => {
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

                            {/* Payment verification badges (Rule #11 — verification only) */}
                            {Object.keys(paymentVerifications).length > 0 && row.settlement_id && (
                              <div className="mb-3 p-3 rounded-lg bg-muted/30 border border-border">
                                <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5 mb-2">
                                  <Shield className="h-3 w-3" /> Payment Verification
                                </p>
                                {renderPaymentVerificationBadges(row)}
                              </div>
                            )}

                            {/* Deposit Coverage Panel — shows which settlements a deposit covers */}
                            {row.settlement_id && depositCoverage[row.settlement_id] && depositCoverage[row.settlement_id].siblings.length > 1 && (() => {
                              const coverage = depositCoverage[row.settlement_id!];
                              const settlementTotal = coverage.siblings.reduce((sum, s) => sum + Math.abs((s as any).bank_deposit || 0), 0);
                              const difference = Math.abs(coverage.depositAmount - settlementTotal);
                              const hasDifference = difference > 0.05;

                              return (
                                <div className="mb-3 p-3 rounded-lg bg-muted/20 border border-border space-y-2">
                                  <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                                    <Banknote className="h-3 w-3" /> Deposit Coverage
                                  </p>
                                  <div className="flex items-baseline gap-2 flex-wrap">
                                    <span className="text-sm font-bold text-foreground">
                                      {formatAUD(coverage.depositAmount)}
                                    </span>
                                    <span className="text-xs text-muted-foreground">
                                      detected {coverage.depositDate ? `on ${formatDate(coverage.depositDate)}` : ''}
                                    </span>
                                    <Badge variant="outline" className="text-[10px]">
                                      {coverage.matchMethod === 'batch_sum' ? 'Batch payout' : 'Single match'}
                                    </Badge>
                                    <Badge variant="outline" className="text-[10px]">
                                      {coverage.confidence}% confidence
                                    </Badge>
                                  </div>
                                  <p className="text-xs text-muted-foreground">
                                    Covers {coverage.siblings.length} settlements:
                                  </p>
                                  <div className="space-y-1">
                                    {coverage.siblings.map(s => (
                                      <div key={s.settlement_id} className="flex items-center gap-2 text-xs">
                                        <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400 shrink-0" />
                                        <span className="font-medium text-foreground">
                                          {MARKETPLACE_LABELS[(s.marketplace || 'unknown')] || s.marketplace || 'Settlement'}
                                        </span>
                                        <span className="text-muted-foreground">
                                          {s.period_start && s.period_end
                                            ? `${formatDate(s.period_start)} – ${formatDate(s.period_end)}`
                                            : s.settlement_id}
                                        </span>
                                        <span className="font-mono font-bold text-foreground ml-auto">
                                          {formatAUD(Math.abs((s as any).bank_deposit || 0))}
                                        </span>
                                      </div>
                                    ))}
                                  </div>
                                  <div className="border-t border-border pt-2 mt-2 flex items-center gap-4 text-xs flex-wrap">
                                    <div>
                                      <span className="text-muted-foreground">Total settlements: </span>
                                      <span className="font-mono font-bold text-foreground">{formatAUD(settlementTotal)}</span>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Deposit amount: </span>
                                      <span className="font-mono font-bold text-foreground">{formatAUD(coverage.depositAmount)}</span>
                                    </div>
                                    <div>
                                      <span className="text-muted-foreground">Difference: </span>
                                      <span className={`font-mono font-bold ${hasDifference ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                                        {formatAUD(difference)}
                                      </span>
                                    </div>
                                  </div>
                                  {hasDifference && (
                                    <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/20 rounded-md px-3 py-1.5">
                                      <AlertTriangle className="h-3 w-3 text-amber-600" />
                                      <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                                        Deposit amount differs from settlement total
                                      </span>
                                    </div>
                                  )}
                                </div>
                              );
                            })()}

                            {/* Deposit verification drill-down panel */}
                            {row.has_settlement && row.settlement_evidence && (
                              <div className="mb-3 p-3 rounded-lg bg-muted/20 border border-border space-y-2">
                                <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
                                  <Banknote className="h-3 w-3" /> Payout Verification
                                </p>
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                                  <div>
                                    <p className="text-muted-foreground">Expected payout</p>
                                    <p className="font-mono font-bold text-foreground">{formatAUD(row.settlement_evidence.bank_deposit)}</p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground">Search window</p>
                                    <p className="font-medium text-foreground">
                                      {formatDate(row.settlement_evidence.period_end)} – {formatDate(
                                        new Date(new Date(row.settlement_evidence.period_end).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()
                                      )}
                                    </p>
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground">Detected deposit</p>
                                    {row.has_bank_deposit && row.bank_match ? (
                                      <p className="font-mono font-bold text-foreground">
                                        {formatAUD(row.bank_match.amount)} on {formatDate(row.bank_match.date)}
                                      </p>
                                    ) : (
                                      <p className="text-muted-foreground italic">No matching deposit</p>
                                    )}
                                  </div>
                                  <div>
                                    <p className="text-muted-foreground">Status</p>
                                    {row.match_status === 'confirmed' || row.match_status === 'balanced' ? (
                                      <p className="font-medium text-emerald-600 dark:text-emerald-400">Verified ✓</p>
                                    ) : row.match_status === 'suggestion_high' ? (
                                      <p className="font-medium text-primary">Deposit matched</p>
                                    ) : row.match_status === 'confirmed_manual' ? (
                                      <p className="font-medium text-primary">Manually confirmed</p>
                                    ) : (
                                      <p className="font-medium text-muted-foreground">Awaiting deposit</p>
                                    )}
                                  </div>
                                </div>
                                {row.has_bank_deposit && row.bank_match && row.bank_difference != null && row.bank_difference > 0.05 && (
                                  <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/20 rounded-md px-3 py-1.5">
                                    <AlertTriangle className="h-3 w-3 text-amber-600" />
                                    <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                                      Difference: {formatAUD(row.bank_difference)}
                                    </span>
                                  </div>
                                )}
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
                                      <p>Sales: <span className="font-medium text-emerald-600 dark:text-emerald-400">{formatAUD(Math.abs(row.settlement_evidence.sales_principal))}</span></p>
                                      <p>Fees: <span className="font-medium text-destructive">{formatAUD(Math.abs(row.settlement_evidence.seller_fees + row.settlement_evidence.fba_fees))}</span></p>
                                      <p>Refunds: <span className="font-medium text-orange-600 dark:text-orange-400">{formatAUD(Math.abs(row.settlement_evidence.refunds))}</span></p>
                                      <p>Net ex GST: <span className="font-bold text-foreground">{formatAUD(row.settlement_evidence.split_net ?? row.settlement_evidence.net_ex_gst)}</span></p>
                                      <p>Bank deposit: <span className="font-bold text-foreground">{formatAUD(row.settlement_evidence.bank_deposit)}</span></p>
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
        <TablePaginationBar
          page={safeOutPage}
          totalPages={outTotalPages}
          totalItems={filteredRows.length}
          pageSize={DEFAULT_PAGE_SIZE}
          onPageChange={setOutPage}
        />
        </>
      )}
    </div>
  );
}
