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

import { useState, useCallback, useEffect, Fragment, useMemo, useRef } from 'react';
import { useAiPageContext } from '@/ai/context/useAiPageContext';
import { Switch } from '@/components/ui/switch';
import TablePaginationBar, { DEFAULT_PAGE_SIZE } from '@/components/shared/TablePaginationBar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  RefreshCw, CheckCircle2, AlertTriangle, XCircle, Upload, Banknote,
  FileText, Loader2, ChevronDown, ChevronUp, ExternalLink, CreditCard,
  MinusCircle, Clock3, Search, ArrowRight, Shield, Link2, ShoppingBag,
  Info, GitCompare,
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import InvoiceRefreshButton from '@/components/shared/InvoiceRefreshButton';
import XeroInvoiceCompareDrawer from '@/components/shared/XeroInvoiceCompareDrawer';
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
  reasons?: string[];
  amount_diff?: number;
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
  // Settlement group fields
  settlement_group_matched?: boolean;
  settlement_group_sum?: number | null;
  settlement_group_net?: number | null;
  settlement_group_diff?: number | null;
  settlement_group_invoice_count?: number | null;
  settlement_group_confidence?: 'exact' | 'high' | 'grouped' | 'explainable' | null;
  settlement_group_explanation?: string | null;
  settlement_group_tolerance_used?: number | null;
  settlement_group_anchor_basis?: 'gross' | 'net' | 'split_part_gross' | null;
  settlement_group_anchor_components?: string[] | null;
  settlement_group_comparison_field?: string | null;
  settlement_group_amount_due_total?: number | null;
  // Per-invoice tax fields (from Xero)
  sub_total?: number | null;
  total_tax?: number | null;
  line_amount_types?: string | null;
  bank_match_method?: string | null;
  bank_match_confidence?: string | null;
  bank_match_confirmed_at?: string | null;
  recent_bank_txns?: BankTxn[];
  routing?: {
    rail_code: string;
    destination_account_id: string | null;
    destination_account_name: string | null;
    mapping_source: string;
  };
  // Match diagnostics from match-bank-deposits
  no_match_reason?: string | null;
  match_reasons?: string[];
  top_candidates?: BankCandidate[];
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
    invoice_cache_age_minutes?: number | null;
    invoice_cache_fetched_at?: string | null;
    from_cache?: boolean;
    xero_rate_limited?: boolean;
    no_xero_connection?: boolean;
    mapping_status?: {
      has_any_mapping?: boolean;
      missing_marketplaces?: string[];
      missing_rails?: string[];
      used_default_for?: string[];
    };
    bank_sync_last_success_at?: string | null;
    bank_sync_cooldown_until?: string | null;
    bank_sync_cooldown_seconds_remaining?: number | null;
  };
}

interface BankSyncDiagnostics {
  mapped_account_ids?: string[];
  mapped_account_ids_count?: number;
  synced_row_count?: number;
  synced_account_count?: number;
  lookback_days?: number;
  date_range_source?: string;
  cooldown_until?: string;
  retry_after_seconds?: number;
  xero_rate_limited?: boolean;
  has_any_mapping?: boolean;
  skip_reason?: string;
  skipped?: boolean;
  refreshed_at?: string;
  bank_rows_cached_total?: number;
  error?: string;
  minutes_ago?: number;
  upserted?: number;
  // Pipeline diagnostics
  pages_fetched?: number;
  transactions_seen_total?: number;
  transactions_in_range?: number;
  stopped_reason?: string;
  bank_account_ids_used?: string[];
  bank_account_names_used?: Record<string, string>;
  endpoint_used?: string;
  fetch_from?: string;
  fetch_to?: string;
  if_modified_since_value?: string;
  per_account_stats?: Record<string, any>;
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

const formatDate = (d: string | null) => {
  if (!d) return '—';
  const parsed = new Date(d);
  if (isNaN(parsed.getTime()) || parsed.getFullYear() < 2000) return '—';
  return parsed.toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
};

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
  const [lastBankSyncResult, setLastBankSyncResult] = useState<BankSyncDiagnostics | null>(null);
  const [backgroundRefreshing, setBackgroundRefreshing] = useState(false);
  const [paymentVerifications, setPaymentVerifications] = useState<Record<string, PaymentVerificationCandidate[]>>({});
  const [compareDrawer, setCompareDrawer] = useState<{ open: boolean; settlementId: string | null; xeroInvoiceId: string | null }>({ open: false, settlementId: null, xeroInvoiceId: null });
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

  // ─── Settlement group building (client-side) ───
  interface SettlementGroup {
    settlement_id: string;
    rows: OutstandingRow[];
    matched: boolean;
    group_sum: number;
    group_net: number;
    group_diff: number;
    confidence: string | null;
    explanation: string | null;
    expected_parts: 1 | 2;
    unexpected_extras: OutstandingRow[];
    anchor_basis: string | null;
    anchor_components: string[] | null;
    comparison_field: string | null;
    amount_due_total: number | null;
  }

  const { settlementGroups, ungroupedRows } = useMemo(() => {
    const groups = new Map<string, OutstandingRow[]>();
    const ungrouped: OutstandingRow[] = [];

    for (const row of filteredRows) {
      if (row.settlement_id) {
        if (!groups.has(row.settlement_id)) groups.set(row.settlement_id, []);
        groups.get(row.settlement_id)!.push(row);
      } else {
        ungrouped.push(row);
      }
    }

    const settlementGroups: SettlementGroup[] = [];
    for (const [sid, rows] of groups) {
      const firstRow = rows[0];
      const isSplit = rows.some(r => r.settlement_evidence?.is_split_month);
      const expectedParts = isSplit ? 2 : 1;

      // Detect unexpected extras
      const unexpected: OutstandingRow[] = [];
      if (isSplit) {
        // For splits: expect at most 2 invoices with distinct split_part values
        const partsSeen = new Map<number | null, OutstandingRow[]>();
        for (const r of rows) {
          const part = r.settlement_evidence?.split_part ?? null;
          if (!partsSeen.has(part)) partsSeen.set(part, []);
          partsSeen.get(part)!.push(r);
        }
        // Flag duplicate parts or invoices beyond 2
        for (const [part, partRows] of partsSeen) {
          if (partRows.length > 1) {
            unexpected.push(...partRows.slice(1));
          }
        }
        if (rows.length > 2) {
          // If more than 2 rows total and not already flagged
          for (const r of rows.slice(2)) {
            if (!unexpected.includes(r)) unexpected.push(r);
          }
        }
      } else {
        // Non-split: expect exactly 1 invoice
        if (rows.length > 1) {
          unexpected.push(...rows.slice(1));
        }
      }

      settlementGroups.push({
        settlement_id: sid,
        rows,
        matched: firstRow.settlement_group_matched === true,
        group_sum: firstRow.settlement_group_sum ?? rows.reduce((s, r) => s + r.amount, 0),
        group_net: firstRow.settlement_group_net ?? 0,
        group_diff: firstRow.settlement_group_diff ?? 0,
        confidence: firstRow.settlement_group_confidence ?? null,
        explanation: firstRow.settlement_group_explanation ?? null,
        expected_parts: expectedParts as 1 | 2,
        unexpected_extras: unexpected,
        anchor_basis: firstRow.settlement_group_anchor_basis ?? null,
        anchor_components: firstRow.settlement_group_anchor_components ?? null,
        comparison_field: firstRow.settlement_group_comparison_field ?? null,
        amount_due_total: firstRow.settlement_group_amount_due_total ?? null,
      });
    }

    return { settlementGroups, ungroupedRows: ungrouped };
  }, [filteredRows]);

