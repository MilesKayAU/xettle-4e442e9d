import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useAiPageContext } from '@/ai/context/useAiPageContext';
import { Card, CardContent } from '@/components/ui/card';
import ReconciliationStatus from '@/components/shared/ReconciliationStatus';
import FileReconciliationStatus from '@/components/shared/FileReconciliationStatus';
import SettlementDetailDrawer from '@/components/shared/SettlementDetailDrawer';
import MarketplaceProfitCard from '@/components/shared/MarketplaceProfitCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Separator } from '@/components/ui/separator';
import {
  Trash2, Loader2, FileText, Upload, ArrowRight, Send, SkipForward,
  CheckSquare, Square, Eye, ShieldCheck, ShieldAlert,
  Download, RefreshCw, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, CloudUpload, BarChart3, Scale, Filter, Zap
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { MARKETPLACE_CATALOG, type UserMarketplace } from './MarketplaceSwitcher';
import { formatSettlementDate, formatAUD, GATEWAY_CODES } from '@/utils/settlement-engine';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';

import MarketplaceAlertsBanner from '@/components/MarketplaceAlertsBanner';
import ChannelDetectedEmptyState from './shared/ChannelDetectedEmptyState';
import EbayUploadGuide from './EbayUploadGuide';
import { isReconciliationOnly } from '@/utils/settlement-policy';
import { isReconSafeForPush, isGapBlocking } from '@/utils/canonical-recon-status';

// ── Shared architecture hooks + components ──────────────────────────────────
import { useSettlementManager, type BaseSettlementRow } from '@/hooks/use-settlement-manager';
import { useBulkSelect } from '@/hooks/use-bulk-select';
import { useXeroSync } from '@/hooks/use-xero-sync';
import { useReconciliation } from '@/hooks/use-reconciliation';
import { useTransactionDrilldown } from '@/hooks/use-transaction-drilldown';
import SettlementStatusBadge from './shared/SettlementStatusBadge';
import ReconChecksInline from './shared/ReconChecksInline';
import BulkDeleteDialog from './shared/BulkDeleteDialog';
import GapDetector, { hasSettlementGap } from './shared/GapDetector';
import TablePaginationBar, { DEFAULT_PAGE_SIZE } from '@/components/shared/TablePaginationBar';

interface GenericMarketplaceDashboardProps {
  marketplace: UserMarketplace;
  onMarketplacesChanged?: () => void;
  onSwitchToUpload?: () => void;
}

/** Maps marketplace codes to their sync edge function names */
const SYNC_FUNCTION_MAP: Record<string, string> = {
  amazon_au: 'fetch-amazon-settlements',
  ebay_au: 'fetch-ebay-settlements',
  shopify_payments: 'fetch-shopify-payouts',
  shopify_orders: 'fetch-shopify-orders',
};

function SyncNowButton({ marketplaceCode }: { marketplaceCode: string }) {
  const [syncing, setSyncing] = useState(false);
  const [lastSync, setLastSync] = useState<{ time: string; status: string } | null>(null);

  useEffect(() => {
    async function fetchLastSync() {
      const fnName = SYNC_FUNCTION_MAP[marketplaceCode];
      if (!fnName) return;
      const { data } = await supabase
        .from('sync_history')
        .select('created_at, status, event_type')
        .or(`event_type.eq.${fnName},event_type.eq.scheduled_sync`)
        .order('created_at', { ascending: false })
        .limit(1);
      if (data && data.length > 0) {
        const d = new Date(data[0].created_at);
        setLastSync({
          time: d.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
          status: data[0].status,
        });
      }
    }
    fetchLastSync();
  }, [marketplaceCode]);

  const handleSync = async () => {
    const fnName = SYNC_FUNCTION_MAP[marketplaceCode];
    if (!fnName) return;
    setSyncing(true);
    try {
      const { error } = await supabase.functions.invoke(fnName);
      if (error) throw error;
      toast.success('Sync completed successfully');
      // Refresh last sync time
      const d = new Date();
      setLastSync({
        time: d.toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }),
        status: 'success',
      });
    } catch (err: any) {
      toast.error(`Sync failed: ${err.message || 'Unknown error'}`);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        className="gap-1.5"
        disabled={syncing}
        onClick={handleSync}
      >
        {syncing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Zap className="h-3.5 w-3.5" />}
        Sync Now
      </Button>
      {lastSync && (
        <span className="text-[11px] text-muted-foreground">
          Last: {lastSync.time}
          {lastSync.status === 'success' ? ' ✅' : lastSync.status === 'error' ? ' ⚠️' : ''}
        </span>
      )}
    </div>
  );
}

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
  refunds: number | null;
  reconciliation_status: string | null;
  reimbursements: number | null;
  other_fees: number | null;
  xero_journal_id: string | null;
  xero_invoice_number: string | null;
  xero_status: string | null;
  sales_shipping: number | null;
  bank_verified: boolean | null;
  bank_verified_amount: number | null;
  bank_verified_at: string | null;
  bank_verified_by: string | null;
  source: string | null;
}

/** 
 * Determine if a marketplace is CSV-only by checking connection_type.
 * Falls back to checking if the marketplace has any API connectors in the static catalog.
 */
const API_CAPABLE_CODES = new Set(['amazon_au', 'amazon_us', 'amazon_uk', 'amazon_ca', 'shopify_payments', 'shopify_orders', 'ebay_au']);

