import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Trash2, Loader2, FileText, Upload, ArrowRight, Send, SkipForward,
  CheckSquare, Square, CheckCircle2, AlertTriangle, Eye, ChevronDown, ShieldCheck, ShieldAlert
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { MARKETPLACE_CATALOG, type UserMarketplace } from './MarketplaceSwitcher';
import {
  syncSettlementToXero,
  deleteSettlement,
  formatSettlementDate,
  formatAUD,
  buildSimpleInvoiceLines,
  type StandardSettlement,
} from '@/utils/settlement-engine';
import { runUniversalReconciliation } from '@/utils/universal-reconciliation';
import XeroConnectionStatus from '@/components/admin/XeroConnectionStatus';
import MarketplaceAlertsBanner from '@/components/MarketplaceAlertsBanner';

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
  sales_shipping: number | null;
  bank_verified: boolean | null;
  bank_verified_amount: number | null;
  bank_verified_at: string | null;
  bank_verified_by: string | null;
}

function statusBadge(status: string | null) {
  switch (status) {
    case 'synced':
      return <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">Synced to Xero ✓</Badge>;
    case 'pushed_to_xero':
      return <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">Posted to Xero ✓</Badge>;
    case 'synced_external':
      return <Badge variant="outline" className="border-muted-foreground/40 text-[10px]">Already in Xero</Badge>;
    case 'saved':
    case 'parsed':
      return <Badge variant="secondary" className="text-[10px]">Saved</Badge>;
    case 'error':
      return <Badge variant="destructive" className="text-[10px]">Error</Badge>;
    default:
      return <Badge variant="outline" className="text-[10px]">{status || 'Saved'}</Badge>;
  }
}

