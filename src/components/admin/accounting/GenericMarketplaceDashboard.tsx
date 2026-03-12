import React, { useState, useEffect, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import ReconciliationStatus from '@/components/shared/ReconciliationStatus';
import FileReconciliationStatus from '@/components/shared/FileReconciliationStatus';
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
  Download, RefreshCw, AlertTriangle, CheckCircle2, ChevronDown, ChevronUp, CloudUpload, BarChart3, Scale, Filter
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

interface GenericMarketplaceDashboardProps {
  marketplace: UserMarketplace;
  onMarketplacesChanged?: () => void;
  onSwitchToUpload?: () => void;
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
}

/** Hardcoded fallback for marketplaces not yet in fingerprints table */
const CSV_ONLY_FALLBACK = ['bigw', 'everyday_market', 'mydeal', 'bunnings', 'catch', 'kogan', 'woolworths', 'woolworths_marketplus'];

export default function GenericMarketplaceDashboard({ marketplace, onMarketplacesChanged, onSwitchToUpload }: GenericMarketplaceDashboardProps) {
  const def = MARKETPLACE_CATALOG.find(m => m.code === marketplace.marketplace_code);
  const code = marketplace.marketplace_code;
  const [reconType, setReconType] = useState<'csv_only' | 'api_sync' | 'unknown'>('unknown');
  const isCsvOnly = reconType === 'csv_only' || (reconType === 'unknown' && CSV_ONLY_FALLBACK.includes(code));

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
  const [hasShopify, setHasShopify] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [settlementFilter, setSettlementFilter] = useState<'all' | 'attention' | 'synced'>('all');
  const [accountingBoundary, setAccountingBoundary] = useState<string | null>(null);

  // Auto-audit Xero status once settlements are loaded
  const [hasAutoAudited, setHasAutoAudited] = useState(false);
  const [hasAutoExpanded, setHasAutoExpanded] = useState(false);

  useEffect(() => {
    if (hasLoadedOnce && settlements.length > 0 && !hasAutoAudited && !refreshingXero) {
      setHasAutoAudited(true);
      console.log(`[GenericDashboard] Auto-auditing Xero status for ${code} (${settlements.length} settlements)`);
      handleRefreshXero();
    }
  }, [hasLoadedOnce, settlements.length, hasAutoAudited, refreshingXero, handleRefreshXero, code]);

  // Auto-expand unpushed settlements so bookkeepers see detail before pushing
  useEffect(() => {
    if (hasLoadedOnce && settlements.length > 0 && !hasAutoExpanded) {
      setHasAutoExpanded(true);
      const unpushed = settlements.filter(s =>
        s.status === 'saved' || s.status === 'parsed' || s.status === 'ready_to_push'
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
      // Fetch accounting boundary
      const { data: boundaryRow } = await supabase
        .from('app_settings')
        .select('value')
        .eq('user_id', user.id)
        .eq('key', 'accounting_boundary_date')
        .maybeSingle();
      if (boundaryRow?.value) setAccountingBoundary(boundaryRow.value);
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


  // Filter settlements
  const filteredSettlements = settlements.filter(s => {
    if (settlementFilter === 'attention') return s.status === 'saved' || s.status === 'parsed' || s.status === 'push_failed' || s.status === 'push_failed_permanent';
    if (settlementFilter === 'synced') return ['synced', 'pushed_to_xero', 'synced_external', 'draft_in_xero', 'authorised_in_xero', 'reconciled_in_xero'].includes(s.status || '');
    return true;
  });

  const attentionCount = settlements.filter(s => s.status === 'saved' || s.status === 'parsed' || s.status === 'push_failed' || s.status === 'push_failed_permanent').length;
  const syncedCount = settlements.filter(s => ['synced', 'pushed_to_xero', 'synced_external', 'draft_in_xero', 'authorised_in_xero', 'reconciled_in_xero'].includes(s.status || '')).length;

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
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            View saved settlements, reconcile, and sync to Xero.
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
          <FileReconciliationStatus settlements={settlements} />
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
                All ({settlements.length})
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
                        for (const s of failed) {
                          await supabase.from('settlements').update({ status: 'ready_to_push', push_retry_count: 0 }).eq('id', s.id);
                        }
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
                {settlements.some(s => s.status === 'saved' || s.status === 'parsed') && (
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
                <div className="hidden sm:grid sm:grid-cols-[auto_1fr_80px_80px_120px_auto] gap-2 px-3 py-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider border-b border-border">
                  <div className="w-5" />
                  <div>Settlement</div>
                  <div className="text-center">Xero</div>
                  <div className="text-center">Bank</div>
                  <div className="text-center">Status</div>
                  <div className="text-right">Actions</div>
                </div>

                <div className="space-y-0">
                  {filteredSettlements.map((s, idx) => {
                    const sales = s.sales_principal || 0;
                    const fees = s.seller_fees || 0;
                    const net = s.bank_deposit || 0;
                    const isSelected = selected.has(s.id);
                    const isSyncable = s.status === 'saved' || s.status === 'parsed' || s.status === 'ready_to_push';
                    const isPushFailed = s.status === 'push_failed';
                    const isSynced = ['synced', 'pushed_to_xero', 'synced_external', 'draft_in_xero', 'authorised_in_xero', 'reconciled_in_xero'].includes(s.status || '');
                    const isAlreadyRecorded = s.status === 'already_recorded';

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
                          isAlreadyRecorded ? 'opacity-40 bg-muted/20' :
                          isSynced ? 'bg-emerald-50/30 dark:bg-emerald-950/10' :
                          isPushFailed ? 'bg-red-50/30 dark:bg-red-950/10' :
                          'hover:bg-muted/20'
                        } ${isSelected ? 'bg-primary/5' : ''}`}>
                          <div className="p-2.5 sm:grid sm:grid-cols-[auto_1fr_80px_80px_120px_auto] gap-2 items-center">
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
                                  {s.marketplace.startsWith('shopify_orders_') && (
                                    <Badge variant="outline" className="text-[9px] text-muted-foreground">from Orders CSV</Badge>
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

                            {/* Status badge */}
                            <div className="flex justify-center">
                              <SettlementStatusBadge
                                status={s.status}
                                xeroInvoiceNumber={s.xero_invoice_number}
                                xeroType={(s as any).xero_type}
                                xeroStatus={s.xero_status}
                              />
                            </div>

                            {/* Actions */}
                            <div className="flex items-center gap-1 justify-end">
                              {/* Push to Xero */}
                              {isSyncable && !isAlreadyRecorded && (
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
                                        <span className="font-semibold text-amber-600 dark:text-amber-400">−{formatAUD(feesTotal)}</span>
                                      </div>
                                      {refundsTotal > 0 && (
                                        <div className="text-xs">
                                          <span className="text-muted-foreground">Refunds: </span>
                                          <span className="font-semibold text-destructive">−{formatAUD(refundsTotal)}</span>
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
                                    {isSyncable && !isAlreadyRecorded && (
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
                                                  isRefund ? 'text-destructive' :
                                                  isFee ? 'text-amber-600 dark:text-amber-400' :
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
              </CardContent>
            </Card>
          </div>
        )}
      </div>

      {/* Upload prompt — below data, not blocking view */}
      {onSwitchToUpload && (
        <>
          <Separator />
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
    </div>
  );
}
