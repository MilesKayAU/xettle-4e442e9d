import React, { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Trash2, Loader2, FileText, Upload, ArrowRight, Send, SkipForward,
  CheckSquare, Square, Eye, ShieldCheck, ShieldAlert,
  Download, RefreshCw, AlertTriangle, CheckCircle2, ChevronDown
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { MARKETPLACE_CATALOG, type UserMarketplace } from './MarketplaceSwitcher';
import { formatSettlementDate, formatAUD } from '@/utils/settlement-engine';
import XeroConnectionStatus from '@/components/admin/XeroConnectionStatus';
import MarketplaceAlertsBanner from '@/components/MarketplaceAlertsBanner';

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

export default function GenericMarketplaceDashboard({ marketplace, onMarketplacesChanged, onSwitchToUpload }: GenericMarketplaceDashboardProps) {
  const def = MARKETPLACE_CATALOG.find(m => m.code === marketplace.marketplace_code);
  const code = marketplace.marketplace_code;

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


  const marketplaceName = def?.name || marketplace.marketplace_name;

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
          <XeroConnectionStatus />
        </div>
      </div>

      {/* Upload prompt — directs to Smart Upload */}
      {onSwitchToUpload && (
        <Card className="border-dashed border-2 border-primary/20 hover:border-primary/40 transition-colors cursor-pointer" onClick={onSwitchToUpload}>
          <CardContent className="py-5 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Upload className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  Upload {marketplaceName} files
                </p>
                <p className="text-xs text-muted-foreground">
                  Use Smart Upload to drop files — auto-detects, previews, and saves
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="gap-2">
              <Upload className="h-4 w-4" />
              Smart Upload
              <ArrowRight className="h-3 w-3" />
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Settlement History */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
          <FileText className="h-4 w-4" />
          Saved Settlements
          {settlements.length > 0 && (
            <Badge variant="secondary" className="text-[10px]">{settlements.length}</Badge>
          )}
        </h4>

        {loading ? (
          <Card className="border-border">
            <CardContent className="py-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading settlements…
            </CardContent>
          </Card>
        ) : settlements.length === 0 && !hasLoadedOnce ? (
          /* Tab just created — uploads are still being processed */
          <Card className="border-border">
            <CardContent className="py-8 text-center">
              <Loader2 className="h-6 w-6 animate-spin text-primary mx-auto mb-3" />
              <p className="text-sm font-medium text-foreground">
                Processing uploads…
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Settlements are being parsed and saved — they'll appear here automatically.
              </p>
            </CardContent>
          </Card>
        ) : settlements.length === 0 ? (
          /* Loaded but genuinely empty */
          <Card className="border-border">
            <CardContent className="py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No settlements saved yet.
              </p>
              {onSwitchToUpload && (
                <Button variant="link" size="sm" onClick={onSwitchToUpload} className="mt-2 gap-1">
                  <Upload className="h-3.5 w-3.5" />
                  Upload files via Smart Upload
                </Button>
              )}
            </CardContent>
          </Card>
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
                {settlements.some(s => s.status === 'saved' || s.status === 'parsed') && (
                  <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleBulkMarkSynced}>
                    <SkipForward className="h-3.5 w-3.5 mr-1" />
                    Mark All as Already in Xero
                  </Button>
                )}
              </div>
            </div>

            {settlements.map((s, idx) => {
              const sales = s.sales_principal || 0;
              const fees = s.seller_fees || 0;
              const net = s.bank_deposit || 0;
              const gstIncome = s.gst_on_income || 0;
              const isSelected = selected.has(s.id);
              const isSyncable = s.status === 'saved' || s.status === 'parsed';
              const isPushFailed = s.status === 'push_failed';
              const isSynced = s.status === 'synced' || s.status === 'pushed_to_xero';

              // Gap detection — allow tolerance for daily-payout marketplaces like Shopify
              const prev = settlements[idx + 1];
              let hasGap = false;
              if (prev && s.period_start > prev.period_end) {
                const gapMs = new Date(s.period_start).getTime() - new Date(prev.period_end).getTime();
                const gapDays = gapMs / (1000 * 60 * 60 * 24);
                // Shopify payouts are daily — gaps up to 4 days (weekends/holidays) are normal
                const isShopify = (s.marketplace || '').toLowerCase().includes('shopify');
                const tolerance = isShopify ? 4 : 1;
                hasGap = gapDays > tolerance;
              }

              return (
                <React.Fragment key={s.id}>
                  {hasGap && (
                    <div className="flex items-center gap-2 py-1 px-3">
                      <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
                      <p className="text-xs text-muted-foreground">
                        Gap: missing settlement between {formatSettlementDate(prev.period_end)} and {formatSettlementDate(s.period_start)}
                      </p>
                    </div>
                  )}
                  <Card className={`border-border hover:border-primary/20 transition-colors ${isSelected ? 'border-primary/40 bg-primary/5' : ''}`}>
                    <CardContent className="py-3 px-4">
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3 flex-1 min-w-0">
                          <button
                            onClick={() => toggleSelect(s.id)}
                            className="text-muted-foreground hover:text-foreground transition-colors flex-shrink-0"
                          >
                            {isSelected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
                          </button>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-semibold text-foreground">
                                {formatSettlementDate(s.period_start)} – {formatSettlementDate(s.period_end)}
                              </span>
                              {statusBadge(s)}
                              {s.marketplace.startsWith('shopify_orders_') && (
                                <Badge variant="outline" className="text-[9px] text-muted-foreground">from Orders CSV</Badge>
                              )}
                            </div>
                            <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                              ID: {s.settlement_id}
                              {s.xero_invoice_number && s.xero_status && (
                                <span className="ml-2 text-primary">{s.xero_invoice_number} · {s.xero_status}</span>
                              )}
                            </p>
                            <div className="flex gap-4 mt-1.5 text-xs text-muted-foreground">
                              <span>Sales: <span className="font-medium text-foreground">{formatAUD(sales)}</span></span>
                              <span>Fees: <span className="font-medium text-foreground">{formatAUD(fees)}</span></span>
                              {gstIncome > 0 && <span>GST: <span className="font-medium text-foreground">{formatAUD(gstIncome)}</span></span>}
                              <span>Net: <span className="font-semibold text-primary">{formatAUD(net)}</span></span>
                            </div>
                            {/* Bank verification status */}
                            {s.bank_verified ? (
                              <p className="text-[10px] text-green-600 dark:text-green-400 mt-1 flex items-center gap-1">
                                <ShieldCheck className="h-3 w-3" />
                                Bank verified {formatAUD(s.bank_verified_amount || 0)} — {s.bank_verified_at ? new Date(s.bank_verified_at).toLocaleDateString('en-AU') : ''}
                              </p>
                            ) : isSyncable ? (
                              <p className="text-[10px] text-amber-500 mt-1 flex items-center gap-1">
                                <ShieldAlert className="h-3 w-3" />
                                Bank not verified
                              </p>
                            ) : null}
                            {/* Inline reconciliation toggle */}
                            <button
                              onClick={() => toggleReconCheck(s)}
                              className="text-[10px] text-muted-foreground hover:text-foreground mt-1 flex items-center gap-1 cursor-pointer"
                            >
                              {expandedRecon === s.settlement_id ? <ChevronDown className="h-3 w-3" /> : <CheckCircle2 className="h-3 w-3" />}
                              {reconResults[s.settlement_id]
                                ? `Recon: ${reconResults[s.settlement_id].overallStatus === 'pass' ? '✅ Pass' : reconResults[s.settlement_id].overallStatus === 'warn' ? '⚠️ Warnings' : '❌ Fail'}`
                                : 'Run recon checks'
                              }
                            </button>
                            {/* Inline reconciliation results */}
                            {expandedRecon === s.settlement_id && reconResults[s.settlement_id] && (
                              <div className="mt-1.5 space-y-1 bg-muted/30 rounded-md px-3 py-2">
                                {reconResults[s.settlement_id].checks.map((check) => (
                                  <div key={check.id} className="flex items-center gap-2 text-[10px]">
                                    <span>
                                      {check.status === 'pass' ? '✅' : check.status === 'warn' ? '⚠️' : '❌'}
                                    </span>
                                    <span className="font-medium text-foreground">{check.label}</span>
                                    <span className="text-muted-foreground">— {check.detail}</span>
                                  </div>
                                ))}
                                {!reconResults[s.settlement_id].canSync && (
                                  <p className="text-[10px] font-medium text-destructive mt-1">⛔ Xero push blocked — resolve critical issues first</p>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {/* Push to Xero — Ready state */}
                          {isSyncable && (
                            <>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant={verifyingId === s.id || s.bank_verified ? 'default' : 'outline'}
                                      onClick={() => {
                                        // Duplicate prevention: warn if already has xero_journal_id
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
                                      <Send className="h-3.5 w-3.5 mr-1" />
                                      Push to Xero
                                    </Button>
                                  </TooltipTrigger>
                                  {!s.bank_verified && verifyingId !== s.id && (
                                    <TooltipContent>
                                      <p className="text-xs">Bank amount not verified — we recommend checking your bank statement before pushing</p>
                                    </TooltipContent>
                                  )}
                                </Tooltip>
                              </TooltipProvider>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleMarkAlreadySynced(s.settlement_id)}
                              >
                                <SkipForward className="h-3.5 w-3.5 mr-1" />
                                Already in Xero
                              </Button>
                            </>
                          )}
                          {/* Retry — Push failed state */}
                          {isPushFailed && (
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-amber-600 border-amber-300 hover:bg-amber-50 dark:hover:bg-amber-950/20"
                              disabled={pushing === s.id}
                              onClick={async () => {
                                // Reset status and retry
                                await supabase
                                  .from('settlements')
                                  .update({ status: 'saved', xero_journal_id: null } as any)
                                  .eq('id', s.id);
                                loadSettlements();
                                toast.info('Status reset — you can now retry pushing to Xero');
                              }}
                            >
                              {pushing === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <AlertTriangle className="h-3.5 w-3.5 mr-1" />}
                              ⚠️ Retry Push
                            </Button>
                          )}
                          {/* Synced state — show green badge + rollback */}
                          {isSynced && (
                            <>
                              <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">
                                ✅ {s.xero_invoice_number || 'Pushed'}
                              </Badge>
                              {s.xero_journal_id && (
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
                            </>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                            disabled={deleting === s.id}
                            onClick={() => handleDelete(s)}
                          >
                            {deleting === s.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </Button>
                          {/* Transaction drill-down button */}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
                            onClick={() => loadLineItems(s.settlement_id)}
                          >
                            {loadingLines === s.settlement_id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Eye className="h-3.5 w-3.5" />
                            )}
                          </Button>
                        </div>
                      </div>

                      {/* ── Transaction drill-down ── */}
                      {expandedLines === s.settlement_id && (
                        <div className="mt-3 pt-3 border-t border-border">
                          {lineItems[s.settlement_id] && lineItems[s.settlement_id].length > 0 ? (() => {
                            const lines = lineItems[s.settlement_id];
                            const PAGE_SIZE = 25;
                            const totalLines = lines.length;
                            const totalAmount = lines.reduce((sum: number, l: any) => sum + (l.amount || 0), 0);

                            const getRowBg = (line: any) => {
                              const type = (line.transaction_type || line.amount_type || '').toLowerCase();
                              if (type.includes('refund') || type === 'refund') return 'bg-red-50 dark:bg-red-950/20';
                              if (type.includes('fee') || type === 'fee') return 'bg-amber-50 dark:bg-amber-950/20';
                              if (type.includes('adjustment') || type === 'adjustment') return 'bg-blue-50 dark:bg-blue-950/10';
                              return '';
                            };

                            const exportCSV = () => {
                              const csvHeader = 'Date,Order ID,SKU,Detail,Amount,Type\n';
                              const csvRows = lines.map((l: any) =>
                                `"${l.posted_date || ''}","${l.order_id || ''}","${l.sku || ''}","${(l.amount_description || '').replace(/"/g, '""')}",${l.amount || 0},"${l.transaction_type || l.amount_type || ''}"`
                              ).join('\n');
                              const blob = new Blob([csvHeader + csvRows], { type: 'text/csv' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url;
                              a.download = `${s.settlement_id}-transactions.csv`;
                              a.click();
                              URL.revokeObjectURL(url);
                            };

                            return (
                              <>
                                <div className="flex items-center justify-between mb-2">
                                  <p className="text-[10px] text-muted-foreground font-medium">
                                    {totalLines} transaction{totalLines !== 1 ? 's' : ''} — source: {s.marketplace.startsWith('shopify_orders_') ? 'Shopify Orders CSV' : 'Settlement file'}
                                  </p>
                                  <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] gap-1" onClick={exportCSV}>
                                    <Download className="h-3 w-3" /> Export CSV
                                  </Button>
                                </div>
                                <div className="overflow-auto max-h-72 rounded-lg border border-border">
                                  <Table>
                                    <TableHeader>
                                      <TableRow>
                                        <TableHead className="text-[10px]">Date</TableHead>
                                        <TableHead className="text-[10px]">Order</TableHead>
                                        <TableHead className="text-[10px]">SKU / Detail</TableHead>
                                        <TableHead className="text-[10px] text-right">Amount</TableHead>
                                        <TableHead className="text-[10px]">Type</TableHead>
                                      </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                      {lines.map((line: any, lIdx: number) => (
                                        <TableRow key={lIdx} className={getRowBg(line)}>
                                          <TableCell className="text-[10px] text-muted-foreground py-1">{line.posted_date || '—'}</TableCell>
                                          <TableCell className="text-[10px] font-mono py-1">{line.order_id || '—'}</TableCell>
                                          <TableCell className="text-[10px] text-muted-foreground py-1 max-w-[200px] truncate">{line.amount_description || line.sku || '—'}</TableCell>
                                          <TableCell className="text-[10px] text-right font-medium py-1">{formatAUD(line.amount || 0)}</TableCell>
                                          <TableCell className="text-[10px] text-muted-foreground py-1">{line.transaction_type || line.amount_type || '—'}</TableCell>
                                        </TableRow>
                                      ))}
                                      {/* Totals row */}
                                      <TableRow className="border-t-2 border-border bg-muted/30 font-semibold">
                                        <TableCell className="text-[10px] py-1.5" colSpan={3}>
                                          Totals ({totalLines} rows)
                                        </TableCell>
                                        <TableCell className="text-[10px] text-right py-1.5 font-bold">{formatAUD(totalAmount)}</TableCell>
                                        <TableCell className="text-[10px] py-1.5" />
                                      </TableRow>
                                    </TableBody>
                                  </Table>
                                </div>
                                {/* Reconciliation footer */}
                                <div className="mt-2 flex items-center justify-between">
                                  <p className="text-[10px] text-muted-foreground">
                                    Net total: <span className="font-semibold text-foreground">{formatAUD(totalAmount)}</span>
                                    {Math.abs(totalAmount - net) <= 0.05 ? (
                                      <span className="text-green-600 dark:text-green-400 ml-2">✅ Matches settlement</span>
                                    ) : (
                                      <span className="text-amber-500 ml-2">⚠️ Difference of {formatAUD(Math.abs(totalAmount - net))}</span>
                                    )}
                                  </p>
                                </div>
                              </>
                            );
                          })() : lineItems[s.settlement_id] ? (
                            <div className="py-4 px-3 text-center space-y-3">
                              <p className="text-xs text-muted-foreground">
                                📋 Transaction detail not available for this settlement — it was uploaded before detailed tracking was enabled.
                              </p>
                              <div className="bg-muted/30 rounded-lg px-4 py-3 inline-block text-left">
                                <p className="text-[10px] text-muted-foreground mb-1 font-medium">Settlement summary:</p>
                                <div className="flex gap-4 text-xs">
                                  <span>Sales: <span className="font-medium text-foreground">{formatAUD(sales)}</span></span>
                                  <span>Fees: <span className="font-medium text-foreground">{formatAUD(fees)}</span></span>
                                  <span>Net: <span className="font-semibold text-primary">{formatAUD(net)}</span></span>
                                </div>
                              </div>
                              <p className="text-[10px] text-muted-foreground">
                                To see full detail, re-upload this settlement file via Smart Upload.
                              </p>
                              {onSwitchToUpload && (
                                <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={onSwitchToUpload}>
                                  <RefreshCw className="h-3 w-3" /> Re-upload settlement file
                                </Button>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 py-3 justify-center text-xs text-muted-foreground">
                              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading transactions…
                            </div>
                          )}
                        </div>
                      )}

                      {/* ── Bank Verification Panel ── */}
                      {verifyingId === s.id && isSyncable && (() => {
                        const enteredAmount = parseFloat(bankAmountInput);
                        const isValidInput = !isNaN(enteredAmount) && bankAmountInput.trim() !== '';
                        const diff = isValidInput ? Math.abs(enteredAmount - net) : 0;
                        const isMatch = isValidInput && diff <= 0.05;
                        const isMismatch = isValidInput && diff > 0.05;

                        return (
                          <div className="mt-3 pt-3 border-t border-border space-y-3">
                            <div className="flex items-center gap-2">
                              <ShieldCheck className="h-4 w-4 text-primary" />
                              <span className="text-sm font-semibold text-foreground">Verify bank deposit</span>
                            </div>
                            <div className="text-xs text-muted-foreground space-y-1">
                              <p>Reference: <span className="font-mono font-medium text-foreground">{s.settlement_id}</span></p>
                              {s.period_end && <p>Period: {formatSettlementDate(s.period_start)} – {formatSettlementDate(s.period_end)}</p>}
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
                              <div className="flex items-center gap-2 bg-green-50 dark:bg-green-950/20 rounded-md px-3 py-2">
                                <CheckCircle2 className="h-4 w-4 text-green-600" />
                                <span className="text-xs font-medium text-green-700 dark:text-green-400">Amounts match — safe to push</span>
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
                    </CardContent>
                  </Card>
                </React.Fragment>
              );
            })}
          </div>
        )}
      </div>

      {/* Xero-aware bulk delete confirmation dialog */}
      <AlertDialog open={bulkDeleteDialogOpen} onOpenChange={setBulkDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {selected.size} settlement{selected.size !== 1 ? 's' : ''}?</AlertDialogTitle>
            <AlertDialogDescription>
              {(() => {
                const syncedCount = settlements.filter(s => selected.has(s.id) && (s.status === 'synced' || s.status === 'pushed_to_xero' || s.xero_journal_id)).length;
                return syncedCount > 0
                  ? `⚠️ ${syncedCount} of ${selected.size} selected settlement${selected.size !== 1 ? 's are' : ' is'} already in Xero. Deleting them here will NOT void them in Xero — you'll need to void those invoices manually.`
                  : `This will permanently delete ${selected.size} settlement${selected.size !== 1 ? 's' : ''} and their transaction lines.`;
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setBulkDeleteDialogOpen(false);
                // Force-run the delete (dialog already confirmed)
                (async () => {
                  setBulkDeleting(true);
                  let deleted = 0;
                  for (const id of selected) {
                    const result = await deleteSettlement(id);
                    if (result.success) deleted++;
                  }
                  setSelected(new Set());
                  setBulkDeleting(false);
                  toast.success(`Deleted ${deleted} settlement${deleted !== 1 ? 's' : ''}`);
                  loadSettlements();
                })();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete {selected.size} Settlement{selected.size !== 1 ? 's' : ''}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