export default function GenericMarketplaceDashboard({ marketplace, onMarketplacesChanged, onSwitchToUpload }: GenericMarketplaceDashboardProps) {
  const def = MARKETPLACE_CATALOG.find(m => m.code === marketplace.marketplace_code);
  const code = marketplace.marketplace_code;
  const [reconType, setReconType] = useState<'csv_only' | 'api_sync' | 'unknown'>('unknown');
  // CSV-only if connection_type is manual, OR marketplace is not API-capable
  const isCsvOnly = reconType === 'csv_only' || (reconType === 'unknown' && !API_CAPABLE_CODES.has(code));

  // ── Shared hooks (BaseMarketplaceDashboard pattern) ──────────────────────
  const {
    settlements, loading, hasLoadedOnce, deleting, loadSettlements, handleDelete,
  } = useSettlementManager<SettlementRow>({
    marketplaceCode: code,
    additionalCodes: [`shopify_orders_${code}`, `woolworths_marketplus_${code}`],
  });

  const {
    pushing, rollingBack, refreshingXero,
    toStandardSettlement, handlePushToXero, handleRollback, handleRefreshXero,
    handleMarkAlreadySynced, handleBulkMarkSynced,
  } = useXeroSync({ loadSettlements });

  const {
    selected, setSelected, toggleSelect, toggleSelectAll,
    bulkDeleting, bulkDeleteDialogOpen, syncedSelectedCount,
    handleBulkDelete, confirmBulkDelete, cancelBulkDelete,
  } = useBulkSelect({ settlements, onComplete: loadSettlements });

  const { reconResults, expandedRecon, toggleReconCheck } =
    useReconciliation({ toStandardSettlement });

  const { expandedLines, lineItems, loadingLines, loadLineItems } =
    useTransactionDrilldown();

  // ── Local UI state ──────────────────────────────────────────────────────────
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [bankAmountInput, setBankAmountInput] = useState('');
  const [bankVerifyConfirmed, setBankVerifyConfirmed] = useState(false);
  const [drawerSettlementId, setDrawerSettlementId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [hasShopify, setHasShopify] = useState(false);
  const [isApiConnected, setIsApiConnected] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [settlementFilter, setSettlementFilter] = useState<'all' | 'attention' | 'synced'>('all');
  const [marketplaceFilter, setMarketplaceFilter] = useState<string>('all');
  const [includeGateways, setIncludeGateways] = useState(false);
  const [accountingBoundary, setAccountingBoundary] = useState<string | null>(null);
  const [validationStatusMap, setValidationStatusMap] = useState<Record<string, string>>({});

  // Auto-audit Xero status once settlements are loaded
  const [hasAutoAudited, setHasAutoAudited] = useState(false);
  const [hasAutoExpanded, setHasAutoExpanded] = useState(false);

  useEffect(() => {
    if (hasLoadedOnce && settlements.length > 0 && !hasAutoAudited && !refreshingXero) {
      setHasAutoAudited(true);
      // Auto-audit Xero status on first load
      handleRefreshXero();
    }
  }, [hasLoadedOnce, settlements.length, hasAutoAudited, refreshingXero, handleRefreshXero, code]);

  // Auto-expand unpushed settlements so bookkeepers see detail before pushing
  useEffect(() => {
    if (hasLoadedOnce && settlements.length > 0 && !hasAutoExpanded) {
      setHasAutoExpanded(true);
      const unpushed = settlements.filter(s =>
        s.status === 'ingested' || s.status === 'ready_to_push'
      );
      // Auto-expand the first unpushed settlement
      if (unpushed.length > 0 && unpushed.length <= 5) {
        loadLineItems(unpushed[0].settlement_id);
      }
    }
  }, [hasLoadedOnce, settlements, hasAutoExpanded, loadLineItems]);

  useEffect(() => {
    async function checkShopifyAndBoundary() {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);
      const { data } = await supabase.from('shopify_tokens').select('id').eq('user_id', user.id).limit(1);
      setHasShopify(!!(data && data.length > 0));

      // Check if this marketplace has an active API connection
      let apiConnected = false;
      if (code === 'amazon_au') {
        const { data: tokens } = await supabase.from('amazon_tokens').select('id').eq('user_id', user.id).limit(1);
        apiConnected = !!(tokens && tokens.length > 0);
      } else if (code === 'shopify_payments' || code === 'shopify_orders') {
        apiConnected = !!(data && data.length > 0); // reuse shopify_tokens check
      } else if (code === 'ebay_au') {
        const { data: ebayTokens } = await supabase.from('ebay_tokens').select('id').eq('user_id', user.id).limit(1);
        apiConnected = !!(ebayTokens && ebayTokens.length > 0);
      }
      setIsApiConnected(apiConnected);

      // Fetch accounting boundary
      const { data: boundaryRow } = await supabase
        .from('app_settings')
        .select('value')
        .eq('user_id', user.id)
        .eq('key', 'accounting_boundary_date')
        .maybeSingle();
      if (boundaryRow?.value) setAccountingBoundary(boundaryRow.value);

      // Fetch validation statuses for this marketplace
      const { data: valRows } = await supabase
        .from('marketplace_validation')
        .select('settlement_id, overall_status')
        .eq('marketplace_code', code);
      const valMap: Record<string, string> = {};
      for (const v of (valRows || []) as any[]) {
        if (v.settlement_id) valMap[v.settlement_id] = v.overall_status;
      }
      setValidationStatusMap(valMap);

      // Fetch reconciliation type from fingerprints
      const { data: fpRows } = await supabase
        .from('marketplace_file_fingerprints')
        .select('reconciliation_type')
        .eq('user_id', user.id)
        .eq('marketplace_code', code)
        .limit(1) as any;
      if (fpRows && fpRows.length > 0 && fpRows[0].reconciliation_type && fpRows[0].reconciliation_type !== 'unknown') {
        setReconType(fpRows[0].reconciliation_type);
      }
    }
    checkShopifyAndBoundary();
  }, [code]);


  const marketplaceName = def?.name || marketplace.marketplace_name;

  // ── AI Page Context ──────────────────────────────────────────────────────────
  /** Compute gap from settlement component fields (bank_deposit is NOT on settlements table) */
  function computeGap(s: SettlementRow): number | null {
    const net = s.bank_deposit;
    if (net == null) return null;
    const computed = (s.sales_principal || 0) + (s.seller_fees || 0) +
      (s.refunds || 0) + (s.other_fees || 0) + (s.reimbursements || 0);
    if (computed === 0 && net === 0) return 0;
    return net - computed;
  }
  const reconciledCount = useMemo(() => settlements.filter(s => {
    const gap = computeGap(s);
    return !isGapBlocking(gap);
  }).length, [settlements]);
  const flaggedCount = useMemo(() => settlements.filter(s => {
    const gap = computeGap(s);
    return isGapBlocking(gap);
  }).length, [settlements]);
  const pushedCount = useMemo(() => settlements.filter(s => ['pushed_to_xero', 'reconciled_in_xero', 'bank_verified'].includes(s.status || '')).length, [settlements]);
  const unpushedCount = useMemo(() => settlements.filter(s => validationStatusMap[s.settlement_id] === 'ready_to_push').length, [settlements, validationStatusMap]);

  useAiPageContext(() => ({
    routeId: 'settlements',
    pageTitle: `${marketplaceName} Settlements`,
    primaryEntities: { marketplace_codes: [code] },
    pageStateSummary: {
      marketplace: marketplaceName,
      marketplace_code: code,
      total_settlements: settlements.length,
      reconciled: reconciledCount,
      flagged_for_review: flaggedCount,
      pushed_to_xero: pushedCount,
      awaiting_push: unpushedCount,
      connection_type: isCsvOnly ? 'CSV upload' : 'API connected',
      active_filter: settlementFilter,
    },
    suggestedPrompts: [
      'What does this table mean?',
      flaggedCount > 0 ? `Why do ${flaggedCount} settlements need review?` : 'Are all my settlements reconciled?',
      'What does "check required" mean?',
      unpushedCount > 0 ? `Can I push ${unpushedCount} settlements to Xero?` : undefined,
    ].filter(Boolean) as string[],
  }));

  // Detect unique marketplace codes in settlements for the marketplace filter
  const uniqueMarketplaceCodes = useMemo(() => {
    const codes = new Set(settlements.map(s => s.marketplace));
    return Array.from(codes).sort();
  }, [settlements]);

  // Detect if any settlements are from payment gateways
  const hasGatewaySettlements = useMemo(() => 
    settlements.some(s => GATEWAY_CODES.has(s.marketplace)),
  [settlements]);

  // Filter settlements
  const filteredSettlements = useMemo(() => {
    return settlements.filter(s => {
      // Gateway filter — exclude payment gateway settlements by default
      if (!includeGateways && GATEWAY_CODES.has(s.marketplace)) return false;
      // Marketplace filter
      if (marketplaceFilter !== 'all' && s.marketplace !== marketplaceFilter) return false;
      // Status filter
      if (settlementFilter === 'attention') return s.status === 'ingested' || s.status === 'push_failed' || s.status === 'push_failed_permanent';
      if (settlementFilter === 'synced') return ['pushed_to_xero', 'reconciled_in_xero', 'bank_verified'].includes(s.status || '');
      return true;
    });
  }, [settlements, settlementFilter, marketplaceFilter, includeGateways]);

  // Pagination
  const [settPage, setSettPage] = useState(1);
  const settTotalPages = Math.max(1, Math.ceil(filteredSettlements.length / DEFAULT_PAGE_SIZE));
  const paginatedSettlements = useMemo(() => {
    const start = (settPage - 1) * DEFAULT_PAGE_SIZE;
    return filteredSettlements.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [filteredSettlements, settPage]);
  // Reset page when filter changes
  useEffect(() => { setSettPage(1); }, [settlementFilter, marketplaceFilter, includeGateways]);

  const baseFiltered = useMemo(() => {
    return settlements.filter(s => {
      if (!includeGateways && GATEWAY_CODES.has(s.marketplace)) return false;
      if (marketplaceFilter !== 'all' && s.marketplace !== marketplaceFilter) return false;
      return true;
    });
  }, [settlements, marketplaceFilter, includeGateways]);

  const attentionCount = baseFiltered.filter(s => s.status === 'ingested' || s.status === 'push_failed' || s.status === 'push_failed_permanent').length;
  const syncedCount = baseFiltered.filter(s => ['pushed_to_xero', 'reconciled_in_xero', 'bank_verified'].includes(s.status || '')).length;

  return (
    <div className="space-y-6">
      {/* Alerts Banner */}
      <MarketplaceAlertsBanner marketplaceCode={marketplace.marketplace_code} />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <span className="text-xl">{def?.icon || '📋'}</span>
            {marketplaceName} Settlements
            {isApiConnected ? (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 gap-0.5 bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800">
                <Zap className="h-2.5 w-2.5" /> API
              </Badge>
            ) : (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5">
                <FileText className="h-2.5 w-2.5" /> File upload
              </Badge>
            )}
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            {isApiConnected
              ? 'Settlements are fetched automatically via API. You can also upload manually.'
              : 'Upload settlement files to view, reconcile, and sync to Xero.'
            }
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isApiConnected && (
            <SyncNowButton marketplaceCode={code} />
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={refreshingXero}
            onClick={handleRefreshXero}
          >
            {refreshingXero ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh from Xero
          </Button>
        </div>
      </div>


      <Separator />

      {/* Reconciliation Status — moved above settlement list */}
      <div className="space-y-3">
        <h4 className="text-base font-semibold text-foreground flex items-center gap-2">
          <Scale className="h-4 w-4 text-primary" />
          {hasShopify && !isCsvOnly ? 'Reconciliation Health' : 'File Reconciliation'}
        </h4>
        {hasShopify && !isCsvOnly && currentUserId ? (
          <ReconciliationStatus marketplaceCode={code} userId={currentUserId} />
        ) : settlements.length > 0 ? (
          <FileReconciliationStatus
            settlements={settlements.filter(s => !isReconciliationOnly((s as any).source, s.marketplace, s.settlement_id))}
            onSettlementClick={(sid) => {
              setDrawerSettlementId(sid);
              setDrawerOpen(true);
            }}
          />
        ) : null}
      </div>

      <Separator />

      {/* Settlement History */}
      <div className="space-y-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <h4 className="text-base font-semibold text-foreground flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Saved Settlements
            {settlements.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">{settlements.length}</Badge>
            )}
          </h4>

          {/* Filter tabs */}
          {settlements.length > 0 && (
            <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-0.5">
              <button
                onClick={() => setSettlementFilter('all')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  settlementFilter === 'all' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                All ({baseFiltered.length})
              </button>
              <button
                onClick={() => setSettlementFilter('attention')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  settlementFilter === 'attention' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Needs Attention {attentionCount > 0 && <span className="ml-1 text-amber-600">({attentionCount})</span>}
              </button>
              <button
                onClick={() => setSettlementFilter('synced')}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
                  settlementFilter === 'synced' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                Synced {syncedCount > 0 && <span className="ml-1 text-emerald-600">({syncedCount})</span>}
              </button>
            </div>
          )}
        </div>

        {/* Advanced filters row */}
        {settlements.length > 0 && (
          <div className="flex items-center gap-4 flex-wrap">
            {/* Marketplace filter — only show when multiple marketplace codes exist */}
            {uniqueMarketplaceCodes.length > 1 && (
              <div className="flex items-center gap-2">
                <Label className="text-xs text-muted-foreground whitespace-nowrap">Marketplace</Label>
                <Select value={marketplaceFilter} onValueChange={setMarketplaceFilter}>
                  <SelectTrigger className="h-7 w-[160px] text-xs">
                    <SelectValue placeholder="All" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All marketplaces</SelectItem>
                    {uniqueMarketplaceCodes.filter(c => includeGateways || !GATEWAY_CODES.has(c)).map(c => {
                      const cat = MARKETPLACE_CATALOG.find(m => m.code === c);
                      return (
                        <SelectItem key={c} value={c}>
                          {cat?.icon || '📦'} {cat?.name || c}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Include gateways toggle — only show when gateway settlements exist */}
            {hasGatewaySettlements && (
              <div className="flex items-center gap-2">
                <Switch
                  id="include-gateways"
                  checked={includeGateways}
                  onCheckedChange={setIncludeGateways}
                  className="scale-75"
                />
                <Label htmlFor="include-gateways" className="text-xs text-muted-foreground cursor-pointer">
                  Include payment gateways
                </Label>
              </div>
            )}

            {/* Settlement count */}
            {filteredSettlements.length !== settlements.length && (
              <span className="text-xs text-muted-foreground ml-auto">
                Showing {filteredSettlements.length} of {settlements.length} settlements
              </span>
            )}
          </div>
        )}

        {loading ? (
          <Card className="border-border">
            <CardContent className="py-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading settlements…
            </CardContent>
          </Card>
        ) : settlements.length === 0 && !hasLoadedOnce ? (
          <Card className="border-border">
            <CardContent className="py-8 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">Processing uploads…</p>
              <p className="text-xs text-muted-foreground mt-1">Settlements are being parsed and saved — they'll appear here automatically.</p>
            </CardContent>
          </Card>
        ) : settlements.length === 0 ? (
          <ChannelDetectedEmptyState
            marketplaceCode={code}
            marketplaceName={marketplaceName}
            onUpload={onSwitchToUpload}
            isApiConnected={isApiConnected}
            onSyncNow={isApiConnected ? handleRefreshXero : undefined}
          />
        ) : (
          <div className="space-y-2">
            {/* Bulk actions bar */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1"
                  onClick={toggleSelectAll}
                >
                  {selected.size === settlements.length ? <CheckSquare className="h-3.5 w-3.5" /> : <Square className="h-3.5 w-3.5" />}
                  {selected.size === settlements.length ? 'Deselect All' : 'Select All'}
                </Button>
                {selected.size > 0 && (
                  <Button
                    variant="destructive"
                    size="sm"
                    className="h-7 px-2 text-xs gap-1"
                    onClick={handleBulkDelete}
                    disabled={bulkDeleting}
                  >
                    {bulkDeleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    Delete {selected.size} Selected
                  </Button>
                )}
              </div>
              <div className="flex items-center gap-2">
                {settlements.some(s => s.status === 'push_failed' || s.status === 'push_failed_permanent') && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs gap-1"
                    onClick={async () => {
                      const failed = settlements.filter(s => s.status === 'push_failed' || s.status === 'push_failed_permanent');
                      if (failed.length === 0) return;
                      try {
                        const { resetFailedSettlements } = await import('@/actions/settlements');
                        const result = await resetFailedSettlements(failed.map(s => s.id));
                        if (!result.success) throw new Error(result.error);
                        toast.success(`Reset ${failed.length} failed settlement(s) — ready to retry`);
                        loadSettlements(true);
                      } catch (err: any) {
                        toast.error(err.message || 'Failed to reset');
                      }
                    }}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Retry {settlements.filter(s => s.status === 'push_failed' || s.status === 'push_failed_permanent').length} Failed
                  </Button>
                )}
                {settlements.some(s => s.status === 'ingested') && (
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => handleBulkMarkSynced(settlements)}>
                    <SkipForward className="h-3.5 w-3.5 mr-1" />
                    Mark All as Already in Xero
                  </Button>
                )}
              </div>
            </div>

            {/* Audit table header */}
            <Card>
              <CardContent className="p-0">
                <div className="hidden sm:grid sm:grid-cols-[auto_1fr_80px_80px_80px_80px_50px_120px_auto] gap-2 px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider border-b border-border">
                  <div className="w-5" />
                  <div>Settlement</div>
                  <div className="text-center">Xero</div>
                  <div className="text-center">Bank</div>
                  <div className="text-right">Expected</div>
                  <div className="text-right">Actual</div>
                  <div className="text-right">Diff</div>
                  <div className="text-center">Status</div>
                  <div className="text-right">Actions</div>
                </div>

                <div className="space-y-0">
                  {paginatedSettlements.map((s, idx) => {
                    const sales = s.sales_principal || 0;
                    const fees = s.seller_fees || 0;
                    const net = s.bank_deposit || 0;
                    const isSelected = selected.has(s.id);
                     const isReconOnly = isReconciliationOnly((s as any).source, s.marketplace, s.settlement_id);
                     const reconGap = computeGap(s);
                     const reconOk = isReconSafeForPush(reconGap);
                     const valStatus = validationStatusMap[s.settlement_id];
                     const isSyncable = !isReconOnly && reconOk && valStatus === 'ready_to_push';
                     const isReconBlocked = !isReconOnly && !reconOk && (s.status === 'ingested' || valStatus === 'ready_to_push');
                    const isPushFailed = s.status === 'push_failed';
                    const isSynced = ['pushed_to_xero', 'reconciled_in_xero', 'bank_verified'].includes(s.status || '');
                    const isPreBoundary = !!(s as any).is_pre_boundary;

                    const prev = filteredSettlements[idx + 1];
                    let hasGap = false;
                    if (prev && s.period_start > prev.period_end) {
                      // Suppress gap warnings for pre-boundary settlements
                      const bothPreBoundary = accountingBoundary &&
                        new Date(s.period_end) < new Date(accountingBoundary) &&
                        new Date(prev.period_end) < new Date(accountingBoundary);
                      if (!bothPreBoundary) {
                        const gapMs = new Date(s.period_start).getTime() - new Date(prev.period_end).getTime();
                        const gapDays = gapMs / (1000 * 60 * 60 * 24);
                        const isShopify = (s.marketplace || '').toLowerCase().includes('shopify');
                        const tolerance = isShopify ? 7 : 1;
                        hasGap = gapDays > tolerance;
                      }
                    }

                    const isExpanded = expandedLines === s.settlement_id;
                    const lines = lineItems[s.settlement_id] || [];
                    const isLoadingLines = loadingLines === s.settlement_id;

                    return (
                      <React.Fragment key={s.id}>
                        {hasGap && (
                          <div className="flex items-center gap-2 py-1 px-3 bg-amber-50/50 dark:bg-amber-950/10 border-b border-border">
                            <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                            <p className="text-xs text-muted-foreground">
                              Gap: missing settlement between {formatSettlementDate(prev.period_end)} and {formatSettlementDate(s.period_start)}
                            </p>
                          </div>
                        )}
                        <div className={`border-b border-border last:border-b-0 transition-colors ${
                          isPreBoundary ? 'opacity-40 bg-muted/20' :
                          isSynced ? 'bg-emerald-50/30 dark:bg-emerald-950/10' :
                          isPushFailed ? 'bg-red-50/30 dark:bg-red-950/10' :
                          'hover:bg-muted/20'
                        } ${isSelected ? 'bg-primary/5' : ''}`}>
                          <div className="p-2.5 sm:grid sm:grid-cols-[auto_1fr_80px_80px_80px_80px_50px_120px_auto] gap-2 items-center">
                            {/* Checkbox */}
                            <button
                              className="shrink-0 p-0.5 text-muted-foreground hover:text-foreground"
                              onClick={() => toggleSelect(s.id)}
                            >
                              {isSelected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
                            </button>

                            {/* Settlement info — clickable to expand */}
                            <button
                              className="min-w-0 text-left cursor-pointer hover:opacity-80 flex items-center gap-2"
                              onClick={() => loadLineItems(s.settlement_id)}
                            >
                              {isLoadingLines ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground shrink-0" />
                              ) : isExpanded ? (
                                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              ) : (
                                <ChevronUp className="h-3.5 w-3.5 text-muted-foreground shrink-0 rotate-90" />
                              )}
                              <div>
                                <div className="flex items-center gap-2 flex-wrap">
                                  <span className="font-mono text-sm font-medium">{s.settlement_id}</span>
                                  {isReconOnly && (
                                    <Badge variant="outline" className="text-[9px] text-muted-foreground">Recon Only</Badge>
                                  )}
                                  {s.source === 'api_sync' && (
                                    <Badge variant="outline" className="text-[9px] bg-amber-500/10 text-amber-700 border-amber-200 dark:text-amber-400 dark:border-amber-800">Shopify Orders</Badge>
                                  )}
                                  {(s.source === 'manual' || s.source === 'csv_upload') && (
                                    <Badge variant="outline" className="text-[9px] bg-blue-500/10 text-blue-700 border-blue-200 dark:text-blue-400 dark:border-blue-800">CSV Upload</Badge>
                                  )}
                                </div>
                                <div className="flex items-center gap-3 mt-0.5 text-xs text-muted-foreground">
                                  <span>{formatSettlementDate(s.period_start)} → {formatSettlementDate(s.period_end)}</span>
                                  <span className="font-medium text-foreground">{formatAUD(net)}</span>
                                </div>
                              </div>
                            </button>

                            {/* Xero indicator */}
                            <div className="flex justify-center">
                              {isSynced ? (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                        <CheckCircle2 className="h-4 w-4" />
                                        <span className="text-xs font-medium">Found</span>
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent className="text-xs">
                                      {s.xero_invoice_number
                                        ? `Invoice ${s.xero_invoice_number} (${s.xero_status || 'AUTHORISED'})`
                                        : s.status === 'synced_external' ? 'Marked as already in Xero' : 'Pushed via Xettle'}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              ) : (
                                <span className="flex items-center gap-1 text-muted-foreground">
                                  <span className="text-xs">—</span>
                                </span>
                              )}
                            </div>

                            {/* Bank indicator */}
                            <div className="flex justify-center">
                              {s.bank_verified ? (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                        <CheckCircle2 className="h-4 w-4" />
                                        <span className="text-xs font-medium">Matched</span>
                                      </span>
                                    </TooltipTrigger>
                                    <TooltipContent className="text-xs">
                                      {s.bank_verified_amount
                                        ? `${formatAUD(s.bank_verified_amount)} verified`
                                        : 'Bank deposit matched'}
                                      {s.bank_verified_at && (
                                        <> on {formatSettlementDate(s.bank_verified_at.split('T')[0])}</>
                                      )}
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              ) : (
                                <span className="flex items-center gap-1 text-muted-foreground">
                                  <span className="text-xs">—</span>
                                </span>
                              )}
                            </div>

                            {/* Expected Deposit */}
                            <div className="text-right">
                              <span className="text-xs font-mono text-muted-foreground">{formatAUD(net)}</span>
                            </div>

                            {/* Actual Deposit */}
                            <div className="text-right">
                              {s.bank_verified && s.bank_verified_amount != null ? (
                                <span className="text-xs font-mono font-medium text-foreground">{formatAUD(s.bank_verified_amount)}</span>
                              ) : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </div>

                            {/* Difference */}
                            <div className="text-right">
                              {s.bank_verified && s.bank_verified_amount != null ? (() => {
                                const diff = Math.abs((s.bank_verified_amount || 0) - net);
                                return diff <= 0.05 ? (
                                  <span className="text-xs font-mono text-emerald-600 dark:text-emerald-400">$0.00 ✓</span>
                                ) : (
                                  <span className="text-xs font-mono text-amber-600 dark:text-amber-400">
                                    −{formatAUD(diff)} ⚠
                                  </span>
                                );
                              })() : (
                                <span className="text-xs text-muted-foreground">—</span>
                              )}
                            </div>

                             {/* Status badge */}
                             <div className="flex justify-center gap-1">
                               {isReconOnly && (
                                 <Badge className="bg-amber-500/15 text-amber-700 border-amber-200 text-[10px]">Recon Only</Badge>
                               )}
                               <SettlementStatusBadge
                                status={s.status}
                                xeroInvoiceNumber={s.xero_invoice_number}
                                xeroType={(s as any).xero_type}
                                xeroStatus={s.xero_status}
                                marketplace={s.marketplace}
                              />
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-1 justify-end">
                              {/* Push to Xero */}
                              {isReconBlocked && !isPreBoundary && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger>
                                      <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800 text-[10px] cursor-default">
                                        <AlertTriangle className="h-3 w-3 mr-1" />
                                        Fix recon first
                                      </Badge>
                                    </TooltipTrigger>
                                    <TooltipContent className="text-xs max-w-[200px]">
                                      Sales − Fees ≠ Net — review line items before pushing to Xero
                                    </TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                              {isSyncable && !isPreBoundary && (
                                <>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          size="sm"
                                          className="h-7 px-2 text-xs gap-1"
                                          disabled={pushing === s.id}
                                          onClick={() => {
                                            if (s.xero_journal_id) {
                                              const confirmed = window.confirm(
                                                `This settlement already has a Xero invoice (${s.xero_invoice_number || s.xero_journal_id}). Push again?`
                                              );
                                              if (!confirmed) return;
                                            }
                                            if (verifyingId === s.id) {
                                              setVerifyingId(null);
                                              setBankAmountInput('');
                                              setBankVerifyConfirmed(false);
                                            } else {
                                              setVerifyingId(s.id);
                                              setBankAmountInput('');
                                              setBankVerifyConfirmed(false);
                                            }
                                          }}
                                        >
                                          {pushing === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                                          Push
                                        </Button>
                                      </TooltipTrigger>
                                      {!s.bank_verified && verifyingId !== s.id && (
                                        <TooltipContent>
                                          <p className="text-xs">Bank amount not verified — we recommend checking first</p>
                                        </TooltipContent>
                                      )}
                                    </Tooltip>
                                  </TooltipProvider>
                                  <TooltipProvider>
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          className="h-7 px-2 text-xs text-muted-foreground"
                                          onClick={() => handleMarkAlreadySynced(s.settlement_id)}
                                        >
                                          <ShieldCheck className="h-3 w-3" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent className="text-xs">Mark as already in Xero</TooltipContent>
                                    </Tooltip>
                                  </TooltipProvider>
                                </>
                              )}
                              {/* Retry */}
                              {isPushFailed && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="h-7 px-2 text-xs text-amber-600 border-amber-300"
                                  disabled={pushing === s.id}
                                  onClick={async () => {
                                    await supabase
                                      .from('settlements')
                                      .update({ status: 'saved', xero_journal_id: null } as any)
                                      .eq('id', s.id);
                                    loadSettlements();
                                    toast.info('Status reset — you can now retry pushing to Xero');
                                  }}
                                >
                                  {pushing === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <AlertTriangle className="h-3 w-3" />}
                                </Button>
                              )}
                              {/* Synced — rollback */}
                              {isSynced && s.xero_journal_id && (
                                <TooltipProvider>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="sm"
                                        variant="ghost"
                                        className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                                        disabled={rollingBack === s.id}
                                        onClick={() => handleRollback(s)}
                                      >
                                        {rollingBack === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent><p className="text-xs">Void invoice in Xero & reset</p></TooltipContent>
                                  </Tooltip>
                                </TooltipProvider>
                              )}
                              {/* View detail drawer */}
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
                                      onClick={() => {
                                        setDrawerSettlementId(s.settlement_id);
                                        setDrawerOpen(true);
                                      }}
                                    >
                                      <Eye className="h-3.5 w-3.5" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent className="text-xs">View settlement details</TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                              {/* Delete */}
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                disabled={deleting === s.id}
                                onClick={() => handleDelete(s)}
                              >
                                {deleting === s.id ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5" />
                                )}
                              </Button>
                            </div>
                          </div>

                          {/* Bank Verification Panel — inline below the row */}
                          {verifyingId === s.id && isSyncable && (() => {
                            const enteredAmount = parseFloat(bankAmountInput);
                            const isValidInput = !isNaN(enteredAmount) && bankAmountInput.trim() !== '';
                            const diff = isValidInput ? Math.abs(enteredAmount - net) : 0;
                            const isMatch = isValidInput && diff <= 0.05;
                            const isMismatch = isValidInput && diff > 0.05;

                            return (
                              <div className="px-4 pb-3 pt-1 border-t border-border space-y-3">
                                <div className="flex items-center gap-2">
                                  <ShieldCheck className="h-4 w-4 text-primary" />
                                  <span className="text-sm font-semibold text-foreground">Verify bank deposit</span>
                                </div>
                                <div className="flex items-center gap-3">
                                  <div className="flex-1">
                                    <label className="text-xs text-muted-foreground mb-1 block">Enter the amount that hit your bank account:</label>
                                    <div className="flex items-center gap-2">
                                      <span className="text-xs text-muted-foreground">$</span>
                                      <Input
                                        type="number"
                                        step="0.01"
                                        placeholder="0.00"
                                        value={bankAmountInput}
                                        onChange={(e) => setBankAmountInput(e.target.value)}
                                        className="h-8 w-36 text-sm"
                                      />
                                      <span className="text-xs text-muted-foreground">AUD</span>
                                    </div>
                                  </div>
                                  <div className="text-xs text-muted-foreground">
                                    <p>Xettle calculated:</p>
                                    <p className="font-semibold text-foreground">{formatAUD(net)}</p>
                                  </div>
                                </div>

                                {isMatch && (
                                  <div className="flex items-center gap-2 bg-emerald-50 dark:bg-emerald-950/20 rounded-md px-3 py-2">
                                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                    <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Amounts match — safe to push</span>
                                  </div>
                                )}
                                {isMismatch && (
                                  <div className="space-y-2">
                                    <div className="flex items-center gap-2 bg-amber-50 dark:bg-amber-950/20 rounded-md px-3 py-2">
                                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                                      <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                                        Difference of {formatAUD(diff)} detected
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2 pl-1">
                                      <Checkbox
                                        id={`verify-${s.id}`}
                                        checked={bankVerifyConfirmed}
                                        onCheckedChange={(checked) => setBankVerifyConfirmed(!!checked)}
                                      />
                                      <label htmlFor={`verify-${s.id}`} className="text-xs text-muted-foreground cursor-pointer">
                                        I understand the difference and want to push anyway
                                      </label>
                                    </div>
                                  </div>
                                )}

                                <div className="flex items-center gap-2">
                                  <Button
                                    size="sm"
                                    disabled={pushing === s.id || (isValidInput && isMismatch && !bankVerifyConfirmed)}
                                    onClick={() => handlePushToXero(s, isValidInput ? enteredAmount : undefined)}
                                  >
                                    {pushing === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                                    {isMatch ? 'Push to Xero ✓' : isValidInput ? 'Push to Xero' : 'Skip verification & Push'}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => { setVerifyingId(null); setBankAmountInput(''); setBankVerifyConfirmed(false); }}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            );
                          })()}

                          {/* Transaction drill-down */}
                          {isExpanded && (
                            <div className="border-t border-border px-3 py-2 bg-muted/30">
                              {lines.length === 0 && !isLoadingLines ? (
                                <p className="text-xs text-muted-foreground py-2 text-center">No transaction lines found for this settlement.</p>
                              ) : isLoadingLines ? (
                                <div className="flex items-center gap-2 py-3 justify-center text-xs text-muted-foreground">
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading transactions…
                                </div>
                              ) : (() => {
                                // ─── Financial summary strip ───
                                const salesTotal = lines
                                  .filter((l: any) => (l.amount || 0) > 0 && !l.transaction_type?.toLowerCase().includes('refund'))
                                  .reduce((sum: number, l: any) => sum + (l.amount || 0), 0);
                                const feesTotal = lines
                                  .filter((l: any) => (l.amount || 0) < 0 && !l.transaction_type?.toLowerCase().includes('refund'))
                                  .reduce((sum: number, l: any) => sum + Math.abs(l.amount || 0), 0);
                                const refundsTotal = lines
                                  .filter((l: any) => l.transaction_type?.toLowerCase().includes('refund'))
                                  .reduce((sum: number, l: any) => sum + Math.abs(l.amount || 0), 0);
                                const linesTotal = lines.reduce((sum: number, l: any) => sum + (l.amount || 0), 0);
                                const reconDiff = Math.abs(linesTotal - net);
                                const reconOk = reconDiff <= 0.05;
                                const uniqueOrders = new Set(lines.filter((l: any) => l.order_id).map((l: any) => l.order_id)).size;

                                return (
                                  <div className="space-y-2">
                                    {/* Summary strip */}
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2 px-2 rounded-md bg-background border border-border">
                                      <div className="text-xs">
                                        <span className="text-muted-foreground">Sales: </span>
                                        <span className="font-semibold text-foreground">{formatAUD(salesTotal)}</span>
                                      </div>
                                      <div className="text-xs">
                                        <span className="text-muted-foreground">Fees: </span>
                                        <span className="font-semibold text-destructive">−{formatAUD(feesTotal)}</span>
                                      </div>
                                      {refundsTotal > 0 && (
                                        <div className="text-xs">
                                          <span className="text-muted-foreground">Refunds: </span>
                                          <span className="font-semibold text-orange-600 dark:text-orange-400">−{formatAUD(refundsTotal)}</span>
                                        </div>
                                      )}
                                      <div className="text-xs">
                                        <span className="text-muted-foreground">Net: </span>
                                        <span className="font-bold text-foreground">{formatAUD(linesTotal)}</span>
                                      </div>
                                      <div className="text-xs">
                                        <span className="text-muted-foreground">Orders: </span>
                                        <span className="font-semibold text-foreground">{uniqueOrders}</span>
                                      </div>
                                      <div className="text-xs ml-auto">
                                        {reconOk ? (
                                          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                                            <CheckCircle2 className="h-3 w-3" />
                                            Reconciled to header
                                          </span>
                                        ) : (
                                          <span className="flex items-center gap-1 text-amber-600 dark:text-amber-400">
                                            <AlertTriangle className="h-3 w-3" />
                                            {formatAUD(reconDiff)} variance vs header
                                          </span>
                                        )}
                                      </div>
                                    </div>

                                    {/* Unpushed settlement review prompt */}
                                    {isSyncable && !isPreBoundary && (
                                      <div className="flex items-center gap-2 py-1.5 px-2 rounded-md bg-primary/5 border border-primary/20">
                                        <Eye className="h-3.5 w-3.5 text-primary shrink-0" />
                                        <p className="text-xs text-foreground">
                                          <span className="font-medium">Review required</span> — check the transaction breakdown above before pushing to Xero.
                                        </p>
                                      </div>
                                    )}

                                    {/* Transaction table */}
                                    <div className="overflow-x-auto">
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="text-[10px] text-muted-foreground uppercase tracking-wider">
                                            <th className="text-left py-1 pr-2">Order ID</th>
                                            <th className="text-left py-1 pr-2">SKU</th>
                                            <th className="text-left py-1 pr-2">Type</th>
                                            <th className="text-left py-1 pr-2">Description</th>
                                            <th className="text-right py-1">Amount</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {lines.map((line: any, lIdx: number) => {
                                            const isRefund = line.transaction_type?.toLowerCase().includes('refund');
                                            const isFee = (line.amount || 0) < 0 && !isRefund;
                                            return (
                                              <tr
                                                key={lIdx}
                                                className={`border-t border-border/50 ${
                                                  isRefund ? 'text-orange-600 dark:text-orange-400' :
                                                  isFee ? 'text-destructive' :
                                                  (line.amount || 0) > 0 ? 'text-emerald-600 dark:text-emerald-400' :
                                                  ''
                                                }`}
                                              >
                                                <td className="py-1 pr-2 font-mono">{line.order_id || '—'}</td>
                                                <td className="py-1 pr-2">{line.sku || '—'}</td>
                                                <td className="py-1 pr-2">{line.transaction_type || '—'}</td>
                                                <td className="py-1 pr-2 max-w-[200px] truncate">{line.amount_description || '—'}</td>
                                                <td className="py-1 text-right font-mono font-medium">{formatAUD(line.amount || 0)}</td>
                                              </tr>
                                            );
                                          })}
                                          <tr className="border-t-2 border-border font-semibold">
                                            <td colSpan={4} className="py-1.5 pr-2">Total ({lines.length} lines)</td>
                                            <td className="py-1.5 text-right font-mono">
                                              {formatAUD(linesTotal)}
                                            </td>
                                          </tr>
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                      </React.Fragment>
                    );
                  })}
                </div>
                <TablePaginationBar
                  page={settPage}
                  totalPages={settTotalPages}
                  totalItems={filteredSettlements.length}
                  pageSize={DEFAULT_PAGE_SIZE}
                  onPageChange={setSettPage}
                />
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* eBay upload guide */}
      {code === 'ebay_au' && <EbayUploadGuide />}

      {/* Upload prompt — below data, not blocking view */}
      {onSwitchToUpload && (
        <>
          <Separator />
          {isApiConnected ? (
            <Card className="border border-emerald-200 dark:border-emerald-800 bg-emerald-50/30 dark:bg-emerald-900/10 rounded-xl">
              <CardContent className="py-6 px-8 flex flex-col items-center justify-center text-center gap-2">
                <div className="h-10 w-10 rounded-full bg-emerald-100 dark:bg-emerald-900/40 flex items-center justify-center">
                  <Zap className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                </div>
                <p className="text-sm font-medium text-foreground">
                  Settlements sync automatically
                </p>
                <p className="text-xs text-muted-foreground">
                  {marketplaceName} settlements are fetched via API during each sync cycle.
                </p>
                <Button size="sm" variant="ghost" onClick={onSwitchToUpload} className="gap-1.5 text-muted-foreground mt-1">
                  <Upload className="h-3.5 w-3.5" /> Upload manually if needed
                </Button>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-dashed border-2 border-primary/30 hover:border-primary/50 transition-colors cursor-pointer bg-muted/30 rounded-xl" onClick={onSwitchToUpload}>
              <CardContent className="py-8 px-8 flex flex-col items-center justify-center text-center gap-3">
                <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                  <CloudUpload className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <p className="text-base font-bold text-foreground uppercase tracking-wide">
                    Upload more settlement files
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Xettle recognises the marketplace automatically. No configuration required.
                  </p>
                </div>
                <Button size="sm" className="gap-2 mt-1">
                  <Upload className="h-4 w-4" />
                  Smart Upload
                  <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      <Separator />

      {/* Profit Summary */}
      <div className="space-y-3">
        <h4 className="text-base font-semibold text-foreground flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          Profit Analysis
        </h4>
        {currentUserId && (
          <MarketplaceProfitCard marketplaceCode={code} userId={currentUserId} />
        )}
      </div>

      {/* Xero-aware bulk delete confirmation dialog */}
      <BulkDeleteDialog
        open={bulkDeleteDialogOpen}
        selectedCount={selected.size}
        syncedCount={syncedSelectedCount}
        onConfirm={confirmBulkDelete}
        onCancel={cancelBulkDelete}
      />

      {/* Settlement Detail Drawer */}
      <SettlementDetailDrawer
        settlementId={drawerSettlementId}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setDrawerSettlementId(null); }}
      />
    </div>
  );
}
