/**
 * WoolworthsPaymentsView — Mirrors the Woolworths seller portal layout.
 * Groups settlements by Bank Payment ID and shows CSV/PDF upload status,
 * marketplace breakdown, and actions per payment group.
 * Includes inline upload zone for ZIP/CSV/PDF files.
 */

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  CheckCircle2, XCircle, Upload, ArrowRight, Send, Eye, Package,
  ChevronDown, ChevronUp, CloudUpload, FileText, Loader2, BarChart3,
  AlertTriangle, RefreshCw, FolderArchive, File as FileIcon, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { type UserMarketplace } from './MarketplaceSwitcher';
import { formatAUD, formatSettlementDate } from '@/utils/settlement-engine';
import { useXeroSync } from '@/hooks/use-xero-sync';
import SettlementDetailDrawer from '@/components/shared/SettlementDetailDrawer';
import SettlementStatusBadge from './shared/SettlementStatusBadge';
import MarketplaceProfitCard from '@/components/shared/MarketplaceProfitCard';
import JSZip from 'jszip';
import { parseWoolworthsMarketPlusCSV } from '@/utils/woolworths-marketplus-parser';
import { saveSettlement, triggerValidationSweep } from '@/utils/settlement-engine';

// ── Types ─────────────────────────────────────────────────────────────────────

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
  raw_payload: any;
  source: string | null;
  xero_invoice_number: string | null;
  xero_status: string | null;
  xero_journal_id: string | null;
}

interface ExpectedPayment {
  bank_payment_id: string;
  paid_date: string;
  amount: number;
  csv_uploaded: boolean;
  pdf_uploaded: boolean;
}

interface PaymentGroup {
  bankPaymentId: string;
  paidDate: string | null;
  totalAmount: number;
  expectedAmount: number | null;
  hasCsv: boolean;
  hasPdf: boolean;
  settlements: SettlementRow[];
  marketplaceBreakdown: { code: string; name: string; amount: number; status: string | null }[];
  overallStatus: 'ready_to_push' | 'pushed' | 'gap_detected' | 'upload_csv' | 'upload_pdf' | 'missing';
  isFromExpected: boolean;
}

interface ExtractedFile {
  name: string;
  file: File;
  type: 'csv' | 'pdf' | 'unknown';
  matchedPaymentId: string | null;
  matchedMarketplace: string | null;
  status: 'pending' | 'processing' | 'done' | 'error';
  message?: string;
}

// ── Marketplace display names ─────────────────────────────────────────────────

const MP_NAMES: Record<string, string> = {
  bigw: 'Big W',
  everyday_market: 'Everyday Market',
  mydeal: 'MyDeal',
  catch: 'Catch',
  woolworths_marketplus: 'Woolworths',
};

// ── Component ─────────────────────────────────────────────────────────────────

interface WoolworthsPaymentsViewProps {
  marketplace: UserMarketplace;
  onSwitchToUpload?: () => void;
  onMarketplacesChanged?: () => void;
}