  // ─── Group-level KPI counts ───
  const groupKpis = useMemo(() => {
    const totalGroups = settlementGroups.length;
    const matchedGroups = settlementGroups.filter(g => g.matched).length;
    const mismatchGroups = settlementGroups.filter(g => !g.matched).length;
    const missingSettlement = ungroupedRows.filter(r => r.is_marketplace && r.match_status !== 'pending_enrichment').length;
    return { totalGroups, matchedGroups, mismatchGroups, missingSettlement };
  }, [settlementGroups, ungroupedRows]);

  // ─── Pagination at group level ───
  // Each group = 1 item, each ungrouped row = 1 item
  const totalPaginationItems = settlementGroups.length + ungroupedRows.length;
  const [outPage, setOutPage] = useState(1);
  const outTotalPages = Math.max(1, Math.ceil(totalPaginationItems / DEFAULT_PAGE_SIZE));
  const safeOutPage = Math.min(outPage, outTotalPages);

  const { paginatedGroups, paginatedUngrouped } = useMemo(() => {
    const start = (safeOutPage - 1) * DEFAULT_PAGE_SIZE;
    const end = start + DEFAULT_PAGE_SIZE;

    // Interleave: groups first, then ungrouped
    const allItems: Array<{ type: 'group'; group: SettlementGroup } | { type: 'row'; row: OutstandingRow }> = [
      ...settlementGroups.map(g => ({ type: 'group' as const, group: g })),
      ...ungroupedRows.map(r => ({ type: 'row' as const, row: r })),
    ];

    const pageSlice = allItems.slice(start, end);
    const groups = pageSlice.filter(i => i.type === 'group').map(i => (i as { type: 'group'; group: SettlementGroup }).group);
    const rows = pageSlice.filter(i => i.type === 'row').map(i => (i as { type: 'row'; row: OutstandingRow }).row);
    return { paginatedGroups: groups, paginatedUngrouped: rows };
  }, [settlementGroups, ungroupedRows, safeOutPage]);

