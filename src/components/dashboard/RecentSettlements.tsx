/**
 * RecentSettlements — Dashboard settlement action center.
 * 
 * Features:
 *   - Clickable status summary cards (Ready to Push, Posted, Needs Attention, Hidden)
 *   - Clean table with Gateway, Period, Amount, Bank, Status, Actions
 *   - Action dropdown: View (inline drill-down), Refresh, Send to Xero, Download CSV, Hide/Unhide
 *   - Pagination (25 per page)
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { ACTIVE_CONNECTION_STATUSES, isApiConnectionType } from '@/constants/connection-status';
import { logger } from '@/utils/logger';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  FileText, ArrowRight, CheckCircle2, Clock, Send, AlertTriangle, Info,
  MoreHorizontal, Eye, RefreshCw, EyeOff, Download, ChevronLeft, ChevronRight,
  EyeIcon, ChevronDown, ChevronUp, Loader2, ShieldAlert,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { isBankMatchRequired } from '@/constants/settlement-rails';

interface SettlementRow {
  id: string;
  settlement_id: string;
  marketplace: string;
  period_start: string;
  period_end: string;
  bank_deposit: number;
  status: string;
  xero_status: string | null;
  source: string;
  created_at: string;
  bank_verified: boolean | null;
  sales_principal: number | null;
  seller_fees: number | null;
  fba_fees: number | null;
  refunds: number | null;
  gst_on_income: number | null;
  other_fees: number | null;
  storage_fees: number | null;
  advertising_costs: number | null;
  is_pre_boundary: boolean;
  dashboard_origin?: 'settlement' | 'validation';
  queue_type?: 'manual_upload' | 'api_sync';
}

const MARKETPLACE_DISPLAY: Record<string, string> = {
  amazon_au: 'Amazon AU',
  shopify_payments: 'Shopify Payments',
  kogan: 'Kogan',
  mydeal: 'MyDeal',
  bunnings: 'Bunnings',
  catch: 'Catch',
  ebay: 'eBay',
  iconic: 'THE ICONIC',
  bigw: 'Big W',
  everyday_market: 'Everyday Market',
  tradesquare: 'TradeSquare',
  tiktok: 'TikTok Shop',
};

function getMarketplaceLabel(code: string | null): string {
  if (!code) return 'Unknown';
  if (MARKETPLACE_DISPLAY[code]) return MARKETPLACE_DISPLAY[code];
  return code.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatAUD(amount: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const startStr = s.toLocaleDateString('en-AU', opts);
  const endStr = e.toLocaleDateString('en-AU', { ...opts, year: 'numeric' });
  return `${startStr} – ${endStr}`;
}

type StatusCategory = 'ready' | 'posted' | 'attention' | 'hidden' | 'completed' | 'other';

function categorize(row: SettlementRow): StatusCategory {
  if ((row as any).is_hidden) return 'hidden';
  if (row.status === 'push_failed' || row.status === 'push_failed_permanent') return 'attention';
  if (row.status === 'settlement_needed' || row.status === 'missing') return 'other';
  if (row.status === 'awaiting_api_sync') return 'completed';
  // Settlement-confirmed rails that are posted are considered complete, not "waiting"
  if (['pushed_to_xero', 'reconciled_in_xero', 'bank_verified'].includes(row.status)) {
    if (row.marketplace && !isBankMatchRequired(row.marketplace)) return 'completed';
    if (row.status === 'reconciled_in_xero' || row.status === 'bank_verified' || row.xero_status === 'PAID') return 'completed';
    return 'posted';
  }
  if (row.xero_status === 'DRAFT' || row.xero_status === 'AUTHORISED' || row.xero_status === 'PAID') {
    if (row.xero_status === 'PAID') return 'completed';
    if (row.marketplace && !isBankMatchRequired(row.marketplace)) return 'completed';
    return 'posted';
  }
  if (row.status === 'ready_to_push') return 'ready';
  if (row.status === 'pre_boundary') return 'completed';
  if (row.status === 'ingested') return 'other';
  return 'other';
}

function StatusBadge({ status, xeroStatus, syncOrigin, marketplace }: { status: string; xeroStatus: string | null; syncOrigin?: string; marketplace?: string | null }) {
  if (status === 'settlement_needed' || status === 'missing') {
    return (
      <Badge variant="outline" className="text-xs text-muted-foreground">
        <Clock className="h-3 w-3 mr-1" />
        Upload Needed
      </Badge>
    );
  }
  if (status === 'awaiting_api_sync') {
    return (
      <Badge variant="outline" className="text-xs text-muted-foreground">
        <RefreshCw className="h-3 w-3 mr-1" />
        Awaiting API Sync
      </Badge>
    );
  }
  // Fully reconciled (PAID in Xero)
  if (status === 'reconciled_in_xero' || status === 'bank_verified' || xeroStatus === 'PAID') {
    return (
      <Badge variant="outline" className="text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-900/30 dark:border-emerald-800 text-xs">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Reconciled ✓
      </Badge>
    );
  }
  // Pushed to Xero (covers draft + authorised + external)
  if (status === 'pushed_to_xero') {
    if (syncOrigin === 'external') {
      return (
        <Badge variant="outline" className="text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-900/30 dark:border-emerald-800 text-xs">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Already in Xero
        </Badge>
      );
    }
    if (xeroStatus === 'AUTHORISED') {
      if (marketplace && !isBankMatchRequired(marketplace)) {
        return (
          <Badge variant="outline" className="text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-900/30 dark:border-emerald-800 text-xs">
            <CheckCircle2 className="h-3 w-3 mr-1" />
            Posted ✓
          </Badge>
        );
      }
      return (
        <Badge variant="outline" className="text-amber-700 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-900/30 dark:border-amber-800 text-xs">
          <Clock className="h-3 w-3 mr-1" />
          Waiting for Payout
        </Badge>
      );
    }
    if (xeroStatus === 'DRAFT') {
      return (
        <Badge variant="outline" className="text-orange-700 bg-orange-50 border-orange-200 dark:text-orange-400 dark:bg-orange-900/30 dark:border-orange-800 text-xs">
          <FileText className="h-3 w-3 mr-1" />
          In Xero — Draft
        </Badge>
      );
    }
    return (
      <Badge variant="outline" className="text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-900/30 dark:border-emerald-800 text-xs">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        In Xero
      </Badge>
    );
  }
  if (status === 'ready_to_push') {
    return (
      <Badge variant="outline" className="text-sky-700 bg-sky-50 border-sky-200 dark:text-sky-400 dark:bg-sky-900/30 dark:border-sky-800 text-xs">
        <Send className="h-3 w-3 mr-1" />
        Send to Xero
      </Badge>
    );
  }
  if (status === 'ingested') {
    return (
      <Badge variant="outline" className="text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-900/30 dark:border-amber-800 text-xs">
        <Clock className="h-3 w-3 mr-1" />
        Needs Sync
      </Badge>
    );
  }
  if (status === 'push_failed' || status === 'push_failed_permanent') {
    return (
      <Badge variant="outline" className="text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/30 dark:border-red-800 text-xs">
        <AlertTriangle className="h-3 w-3 mr-1" />
        Failed
      </Badge>
    );
  }
  if (status === 'pre_boundary') {
    return (
      <Badge variant="outline" className="text-amber-600 bg-amber-50 border-amber-200 dark:text-amber-400 dark:bg-amber-900/30 dark:border-amber-800 text-xs">
        <Info className="h-3 w-3 mr-1" />
        Import Only — Before Boundary
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground text-xs">
      <Clock className="h-3 w-3 mr-1" />
      Pending
    </Badge>
  );
}

// ── Inline drill-down panel ──
function SettlementDrillDown({ row }: { row: SettlementRow }) {
  const [lines, setLines] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('settlement_lines')
        .select('order_id, sku, amount, amount_description, transaction_type')
        .eq('settlement_id', row.settlement_id)
        .order('amount', { ascending: true })
        .limit(50);
      setLines(data || []);
      setLoading(false);
    })();
  }, [row.settlement_id]);

  const summaryItems = [
    { label: 'Gross Sales', value: row.sales_principal },
    { label: 'Seller Fees', value: row.seller_fees },
    { label: 'FBA Fees', value: row.fba_fees },
    { label: 'Storage Fees', value: row.storage_fees },
    { label: 'Advertising', value: row.advertising_costs },
    { label: 'Other Fees', value: row.other_fees },
    { label: 'Refunds', value: row.refunds },
    { label: 'GST on Income', value: row.gst_on_income },
    { label: 'Net Deposit', value: row.bank_deposit },
  ].filter(i => i.value !== null && i.value !== 0);

  return (
    <div className="bg-muted/30 border-t border-border/50 px-6 py-4 space-y-4">
      {/* Financial summary */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">Financial Summary</p>
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-3">
          {summaryItems.map(item => (
            <div key={item.label} className="space-y-0.5">
              <p className="text-[11px] text-muted-foreground">{item.label}</p>
              <p className={cn(
                'text-sm font-semibold',
                (item.value || 0) < 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground'
              )}>
                {formatAUD(item.value || 0)}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Line items */}
      <div>
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
          Transaction Lines {lines && `(${lines.length}${lines.length >= 50 ? '+' : ''})`}
        </p>
        {loading ? (
          <div className="flex items-center gap-2 text-xs text-muted-foreground py-2">
            <Loader2 className="h-3 w-3 animate-spin" /> Loading…
          </div>
        ) : lines && lines.length > 0 ? (
          <div className="max-h-48 overflow-y-auto rounded border border-border/50">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-muted/40 border-b border-border/50">
                  <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Type</th>
                  <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Description</th>
                  <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Order</th>
                  <th className="px-3 py-1.5 text-right font-medium text-muted-foreground">Amount</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, i) => (
                  <tr key={i} className="border-b border-border/20 last:border-0">
                    <td className="px-3 py-1.5 text-muted-foreground">{line.transaction_type || '—'}</td>
                    <td className="px-3 py-1.5 text-foreground">{line.amount_description || line.sku || '—'}</td>
                    <td className="px-3 py-1.5 text-muted-foreground font-mono">{line.order_id || '—'}</td>
                    <td className={cn(
                      'px-3 py-1.5 text-right font-mono',
                      (line.amount || 0) < 0 ? 'text-red-600 dark:text-red-400' : 'text-foreground'
                    )}>
                      {formatAUD(line.amount || 0)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground/70 py-2">No line items recorded for this settlement</p>
        )}
      </div>
    </div>
  );
}

const PAGE_SIZE = 10;

function getPrimaryAction(row: SettlementRow): { label: string } {
  if (row.dashboard_origin === 'validation' && (row.status === 'settlement_needed' || row.status === 'missing')) {
    return { label: 'Upload' };
  }
  if (row.dashboard_origin === 'validation' && row.status === 'awaiting_api_sync') {
    return { label: 'View' };
  }
  if (row.status === 'hidden') return { label: 'Unhide' };
  if (row.status === 'push_failed' || row.status === 'push_failed_permanent') return { label: 'Retry' };
  if (row.status === 'reconciled_in_xero' || row.status === 'bank_verified' || row.xero_status === 'PAID') return { label: 'View evidence' };
  if (row.status === 'pushed_to_xero' && row.bank_verified) return { label: 'View evidence' };
  if (row.status === 'pushed_to_xero') return { label: 'Sync feed' };
  if (row.status === 'ready_to_push' || row.status === 'parsed' || row.status === 'saved') return { label: 'Send to Xero' };
  if (row.status === 'ingested') return { label: 'View' };
  return { label: 'View' };
}

function getActionSort(row: SettlementRow): number {
  if (row.status === 'ready_to_push' || row.status === 'parsed' || row.status === 'saved') return 0;
  if (row.status === 'push_failed' || row.status === 'push_failed_permanent') return 1;
  if (row.status === 'pushed_to_xero' && !row.bank_verified) return 2;
  if (row.status === 'pushed_to_xero' && row.bank_verified) return 3;
  if (row.status === 'reconciled_in_xero' || row.status === 'bank_verified' || row.xero_status === 'PAID') return 4;
  if (row.status === 'hidden') return 5;
  return 3;
}

interface RecentSettlementsProps {
  onViewAll?: () => void;
  /** External filter from pipeline click: { marketplace, month (YYYY-MM) } */
  pipelineFilter?: { marketplace: string; month: string } | null;
  onClearPipelineFilter?: () => void;
  /** When true, only show settlements needing user action (ready_to_push, push_failed, ingested) */
  actionableOnly?: boolean;
  /** Navigate to the Settlements Overview tab with a pre-set filter */
  onNavigateToFilter?: (filter: string) => void;
}

export default function RecentSettlements({ onViewAll, pipelineFilter, onClearPipelineFilter, actionableOnly, onNavigateToFilter }: RecentSettlementsProps) {
  const [allRows, setAllRows] = useState<SettlementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [activeFilter, setActiveFilter] = useState<StatusCategory | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [externalMatchIds, setExternalMatchIds] = useState<Set<string>>(new Set());
  // Validation pipeline counts (from marketplace_validation — the true source of what needs pushing)
  const [validationCounts, setValidationCounts] = useState<{ ready: number; readyTotal: number; uploadNeeded: number; uploadNeededManual: number; uploadNeededApi: number; gaps: number } | null>(null);

  const fetchAll = useCallback(async () => {
    try {
      const [settlementsRes, validationRes, connRes] = await Promise.all([
        supabase
          .from('settlements')
          .select('id, settlement_id, marketplace, period_start, period_end, bank_deposit, status, xero_status, source, created_at, bank_verified, sales_principal, seller_fees, fba_fees, refunds, gst_on_income, other_fees, storage_fees, advertising_costs, is_pre_boundary')
          .neq('source', 'api_sync')
          .neq('status', 'duplicate_suppressed')
          .neq('status', 'already_recorded')
          .order('period_end', { ascending: false }),
        actionableOnly
          ? supabase
              .from('marketplace_validation')
              .select('id, overall_status, settlement_id, marketplace_code, period_start, period_end, settlement_net, updated_at')
              .in('overall_status', ['settlement_needed', 'missing', 'ready_to_push'])
          : Promise.resolve({ data: null, error: null } as any),
        actionableOnly
          ? supabase
              .from('marketplace_connections')
              .select('marketplace_code, connection_type, connection_status')
          : Promise.resolve({ data: null, error: null } as any),
      ]);

      if (settlementsRes.error) throw settlementsRes.error;
      if (validationRes.error) throw validationRes.error;
      if (connRes.error) throw connRes.error;

      const rows = (settlementsRes.data || []) as SettlementRow[];

      // Bulk-promote stuck 'ingested' settlements that aren't pre-boundary
      const stuckIngested = rows.filter(r => r.status === 'ingested' && !r.is_pre_boundary);
      if (stuckIngested.length > 0) {
        const stuckIds = stuckIngested.map(r => r.id);
        await supabase.from('settlements')
          .update({ status: 'ready_to_push' } as any)
          .in('id', stuckIds);
        logger.debug(`[RecentSettlements] Promoted ${stuckIds.length} stuck ingested → ready_to_push`);
        fetchAll();
        return;
      }

      const settlementMap = new Map(rows.map(row => [row.settlement_id, row]));
      const apiCodes = new Set<string>(
        ((connRes.data || []) as any[])
          .filter((c) => isApiConnectionType(c.connection_type) && (ACTIVE_CONNECTION_STATUSES as readonly string[]).includes(c.connection_status))
          .map((c) => c.marketplace_code)
      );

      const queueRows: SettlementRow[] = actionableOnly
        ? ((validationRes.data || []) as any[])
            .filter((row) => !isReconciliationOnly((row as any).source, row.marketplace_code, row.settlement_id))
            .map((row) => {
              const existing = row.settlement_id ? settlementMap.get(row.settlement_id) : undefined;
              if (existing) return { ...existing, dashboard_origin: 'settlement' as const };
              const isApi = apiCodes.has(row.marketplace_code);
              return {
                id: `validation-${row.id}`,
                settlement_id: row.settlement_id || `validation-${row.id}`,
                marketplace: row.marketplace_code,
                period_start: row.period_start,
                period_end: row.period_end,
                bank_deposit: Number(row.settlement_net || 0),
                status: row.overall_status === 'ready_to_push' ? 'ready_to_push' : (isApi ? 'awaiting_api_sync' : row.overall_status),
                xero_status: null,
                source: isApi ? 'api_sync_queue' : 'manual_upload_queue',
                created_at: row.updated_at,
                bank_verified: null,
                sales_principal: null,
                seller_fees: null,
                fba_fees: null,
                refunds: null,
                gst_on_income: null,
                other_fees: null,
                storage_fees: null,
                advertising_costs: null,
                is_pre_boundary: false,
                dashboard_origin: 'validation' as const,
                queue_type: isApi ? 'api_sync' as const : 'manual_upload' as const,
              } satisfies SettlementRow;
            })
        : rows;

      setAllRows(queueRows);

      // Fetch external matches for ready-to-push settlements with xero_status
      const readyIds = queueRows.filter(r => r.status === 'ready_to_push' && !r.settlement_id.startsWith('validation-')).map(r => r.settlement_id).filter(Boolean);
      if (readyIds.length > 0) {
        const { data: matches } = await supabase
          .from('xero_accounting_matches')
          .select('settlement_id, xero_status')
          .in('settlement_id', readyIds);
        if (matches) {
          const paidMatchIds = new Set(
            matches.filter((m: any) => m.xero_status === 'PAID').map((m: any) => m.settlement_id)
          );
          if (paidMatchIds.size > 0) {
            const paidDbIds = rows
              .filter(r => paidMatchIds.has(r.settlement_id))
              .map(r => r.id);
            if (paidDbIds.length > 0) {
              supabase.from('settlements')
                .update({ status: 'already_recorded', sync_origin: 'external' } as any)
                .in('id', paidDbIds)
                .then(() => {
                  logger.debug(`[RecentSettlements] Auto-resolved ${paidDbIds.length} PAID external matches`);
                  fetchAll();
                });
            }
          }
          setExternalMatchIds(new Set(
            matches.filter((m: any) => m.xero_status !== 'PAID').map((m: any) => m.settlement_id)
          ));
        }
      }
    } catch (err) {
      console.error('Failed to load settlements:', err);
    } finally {
      setLoading(false);
    }
  }, [actionableOnly]);

  // Fetch marketplace_validation counts (true source of what needs pushing)
  const fetchValidationCounts = useCallback(async () => {
    try {
      const [valRes, connRes] = await Promise.all([
        supabase
          .from('marketplace_validation')
          .select('overall_status, settlement_net, marketplace_code, settlement_id')
          .in('overall_status', ['ready_to_push', 'pushed_to_xero', 'settlement_needed', 'missing', 'gap_detected']),
        supabase
          .from('marketplace_connections')
          .select('marketplace_code, connection_type, connection_status'),
      ]);
      if (valRes.data) {
        const apiCodes = new Set<string>(
          (connRes.data || [])
            .filter((c: any) => isApiConnectionType(c.connection_type) && (ACTIVE_CONNECTION_STATUSES as readonly string[]).includes(c.connection_status))
            .map((c: any) => c.marketplace_code)
        );
        let ready = 0, readyTotal = 0, uploadNeeded = 0, uploadNeededManual = 0, uploadNeededApi = 0, gaps = 0;
        for (const r of valRes.data) {
          if ((r as any).settlement_id?.startsWith('shopify_auto_')) continue;
          if (r.overall_status === 'ready_to_push') {
            ready++;
            readyTotal += (r as any).settlement_net || 0;
          }
          if (r.overall_status === 'settlement_needed' || r.overall_status === 'missing') {
            uploadNeeded++;
            if (apiCodes.has(r.marketplace_code)) uploadNeededApi++;
            else uploadNeededManual++;
          }
          if (r.overall_status === 'gap_detected') gaps++;
        }
        setValidationCounts({ ready, readyTotal, uploadNeeded, uploadNeededManual, uploadNeededApi, gaps });
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => { fetchAll(); fetchValidationCounts(); }, [fetchAll, fetchValidationCounts]);

  // Summary counts
  const counts = useMemo(() => {
    const c = { ready: 0, posted: 0, attention: 0, hidden: 0, completed: 0, other: 0, readyTotal: 0, postedTotal: 0 };
    for (const r of allRows) {
      const cat = categorize(r);
      c[cat]++;
      if (cat === 'ready') c.readyTotal += r.bank_deposit || 0;
      if (cat === 'posted') c.postedTotal += r.bank_deposit || 0;
    }
    return c;
  }, [allRows]);

  // Filtered + paginated
  const filtered = useMemo(() => {
    if (activeFilter === 'hidden') return allRows.filter(r => r.status === 'hidden');
    let visible = showHidden ? allRows : allRows.filter(r => r.status !== 'hidden');
    
    // When actionableOnly, show the same queue states represented by the homepage cards
    if (actionableOnly) {
      visible = visible.filter(r => {
        const cat = categorize(r);
        return cat === 'ready' || cat === 'attention' || cat === 'other' || cat === 'completed';
      });
    }
    
    // Apply pipeline filter if set
    if (pipelineFilter) {
      visible = visible.filter(r => {
        const matchesMarketplace = r.marketplace === pipelineFilter.marketplace;
        const rowMonth = r.period_start?.substring(0, 7);
        const matchesMonth = rowMonth === pipelineFilter.month;
        return matchesMarketplace && matchesMonth;
      });
    }
    
    const base = !activeFilter ? visible : visible.filter(r => categorize(r) === activeFilter);
    // Sort by actionability: most actionable first
    return [...base].sort((a, b) => getActionSort(a) - getActionSort(b));
  }, [allRows, activeFilter, showHidden, pipelineFilter, actionableOnly]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = useMemo(() => {
    const start = (page - 1) * PAGE_SIZE;
    return filtered.slice(start, start + PAGE_SIZE);
  }, [filtered, page]);

  useEffect(() => { setPage(1); }, [activeFilter, showHidden, pipelineFilter]);

  // ── Actions ──
  const handleHide = async (row: SettlementRow) => {
    const { updateSettlementVisibility } = await import('@/actions/settlements');
    await updateSettlementVisibility(row.id, true);
    toast.success(`Hidden: ${getMarketplaceLabel(row.marketplace)} ${formatDateRange(row.period_start, row.period_end)}`);
    fetchAll();
  };

  const handleUnhide = async (row: SettlementRow) => {
    const { updateSettlementVisibility } = await import('@/actions/settlements');
    await updateSettlementVisibility(row.id, false);
    toast.success(`Restored: ${getMarketplaceLabel(row.marketplace)} ${formatDateRange(row.period_start, row.period_end)}`);
    fetchAll();
  };

  const handleView = (row: SettlementRow) => {
    setExpandedId(prev => prev === row.id ? null : row.id);
  };

  const handleDownloadCSV = (row: SettlementRow) => {
    const headers = ['Field', 'Amount'];
    const rows = [
      ['Marketplace', getMarketplaceLabel(row.marketplace)],
      ['Period', `${row.period_start} to ${row.period_end}`],
      ['Settlement ID', row.settlement_id],
      ['Gross Sales', String(row.sales_principal || 0)],
      ['Seller Fees', String(row.seller_fees || 0)],
      ['FBA Fees', String(row.fba_fees || 0)],
      ['Storage Fees', String(row.storage_fees || 0)],
      ['Advertising', String(row.advertising_costs || 0)],
      ['Other Fees', String(row.other_fees || 0)],
      ['Refunds', String(row.refunds || 0)],
      ['GST on Income', String(row.gst_on_income || 0)],
      ['Net Deposit', String(row.bank_deposit || 0)],
    ];
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `settlement-${row.settlement_id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('CSV downloaded');
  };

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3"><Skeleton className="h-5 w-40" /></CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  if (allRows.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <FileText className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">No settlements yet</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Upload a settlement file or connect your marketplace to get started
          </p>
        </CardContent>
      </Card>
    );
  }

  // Use validation pipeline counts when in actionableOnly (homepage) mode
  const displayReadyCount = actionableOnly && validationCounts ? validationCounts.ready : counts.ready;
  const displayReadyTotal = actionableOnly && validationCounts ? validationCounts.readyTotal : counts.readyTotal;
  const displayUploadNeeded = actionableOnly && validationCounts ? validationCounts.uploadNeeded : 0;
  const displayUploadManual = actionableOnly && validationCounts ? validationCounts.uploadNeededManual : 0;
  const displayUploadApi = actionableOnly && validationCounts ? validationCounts.uploadNeededApi : 0;
  const displayGaps = actionableOnly && validationCounts ? validationCounts.gaps : 0;

  // In actionableOnly mode, show "all clear" when nothing needs action
  if (actionableOnly && displayReadyCount === 0 && counts.attention === 0 && displayUploadManual === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Settlements — All Clear
            </CardTitle>
            {onViewAll && (
              <Button variant="ghost" size="sm" onClick={onViewAll} className="text-xs text-muted-foreground hover:text-foreground">
                Full ledger
                <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="pt-0 pb-4">
          <p className="text-sm text-muted-foreground">No settlements waiting to be sent to Xero.</p>
        </CardContent>
      </Card>
    );
  }

  const summaryCards: { key: StatusCategory; label: string; sublabel: string; count: number; total?: number; color: string; icon: React.ReactNode }[] = [
    // Hide "Ready for Xero" summary card on homepage — ActionCentre already shows it with more detail
    ...(!actionableOnly ? [{
      key: 'ready' as StatusCategory,
      label: 'Ready for Xero',
      sublabel: `${displayReadyCount} period${displayReadyCount !== 1 ? 's' : ''} across all marketplaces`,
      count: displayReadyCount,
      total: displayReadyTotal,
      color: 'border-sky-200 bg-sky-50/80 dark:border-sky-800 dark:bg-sky-900/20',
      icon: <Send className="h-4 w-4 text-sky-600 dark:text-sky-400" />,
    }] : []),
    // In actionableOnly mode, show Manual Upload Needed (urgent) and API Sync Pending (low urgency)
    ...(actionableOnly && displayUploadManual > 0 ? [{
      key: 'other' as StatusCategory,
      label: 'Upload Needed',
      sublabel: `${displayUploadManual} period${displayUploadManual !== 1 ? 's' : ''} need a manual CSV upload`,
      count: displayUploadManual,
      color: 'border-amber-200 bg-amber-50/80 dark:border-amber-800 dark:bg-amber-900/20',
      icon: <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400" />,
    }] : []),
    ...(actionableOnly && displayUploadApi > 0 ? [{
      key: 'completed' as StatusCategory,
      label: 'Awaiting API Sync',
      sublabel: `${displayUploadApi} period${displayUploadApi !== 1 ? 's' : ''} will sync automatically`,
      count: displayUploadApi,
      color: 'border-emerald-200 bg-emerald-50/80 dark:border-emerald-800 dark:bg-emerald-900/20',
      icon: <RefreshCw className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />,
    }] : []),
    // Hide "In Xero — Processing" on homepage (actionableOnly mode)
    ...(!actionableOnly ? [{
      key: 'posted' as StatusCategory,
      label: 'In Xero — Processing',
      sublabel: 'Posted, awaiting reconciliation',
      count: counts.posted,
      total: counts.postedTotal,
      color: 'border-amber-300 bg-amber-50/80 dark:border-amber-700 dark:bg-amber-900/25',
      icon: <CheckCircle2 className="h-4 w-4 text-amber-600 dark:text-amber-400" />,
    }] : []),
    // Only show Needs Attention when there are items
    ...(counts.attention > 0 ? [{
      key: 'attention' as StatusCategory,
      label: 'Needs Attention',
      sublabel: 'Failed or needs review',
      count: counts.attention,
      color: 'border-red-200 bg-red-50/80 dark:border-red-800 dark:bg-red-900/20',
      icon: <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />,
    }] : []),
  ];

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Settlements
          </CardTitle>
          <div className="flex items-center gap-2">
            {counts.hidden > 0 && (
              <Button
                variant={activeFilter === 'hidden' ? 'secondary' : 'ghost'}
                size="sm"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setActiveFilter(prev => prev === 'hidden' ? null : 'hidden')}
              >
                <EyeOff className="h-3 w-3 mr-1" />
                {counts.hidden} hidden
              </Button>
            )}
            {onViewAll && (
              <Button variant="ghost" size="sm" onClick={onViewAll} className="text-xs text-muted-foreground hover:text-foreground">
                Full ledger
                <ArrowRight className="h-3 w-3 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4 pt-0">
        {/* ── Stale settlements bulk action ── */}
        {(() => {
          const thirtyDaysAgo = new Date();
          thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
          const staleReady = allRows.filter(r => 
            r.status === 'ready_to_push' && 
            new Date(r.period_end + 'T00:00:00') < thirtyDaysAgo
          );
          if (staleReady.length === 0) return null;
          return (
            <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50/60 dark:bg-amber-900/15 px-4 py-3">
              <div className="flex items-center gap-2 text-xs">
                <Clock className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span className="text-muted-foreground">
                  <span className="font-medium text-foreground">{staleReady.length}</span> settlement{staleReady.length > 1 ? 's' : ''} older than 30 days still awaiting push — already handled externally?
                </span>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="text-xs shrink-0 h-7 border-amber-300 dark:border-amber-700 text-amber-700 dark:text-amber-400"
                onClick={async () => {
                  const ids = staleReady.map(r => r.id);
                  const { error } = await supabase
                    .from('settlements')
                    .update({ status: 'already_recorded', reconciliation_status: 'already_recorded' } as any)
                    .in('id', ids);
                  if (error) {
                    toast.error('Failed to update settlements');
                  } else {
                    toast.success(`${ids.length} settlement${ids.length > 1 ? 's' : ''} marked as already reconciled`);
                    fetchAll();
                  }
                }}
              >
                Mark as Already Reconciled
              </Button>
            </div>
          );
        })()}

        {/* ── Status summary cards (clickable filters) ── */}
        <div className={cn("grid gap-3", summaryCards.length >= 3 ? "grid-cols-3" : summaryCards.length === 2 ? "grid-cols-2" : "grid-cols-1")}>
          {summaryCards.map(card => (
            <button
              key={card.key}
              onClick={() => {
                // "Upload Needed" and "Ready to Push" cards navigate to Overview tab with correct filter
                // because "Upload Needed" has no settlement rows to display inline
                if (card.key === 'other' && card.label === 'Upload Needed' && onNavigateToFilter) {
                  onNavigateToFilter('settlement_needed');
                  return;
                }
                if (card.key === 'ready' && onNavigateToFilter) {
                  onNavigateToFilter('ready_to_push');
                  return;
                }
                setActiveFilter(prev => prev === card.key ? null : card.key);
              }}
              className={cn(
                'rounded-lg border p-3 text-left transition-all hover:shadow-sm',
                card.color,
                activeFilter === card.key && 'ring-2 ring-primary ring-offset-1',
                card.count === 0 && 'opacity-50'
              )}
            >
              <div className="flex items-center gap-2 mb-0.5">
                {card.icon}
                <span className="text-xs font-medium text-muted-foreground">{card.label}</span>
              </div>
              <p className="text-[10px] text-muted-foreground/70 mb-1 ml-6">{card.sublabel}</p>
              {card.total !== undefined && card.count > 0 ? (
                <>
                  <p className="text-xl font-bold text-foreground">{formatAUD(card.total)}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{card.count} settlement{card.count > 1 ? 's' : ''}</p>
                </>
              ) : (
                <p className="text-xl font-bold text-foreground">{card.count}</p>
              )}
            </button>
          ))}
        </div>

        {/* ── Active filter indicator ── */}
        {(activeFilter || pipelineFilter) && (
          <div className="flex items-center gap-2 flex-wrap">
            {pipelineFilter && (
              <>
                <Badge variant="outline" className="text-xs border-primary/30 bg-primary/5">
                  Pipeline: {getMarketplaceLabel(pipelineFilter.marketplace)} — {pipelineFilter.month}
                </Badge>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={onClearPipelineFilter}>
                  Clear pipeline filter
                </Button>
              </>
            )}
            {activeFilter && (
              <>
                <Badge variant="secondary" className="text-xs">
                  Showing: {activeFilter === 'hidden' ? 'Hidden' : summaryCards.find(c => c.key === activeFilter)?.label}
                </Badge>
                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setActiveFilter(null)}>
                  Clear filter
                </Button>
              </>
            )}
          </div>
        )}

        {/* ── Settlement table ── */}
        <div className="overflow-x-auto rounded-lg border border-border/50 max-h-[600px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10">
              <tr className="bg-muted border-b border-border/50">
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span className="cursor-help border-b border-dotted border-muted-foreground/40">Rail</span>
                      </TooltipTrigger>
                      <TooltipContent className="text-xs max-w-[220px]">Payout rail — the source that generates settlement payouts (Amazon AU, Shopify Payments, PayPal, etc.)</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </th>
                <th className="px-4 py-2.5 text-left font-medium text-muted-foreground text-xs uppercase tracking-wider">Period</th>
                <th className="px-4 py-2.5 text-right font-medium text-muted-foreground text-xs uppercase tracking-wider">Settlement Total</th>
                <th className="px-4 py-2.5 text-center font-medium text-muted-foreground text-xs uppercase tracking-wider">Bank</th>
                <th className="px-4 py-2.5 text-center font-medium text-muted-foreground text-xs uppercase tracking-wider">Status</th>
                <th className="px-4 py-2.5 text-center font-medium text-muted-foreground text-xs uppercase tracking-wider w-[80px]">Action</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-8 text-center text-muted-foreground text-sm">
                    {actionableOnly ? (
                      <div className="space-y-1">
                        <p>No settlements waiting in the queue right now.</p>
                        {(displayUploadManual > 0 || displayUploadApi > 0) && (
                          <p className="text-xs text-muted-foreground/70">
                            Upload or sync settlements from the{' '}
                            {onViewAll ? (
                              <button onClick={onViewAll} className="underline hover:text-foreground">Settlements Overview</button>
                            ) : 'Settlements Overview'}{' '}
                            to populate this table.
                          </p>
                        )}
                      </div>
                    ) : 'No settlements match this filter'}
                  </td>
                </tr>
              )}
              {pageRows.map((row, idx) => {
                const hasExternalRisk = row.status === 'ready_to_push' && externalMatchIds.has(row.settlement_id);
                return (
                <React.Fragment key={row.id}>
                  <tr
                    className={cn(
                      'border-b border-border/30 last:border-0 transition-colors hover:bg-muted/30',
                      idx % 2 === 1 && 'bg-muted/10',
                      expandedId === row.id && 'bg-muted/20',
                      row.status === 'hidden' && 'opacity-60',
                      hasExternalRisk && 'bg-destructive/5 border-l-2 border-l-destructive/60'
                    )}
                  >
                    <td className="px-4 py-3 font-medium text-foreground">
                      <div className="flex items-center gap-1.5">
                        {hasExternalRisk && (
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <ShieldAlert className="h-4 w-4 text-destructive shrink-0" />
                              </TooltipTrigger>
                              <TooltipContent side="right" className="max-w-[220px] text-xs">
                                Possible duplicate — an invoice for this settlement already exists in Xero (e.g. Link My Books). Open the drawer to review before pushing.
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        )}
                        {getMarketplaceLabel(row.marketplace)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">
                      {formatDateRange(row.period_start, row.period_end)}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold text-foreground whitespace-nowrap">
                      {formatAUD(row.bank_deposit || 0)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {row.bank_verified ? (
                        <span className="text-emerald-600 dark:text-emerald-400" title="Bank deposit matched">✔</span>
                      ) : (
                        <span className="text-muted-foreground/40" title="Awaiting bank match">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {hasExternalRisk ? (
                        <Badge variant="outline" className="text-destructive bg-destructive/10 border-destructive/30 text-xs">
                          <ShieldAlert className="h-3 w-3 mr-1" />
                          Duplicate Risk
                        </Badge>
                      ) : (
                        <StatusBadge status={row.status || ''} xeroStatus={row.xero_status} marketplace={row.marketplace} />
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {(() => {
                        const primaryAction = getPrimaryAction(row);
                        return (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="outline" size="sm" className="h-8 px-3 text-xs font-medium">
                            {primaryAction.label}
                            <MoreHorizontal className="h-3 w-3 ml-1" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                          <DropdownMenuItem className="text-xs" onClick={() => {
                            if (row.dashboard_origin === 'validation') {
                              onViewAll?.();
                              return;
                            }
                            handleView(row);
                          }}>
                            <Eye className="h-3.5 w-3.5 mr-2" />
                            {row.dashboard_origin === 'validation'
                              ? row.status === 'awaiting_api_sync' ? 'View in overview' : 'Go to upload flow'
                              : expandedId === row.id ? 'Close breakdown' : 'View breakdown'}
                          </DropdownMenuItem>

                          {row.dashboard_origin !== 'validation' && (
                            <DropdownMenuItem className="text-xs" onClick={() => handleDownloadCSV(row)}>
                              <Download className="h-3.5 w-3.5 mr-2" />
                              Download CSV
                            </DropdownMenuItem>
                          )}

                          <DropdownMenuSeparator />

                          {row.dashboard_origin !== 'validation' && (
                            <DropdownMenuItem className="text-xs" onClick={() => {
                              toast.info('Recalculate: re-parse from the Settlements tab');
                            }}>
                              <RefreshCw className="h-3.5 w-3.5 mr-2" />
                              Recalculate
                            </DropdownMenuItem>
                          )}

                          {row.dashboard_origin !== 'validation' && ['parsed', 'ready_to_push', 'saved'].includes(row.status) && row.status !== 'pre_boundary' && (
                            <DropdownMenuItem className="text-xs" onClick={() => {
                              toast.info('Push to Xero from the Settlements tab');
                            }}>
                              <Send className="h-3.5 w-3.5 mr-2" />
                              Send to Xero
                            </DropdownMenuItem>
                          )}

                          {row.dashboard_origin !== 'validation' && <DropdownMenuSeparator />}

                          {row.dashboard_origin !== 'validation' && (row.status === 'hidden' ? (
                            <DropdownMenuItem className="text-xs" onClick={() => handleUnhide(row)}>
                              <EyeIcon className="h-3.5 w-3.5 mr-2" />
                              Unhide
                            </DropdownMenuItem>
                          ) : (
                            <DropdownMenuItem className="text-xs text-destructive" onClick={() => handleHide(row)}>
                              <EyeOff className="h-3.5 w-3.5 mr-2" />
                              Hide
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                        );
                      })()}
                    </td>
                  </tr>
                  {/* ── Inline drill-down ── */}
                  {expandedId === row.id && (
                    <tr>
                      <td colSpan={6} className="p-0">
                        <SettlementDrillDown row={row} />
                      </td>
                    </tr>
                  )}
                </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* ── Pagination ── */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between text-xs text-muted-foreground pt-1">
            <span>
              Page {page} of {totalPages} ({filtered.length} items total)
            </span>
            <div className="flex items-center gap-1">
              <Button
                variant="outline" size="sm" className="h-7 w-7 p-0"
                disabled={page <= 1}
                onClick={() => setPage(p => p - 1)}
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => {
                const p = i + 1;
                return (
                  <Button
                    key={p}
                    variant={p === page ? 'default' : 'outline'}
                    size="sm"
                    className="h-7 w-7 p-0 text-xs"
                    onClick={() => setPage(p)}
                  >
                    {p}
                  </Button>
                );
              })}
              <Button
                variant="outline" size="sm" className="h-7 w-7 p-0"
                disabled={page >= totalPages}
                onClick={() => setPage(p => p + 1)}
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