export default function GenericMarketplaceDashboard({ marketplace, onMarketplacesChanged, onSwitchToUpload }: GenericMarketplaceDashboardProps) {
  const def = MARKETPLACE_CATALOG.find(m => m.code === marketplace.marketplace_code);
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasLoadedOnce, setHasLoadedOnce] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pushing, setPushing] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [expandedLines, setExpandedLines] = useState<string | null>(null);
  const [lineItems, setLineItems] = useState<Record<string, any[]>>({});
  const [loadingLines, setLoadingLines] = useState<string | null>(null);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [bankAmountInput, setBankAmountInput] = useState('');
  const [bankVerifyConfirmed, setBankVerifyConfirmed] = useState(false);

  const loadLineItems = useCallback(async (settlementId: string) => {
    if (lineItems[settlementId]) {
      setExpandedLines(expandedLines === settlementId ? null : settlementId);
      return;
    }
    setLoadingLines(settlementId);
    setExpandedLines(settlementId);
    try {
      const { data, error } = await supabase
        .from('settlement_lines')
        .select('order_id, sku, amount, amount_description, posted_date, transaction_type')
        .eq('settlement_id', settlementId)
        .order('posted_date', { ascending: true })
        .limit(200);
      if (error) throw error;
      setLineItems(prev => ({ ...prev, [settlementId]: data || [] }));
    } catch {
      toast.error('Failed to load transaction details');
    } finally {
      setLoadingLines(null);
    }
  }, [lineItems, expandedLines]);

  const loadSettlements = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true);
    try {
      const code = marketplace.marketplace_code;
      const shopifyOrdersCode = `shopify_orders_${code}`;
      const woolworthsCode = `woolworths_marketplus_${code}`;
      const { data, error } = await supabase
        .from('settlements')
        .select('id, settlement_id, marketplace, period_start, period_end, sales_principal, seller_fees, bank_deposit, status, created_at, gst_on_income, gst_on_expenses, refunds, reimbursements, other_fees, xero_journal_id, sales_shipping, bank_verified, bank_verified_amount, bank_verified_at, bank_verified_by')
        .or(`marketplace.eq.${code},marketplace.eq.${shopifyOrdersCode},marketplace.eq.${woolworthsCode}`)
        .order('period_end', { ascending: false });
      if (error) throw error;
      setSettlements((data || []) as SettlementRow[]);
      setHasLoadedOnce(true);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [marketplace.marketplace_code]);

  useEffect(() => {
    loadSettlements(true);
  }, [loadSettlements]);

  // Realtime: auto-refresh when settlements change
  useEffect(() => {
    const channel = supabase
      .channel(`settlements-${marketplace.marketplace_code}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements' }, () => {
        loadSettlements();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [loadSettlements, marketplace.marketplace_code]);

  // ─── Actions ────────────────────────────────────────────────────────────────

  const handleDelete = useCallback(async (settlement: SettlementRow) => {
    setDeleting(settlement.id);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      await supabase.from('settlement_lines').delete().eq('user_id', user.id).eq('settlement_id', settlement.settlement_id);
      await supabase.from('settlement_unmapped').delete().eq('user_id', user.id).eq('settlement_id', settlement.settlement_id);
      await supabase.from('settlements').delete().eq('id', settlement.id);

      toast.success(`Deleted settlement ${settlement.settlement_id}`);
      setSelected(prev => { const n = new Set(prev); n.delete(settlement.id); return n; });
      loadSettlements();
    } catch (err: any) {
      toast.error(`Failed to delete: ${err.message}`);
    } finally {
      setDeleting(null);
    }
  }, [loadSettlements]);

  const handleBulkDelete = useCallback(async () => {
    if (selected.size === 0) return;
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
  }, [selected, loadSettlements]);

  const handlePushToXero = useCallback(async (settlement: SettlementRow, bankAmount?: number) => {
    setPushing(settlement.id);
    try {
      // Build a StandardSettlement from the DB record for reconciliation check
      const stdSettlement: StandardSettlement = {
        marketplace: settlement.marketplace,
        settlement_id: settlement.settlement_id,
        period_start: settlement.period_start,
        period_end: settlement.period_end,
        sales_ex_gst: settlement.sales_principal || 0,
        gst_on_sales: settlement.gst_on_income || 0,
        fees_ex_gst: settlement.seller_fees || 0,
        gst_on_fees: settlement.gst_on_expenses || 0,
        net_payout: settlement.bank_deposit || 0,
        source: 'csv_upload',
        reconciles: true,
        metadata: {
          refundsExGst: settlement.refunds || 0,
          shippingExGst: settlement.sales_shipping || 0,
          subscriptionAmount: settlement.other_fees || 0,
          refundCommissionExGst: settlement.reimbursements || 0,
        },
      };

      // Run reconciliation check
      const reconResult = runUniversalReconciliation(stdSettlement);
      if (!reconResult.canSync) {
        toast.error('Critical reconciliation issues — resolve before syncing to Xero.');
        return;
      }
      if (reconResult.overallStatus === 'warn') {
        toast.warning('Reconciliation warnings exist — proceeding with sync.');
      }

      const lineItems = buildSimpleInvoiceLines(stdSettlement);
      const result = await syncSettlementToXero(settlement.settlement_id, settlement.marketplace, { lineItems });
      if (result.success) {
        // Save bank verification data
        const { data: { user } } = await supabase.auth.getUser();
        if (user && bankAmount !== undefined) {
          await supabase.from('settlements').update({
            bank_verified: true,
            bank_verified_amount: bankAmount,
            bank_verified_at: new Date().toISOString(),
            bank_verified_by: user.id,
          } as any).eq('id', settlement.id);
        }
        toast.success('Invoice created in Xero!');
        setVerifyingId(null);
        setBankAmountInput('');
        setBankVerifyConfirmed(false);
        loadSettlements();
      } else {
        toast.error(result.error || 'Failed to push to Xero');
      }
    } catch (err: any) {
      toast.error(`Xero sync failed: ${err.message}`);
    } finally {
      setPushing(null);
    }
  }, [loadSettlements]);

  const handleMarkAlreadySynced = useCallback(async (settlementId: string) => {
    const { error } = await supabase
      .from('settlements')
      .update({ status: 'synced_external' })
      .eq('settlement_id', settlementId);
    if (error) {
      toast.error('Failed to update status');
    } else {
      toast.success('Marked as Already in Xero');
      loadSettlements();
    }
  }, [loadSettlements]);

  const handleBulkMarkSynced = useCallback(async () => {
    const unsyncedIds = settlements
      .filter(s => s.status === 'saved' || s.status === 'parsed')
      .map(s => s.settlement_id);
    if (unsyncedIds.length === 0) {
      toast.info('No unsynced settlements to mark');
      return;
    }
    const { error } = await supabase
      .from('settlements')
      .update({ status: 'synced_external' })
      .in('settlement_id', unsyncedIds);
    if (error) {
      toast.error('Failed to update statuses');
    } else {
      toast.success(`Marked ${unsyncedIds.length} settlements as Already in Xero`);
      loadSettlements();
    }
  }, [settlements, loadSettlements]);

  // ─── Selection ──────────────────────────────────────────────────────────────

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === settlements.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(settlements.map(s => s.id)));
    }
  };

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
        <XeroConnectionStatus />
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
                              {statusBadge(s.status)}
                              {s.marketplace.startsWith('shopify_orders_') && (
                                <Badge variant="outline" className="text-[9px] text-muted-foreground">from Orders CSV</Badge>
                              )}
                            </div>
                            <p className="text-[10px] text-muted-foreground font-mono mt-0.5">
                              ID: {s.settlement_id}
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
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {isSyncable && (
                            <>
                              <TooltipProvider>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="sm"
                                      variant={verifyingId === s.id || s.bank_verified ? 'default' : 'outline'}
                                      onClick={() => {
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
                          {lineItems[s.settlement_id] && lineItems[s.settlement_id].length > 0 ? (
                            <>
                              <p className="text-[10px] text-muted-foreground mb-2 font-medium">
                                {lineItems[s.settlement_id].length} transaction{lineItems[s.settlement_id].length !== 1 ? 's' : ''} — source: {s.marketplace.startsWith('shopify_orders_') ? 'Shopify Orders CSV' : 'Direct settlement'}
                              </p>
                              <div className="overflow-auto max-h-60 rounded-lg border border-border">
                                <Table>
                                  <TableHeader>
                                    <TableRow>
                                      <TableHead className="text-[10px]">Date</TableHead>
                                      <TableHead className="text-[10px]">Order</TableHead>
                                      <TableHead className="text-[10px]">SKU / Detail</TableHead>
                                      <TableHead className="text-[10px] text-right">Amount</TableHead>
                                    </TableRow>
                                  </TableHeader>
                                  <TableBody>
                                    {lineItems[s.settlement_id].map((line: any, lIdx: number) => (
                                      <TableRow key={lIdx}>
                                        <TableCell className="text-[10px] text-muted-foreground py-1">{line.posted_date || '—'}</TableCell>
                                        <TableCell className="text-[10px] font-mono py-1">{line.order_id || '—'}</TableCell>
                                        <TableCell className="text-[10px] text-muted-foreground py-1">{line.amount_description || line.sku || '—'}</TableCell>
                                        <TableCell className="text-[10px] text-right font-medium py-1">{formatAUD(line.amount || 0)}</TableCell>
                                      </TableRow>
                                    ))}
                                  </TableBody>
                                </Table>
                              </div>
                              <p className="text-[10px] text-muted-foreground mt-1.5">
                                Total: <span className="font-semibold text-foreground">{formatAUD(lineItems[s.settlement_id].reduce((sum: number, l: any) => sum + (l.amount || 0), 0))}</span>
                                {' · '}ex GST: <span className="font-medium">{formatAUD(sales)}</span>
                              </p>
                            </>
                          ) : lineItems[s.settlement_id] ? (
                            <p className="text-xs text-muted-foreground py-2 text-center">
                              No transaction detail available for this settlement.
                            </p>
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
    </div>
  );
}