  // Collapsed state for settlement groups
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const toggleGroupCollapse = (sid: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(sid)) next.delete(sid);
      else next.add(sid);
      return next;
    });
  };

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

  // ─── Persist fetched rows to client-side cache for instant next load ───
  const persistToCache = useCallback(async (rows: OutstandingRow[]) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user || rows.length === 0) return;
      const userId = session.user.id;

      // Delete stale cache
      await supabase.from('outstanding_invoices_cache').delete().eq('user_id', userId);

      // Map rows back to cache schema
      const cacheRows = rows.map(r => ({
        user_id: userId,
        xero_invoice_id: r.xero_invoice_id,
        invoice_number: r.xero_invoice_number === '—' ? null : r.xero_invoice_number,
        reference: r.xero_reference || null,
        contact_name: r.contact_name,
        date: r.invoice_date,
        due_date: r.due_date,
        amount_due: r.amount,
        currency_code: r.currency_code || 'AUD',
        status: 'AUTHORISED',
        fetched_at: new Date().toISOString(),
      }));

      for (let i = 0; i < cacheRows.length; i += 500) {
        await supabase.from('outstanding_invoices_cache').insert(cacheRows.slice(i, i + 500));
      }
    } catch (err) {
      console.warn('[OutstandingTab] cache persist failed:', err);
    }
  }, []);

  // ─── REQUEST DEDUP / THROTTLE: prevent parallel Outstanding + Status refreshes ───
  const inflightRef = useRef<AbortController | null>(null);
  const lastFetchTimestampRef = useRef<number>(0);
  const THROTTLE_MS = 30_000; // 30s minimum between fetch-outstanding calls

  const fetchOutstanding = useCallback(async (options?: { runSync?: boolean; background?: boolean }) => {
    const now = Date.now();
    const timeSinceLast = now - lastFetchTimestampRef.current;

    // Throttle: skip if called within THROTTLE_MS (unless it's the first load)
    if (lastFetchTimestampRef.current > 0 && timeSinceLast < THROTTLE_MS && !options?.runSync) {
      console.log(`[OutstandingTab] Throttled: ${Math.round(timeSinceLast / 1000)}s since last fetch (min ${THROTTLE_MS / 1000}s)`);
      return;
    }

    // Dedup: if a request is already in-flight, cancel it (latest wins)
    if (inflightRef.current) {
      console.log('[OutstandingTab] Cancelling in-flight fetch — new request takes priority');
      inflightRef.current.abort();
    }

    const controller = new AbortController();
    inflightRef.current = controller;
    lastFetchTimestampRef.current = now;

    const isBackground = options?.background === true;
    if (isBackground) {
      setBackgroundRefreshing(true);
    } else {
      setLoading(true);
    }
    setNoXeroConnection(false);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error('Session expired — please sign in again.');
        throw new Error('Not authenticated');
      }

      if (options?.runSync) {
        const syncResp = await supabase.functions.invoke('sync-xero-status', {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });

        // Check if aborted while waiting
        if (controller.signal.aborted) return;

        // Treat sync failure as actionable — surface no-connection explicitly
        if (syncResp.error) {
          console.warn(`[OutstandingTab] sync-xero-status error: ${syncResp.error.message}`);
        }
        if (syncResp.data?.success === false) {
          const syncError = syncResp.data?.error || '';
          if (typeof syncError === 'string' && (syncError.includes('No Xero connection') || syncError.includes('Unauthorized'))) {
            setNoXeroConnection(true);
            setHasLoaded(true);
            return;
          }
        }
      }

      if (controller.signal.aborted) return;

      const resp = await supabase.functions.invoke('fetch-outstanding', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { force_refresh: !!options?.runSync },
      });

      if (controller.signal.aborted) return;

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
      if (!isBackground && (resp.data as { source?: string })?.source === 'cache_fallback') {
        toast.warning('Xero is temporarily rate limited — showing cached outstanding data while background sync continues.');
      }

      const summary = resp.data as OutstandingSummary;
      setData(summary);
      setHasLoaded(true);
      setSelected(new Set());
      // Persist to client-side cache so next page load is instant
      persistToCache(summary.rows);
    } catch (err: any) {
      if (controller.signal.aborted) return; // Silently ignore aborted requests
      if (!isBackground) {
        toast.error(`Failed to fetch outstanding: ${err.message}`);
      } else {
        console.warn('[OutstandingTab] background fetch failed:', err.message);
      }
    } finally {
      if (inflightRef.current === controller) {
        inflightRef.current = null;
      }
      if (isBackground) {
        setBackgroundRefreshing(false);
      } else {
        setLoading(false);
      }
    }
  }, []);

  // ─── Re-scan matches: force recompute with bounded lookback ───
  const rescanMatches = useCallback(async () => {
    setRescanning(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error('Session expired — please sign in again.');
        throw new Error('Not authenticated');
      }

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
      persistToCache(result.rows);

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
        // Track these IDs as permanently unfindable so we don't retry on every load
        try {
          const existing = JSON.parse(sessionStorage.getItem('backfill_failed_ids') || '[]');
          const merged = [...new Set([...existing, ...missingIds])];
          sessionStorage.setItem('backfill_failed_ids', JSON.stringify(merged));
        } catch {}
        toast.info('Settlement reports not found in Amazon — they may be older than 270 days.', { id: 'backfill-270-days' });
      }
    } catch (err: any) {
      console.error('[backfill] error:', err);
    } finally {
      setBackfilling(false);
    }
  }, [backfilling, fetchOutstanding]);

  // Auto-trigger backfill when missing settlement IDs detected (skip already-failed ones)
  useEffect(() => {
    const missingIds = data?.sync_info?.missing_settlement_ids;
    if (missingIds && missingIds.length > 0 && hasLoaded && !backfilling) {
      let failedIds: string[] = [];
      try { failedIds = JSON.parse(sessionStorage.getItem('backfill_failed_ids') || '[]'); } catch {}
      const newIds = missingIds.filter((id: string) => !failedIds.includes(id));
      if (newIds.length > 0) {
        triggerBackfill(newIds);
      }
    }
  }, [data?.sync_info?.missing_settlement_ids, hasLoaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Cache-first load: instant render from outstanding_invoices_cache ───
  const loadCachedSnapshot = useCallback(async (): Promise<number> => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.user) return 0;

      const { data: cached, error } = await supabase
        .from('outstanding_invoices_cache')
        .select('*')
        .eq('user_id', session.user.id);

      if (error || !cached || cached.length === 0) return 0;

      const rows: OutstandingRow[] = cached.map(row => {
        const dueDateMs = row.due_date ? new Date(row.due_date).getTime() : null;
        const overdueDays = dueDateMs ? Math.max(0, Math.floor((Date.now() - dueDateMs) / 86400000)) : null;
        const contactLower = (row.contact_name || '').toLowerCase();
        const isMarketplace = ['amazon', 'shopify', 'kogan', 'ebay', 'catch', 'mydeal', 'bigw', 'bunnings', 'woolworths'].some(m => contactLower.includes(m));
        const marketplace = contactLower.includes('amazon') ? 'amazon_au'
          : contactLower.includes('shopify') ? 'shopify_payments'
          : contactLower.includes('kogan') ? 'kogan'
          : contactLower.includes('ebay') ? 'ebay_au'
          : contactLower.includes('catch') ? 'catch'
          : contactLower.includes('mydeal') ? 'mydeal'
          : contactLower.includes('bigw') ? 'bigw'
          : contactLower.includes('bunnings') ? 'bunnings'
          : 'unknown';

        return {
          xero_invoice_id: row.xero_invoice_id,
          xero_invoice_number: row.invoice_number || '—',
          xero_reference: row.reference || '',
          contact_name: row.contact_name || '',
          marketplace,
          is_marketplace: isMarketplace,
          invoice_date: row.date || null,
          due_date: row.due_date || null,
          amount: Number(row.amount_due) || 0,
          currency_code: row.currency_code || 'AUD',
          overdue_days: overdueDays,
          has_settlement: undefined as unknown as boolean,
          settlement_id: null,
          settlement_status: null,
          settlement_evidence: null,
          has_bank_deposit: undefined as unknown as boolean,
          bank_match: null,
          bank_difference: null,
          match_status: 'pending_enrichment',
        };
      });

      const summary: OutstandingSummary = {
        total_outstanding: rows.reduce((sum, r) => sum + r.amount, 0),
        invoice_count: rows.length,
        matched_with_settlement: 0,
        bank_deposit_found: 0,
        ready_to_reconcile: 0,
        rows,
      };

      setData(summary);
      setHasLoaded(true);
      return rows.length;
    } catch (err) {
      console.warn('[OutstandingTab] cache snapshot failed:', err);
      return 0;
    }
  }, []);

  // On mount: load cache first, then enrich in background (or foreground if cache empty)
  useEffect(() => {
    const init = async () => {
      const cachedCount = await loadCachedSnapshot();
      if (cachedCount > 0) {
        fetchOutstanding({ runSync: false, background: true });
      } else {
        fetchOutstanding({ runSync: false });
      }
    };
    init();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Listen for refresh events dispatched after bank mapping saves
  useEffect(() => {
    const handler = () => { fetchOutstanding({ runSync: false }); };
    window.addEventListener('xettle:refresh-outstanding', handler);
    return () => window.removeEventListener('xettle:refresh-outstanding', handler);
  }, [fetchOutstanding]);

  // ─── Sync bank feed (user-scoped) ───
  const [syncingBankFeed, setSyncingBankFeed] = useState(false);
  const syncBankFeedAndRefresh = useCallback(async () => {
    setSyncingBankFeed(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error('Session expired — please sign in again.');
        return;
      }
      toast.info('Syncing bank feed…', { id: 'bank-feed-sync' });
      const resp = await supabase.functions.invoke('fetch-xero-bank-transactions', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'x-action': 'self',
        },
        body: { action: 'self' },
      });
      // Store diagnostics for every response path — before any early return
      setLastBankSyncResult(resp.data ?? { error: resp.error?.message });

      if (resp.error) {
        toast.error(`Bank feed sync failed: ${resp.error.message}`, { id: 'bank-feed-sync' });
        // Still refetch so cached data renders
        await fetchOutstanding({ runSync: false });
        return;
      }

      if (resp.data?.xero_rate_limited) {
        const retryAfter = Number(resp.data?.retry_after_seconds) || 60;
        const cached = Number(resp.data?.bank_rows_cached_total) || 0;
        const hasMappings = resp.data.has_any_mapping;
        const mappingNote = hasMappings === false ? ' No payout mappings configured — go to Settings.' : '';
        if (cached > 0) {
          toast.warning(
            `Xero rate limited — try again in ~${retryAfter}s. Using ${cached} cached transaction${cached !== 1 ? 's' : ''}.${mappingNote}`,
            { id: 'bank-feed-sync', duration: 8000 }
          );
        } else {
          toast.error(
            `Xero rate limited and no cached bank data available. Try again in ~${retryAfter}s.${mappingNote}`,
            { id: 'bank-feed-sync', duration: 10000 }
          );
        }
        await fetchOutstanding({ runSync: false });
        return;
      }
      if (resp.data?.error) {
        toast.error(`Bank feed sync failed: ${resp.data.error}`, { id: 'bank-feed-sync' });
        await fetchOutstanding({ runSync: false });
        return;
      }
      // Handle no-mapping early exit BEFORE generic skipped handler
      if (resp.data?.skipped && resp.data?.skip_reason === 'no_mapping') {
        toast.warning('No destination account mapped. Go to Settings → Payout Mapping to configure.', { id: 'bank-feed-sync', duration: 10000 });
        await fetchOutstanding({ runSync: false });
        return;
      }
      if (resp.data?.skipped) {
        const retryAfter = Number(resp.data?.retry_after_seconds) || 60;
        const retryInfo = resp.data.retry_after_seconds
          ? ` Try again in ~${retryAfter}s.`
          : ` (${resp.data.minutes_ago}m ago)`;
        const reason = resp.data.skip_reason === 'cooldown'
          ? `Xero cooldown active —${retryInfo}`
          : `Bank feed recently synced — using cache${retryInfo}`;
        toast.info(reason, { id: 'bank-feed-sync' });
        await fetchOutstanding({ runSync: false });
        return;
      }
      const count = resp.data?.synced_row_count || resp.data?.upserted || 0;
      const accts = resp.data?.synced_account_count || 0;
      const acctNote = accts > 0 ? ` across ${accts} account${accts !== 1 ? 's' : ''}` : '';
      toast.success(`Bank feed synced — ${count} transaction${count !== 1 ? 's' : ''}${acctNote}`, { id: 'bank-feed-sync' });
      await fetchOutstanding({ runSync: false });
    } catch (err: any) {
      toast.error(`Bank feed sync failed: ${err.message}`, { id: 'bank-feed-sync' });
      setLastBankSyncResult({ error: err.message });
      try { await fetchOutstanding({ runSync: false }); } catch {} // always refetch
    } finally {
      setSyncingBankFeed(false);
    }
  }, [fetchOutstanding]);

  // ─── Fetch payment verification candidates (Rule #11 — verification only) ───
  // PAYMENT VERIFICATION LAYER ONLY
  // This never creates accounting entries. No invoice. No journal. No Xero push.
  // Settlements are the only accounting source.
  const fetchPaymentVerifications = useCallback(async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) return;

      // Skip verification if we know bank feed is empty (from sync_info)
      if (data?.sync_info?.bank_feed_empty) {
        console.log('[OutstandingTab] Bank feed empty — skipping payment verification');
        return;
      }

      const resp = await supabase.functions.invoke('verify-payment-matches', {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });

      if (resp.data?.bank_feed_empty) {
        console.log('[OutstandingTab] verify-payment-matches reports bank feed empty — no verification attempted');
        return;
      }

      if (resp.data?.candidates) {
        setPaymentVerifications(resp.data.candidates);
      }
    } catch {
      // Non-blocking — payment verification is optional
    }
  }, [data?.sync_info?.bank_feed_empty]);

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
            ? { ...r, match_status: 'no_settlement' }
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
      r => selected.has(r.xero_invoice_id) && (r.match_status === 'balanced' || r.match_status === 'confirmed' || r.match_status === 'settlement_matched')
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
    const balancedIds = data.rows.filter(r => r.match_status === 'balanced' || r.match_status === 'confirmed' || r.match_status === 'settlement_matched').map(r => r.xero_invoice_id);
    const allSelected = balancedIds.every(id => selected.has(id));
    setSelected(allSelected ? new Set() : new Set(balancedIds));
  };

  const isAmazon = (row: OutstandingRow) => row.marketplace?.toLowerCase().includes('amazon');

  // ─── Status rendering helpers ───
  const getStatusIcon = (row: OutstandingRow) => {
    if (row.match_status === 'pending_enrichment') return <Loader2 className="h-4 w-4 text-muted-foreground animate-spin" />;
    if (row.match_status === 'settlement_matched') return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    if (row.match_status === 'balanced' || row.match_status === 'confirmed') return <CheckCircle2 className="h-4 w-4 text-green-600" />;
    if (row.match_status === 'confirmed_manual') return <CheckCircle2 className="h-4 w-4 text-blue-600" />;
    if (row.match_status === 'settlement_mismatch') return <AlertTriangle className="h-4 w-4 text-amber-600" />;
    if (row.match_status === 'awaiting_confirmation') return <Clock3 className="h-4 w-4 text-amber-500" />;
    if (row.match_status === 'suggestion_high' || row.match_status === 'suggestion_multiple') return <AlertTriangle className="h-4 w-4 text-amber-600" />;
    if (row.match_status === 'unsupported_marketplace') return <AlertTriangle className="h-4 w-4 text-muted-foreground" />;
    if (row.match_status === 'settlement_not_ingested') return <Clock3 className="h-4 w-4 text-amber-500" />;
    if (row.is_pre_boundary && row.match_status === 'no_settlement') return <MinusCircle className="h-4 w-4 text-muted-foreground" />;
    if (row.match_status === 'awaiting_sync') return <Loader2 className="h-4 w-4 text-blue-500 animate-spin" />;
    if ((row.match_status || '').startsWith('gap_')) return <AlertTriangle className="h-4 w-4 text-amber-600" />;
    return <XCircle className="h-4 w-4 text-destructive" />;
  };

   const getStatusLabel = (row: OutstandingRow) => {
    if (row.match_status === 'pending_enrichment') return 'Loading matches…';
    if (row.match_status === 'settlement_matched') {
      const conf = row.settlement_group_confidence;
      if (conf === 'exact') return 'Matched exact';
      if (conf === 'high') return 'Matched high';
      if (conf === 'grouped') return 'Matched grouped';
      if (conf === 'explainable') return `Matched (${row.settlement_group_explanation || 'explainable'})`;
      return 'Settlement matched';
    }
    if (row.match_status === 'balanced') return 'Balanced';
    if (row.match_status === 'confirmed') return 'Deposit confirmed ✓';
    if (row.match_status === 'confirmed_manual') return 'Confirmed manually ✓';
    if (row.match_status === 'settlement_mismatch') {
      const diff = row.settlement_group_diff;
      return diff != null ? `Mismatch — $${diff.toFixed(2)}` : 'Mismatch — review';
    }
    if (row.match_status === 'awaiting_confirmation') return 'Ready to confirm';
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
    return 'No settlement';
  };

  const getRowBgClass = (row: OutstandingRow) => {
    if (row.match_status === 'pending_enrichment') return '';
    if (row.match_status === 'settlement_matched') return 'bg-green-50/50 dark:bg-green-950/10';
    if (row.match_status === 'balanced' || row.match_status === 'confirmed') return 'bg-green-50/50 dark:bg-green-950/10';
    if (row.match_status === 'confirmed_manual') return 'bg-blue-50/50 dark:bg-blue-950/10';
    if (row.match_status === 'settlement_mismatch') return 'bg-amber-50/50 dark:bg-amber-950/10';
    if (row.match_status === 'awaiting_confirmation') return 'bg-amber-50/50 dark:bg-amber-950/10';
    if (row.match_status === 'suggestion_high' || row.match_status === 'suggestion_multiple') return 'bg-amber-50/50 dark:bg-amber-950/10';
    if (row.match_status === 'unsupported_marketplace') return 'bg-muted/30';
    if (row.match_status === 'settlement_not_ingested') return 'bg-amber-50/30 dark:bg-amber-950/10';
    if (row.is_pre_boundary && row.match_status === 'no_settlement') return '';
    if (row.match_status === 'awaiting_sync') return 'bg-blue-50/30 dark:bg-blue-950/10';
    if ((row.match_status || '').startsWith('gap_')) return 'bg-amber-50/50 dark:bg-amber-950/10';
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

    // Settlement-level match: show settlement group summary
    if (row.match_status === 'settlement_matched' && row.settlement_group_matched) {
      return (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
          <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-green-800 dark:text-green-300">
              Settlement matched — {row.settlement_group_invoice_count} invoice{(row.settlement_group_invoice_count || 0) > 1 ? 's' : ''} total {formatAUD(row.settlement_group_sum || 0)}
            </p>
            <p className="text-xs text-green-700 dark:text-green-400">
              Settlement net: {formatAUD(row.settlement_group_net || 0)}
              {(row.settlement_group_diff || 0) > 0 && ` · Diff: $${row.settlement_group_diff?.toFixed(2)}`}
              {row.settlement_group_confidence && <Badge variant="outline" className="ml-2 text-[10px] border-green-300 text-green-700">{row.settlement_group_confidence}{row.settlement_group_explanation ? ` (${row.settlement_group_explanation})` : ''}</Badge>}
            </p>
          </div>
        </div>
      );
    }

    // Awaiting confirmation: settlement exists but no group-level match yet
    if (row.match_status === 'awaiting_confirmation' && row.has_settlement) {
      return (
        <div className="flex items-center gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800">
          <Clock3 className="h-5 w-5 text-amber-600 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              Settlement found — ready to confirm
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Settlement {row.settlement_id} · Net {formatAUD(Math.abs(row.settlement_evidence?.bank_deposit || row.settlement_evidence?.net_ex_gst || 0))}
            </p>
          </div>
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

  // ─── Loading state — skeleton table instead of blocking spinner ───
  if (!hasLoaded && loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-2xl font-bold text-foreground">Outstanding</h2>
          <p className="text-muted-foreground mt-1">Loading outstanding invoices...</p>
        </div>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Invoice</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Date</TableHead>
                <TableHead>Due</TableHead>
                <TableHead className="text-right">Amount Due</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell className="text-right"><Skeleton className="h-4 w-16 ml-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-16" /></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
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
            Xero invoices awaiting settlement matching. Bank feed is optional verification.
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
          <h2 className="text-2xl font-bold text-foreground flex items-center gap-2">
            Outstanding
            {backgroundRefreshing && <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />}
          </h2>
          <p className="text-muted-foreground mt-1">
            Xero invoices awaiting settlement matching. Bank feed is optional verification.
          </p>
        </div>
        <div className="flex items-center gap-2">
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
              <p>Rebuild settlement matching from the last 90 days</p>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                onClick={syncBankFeedAndRefresh}
                disabled={syncingBankFeed || loading}
                className="gap-1.5"
              >
                <Banknote className={`h-4 w-4 ${syncingBankFeed ? 'animate-pulse' : ''}`} />
                {syncingBankFeed ? 'Syncing…' : 'Sync bank feed'}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              <p>Optional — refresh bank transactions for deposit verification</p>
            </TooltipContent>
          </Tooltip>
        </div>
      </div>

      {/* ─── PRIMARY: Settlement matching status banner ─── */}
      {data && data.invoice_count > 0 && (() => {
        const { totalGroups, matchedGroups, mismatchGroups, missingSettlement } = groupKpis;
        const linkedPending = totalGroups - matchedGroups;

        return (
          <div className="p-4 rounded-lg border border-primary/20 bg-primary/5 space-y-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
              <p className="text-sm font-medium text-foreground">
                Settlement matching — {totalGroups} settlement group{totalGroups !== 1 ? 's' : ''}, {ungroupedRows.length} ungrouped
              </p>
            </div>
            <div className="flex flex-wrap gap-3 ml-7 text-xs">
              <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                {matchedGroups} matched
              </span>
              {linkedPending > 0 && (
                <span className="text-amber-700 dark:text-amber-400 font-medium">
                  {linkedPending} pending match
                </span>
              )}
              {missingSettlement > 0 && (
                <span className="text-destructive font-medium">
                  {missingSettlement} missing settlement
                </span>
              )}
              {mismatchGroups > 0 && (
                <span className="text-amber-700 dark:text-amber-400 font-medium">
                  {mismatchGroups} mismatch
                </span>
              )}
            </div>
          </div>
        );
      })()}

      {/* ─── Bank feed diagnostic banners ─── */}
      {/* ─── SECONDARY: Bank verification section (collapsible, non-blocking) ─── */}
      <Collapsible>
        <CollapsibleTrigger className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-1 py-1">
          <Banknote className="h-3.5 w-3.5" />
          <span>Bank verification (optional)</span>
          <ChevronDown className="h-3 w-3" />
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 mt-2">
          {data?.sync_info?.bank_feed_empty && (
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/20">
              <Info className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-muted-foreground">Bank verification unavailable (optional)</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  No cached bank transactions found. Settlement matching still works. Sync bank feed only if you want deposit verification.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={syncBankFeedAndRefresh} disabled={syncingBankFeed} className="gap-1.5 shrink-0">
                <Banknote className={`h-4 w-4 ${syncingBankFeed ? 'animate-pulse' : ''}`} />
                {syncingBankFeed ? 'Syncing…' : 'Sync now'}
              </Button>
            </div>
          )}
          {data?.sync_info?.bank_cache_stale && !data?.sync_info?.bank_feed_empty && (
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/20">
              <Clock3 className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1">
                <p className="text-sm font-medium text-muted-foreground">Bank feed is stale</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Last refreshed: {data.sync_info.bank_cache_last_refreshed_at
                    ? new Date(data.sync_info.bank_cache_last_refreshed_at).toLocaleString('en-AU')
                    : 'unknown'}. Refresh to update deposit verification.
                </p>
              </div>
              <Button size="sm" variant="outline" onClick={syncBankFeedAndRefresh} disabled={syncingBankFeed} className="gap-1.5 shrink-0">
                <RefreshCw className={`h-4 w-4 ${syncingBankFeed ? 'animate-pulse' : ''}`} />
                {syncingBankFeed ? 'Syncing…' : 'Refresh'}
              </Button>
            </div>
          )}
          {(() => {
            const missingRails = data?.sync_info?.mapping_status?.missing_rails || data?.sync_info?.mapping_status?.missing_marketplaces || [];
            return missingRails.length > 0 ? (
              <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/20">
                <Info className="h-4 w-4 text-muted-foreground shrink-0" />
                <p className="text-xs text-muted-foreground">
                  Bank verification mappings missing for: <strong>{missingRails.map((m: string) => MARKETPLACE_LABELS[m] || m).join(', ')}</strong>.
                  Settlement matching and pushing to Xero are unaffected. Map destination accounts only to enable bank-deposit verification.
                </p>
              </div>
            ) : null;
          })()}

          {/* Bank sync timestamp */}
          {data?.sync_info && (
            <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/20">
              <Clock3 className="h-4 w-4 text-muted-foreground shrink-0" />
              <div className="flex-1 text-xs text-muted-foreground">
                <span className="font-medium">Last bank sync: </span>
                {data.sync_info.bank_sync_last_success_at
                  ? (() => {
                      const mins = Math.round((Date.now() - new Date(data.sync_info.bank_sync_last_success_at!).getTime()) / 60000);
                      return mins < 1 ? 'just now' : mins < 60 ? `${mins}m ago` : `${Math.round(mins / 60)}h ago`;
                    })()
                  : 'never'}
                {(() => {
                  const cooldownSec = Number(data.sync_info.bank_sync_cooldown_seconds_remaining);
                  return cooldownSec > 0 ? (
                    <span className="ml-2">· Retry in ~{cooldownSec}s</span>
                  ) : null;
                })()}
              </div>
            </div>
          )}

          {/* Bank sync diagnostics */}
          {lastBankSyncResult ? (
            <Collapsible>
              <CollapsibleTrigger className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer px-1 py-0.5">
                <Info className="h-3.5 w-3.5" />
                <span>Show sync details</span>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-1 p-3 rounded-lg border border-border bg-muted/30 text-xs text-muted-foreground space-y-1">
                  <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                    <span className="font-medium">Outcome</span>
                    <span>{
                      lastBankSyncResult.error ? `Error: ${lastBankSyncResult.error}`
                      : lastBankSyncResult.skipped ? `Skipped (${lastBankSyncResult.skip_reason || 'unknown'})`
                      : lastBankSyncResult.xero_rate_limited ? 'Rate limited'
                      : `Synced ${lastBankSyncResult.synced_row_count ?? lastBankSyncResult.upserted ?? 0} rows`
                    }</span>
                    {lastBankSyncResult.mapped_account_ids_count != null && (
                      <><span className="font-medium">Mapped accounts</span><span>{lastBankSyncResult.mapped_account_ids_count}</span></>
                    )}
                    {lastBankSyncResult.synced_row_count != null && (
                      <><span className="font-medium">Synced rows</span><span>{lastBankSyncResult.synced_row_count}</span></>
                    )}
                    {lastBankSyncResult.lookback_days != null && (
                      <><span className="font-medium">Date range span</span><span>{lastBankSyncResult.lookback_days} days</span></>
                    )}
                    <span className="font-medium">Rate limited</span><span>{lastBankSyncResult.xero_rate_limited ? 'Yes' : 'No'}</span>
                    <span className="font-medium">Has mapping</span><span>{lastBankSyncResult.has_any_mapping === true ? 'Yes' : lastBankSyncResult.has_any_mapping === false ? 'No' : '—'}</span>
                  </div>
                </div>
              </CollapsibleContent>
            </Collapsible>
          ) : (
            <p className="text-xs text-muted-foreground px-1">No bank sync diagnostics yet.</p>
          )}
        </CollapsibleContent>
      </Collapsible>


      {data?.sync_info?.xero_rate_limited && (
        <div className="flex items-center gap-3 p-4 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
          <Clock3 className="h-5 w-5 text-amber-600 shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-medium text-amber-800 dark:text-amber-300">
              Xero rate limited — showing cached data
            </p>
            <p className="text-xs text-amber-700 dark:text-amber-400 mt-0.5">
              Invoice data is {data.sync_info.invoice_cache_age_minutes != null
                ? `${data.sync_info.invoice_cache_age_minutes} minute${data.sync_info.invoice_cache_age_minutes !== 1 ? 's' : ''} old`
                : 'from cache'}. Will refresh automatically when the rate limit clears.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => fetchOutstanding({ runSync: true })}
            disabled={loading}
            className="gap-1.5 shrink-0"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            Retry
          </Button>
        </div>
      )}
      {data?.sync_info?.from_cache && !data?.sync_info?.xero_rate_limited && data?.sync_info?.invoice_cache_age_minutes != null && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
          <Clock3 className="h-3.5 w-3.5" />
          <span>Invoice data refreshed {data.sync_info.invoice_cache_age_minutes} min ago</span>
        </div>
      )}

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

      {/* Legacy bank feed banners removed — superseded by actionable banners at top of page */}

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
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Total outstanding</p>
              <p className="text-xl font-bold text-foreground">{formatAUD(filteredTotal)}</p>
              <p className="text-xs text-muted-foreground">{filteredRows.length} invoices</p>
            </CardContent>
          </Card>
          <Card className={groupKpis.totalGroups > 0 && groupKpis.totalGroups === groupKpis.matchedGroups ? 'border-emerald-200 dark:border-emerald-800' : ''}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Settlement found</p>
              <p className={`text-xl font-bold ${groupKpis.totalGroups > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-foreground'}`}>
                {groupKpis.totalGroups}
              </p>
              <p className="text-xs text-muted-foreground">groups</p>
            </CardContent>
          </Card>
          <Card className={groupKpis.matchedGroups > 0 ? 'border-emerald-200 dark:border-emerald-800' : ''}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Settlement matched</p>
              <p className={`text-xl font-bold ${
                groupKpis.matchedGroups > 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-muted-foreground'
              }`}>{groupKpis.matchedGroups}</p>
              <p className="text-xs text-muted-foreground">of {groupKpis.totalGroups}</p>
            </CardContent>
          </Card>
          <Card className={groupKpis.mismatchGroups > 0 ? 'border-amber-200 dark:border-amber-800' : ''}>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Needs attention</p>
              <p className={`text-xl font-bold ${groupKpis.mismatchGroups + groupKpis.missingSettlement > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
                {groupKpis.mismatchGroups + groupKpis.missingSettlement}
              </p>
              <p className="text-xs text-muted-foreground">
                {groupKpis.mismatchGroups > 0 ? `${groupKpis.mismatchGroups} mismatch` : ''}
                {groupKpis.mismatchGroups > 0 && groupKpis.missingSettlement > 0 ? ' · ' : ''}
                {groupKpis.missingSettlement > 0 ? `${groupKpis.missingSettlement} missing` : ''}
                {groupKpis.mismatchGroups === 0 && groupKpis.missingSettlement === 0 ? 'all clear' : ''}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-muted-foreground">Ready to push</p>
              <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{groupKpis.matchedGroups}</p>
              <p className="text-xs text-muted-foreground">matched groups</p>
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
                <th className="text-right font-medium text-muted-foreground px-3 py-2.5">Match Diff</th>
                <th className="text-left font-medium text-muted-foreground px-3 py-2.5">Status</th>
                <th className="text-right font-medium text-muted-foreground px-3 py-2.5">Action</th>
              </tr>
            </thead>
            <tbody>
              {/* ─── Settlement groups ─── */}
              {paginatedGroups.map(group => {
                const isCollapsed = collapsedGroups.has(group.settlement_id);
                const truncatedId = group.settlement_id.length > 12
                  ? group.settlement_id.slice(0, 12) + '…'
                  : group.settlement_id;
                const isSplit = group.expected_parts === 2;
                const partLabel = isSplit
                  ? `P1+P2`
                  : `${group.rows.length} inv`;

                return (
                  <Fragment key={`group-${group.settlement_id}`}>
                    {/* Settlement group header row */}
                    <tr
                      className={`border-b border-border cursor-pointer transition-colors ${
                        group.matched
                          ? 'bg-emerald-50/60 dark:bg-emerald-950/15 hover:bg-emerald-50 dark:hover:bg-emerald-950/25'
                          : 'bg-amber-50/40 dark:bg-amber-950/10 hover:bg-amber-50/60 dark:hover:bg-amber-950/20'
                      }`}
                      onClick={() => toggleGroupCollapse(group.settlement_id)}
                    >
                      <td className="px-3 py-2.5">
                        {isCollapsed ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronUp className="h-4 w-4 text-muted-foreground" />}
                      </td>
                      <td className="px-3 py-2.5" colSpan={2}>
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{truncatedId}</span>
                          <Badge variant="outline" className="text-[10px]">{partLabel}</Badge>
                          {group.unexpected_extras.length > 0 && (
                            <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 dark:text-amber-400">
                              {group.unexpected_extras.length} unexpected
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5"></td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="font-mono font-medium text-foreground">{formatAUD(group.group_sum)}</span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        {group.matched ? (
                          <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 inline" />
                        ) : (
                          <AlertTriangle className="h-4 w-4 text-amber-600 inline" />
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {group.matched && group.group_diff < 0.50 ? (
                          <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium">✓</span>
                        ) : (
                          <span className="text-xs font-mono font-medium text-amber-600 dark:text-amber-400">
                            {formatAUD(group.group_diff)}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div className="flex items-center gap-1.5 cursor-help">
                              {group.matched ? (
                                <>
                                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                  <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                                    Matched{isSplit ? ' (split: P1+P2)' : ''}
                                    {group.confidence && group.confidence !== 'exact' ? ` · ${group.confidence}` : ''}
                                    {group.explanation ? ` (${group.explanation})` : ''}
                                  </span>
                                </>
                              ) : (
                                <>
                                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                                  <span className="text-xs font-medium text-amber-700 dark:text-amber-400">Mismatch</span>
                                </>
                              )}
                            </div>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-xs">
                            <div className="text-xs space-y-1">
                              <p><strong>Anchor basis:</strong> {group.anchor_basis || 'unknown'}</p>
                              {group.anchor_components && (
                                <p><strong>Components:</strong> {group.anchor_components.join(' + ')}</p>
                              )}
                              {group.comparison_field && (
                                <p><strong>Comparison field:</strong> {group.comparison_field}</p>
                              )}
                              <p><strong>Invoice sum ({group.comparison_field === 'SubTotal' ? 'SubTotal' : 'AmountDue'}):</strong> {formatAUD(group.group_sum)}</p>
                              {group.amount_due_total != null && group.comparison_field === 'SubTotal' && (
                                <p><strong>AmountDue total:</strong> {formatAUD(group.amount_due_total)}</p>
                              )}
                              <p><strong>Settlement anchor:</strong> {formatAUD(group.group_net)}</p>
                              <p><strong>Diff:</strong> {formatAUD(group.group_diff)}</p>
                              {group.rows[0]?.line_amount_types && (
                                <p><strong>Tax type:</strong> {group.rows[0].line_amount_types}</p>
                              )}
                            </div>
                          </TooltipContent>
                        </Tooltip>
                      </td>
                      <td className="px-3 py-2.5"></td>
                    </tr>

                    {/* Child invoice rows (visible when not collapsed) */}
                    {!isCollapsed && group.rows.map(row => {
                      const isExpanded = expandedRow === row.xero_invoice_id;
                      const isApplying = applying.has(row.xero_invoice_id);
                      const isBalanced = row.match_status === 'balanced' || row.match_status === 'confirmed';
                      const hasSuggestion = row.match_status === 'suggestion_high' || row.match_status === 'suggestion_multiple' || row.match_status === 'settlement_matched' || row.match_status === 'awaiting_confirmation';
                      const isUnexpected = group.unexpected_extras.includes(row);

                      return (
                        <Fragment key={row.xero_invoice_id}>
                          <tr className={`border-b border-border/50 ${getRowBgClass(row)} hover:bg-muted/30 transition-colors`}>
                            <td className="px-3 py-2 pl-8">
                              {isBalanced && (
                                <Checkbox
                                  checked={selected.has(row.xero_invoice_id)}
                                  onCheckedChange={() => toggleSelect(row.xero_invoice_id)}
                                />
                              )}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center gap-1.5">
                                <div>
                                  <p className="font-medium text-foreground">{row.xero_invoice_number}</p>
                                  <p className="text-xs text-muted-foreground font-mono truncate max-w-[180px]">
                                    {row.xero_reference || '—'}
                                  </p>
                                </div>
                                <InvoiceRefreshButton
                                  xeroInvoiceId={row.xero_invoice_id}
                                  onRefreshComplete={() => fetchOutstanding({ runSync: false, background: true })}
                                />
                                {row.settlement_id && (
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={(e) => {
                                        e.stopPropagation();
                                        setCompareDrawer({ open: true, settlementId: row.settlement_id, xeroInvoiceId: row.xero_invoice_id });
                                      }}>
                                        <GitCompare className="h-3.5 w-3.5" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top" className="text-xs">Compare Xero vs Xettle</TooltipContent>
                                  </Tooltip>
                                )}
                                {row.settlement_evidence?.split_part && (
                                  <Badge variant="outline" className="text-[10px]">P{row.settlement_evidence.split_part}</Badge>
                                )}
                                {isUnexpected && (
                                  <Badge variant="outline" className="text-[10px] border-amber-300 text-amber-700 dark:text-amber-400">
                                    Unexpected — review
                                  </Badge>
                                )}
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
                              <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 inline" />
                            </td>
                            <td className="px-3 py-2 text-right">
                              {/* Individual diff not shown for grouped rows — group header has it */}
                              <span className="text-xs text-muted-foreground">—</span>
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
                                {row.match_status !== 'no_settlement' && (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => setExpandedRow(isExpanded ? null : row.xero_invoice_id)}
                                    className="gap-1 text-xs h-7"
                                  >
                                    <FileText className="h-3 w-3" />
                                    Evidence
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

                                  {/* Routing diagnostics */}
                                  {row.routing && row.is_marketplace && (
                                    <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground p-2 rounded bg-muted/30 border border-border">
                                      <span>Rail: <span className="font-mono font-medium text-foreground">{row.routing.rail_code}</span></span>
                                      <span className="text-border">·</span>
                                      <span>Destination: <span className="font-medium text-foreground">{row.routing.destination_account_name || row.routing.destination_account_id || '—'}</span></span>
                                      <span className="text-border">·</span>
                                      <Badge variant="outline" className="text-[10px]">{row.routing.mapping_source}</Badge>
                                    </div>
                                  )}

                                  {/* Bank match action panel */}
                                  {(hasSuggestion || row.match_status === 'confirmed' || row.match_status === 'confirmed_manual' || row.match_status === 'settlement_matched' || row.match_status === 'awaiting_confirmation') && (
                                    <div className="mb-3">
                                      {renderBankMatchPanel(row)}
                                    </div>
                                  )}

                                  {/* Settlement evidence */}
                                  {row.has_settlement && row.settlement_evidence && (
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                                      <div className="space-y-1.5 p-3 rounded-lg bg-background border border-border">
                                        <p className="font-semibold text-muted-foreground flex items-center gap-1.5">
                                          <ExternalLink className="h-3 w-3" /> Xero Invoice
                                        </p>
                                        <p className="font-medium">{row.xero_invoice_number} — {row.contact_name}</p>
                                        <p>Ref: <span className="font-mono">{row.xero_reference || '—'}</span></p>
                                        <p>Amount: <span className="font-bold">{formatAUD(row.amount)}</span></p>
                                      </div>
                                      <div className="space-y-1.5 p-3 rounded-lg bg-background border border-border">
                                        <p className="font-semibold text-muted-foreground flex items-center gap-1.5">
                                          <FileText className="h-3 w-3" /> Settlement Data
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
                                          <p>Bank deposit: <span className="font-bold text-foreground">{formatAUD(row.settlement_evidence.bank_deposit)}</span></p>
                                        </div>
                                      </div>
                                      <div className="space-y-1.5 p-3 rounded-lg bg-background border border-border">
                                        <p className="font-semibold text-muted-foreground flex items-center gap-1.5">
                                          <Banknote className="h-3 w-3" /> Bank Deposit (Xero)
                                        </p>
                                        {row.has_bank_deposit && row.bank_match ? (
                                          <>
                                            <p className="flex items-center gap-1">
                                              <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                                              <span className="font-bold">{formatAUD(row.bank_match.amount)}</span> on {row.bank_match.date || '—'}
                                            </p>
                                          </>
                                        ) : (
                                          <p className="text-muted-foreground">No matching deposit</p>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}

              {/* ─── Ungrouped invoices (no settlement_id) ─── */}
              {paginatedUngrouped.map(row => {
                const isExpanded = expandedRow === row.xero_invoice_id;
                const isApplying = applying.has(row.xero_invoice_id);
                const isBalanced = row.match_status === 'balanced' || row.match_status === 'confirmed';
                const hasSuggestion = row.match_status === 'suggestion_high' || row.match_status === 'suggestion_multiple' || row.match_status === 'settlement_matched' || row.match_status === 'awaiting_confirmation';

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
                        {row.match_status === 'pending_enrichment' ? (
                          <span className="text-muted-foreground">—</span>
                        ) : row.is_pre_boundary ? (
                          <MinusCircle className="h-4 w-4 text-muted-foreground inline" />
                        ) : (
                          <XCircle className="h-4 w-4 text-destructive inline" />
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="text-xs text-muted-foreground">—</span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          {getStatusIcon(row)}
                          <span className="text-xs font-medium">{getStatusLabel(row)}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center gap-1.5 justify-end">
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
                        </div>
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <TablePaginationBar
          page={safeOutPage}
          totalPages={outTotalPages}
          totalItems={totalPaginationItems}
          pageSize={DEFAULT_PAGE_SIZE}
          onPageChange={setOutPage}
        />
        </>
      )}
      <XeroInvoiceCompareDrawer
        open={compareDrawer.open}
        onClose={() => setCompareDrawer({ open: false, settlementId: null, xeroInvoiceId: null })}
        settlementId={compareDrawer.settlementId}
        xeroInvoiceId={compareDrawer.xeroInvoiceId}
      />
    </div>
  );
}
