import React, { useState, useCallback, useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { DollarSign, CheckCircle2, XCircle, AlertTriangle, FileText, History, Clock, ArrowRight, Download, MoreHorizontal, Undo2, ExternalLink, Trash2, CheckSquare, RefreshCw, Loader2, Eye, Scissors } from "lucide-react";
import { formatDisplayDate, formatAUD, round2, type ParsedSettlement } from '@/utils/settlement-parser';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { useBulkSelect } from '@/hooks/use-bulk-select';
import { useXeroSync } from '@/hooks/use-xero-sync';
import { useTransactionDrilldown } from '@/hooks/use-transaction-drilldown';
import { deleteSettlement } from '@/utils/settlement-engine';
import TablePaginationBar, { DEFAULT_PAGE_SIZE } from '@/components/shared/TablePaginationBar';
import BulkDeleteDialog from '@/components/admin/accounting/shared/BulkDeleteDialog';
import SafeRepostModal from '@/components/admin/accounting/SafeRepostModal';

export interface SettlementRecord {
  id: string;
  settlement_id: string;
  marketplace: string;
  period_start: string;
  period_end: string;
  deposit_date: string;
  bank_deposit: number;
  status: string;
  sales_principal: number;
  sales_shipping: number;
  promotional_discounts: number;
  seller_fees: number;
  fba_fees: number;
  storage_fees: number;
  refunds: number;
  reimbursements: number;
  other_fees: number;
  net_ex_gst: number;
  gst_on_income: number;
  gst_on_expenses: number;
  reconciliation_status: string;
  xero_journal_id: string | null;
  xero_invoice_number: string | null;
  xero_status: string | null;
  created_at: string;
  is_split_month?: boolean;
  split_month_1_data?: string | null;
  split_month_2_data?: string | null;
  xero_journal_id_1?: string | null;
  xero_journal_id_2?: string | null;
}

type SortField = 'period' | 'deposit' | 'status' | 'seq';
type SortDir = 'asc' | 'desc';

export default function SettlementHistory({ settlements, loading, onDeleted, onReview, onPushToXero }: { settlements: SettlementRecord[]; loading: boolean; onDeleted: () => void; onReview?: (settlementId: string, settlementUuid: string) => void; onPushToXero?: (settlementId: string, settlementUuid: string) => void }) {
  const { expandedLines: expandedId, loadLineItems: toggleExpand } = useTransactionDrilldown();
  const [sortField, setSortField] = useState<SortField>('period');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const {
    selected: selectedIds,
    toggleSelect,
    toggleSelectAll: toggleAll,
    bulkDeleting: deleting,
    bulkDeleteDialogOpen,
    syncedSelectedCount,
    handleBulkDelete,
    confirmBulkDelete,
    cancelBulkDelete,
  } = useBulkSelect({ settlements: settlements as any, onComplete: onDeleted });
  const [rollingBack, setRollingBack] = useState<string | null>(null);
  const [rollbackConfirm, setRollbackConfirm] = useState<{ settlement: SettlementRecord; scope: 'all' | 'journal_1' | 'journal_2' } | null>(null);
  const [repostTarget, setRepostTarget] = useState<SettlementRecord | null>(null);

  const {
    handleMarkAlreadySynced: xeroMarkSynced,
    handleBulkMarkSynced: xeroBulkMarkSynced,
  } = useXeroSync({ loadSettlements: onDeleted });

  const handleRollback = async (settlement: SettlementRecord, scope: 'all' | 'journal_1' | 'journal_2' = 'all') => {
    let journalIds: string[] = [];
    if (scope === 'all') {
      journalIds = [settlement.xero_journal_id, settlement.xero_journal_id_1, settlement.xero_journal_id_2].filter(Boolean) as string[];
    } else if (scope === 'journal_1' && settlement.xero_journal_id_1) {
      journalIds = [settlement.xero_journal_id_1];
    } else if (scope === 'journal_2' && settlement.xero_journal_id_2) {
      journalIds = [settlement.xero_journal_id_2];
    }
    if (journalIds.length === 0) {
      toast.error('No Xero journal to rollback');
      return;
    }
    setRollingBack(settlement.id);
    setRollbackConfirm(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data, error } = await supabase.functions.invoke('sync-amazon-journal', {
        body: { action: 'rollback', userId: user.id, settlementId: settlement.settlement_id, journalIds, rollbackScope: scope },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const scopeLabel = scope === 'all' ? '' : scope === 'journal_1' ? ' (Journal 1)' : ' (Journal 2)';
      toast.success(`Rolled back Xero journal${scopeLabel} for ${settlement.settlement_id}`);
      onDeleted();
    } catch (err: any) {
      toast.error(`Rollback failed: ${err.message}`);
    } finally {
      setRollingBack(null);
    }
  };

  const handleDownloadAuditData = async (settlement: SettlementRecord) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const { data: lines, error: linesErr } = await supabase
        .from('settlement_lines')
        .select('*')
        .eq('settlement_id', settlement.settlement_id)
        .eq('user_id', user.id)
        .order('posted_date', { ascending: true });
      if (linesErr) throw linesErr;
      const { data: unmapped, error: unmappedErr } = await supabase
        .from('settlement_unmapped')
        .select('*')
        .eq('settlement_id', settlement.settlement_id)
        .eq('user_id', user.id);
      if (unmappedErr) throw unmappedErr;
      const headers = ['Type', 'Transaction Type', 'Amount Type', 'Amount Description', 'Accounting Category', 'Amount', 'Order ID', 'SKU', 'Marketplace', 'Posted Date'];
      const rows = [
        headers,
        ...(lines || []).map((l: any) => [
          'Mapped', l.transaction_type || '', l.amount_type || '', l.amount_description || '',
          l.accounting_category || '', String(l.amount || 0), l.order_id || '', l.sku || '',
          l.marketplace_name || '', l.posted_date || ''
        ]),
        ...(unmapped || []).map((u: any) => [
          'UNMAPPED', u.transaction_type || '', u.amount_type || '', u.amount_description || '',
          '', String(u.amount || 0), '', '', '', ''
        ]),
      ];
      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `settlement-${settlement.settlement_id}-audit.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`Downloaded audit data (${(lines?.length || 0) + (unmapped?.length || 0)} rows)`);
    } catch (err: any) {
      toast.error(`Failed to download audit data: ${err.message}`);
    }
  };

  const handleDownloadEntry = (settlement: SettlementRecord) => {
    const rows = [
      ['Description', 'Account Code', 'Net Amount', 'Tax', 'Gross'],
      ['Sales - Principal', '200', String(settlement.sales_principal || 0), '', ''],
      ['Sales - Shipping', '200', String(settlement.sales_shipping || 0), '', ''],
      ['Promotional Discounts', '200', String(settlement.promotional_discounts || 0), '', ''],
      ['Seller Fees', '407', String(settlement.seller_fees || 0), '', ''],
      ['FBA Fees', '408', String(settlement.fba_fees || 0), '', ''],
      ['Storage Fees', '409', String(settlement.storage_fees || 0), '', ''],
      ['Refunds', '200', String(settlement.refunds || 0), '', ''],
      ['Reimbursements', '200', String(settlement.reimbursements || 0), '', ''],
      ['GST on Income', '', String(settlement.gst_on_income || 0), '', ''],
      ['GST on Expenses', '', String(settlement.gst_on_expenses || 0), '', ''],
      ['Bank Deposit', '801', String(settlement.bank_deposit || 0), '', ''],
    ];
    const csv = rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `settlement-${settlement.settlement_id}-entry.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDeleteOne = async (settlement: SettlementRecord) => {
    const result = await deleteSettlement(settlement.id);
    if (result.success) {
      toast.success(`Deleted settlement ${settlement.settlement_id}`);
      onDeleted();
    } else {
      toast.error(`Delete failed: ${result.error}`);
    }
  };

  const getXeroDeepLink = (invoiceId: string) => {
    return `https://go.xero.com/AccountsReceivable/View.aspx?InvoiceID=${invoiceId}`;
  };

  const handleMarkSyncedOne = (settlement: SettlementRecord) => xeroMarkSynced(settlement.settlement_id);

  const handleMarkSyncedBulk = () => {
    const selected = settlements.filter(s => selectedIds.has(s.id));
    xeroBulkMarkSynced(selected as any);
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <Clock className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2 animate-pulse" />
          <p className="text-muted-foreground text-sm">Loading settlements…</p>
        </CardContent>
      </Card>
    );
  }

  if (settlements.length === 0) {
    return (
      <Card>
        <CardContent className="py-12 text-center">
          <History className="h-12 w-12 text-muted-foreground/40 mx-auto mb-3" />
          <p className="text-muted-foreground">No settlements uploaded yet. Upload your first settlement to begin.</p>
        </CardContent>
      </Card>
    );
  }

  const statusBadge = (status: string, xeroStatus?: string | null) => {
    const xs = (xeroStatus || '').toUpperCase();
    switch (status) {
      case 'pushed_to_xero':
      case 'synced':
        if (xs === 'DRAFT') return <Badge className="bg-orange-100 text-orange-700 border-orange-200 text-[10px]">In Xero — Draft</Badge>;
        if (xs === 'AUTHORISED') return <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">In Xero — Awaiting Payment</Badge>;
        if (xs === 'PAID') return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-[10px]">Fully Reconciled ✓</Badge>;
        return <Badge className="bg-emerald-600 text-white border-emerald-600 text-[10px]">Posted ✓</Badge>;
      case 'synced_external': return <Badge variant="outline" className="border-muted-foreground/40 text-[10px]">Already in Xero (legacy)</Badge>;
      case 'ready_to_push': return <Badge className="bg-amber-100 text-amber-700 border-amber-200 text-[10px]">Ready for Xero</Badge>;
      case 'already_recorded': return <Badge variant="secondary" className="text-[10px] text-muted-foreground">Pre-accounting boundary</Badge>;
      case 'mapping_error': return <Badge variant="destructive" className="text-[10px]">Mapping Error</Badge>;
      case 'voided': return <Badge variant="destructive" className="text-[10px]">Voided</Badge>;
      case 'saved': return <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-[10px]">Saved</Badge>;
      case 'pending': return <Badge variant="outline" className="text-[10px] text-muted-foreground">Unsaved</Badge>;
      case 'reconciliation_failed': return <Badge variant="destructive" className="text-[10px]">Recon Failed</Badge>;
      default: return <Badge variant="outline" className="text-[10px]">{status}</Badge>;
    }
  };

  const toggleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDir(field === 'period' ? 'desc' : 'asc');
    }
  };

  const SortIcon = ({ field }: { field: SortField }) => (
    <span className={`inline-block ml-1 text-[10px] ${sortField === field ? 'text-primary' : 'text-muted-foreground/40'}`}>
      {sortField === field ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
    </span>
  );

  const seqSorted = [...settlements].sort((a, b) => a.period_end.localeCompare(b.period_end));
  const seqMap = new Map<string, number>();
  seqSorted.forEach((s, i) => seqMap.set(s.id, i + 1));

  const sortedSettlements = [...settlements].sort((a, b) => {
    let cmp = 0;
    switch (sortField) {
      case 'period': cmp = a.period_start.localeCompare(b.period_start); break;
      case 'deposit': cmp = (a.bank_deposit || 0) - (b.bank_deposit || 0); break;
      case 'status': cmp = (a.status || '').localeCompare(b.status || ''); break;
      case 'seq': cmp = (seqMap.get(a.id) || 0) - (seqMap.get(b.id) || 0); break;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  type DisplayRow =
    | { type: 'settlement'; settlement: SettlementRecord; seq: number }
    | { type: 'gap'; afterDate: string; beforeDate: string };

  const displayRows: DisplayRow[] = [];
  for (let i = 0; i < sortedSettlements.length; i++) {
    const s = sortedSettlements[i];
    const seq = seqMap.get(s.id) || 0;
    displayRows.push({ type: 'settlement', settlement: s, seq });
    if (sortField === 'period' && i < sortedSettlements.length - 1) {
      const next = sortedSettlements[i + 1];
      if (sortDir === 'desc') {
        if (s.period_start > next.period_end) {
          displayRows.push({ type: 'gap', afterDate: next.period_end, beforeDate: s.period_start });
        }
      } else {
        if (next.period_start > s.period_end) {
          displayRows.push({ type: 'gap', afterDate: s.period_end, beforeDate: next.period_start });
        }
      }
    }
  }

  const [histPage, setHistPage] = useState(1);
  const histTotalPages = Math.max(1, Math.ceil(displayRows.length / DEFAULT_PAGE_SIZE));
  const paginatedDisplayRows = displayRows.slice((histPage - 1) * DEFAULT_PAGE_SIZE, histPage * DEFAULT_PAGE_SIZE);

  const allSelected = selectedIds.size === settlements.length;
  const someSelected = selectedIds.size > 0;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Settlement History</CardTitle>
            <CardDescription className="text-xs">
              {settlements.length} settlement{settlements.length !== 1 ? 's' : ''} uploaded.
              {someSelected && ` ${selectedIds.size} selected.`}
            </CardDescription>
          </div>
          {someSelected && (
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleMarkSyncedBulk}
                className="gap-1.5"
              >
                <CheckSquare className="h-3.5 w-3.5" />
                Mark {selectedIds.size} as Synced
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={handleBulkDelete}
                disabled={deleting}
                className="gap-1.5"
              >
                {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <XCircle className="h-3.5 w-3.5" />}
                Delete {selectedIds.size === settlements.length ? 'All' : selectedIds.size}
              </Button>
            </div>
          )}
          <BulkDeleteDialog
            open={bulkDeleteDialogOpen}
            selectedCount={selectedIds.size}
            syncedCount={syncedSelectedCount}
            onConfirm={confirmBulkDelete}
            onCancel={cancelBulkDelete}
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/50 text-left text-muted-foreground">
                <th className="py-2 px-3 w-10">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="rounded border-muted-foreground/40 h-3.5 w-3.5 cursor-pointer"
                  />
                </th>
                <th className="py-2 px-2 font-medium w-12 text-center cursor-pointer hover:text-foreground" onClick={() => toggleSort('seq')}>
                  Seq<SortIcon field="seq" />
                </th>
                <th className="py-2 px-4 font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort('period')}>
                  Period<SortIcon field="period" />
                </th>
                <th className="py-2 px-4 font-medium text-right">Sales</th>
                <th className="py-2 px-4 font-medium text-right">Fees</th>
                <th className="py-2 px-4 font-medium text-right">Refunds</th>
                <th className="py-2 px-4 font-medium text-right">Net</th>
                <th className="py-2 px-4 font-medium text-right cursor-pointer hover:text-foreground" onClick={() => toggleSort('deposit')}>
                  Deposit<SortIcon field="deposit" />
                </th>
                <th className="py-2 px-4 font-medium cursor-pointer hover:text-foreground" onClick={() => toggleSort('status')}>
                  Status<SortIcon field="status" />
                </th>
                <th className="py-2 px-2 font-medium w-10">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paginatedDisplayRows.map((row, idx) => {
                if (row.type === 'gap') {
                  return (
                    <tr key={`gap-${idx}`} className="border-b bg-amber-50/60">
                      <td colSpan={10} className="py-1.5 px-4">
                        <div className="flex items-center gap-2 text-xs text-amber-700">
                          <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0" />
                          <span className="font-medium">⚠ Missing settlement(s)</span>
                          <span className="text-muted-foreground">
                            between {formatDisplayDate(row.afterDate)} and {formatDisplayDate(row.beforeDate)}
                          </span>
                        </div>
                      </td>
                    </tr>
                  );
                }

                const s = row.settlement;
                const isSelected = selectedIds.has(s.id);
                return (
                  <React.Fragment key={s.id}>
                    <tr
                      className={`border-b hover:bg-muted/30 cursor-pointer transition-colors ${isSelected ? 'bg-primary/5' : ''}`}
                      onClick={() => toggleExpand(s.id)}
                    >
                      <td className="py-2 px-3" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleSelect(s.id)}
                          className="rounded border-muted-foreground/40 h-3.5 w-3.5 cursor-pointer"
                        />
                      </td>
                      <td className="py-2 px-2 text-center">
                        <span className="font-mono text-xs font-semibold text-muted-foreground">{row.seq}</span>
                      </td>
                      <td className="py-2 px-4">
                        <div className="font-medium text-xs flex items-center gap-1">
                          {formatDisplayDate(s.period_start)} – {formatDisplayDate(s.period_end)}
                          {(s as any).is_split_month && <Scissors className="h-3 w-3 text-purple-600 inline" />}
                        </div>
                        <div className="text-[10px] text-muted-foreground font-mono">{s.settlement_id}</div>
                      </td>
                      <td className="py-2 px-4 text-right font-mono text-green-700">
                        {formatAUD((s.sales_principal || 0) + (s.sales_shipping || 0))}
                      </td>
                      <td className="py-2 px-4 text-right font-mono text-red-600">
                        {formatAUD((s.seller_fees || 0) + (s.fba_fees || 0) + (s.storage_fees || 0))}
                      </td>
                      <td className="py-2 px-4 text-right font-mono text-amber-600">
                        {formatAUD(s.refunds || 0)}
                      </td>
                      <td className="py-2 px-4 text-right font-mono">
                        {formatAUD(s.net_ex_gst || 0)}
                      </td>
                      <td className="py-2 px-4 text-right font-mono font-semibold">
                        {formatAUD(s.bank_deposit || 0)}
                      </td>
                      <td className="py-2 px-4">
                        {statusBadge(s.status || 'pending', s.xero_status)}
                        {(s as any).is_split_month && <Badge className="bg-purple-100 text-purple-800 text-[10px] ml-1">Split</Badge>}
                      </td>
                      <td className="py-2 px-2" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
                              <MoreHorizontal className="h-3.5 w-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-52">
                            {onReview && (
                              <DropdownMenuItem onClick={() => onReview(s.settlement_id, s.id)}>
                                <Eye className="h-3.5 w-3.5 mr-2" /> View
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => handleDownloadEntry(s)}>
                              <Download className="h-3.5 w-3.5 mr-2" /> Download Entry
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => handleDownloadAuditData(s)}>
                              <FileText className="h-3.5 w-3.5 mr-2" /> Download Audit Data
                            </DropdownMenuItem>

                            {/* Mapping error: allow retry after fix */}
                            {s.status === 'mapping_error' && (
                              <>
                                <DropdownMenuSeparator />
                                {onPushToXero && (
                                  <DropdownMenuItem onClick={() => onPushToXero(s.settlement_id, s.id)}>
                                    <ExternalLink className="h-3.5 w-3.5 mr-2" /> Retry Push to Xero
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => handleDeleteOne(s)}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                                </DropdownMenuItem>
                              </>
                            )}

                            {s.status === 'saved' && (
                              <>
                                <DropdownMenuSeparator />
                                {onPushToXero && (
                                  <DropdownMenuItem onClick={() => onPushToXero(s.settlement_id, s.id)}>
                                    <ExternalLink className="h-3.5 w-3.5 mr-2" /> Push to Xero
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={() => handleMarkSyncedOne(s)}>
                                  <CheckSquare className="h-3.5 w-3.5 mr-2" /> Mark as Already in Xero
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => handleDeleteOne(s)}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                                </DropdownMenuItem>
                              </>
                            )}

                            {s.status === 'synced_external' && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onClick={async () => {
                                  try {
                                    const { revertSettlementToSaved } = await import('@/actions/settlements');
                                    const result = await revertSettlementToSaved(s.id);
                                    if (!result.success) throw new Error(result.error);
                                    toast.success('Reverted to Saved');
                                    onDeleted();
                                  } catch (err: any) { toast.error(err.message); }
                                }}>
                                  <Undo2 className="h-3.5 w-3.5 mr-2" /> Revert to Saved
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => handleDeleteOne(s)}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                                </DropdownMenuItem>
                              </>
                            )}

                            {['pushed_to_xero', 'draft_in_xero', 'authorised_in_xero', 'reconciled_in_xero', 'synced'].includes(s.status || '') && (
                              <>
                                <DropdownMenuSeparator />
                                {(() => {
                                  const journalIds = [s.xero_journal_id, s.xero_journal_id_1, s.xero_journal_id_2].filter(Boolean) as string[];
                                  return journalIds.map((jId, jIdx) => (
                                    <DropdownMenuItem key={jId} asChild>
                                      <a href={getXeroDeepLink(jId)} target="_blank" rel="noopener noreferrer">
                                        <ExternalLink className="h-3.5 w-3.5 mr-2" />
                                        View in Xero{journalIds.length > 1 ? ` (Journal ${jIdx + 1})` : ''}
                                      </a>
                                    </DropdownMenuItem>
                                  ));
                                })()}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => setRollbackConfirm({ settlement: s, scope: 'all' })}
                                  disabled={rollingBack === s.id}
                                  className="text-amber-700 focus:text-amber-700"
                                >
                                  {rollingBack === s.id ? (
                                    <><Loader2 className="h-3.5 w-3.5 mr-2 animate-spin" /> Rolling back…</>
                                  ) : (
                                    <><Undo2 className="h-3.5 w-3.5 mr-2" /> Rollback Entire Settlement</>
                                  )}
                                </DropdownMenuItem>
                                {(s as any).is_split_month && s.xero_journal_id_1 && (
                                  <DropdownMenuItem
                                    onClick={() => setRollbackConfirm({ settlement: s, scope: 'journal_1' })}
                                    disabled={rollingBack === s.id}
                                    className="text-amber-700 focus:text-amber-700"
                                  >
                                    <Undo2 className="h-3.5 w-3.5 mr-2" /> Rollback Journal 1
                                  </DropdownMenuItem>
                                )}
                                {(s as any).is_split_month && s.xero_journal_id_2 && (
                                  <DropdownMenuItem
                                    onClick={() => setRollbackConfirm({ settlement: s, scope: 'journal_2' })}
                                    disabled={rollingBack === s.id}
                                    className="text-amber-700 focus:text-amber-700"
                                  >
                                    <Undo2 className="h-3.5 w-3.5 mr-2" /> Rollback Journal 2
                                  </DropdownMenuItem>
                                )}
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => setRepostTarget(s)}
                                  className="text-primary focus:text-primary"
                                >
                                  <RefreshCw className="h-3.5 w-3.5 mr-2" /> Safe Repost…
                                </DropdownMenuItem>
                              </>
                            )}

                            {s.status === 'voided' && (
                              <>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => handleDeleteOne(s)}
                                  className="text-destructive focus:text-destructive"
                                >
                                  <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                                </DropdownMenuItem>
                              </>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                    {expandedId === s.id && (
                      <tr>
                        <td colSpan={10} className="bg-muted/20 px-6 py-3">
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                            <div><span className="text-muted-foreground">Principal Sales:</span> <span className="font-mono">{formatAUD(s.sales_principal || 0)}</span></div>
                            <div><span className="text-muted-foreground">Shipping Sales:</span> <span className="font-mono">{formatAUD(s.sales_shipping || 0)}</span></div>
                            <div><span className="text-muted-foreground">Promo Discounts:</span> <span className="font-mono">{formatAUD(s.promotional_discounts || 0)}</span></div>
                            <div><span className="text-muted-foreground">Seller Fees:</span> <span className="font-mono">{formatAUD(s.seller_fees || 0)}</span></div>
                            <div><span className="text-muted-foreground">FBA Fees:</span> <span className="font-mono">{formatAUD(s.fba_fees || 0)}</span></div>
                            <div><span className="text-muted-foreground">Storage Fees:</span> <span className="font-mono">{formatAUD(s.storage_fees || 0)}</span></div>
                            <div><span className="text-muted-foreground">Refunds:</span> <span className="font-mono">{formatAUD(s.refunds || 0)}</span></div>
                            <div><span className="text-muted-foreground">Reimbursements:</span> <span className="font-mono">{formatAUD(s.reimbursements || 0)}</span></div>
                            <div><span className="text-muted-foreground">GST Income:</span> <span className="font-mono">{formatAUD(s.gst_on_income || 0)}</span></div>
                            <div><span className="text-muted-foreground">GST Expenses:</span> <span className="font-mono">{formatAUD(s.gst_on_expenses || 0)}</span></div>
                            <div><span className="text-muted-foreground">Parser version:</span> <span className="font-mono ml-1">{(s as any).parser_version || '—'}</span></div>
                          </div>
                          {s.xero_journal_id && !s.is_split_month && (
                            <p className="text-[10px] text-muted-foreground mt-2 font-mono">Xero Invoice: {s.xero_journal_id}</p>
                          )}
                          {s.is_split_month && (
                            <div className="mt-3 pt-2 border-t border-purple-200 space-y-2">
                              <p className="text-xs font-medium text-purple-800 flex items-center gap-1">
                                <Scissors className="h-3 w-3" /> Deferred Revenue Recognition (Account 612)
                              </p>
                              {(() => {
                                const m1 = s.split_month_1_data ? JSON.parse(s.split_month_1_data as string) : null;
                                const m2 = s.split_month_2_data ? JSON.parse(s.split_month_2_data as string) : null;
                                const rollover = m1 ? round2(
                                  (m1.salesPrincipal || 0) + (m1.salesShipping || 0) +
                                  (m1.promotionalDiscounts || 0) + (m1.refunds || 0) +
                                  (m1.fbaFees || 0) + (m1.sellerFees || 0) +
                                  (m1.storageFees || 0) + (m1.otherFees || 0) +
                                  (m1.reimbursements || 0)
                                ) : 0;
                                return (
                                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                    {m1 && (
                                      <div className="p-2 rounded bg-purple-50/50 border border-purple-100">
                                        <p className="font-medium">Journal 1 ({formatDisplayDate(m1.end)}) — nets to $0.00</p>
                                        <p className="font-mono">{m1.monthLabel} transactions (by posted date)</p>
                                        <p className="font-mono text-purple-700">Rollover to 612: {formatAUD(-rollover)}</p>
                                        {(s as any).xero_journal_id_1 && <p className="font-mono text-[10px] text-muted-foreground">Journal: {(s as any).xero_journal_id_1}</p>}
                                      </div>
                                    )}
                                    {m2 && (
                                      <div className="p-2 rounded bg-purple-50/50 border border-purple-100">
                                        <p className="font-medium">Journal 2 ({formatDisplayDate(m2.start)}) — nets to {formatAUD(s.bank_deposit)}</p>
                                        <p className="font-mono text-purple-700">Rollover from 612: {formatAUD(rollover)}</p>
                                        <p className="font-mono">{m2.monthLabel} transactions (by posted date)</p>
                                        {(s as any).xero_journal_id_2 && <p className="font-mono text-[10px] text-muted-foreground">Journal: {(s as any).xero_journal_id_2}</p>}
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <TablePaginationBar
          page={histPage}
          totalPages={histTotalPages}
          totalItems={displayRows.length}
          pageSize={DEFAULT_PAGE_SIZE}
          onPageChange={setHistPage}
        />
      </CardContent>

      {rollbackConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setRollbackConfirm(null)}>
          <div className="bg-background rounded-lg shadow-xl max-w-md w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold text-foreground">
              {rollbackConfirm.scope === 'all' ? 'Rollback Entire Settlement?' : `Rollback ${rollbackConfirm.scope === 'journal_1' ? 'Journal 1' : 'Journal 2'}?`}
            </h3>
            <p className="text-sm text-muted-foreground">
              {rollbackConfirm.scope === 'all' ? (
                <>This will <strong>void</strong> {rollbackConfirm.settlement.is_split_month ? 'both deferred revenue invoices' : 'the Xero invoice'} for settlement <span className="font-mono">{rollbackConfirm.settlement.settlement_id}</span> and reset the status to "Saved".</>
              ) : (
                <>This will <strong>void</strong> only {rollbackConfirm.scope === 'journal_1' ? 'Invoice 1 (Month 1)' : 'Invoice 2 (Month 2)'} for settlement <span className="font-mono">{rollbackConfirm.settlement.settlement_id}</span>. The other invoice will remain posted.</>
              )}
            </p>
            <p className="text-xs text-amber-700 bg-amber-50 p-2 rounded">
              ⚠ This action cannot be undone in Xero. The voided invoice will remain visible in Xero's history but will have no financial effect.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setRollbackConfirm(null)}>Cancel</Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={() => handleRollback(rollbackConfirm.settlement, rollbackConfirm.scope)}
                disabled={rollingBack === rollbackConfirm.settlement.id}
                className="gap-1.5"
              >
                {rollingBack === rollbackConfirm.settlement.id ? (
                  <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Voiding…</>
                ) : (
                  <><Undo2 className="h-3.5 w-3.5" /> Void & Rollback</>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

      {repostTarget && (
        <SafeRepostModal
          settlement={repostTarget}
          onClose={() => setRepostTarget(null)}
          onComplete={onDeleted}
        />
      )}
    </Card>
  );
}