export default function WoolworthsPaymentsView({ marketplace, onSwitchToUpload, onMarketplacesChanged }: WoolworthsPaymentsViewProps) {
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);
  const [expectedPayments, setExpectedPayments] = useState<ExpectedPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedPayment, setExpandedPayment] = useState<string | null>(null);
  const [drawerSettlementId, setDrawerSettlementId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [accountingBoundary, setAccountingBoundary] = useState<string | null>(null);
  const [preBoundaryOpen, setPreBoundaryOpen] = useState(false);

  // Upload state
  const [uploadOpen, setUploadOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [extractedFiles, setExtractedFiles] = useState<ExtractedFile[]>([]);
  const [uploadProcessing, setUploadProcessing] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const WOOLWORTHS_CODES = ['bigw', 'everyday_market', 'mydeal', 'catch', 'woolworths_marketplus'];

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setCurrentUserId(user.id);

      const { data: boundaryRow } = await supabase
        .from('app_settings')
        .select('value')
        .eq('user_id', user.id)
        .eq('key', 'accounting_boundary_date')
        .maybeSingle();
      if (boundaryRow?.value) setAccountingBoundary(boundaryRow.value);

      const { data: sRows, error } = await supabase
        .from('settlements')
        .select('id, settlement_id, marketplace, period_start, period_end, sales_principal, seller_fees, bank_deposit, status, created_at, gst_on_income, gst_on_expenses, raw_payload, source, xero_invoice_number, xero_status, xero_journal_id')
        .eq('user_id', user.id)
        .in('marketplace', WOOLWORTHS_CODES)
        .eq('is_hidden', false)
        .order('period_end', { ascending: false });

      if (error) {
        console.error('[WoolworthsPaymentsView] load error:', error);
        toast.error('Failed to load settlements');
      }
      setSettlements((sRows as SettlementRow[]) || []);

      const { data: epRows } = await supabase
        .from('expected_woolworths_payments')
        .select('bank_payment_id, paid_date, amount, csv_uploaded, pdf_uploaded')
        .eq('user_id', user.id)
        .order('paid_date', { ascending: false });
      setExpectedPayments((epRows as ExpectedPayment[]) || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const { pushing, handlePushToXero, handleRefreshXero, refreshingXero, toStandardSettlement } = useXeroSync({ loadSettlements: loadData });

  // ── Group settlements by Bank Payment ID ────────────────────────────────────

  const paymentGroups = useMemo<PaymentGroup[]>(() => {
    const groupMap = new Map<string, SettlementRow[]>();

    for (const s of settlements) {
      const parts = s.settlement_id.split('_');
      const ref = parts[0];
      if (!ref || !/^\d+$/.test(ref)) {
        if (!groupMap.has(s.settlement_id)) groupMap.set(s.settlement_id, []);
        groupMap.get(s.settlement_id)!.push(s);
        continue;
      }
      if (!groupMap.has(ref)) groupMap.set(ref, []);
      groupMap.get(ref)!.push(s);
    }

    const groups: PaymentGroup[] = [];
    const seenIds = new Set<string>();

    for (const [ref, setts] of groupMap) {
      seenIds.add(ref);
      const ep = expectedPayments.find(e => e.bank_payment_id === ref);

      const breakdown = setts.map(s => ({
        code: s.marketplace,
        name: MP_NAMES[s.marketplace] || s.marketplace,
        amount: s.bank_deposit || 0,
        status: s.status,
      }));

      const totalAmount = setts.reduce((sum, s) => sum + (s.bank_deposit || 0), 0);
      const hasCsv = setts.length > 0;
      const hasPdf = false;
      const allPushed = setts.every(s => ['pushed_to_xero', 'reconciled_in_xero', 'bank_verified', 'already_recorded'].includes(s.status || ''));
      const anyGap = setts.some(s => s.status === 'gap_detected' || s.status === 'push_failed');

      let overallStatus: PaymentGroup['overallStatus'] = 'ready_to_push';
      if (allPushed) overallStatus = 'pushed';
      else if (anyGap) overallStatus = 'gap_detected';

      const paidDate = setts[0]?.period_end || ep?.paid_date || null;

      groups.push({
        bankPaymentId: ref,
        paidDate,
        totalAmount: Math.round(totalAmount * 100) / 100,
        expectedAmount: ep?.amount ?? null,
        hasCsv,
        hasPdf,
        settlements: setts,
        marketplaceBreakdown: breakdown,
        overallStatus,
        isFromExpected: false,
      });
    }

    for (const ep of expectedPayments) {
      if (seenIds.has(ep.bank_payment_id)) continue;
      groups.push({
        bankPaymentId: ep.bank_payment_id,
        paidDate: ep.paid_date,
        totalAmount: ep.amount,
        expectedAmount: ep.amount,
        hasCsv: false,
        hasPdf: false,
        settlements: [],
        marketplaceBreakdown: [],
        overallStatus: 'missing',
        isFromExpected: true,
      });
    }

    groups.sort((a, b) => {
      if (!a.paidDate && !b.paidDate) return 0;
      if (!a.paidDate) return 1;
      if (!b.paidDate) return -1;
      return b.paidDate.localeCompare(a.paidDate);
    });

    return groups;
  }, [settlements, expectedPayments]);

  const { activeGroups, preBoundaryGroups } = useMemo(() => {
    if (!accountingBoundary) return { activeGroups: paymentGroups, preBoundaryGroups: [] };
    const active: PaymentGroup[] = [];
    const pre: PaymentGroup[] = [];
    for (const g of paymentGroups) {
      if (g.paidDate && g.paidDate < accountingBoundary) {
        pre.push(g);
      } else {
        active.push(g);
      }
    }
    return { activeGroups: active, preBoundaryGroups: pre };
  }, [paymentGroups, accountingBoundary]);

  // ── Upload handling ─────────────────────────────────────────────────────────

  const handleFilesSelected = async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const extracted: ExtractedFile[] = [];

    for (const file of fileArray) {
      if (file.name.endsWith('.zip')) {
        // Extract ZIP
        try {
          const zip = await JSZip.loadAsync(file);
          const entries = Object.entries(zip.files).filter(([, f]) => !f.dir && !f.name.startsWith('__MACOSX'));
          for (const [name, zipEntry] of entries) {
            const blob = await zipEntry.async('blob');
            const fileName = name.split('/').pop() || name;
            const ext = fileName.toLowerCase();
            const extractedFile = new File([blob], fileName, {
              type: ext.endsWith('.csv') ? 'text/csv' : ext.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
            });
            extracted.push({
              name: fileName,
              file: extractedFile,
              type: ext.endsWith('.csv') ? 'csv' : ext.endsWith('.pdf') ? 'pdf' : 'unknown',
              matchedPaymentId: null,
              matchedMarketplace: null,
              status: 'pending',
            });
          }
        } catch (e) {
          toast.error(`Failed to extract ${file.name}`);
        }
      } else {
        const ext = file.name.toLowerCase();
        extracted.push({
          name: file.name,
          file,
          type: ext.endsWith('.csv') ? 'csv' : ext.endsWith('.pdf') ? 'pdf' : 'unknown',
          matchedPaymentId: null,
          matchedMarketplace: null,
          status: 'pending',
        });
      }
    }

    // Auto-match CSVs by reading Bank Payment Ref
    for (const ef of extracted) {
      if (ef.type === 'csv') {
        try {
          const text = await ef.file.text();
          const result = parseWoolworthsMarketPlusCSV(text);
          if (result.success) {
            ef.matchedPaymentId = result.bankPaymentRef;
            ef.message = `Matched to Payment ${result.bankPaymentRef} — ${result.groups.length} marketplace(s)`;
          }
        } catch { /* ignore */ }
      }
      // Match PDFs by filename patterns like "BigW_290145.pdf" or "290145_EverydayMarket.pdf"
      if (ef.type === 'pdf') {
        const numMatch = ef.name.match(/(\d{5,7})/);
        if (numMatch) {
          ef.matchedPaymentId = numMatch[1];
          const lowerName = ef.name.toLowerCase();
          if (lowerName.includes('bigw') || lowerName.includes('big_w') || lowerName.includes('big w')) {
            ef.matchedMarketplace = 'BigW';
          } else if (lowerName.includes('everyday') || lowerName.includes('em')) {
            ef.matchedMarketplace = 'EverydayMarket';
          } else if (lowerName.includes('mydeal') || lowerName.includes('my_deal')) {
            ef.matchedMarketplace = 'MyDeal';
          }
          ef.message = `PDF → Payment ${ef.matchedPaymentId}${ef.matchedMarketplace ? ` (${ef.matchedMarketplace})` : ''}`;
        }
      }
    }

    setExtractedFiles(extracted);
    setUploadOpen(true);
  };

  const handleProcessFiles = async () => {
    setUploadProcessing(true);
    let savedCount = 0;
    const updatedFiles = [...extractedFiles];

    for (let i = 0; i < updatedFiles.length; i++) {
      const ef = updatedFiles[i];
      if (ef.type !== 'csv') {
        // PDFs: mark as noted (no processing needed for now)
        ef.status = 'done';
        ef.message = ef.message || 'PDF noted';
        setExtractedFiles([...updatedFiles]);
        continue;
      }

      ef.status = 'processing';
      setExtractedFiles([...updatedFiles]);

      try {
        const text = await ef.file.text();
        const result = parseWoolworthsMarketPlusCSV(text);
        if (!result.success) {
          ef.status = 'error';
          ef.message = 'error' in result ? result.error : 'Parse failed';
          setExtractedFiles([...updatedFiles]);
          continue;
        }

        // Save each settlement from the CSV
        for (const settlement of result.settlements) {
          const saveResult = await saveSettlement(settlement);
          if (saveResult.success) {
            savedCount++;
          }
        }

        ef.status = 'done';
        ef.message = `✅ Created ${result.settlements.length} settlement(s) for Payment ${result.bankPaymentRef}`;
        setExtractedFiles([...updatedFiles]);
      } catch (err: any) {
        ef.status = 'error';
        ef.message = err.message || 'Processing failed';
        setExtractedFiles([...updatedFiles]);
      }
    }

    if (savedCount > 0) {
      toast.success(`Created ${savedCount} settlement(s)`);
      triggerValidationSweep();
      await loadData();
    }

    setUploadProcessing(false);
  };

  const clearUpload = () => {
    setExtractedFiles([]);
    setUploadOpen(false);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) {
      handleFilesSelected(e.dataTransfer.files);
    }
  };

  // ── Status helpers ──────────────────────────────────────────────────────────

  function getStatusBadge(status: PaymentGroup['overallStatus']) {
    switch (status) {
      case 'pushed':
        return <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-400 dark:border-emerald-800 text-[11px]">Pushed to Xero</Badge>;
      case 'ready_to_push':
        return <Badge className="bg-primary/10 text-primary border-primary/20 text-[11px]">Ready to Push</Badge>;
      case 'gap_detected':
        return <Badge variant="outline" className="text-amber-600 border-amber-300 dark:text-amber-400 dark:border-amber-700 text-[11px]"><AlertTriangle className="h-3 w-3 mr-1" />Gap Detected</Badge>;
      case 'upload_csv':
        return <Badge variant="outline" className="text-destructive text-[11px]">Upload CSV + PDF</Badge>;
      case 'upload_pdf':
        return <Badge variant="outline" className="text-amber-600 text-[11px]">Upload PDF</Badge>;
      case 'missing':
        return <Badge variant="outline" className="text-muted-foreground text-[11px]">Not Uploaded</Badge>;
    }
  }

  function getActionButton(group: PaymentGroup) {
    if (group.overallStatus === 'missing' || group.overallStatus === 'upload_csv') {
      return (
        <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={(e) => {
          e.stopPropagation();
          setUploadOpen(true);
        }}>
          <Upload className="h-3 w-3" /> Upload
        </Button>
      );
    }
    if (group.overallStatus === 'ready_to_push' && group.settlements.length > 0) {
      return (
        <Button
          size="sm"
          className="gap-1.5 text-xs"
          disabled={!!pushing}
          onClick={async (e) => {
            e.stopPropagation();
            for (const s of group.settlements) {
              if (['pushed_to_xero', 'reconciled_in_xero', 'bank_verified', 'already_recorded'].includes(s.status || '')) continue;
              await handlePushToXero(s as any);
            }
          }}
        >
          <Send className="h-3 w-3" /> Push to Xero
        </Button>
      );
    }
    if (group.overallStatus === 'pushed') {
      return <span className="text-xs text-muted-foreground">Complete</span>;
    }
    return null;
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const renderPaymentRow = (group: PaymentGroup) => {
    const isExpanded = expandedPayment === group.bankPaymentId;
    return (
      <React.Fragment key={group.bankPaymentId}>
        <TableRow
          className="cursor-pointer hover:bg-muted/50 transition-colors"
          onClick={() => setExpandedPayment(isExpanded ? null : group.bankPaymentId)}
        >
          <TableCell className="font-mono font-medium text-sm">{group.bankPaymentId}</TableCell>
          <TableCell className="text-sm text-muted-foreground">
            {group.paidDate ? formatSettlementDate(group.paidDate) : '—'}
          </TableCell>
          <TableCell className="text-sm font-semibold tabular-nums text-right">
            {formatAUD(group.totalAmount)}
          </TableCell>
          <TableCell className="text-center">
            {group.hasCsv
              ? <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto" />
              : <XCircle className="h-4 w-4 text-destructive/60 mx-auto" />}
          </TableCell>
          <TableCell className="text-center">
            {group.hasPdf
              ? <CheckCircle2 className="h-4 w-4 text-emerald-500 mx-auto" />
              : <XCircle className="h-4 w-4 text-destructive/60 mx-auto" />}
          </TableCell>
          <TableCell>
            {group.marketplaceBreakdown.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {group.marketplaceBreakdown.map(b => (
                  <span key={b.code} className="text-[11px] text-muted-foreground">
                    {b.name} {formatAUD(b.amount)}
                  </span>
                ))}
              </div>
            ) : (
              <span className="text-xs text-muted-foreground">—</span>
            )}
          </TableCell>
          <TableCell>{getStatusBadge(group.overallStatus)}</TableCell>
          <TableCell className="text-right">
            <div className="flex items-center justify-end gap-2">
              {getActionButton(group)}
              {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </div>
          </TableCell>
        </TableRow>
        {isExpanded && group.settlements.length > 0 && (
          <TableRow>
            <TableCell colSpan={8} className="bg-muted/30 p-0">
              <div className="px-6 py-3 space-y-2">
                {group.settlements.map(s => (
                  <div key={s.settlement_id} className="flex items-center justify-between py-1.5 px-3 rounded-md bg-background border border-border/50">
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-medium text-foreground">{MP_NAMES[s.marketplace] || s.marketplace}</span>
                      <SettlementStatusBadge status={s.status || 'saved'} />
                      {s.xero_invoice_number && (
                        <span className="text-[10px] text-muted-foreground">#{s.xero_invoice_number}</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-mono tabular-nums">{formatAUD(s.bank_deposit || 0)}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 w-6 p-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDrawerSettlementId(s.settlement_id);
                          setDrawerOpen(true);
                        }}
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </TableCell>
          </TableRow>
        )}
      </React.Fragment>
    );
  };

  const needsAttentionCount = activeGroups.filter(g => g.overallStatus !== 'pushed').length;
  const readyCount = activeGroups.filter(g => g.overallStatus === 'ready_to_push').length;
  const missingCount = activeGroups.filter(g => g.overallStatus === 'missing').length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            Woolworths Group Payments
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-0.5">
              <FileText className="h-2.5 w-2.5" /> File upload
            </Badge>
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Upload your Woolworths MarketPlus zip or CSV — Xettle splits across BigW, Everyday Market & MyDeal automatically.
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
            <RefreshCw className={`h-3.5 w-3.5 ${refreshingXero ? 'animate-spin' : ''}`} />
            Audit Xero
          </Button>
        </div>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="py-3 px-4">
          <p className="text-xs text-muted-foreground">Total Payments</p>
          <p className="text-xl font-bold tabular-nums">{activeGroups.length}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4">
          <p className="text-xs text-muted-foreground">Ready to Push</p>
          <p className="text-xl font-bold tabular-nums text-primary">{readyCount}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4">
          <p className="text-xs text-muted-foreground">Needs Upload</p>
          <p className="text-xl font-bold tabular-nums text-amber-600">{missingCount}</p>
        </CardContent></Card>
        <Card><CardContent className="py-3 px-4">
          <p className="text-xs text-muted-foreground">Needs Attention</p>
          <p className="text-xl font-bold tabular-nums text-destructive">{needsAttentionCount}</p>
        </CardContent></Card>
      </div>

      {/* ── Inline Upload Zone ──────────────────────────────────────────── */}
      <Collapsible open={uploadOpen} onOpenChange={setUploadOpen}>
        <CollapsibleTrigger asChild>
          <Card className="border-dashed border-2 border-primary/30 hover:border-primary/50 transition-colors cursor-pointer bg-muted/20">
            <CardContent className="py-4 px-6 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <FolderArchive className="h-5 w-5 text-primary" />
                <div>
                  <p className="text-sm font-semibold text-foreground">Upload Woolworths Files</p>
                  <p className="text-xs text-muted-foreground">Drop ZIP, CSV, or PDF — auto-matched to Payment IDs</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {extractedFiles.length > 0 && (
                  <Badge variant="secondary" className="text-[10px]">{extractedFiles.length} file(s)</Badge>
                )}
                {uploadOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </div>
            </CardContent>
          </Card>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <Card className="mt-1 border-primary/20">
            <CardContent className="py-5 px-6 space-y-4">
              {/* Drop zone */}
              <div
                className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors ${
                  dragOver ? 'border-primary bg-primary/5' : 'border-border hover:border-primary/40'
                }`}
                onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                onDragLeave={() => setDragOver(false)}
                onDrop={onDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <CloudUpload className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm font-medium text-foreground">
                  {dragOver ? 'Drop files here' : 'Drop your Woolworths ZIP, CSV, or PDF files'}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  Xettle extracts and matches to Payment IDs automatically
                </p>
                <Button variant="outline" size="sm" className="mt-3 gap-1.5" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
                  <Upload className="h-3 w-3" /> Browse Files
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  multiple
                  accept=".zip,.csv,.pdf"
                  onChange={(e) => { if (e.target.files?.length) handleFilesSelected(e.target.files); }}
                />
              </div>

              {/* Extracted files list */}
              {extractedFiles.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold text-foreground">
                      {extractedFiles.length} file(s) detected
                    </p>
                    <Button variant="ghost" size="sm" className="h-6 text-xs gap-1 text-muted-foreground" onClick={clearUpload}>
                      <X className="h-3 w-3" /> Clear
                    </Button>
                  </div>
                  {extractedFiles.map((ef, i) => (
                    <div key={i} className="flex items-center gap-3 py-2 px-3 rounded-md bg-muted/50 border border-border/50">
                      {ef.type === 'csv' ? (
                        <FileText className="h-4 w-4 text-emerald-500 shrink-0" />
                      ) : ef.type === 'pdf' ? (
                        <FileIcon className="h-4 w-4 text-red-500 shrink-0" />
                      ) : (
                        <FileIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-foreground truncate">{ef.name}</p>
                        {ef.message && (
                          <p className={`text-[11px] ${ef.status === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}>
                            {ef.message}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0">
                        {ef.status === 'pending' && ef.matchedPaymentId && (
                          <Badge variant="secondary" className="text-[10px]">Payment {ef.matchedPaymentId}</Badge>
                        )}
                        {ef.status === 'processing' && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                        {ef.status === 'done' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                        {ef.status === 'error' && <XCircle className="h-3.5 w-3.5 text-destructive" />}
                      </div>
                    </div>
                  ))}

                  {/* Process button */}
                  {extractedFiles.some(f => f.status === 'pending') && (
                    <Button
                      className="w-full gap-2 mt-2"
                      disabled={uploadProcessing}
                      onClick={handleProcessFiles}
                    >
                      {uploadProcessing ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> Processing...</>
                      ) : (
                        <><CheckCircle2 className="h-4 w-4" /> Confirm & Process {extractedFiles.filter(f => f.type === 'csv').length} CSV(s)</>
                      )}
                    </Button>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      {/* Payments Table */}
      {activeGroups.length > 0 ? (
        <Card>
          <CardContent className="p-0">
            <TooltipProvider>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[120px]">Payment ID</TableHead>
                    <TableHead>Paid Date</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-center w-[60px]">CSV</TableHead>
                    <TableHead className="text-center w-[60px]">PDF</TableHead>
                    <TableHead>Breakdown</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right w-[140px]">Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {activeGroups.map(renderPaymentRow)}
                </TableBody>
              </Table>
            </TooltipProvider>
          </CardContent>
        </Card>
      ) : (
        <Card className="border-dashed border-2 border-primary/30">
          <CardContent className="py-12 flex flex-col items-center justify-center text-center gap-3">
            <Package className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="font-semibold text-foreground">No Woolworths payments found</p>
              <p className="text-sm text-muted-foreground mt-1">
                Upload your Woolworths MarketPlus zip file using the upload zone above.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Pre-boundary payments (collapsed) */}
      {preBoundaryGroups.length > 0 && (
        <Collapsible open={preBoundaryOpen} onOpenChange={setPreBoundaryOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className="w-full justify-between text-muted-foreground">
              <span className="text-xs">Pre-{accountingBoundary} — managed by prior system ({preBoundaryGroups.length} payments)</span>
              {preBoundaryOpen ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <Card>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Payment ID</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-center">CSV</TableHead>
                      <TableHead className="text-center">PDF</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preBoundaryGroups.map(g => (
                      <TableRow key={g.bankPaymentId} className="text-muted-foreground">
                        <TableCell className="font-mono text-xs">{g.bankPaymentId}</TableCell>
                        <TableCell className="text-xs">{g.paidDate ? formatSettlementDate(g.paidDate) : '—'}</TableCell>
                        <TableCell className="text-xs text-right tabular-nums">{formatAUD(g.totalAmount)}</TableCell>
                        <TableCell className="text-center">{g.hasCsv ? <CheckCircle2 className="h-3 w-3 text-emerald-500 mx-auto" /> : <XCircle className="h-3 w-3 text-muted-foreground mx-auto" />}</TableCell>
                        <TableCell className="text-center">{g.hasPdf ? <CheckCircle2 className="h-3 w-3 text-emerald-500 mx-auto" /> : <XCircle className="h-3 w-3 text-muted-foreground mx-auto" />}</TableCell>
                        <TableCell>{getStatusBadge(g.overallStatus)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </CollapsibleContent>
        </Collapsible>
      )}

      {/* Profit Analysis */}
      {currentUserId && (
        <div className="space-y-3">
          <h4 className="text-base font-semibold text-foreground flex items-center gap-2">
            <BarChart3 className="h-4 w-4 text-primary" />
            Profit Analysis
          </h4>
          <MarketplaceProfitCard marketplaceCode={marketplace.marketplace_code} userId={currentUserId} />
        </div>
      )}

      {/* Settlement Detail Drawer */}
      <SettlementDetailDrawer
        settlementId={drawerSettlementId}
        open={drawerOpen}
        onClose={() => { setDrawerOpen(false); setDrawerSettlementId(null); }}
      />
    </div>
  );
}