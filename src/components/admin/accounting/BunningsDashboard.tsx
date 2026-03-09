import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Upload, FileText, CheckCircle2, XCircle, AlertTriangle,
  History, Loader2, Send, Eye, Trash2, Info, HelpCircle, ChevronDown, FolderUp, SkipForward
} from 'lucide-react';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import bunningsBillingImg from '@/assets/bunnings-billing-cycles.png';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { parseBunningsSummaryPdf, type BunningsParseExtra } from '@/utils/bunnings-summary-parser';
import {
  type StandardSettlement,
  saveSettlement,
  syncSettlementToXero,
  deleteSettlement,
  formatSettlementDate,
  formatAUD,
} from '@/utils/settlement-engine';
import XeroConnectionStatus from '@/components/admin/XeroConnectionStatus';
import MarketplaceInfoPanel from '@/components/MarketplaceInfoPanel';
import MarketplaceAlertsBanner from '@/components/MarketplaceAlertsBanner';

interface BunningsDashboardProps {
  marketplace: { marketplace_code: string; marketplace_name: string };
}

interface SettlementRecord {
  id: string;
  settlement_id: string;
  period_start: string;
  period_end: string;
  bank_deposit: number;
  sales_principal: number;
  seller_fees: number;
  gst_on_income: number;
  gst_on_expenses: number;
  status: string;
  xero_journal_id: string | null;
  created_at: string;
  marketplace: string;
}

interface UploadWarning {
  type: 'duplicate' | 'gap';
  message: string;
}

interface BatchItem {
  file: File | null;
  fileName: string;
  parsed: StandardSettlement | null;
  extra: BunningsParseExtra | null;
  error: string | null;
  saved: boolean;
  saving: boolean;
  skipped: boolean;
  isDuplicate: boolean;
}

function statusBadge(status: string) {
  switch (status) {
    case 'synced':
      return <Badge className="bg-primary/10 text-primary border-primary/20">Synced to Xero</Badge>;
    case 'saved':
    case 'parsed':
      return <Badge variant="secondary">Saved</Badge>;
    case 'synced_external':
      return <Badge variant="outline" className="border-muted-foreground/40">Already in Xero</Badge>;
    case 'error':
      return <Badge variant="destructive">Error</Badge>;
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

const LS_KEY = 'bunnings_pending_upload';
const LS_BULK_KEY = 'bunnings_pending_bulk';

interface PersistedSingle {
  parsed: StandardSettlement;
  extra: BunningsParseExtra | null;
  warning: UploadWarning | null;
  savedId: string | null;
}

interface PersistedBulkItem {
  fileName: string;
  parsed: StandardSettlement | null;
  error: string | null;
  saved: boolean;
  skipped: boolean;
  isDuplicate: boolean;
}

function saveParsedToStorage(
  parsed: StandardSettlement,
  extra: BunningsParseExtra | null,
  warning: UploadWarning | null,
  savedId: string | null,
) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify({ parsed, extra, warning, savedId }));
  } catch { /* quota exceeded — ignore */ }
}

function saveBulkToStorage(items: BatchItem[]) {
  try {
    const slim: PersistedBulkItem[] = items.map(b => ({
      fileName: b.file?.name || b.fileName || 'unknown',
      parsed: b.parsed,
      error: b.error,
      saved: b.saved,
      skipped: b.skipped,
      isDuplicate: b.isDuplicate,
    }));
    localStorage.setItem(LS_BULK_KEY, JSON.stringify(slim));
  } catch { /* quota exceeded — ignore */ }
}

function loadParsedFromStorage(): PersistedSingle | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function loadBulkFromStorage(): PersistedBulkItem[] | null {
  try {
    const raw = localStorage.getItem(LS_BULK_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch { return null; }
}

function clearParsedStorage() {
  try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
}

function clearBulkStorage() {
  try { localStorage.removeItem(LS_BULK_KEY); } catch { /* ignore */ }
}

export default function BunningsDashboard({ marketplace }: BunningsDashboardProps) {
  // Restore persisted parse session on mount
  const persisted = loadParsedFromStorage();
  const persistedBulk = loadBulkFromStorage();

  const [activeTab, setActiveTab] = useState(
    persistedBulk && persistedBulk.length > 0 ? 'review' : persisted?.parsed ? 'review' : 'upload'
  );

  // Single file mode
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<StandardSettlement | null>(persisted?.parsed ?? null);
  const [extra, setExtra] = useState<BunningsParseExtra | null>(persisted?.extra ?? null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [savedSettlementId, setSavedSettlementId] = useState<string | null>(persisted?.savedId ?? null);
  const [uploadWarning, setUploadWarning] = useState<UploadWarning | null>(persisted?.warning ?? null);

  // Bulk mode — restore from localStorage if available
  const [bulkFiles, setBulkFiles] = useState<File[] | null>(null);
  const [bulkBatch, setBulkBatch] = useState<BatchItem[]>(() => {
    if (persistedBulk && persistedBulk.length > 0) {
      return persistedBulk.map(p => ({
        file: null,
        fileName: p.fileName,
        parsed: p.parsed,
        extra: null,
        error: p.error,
        saved: p.saved,
        saving: false,
        skipped: p.skipped,
        isDuplicate: p.isDuplicate,
      }));
    }
    return [];
  });
  const [bulkProcessing, setBulkProcessing] = useState(false);

  const [settlements, setSettlements] = useState<SettlementRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase
        .from('settlements')
        .select('*')
        .eq('marketplace', 'bunnings')
        .order('period_end', { ascending: false })
        .limit(50);
      if (error) throw error;
      setSettlements((data || []) as SettlementRecord[]);
    } catch {
      // silent
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // ─── Duplicate / gap checks ─────────────────────────────────────────────────

  function checkDuplicateAndGap(
    incoming: StandardSettlement,
    existing: SettlementRecord[]
  ): UploadWarning | null {
    // Exact ID match
    const exactMatch = existing.find(s => s.settlement_id === incoming.settlement_id);
    if (exactMatch) {
      return {
        type: 'duplicate',
        message: `Settlement ${incoming.settlement_id} is already saved (${formatSettlementDate(exactMatch.period_start)} – ${formatSettlementDate(exactMatch.period_end)}). Saving will overwrite it.`,
      };
    }

    // Fingerprint match: same dates + similar deposit
    const fingerprint = existing.find(s =>
      s.period_start === incoming.period_start &&
      s.period_end === incoming.period_end &&
      Math.abs((s.bank_deposit || 0) - incoming.net_payout) < 1.00
    );
    if (fingerprint) {
      return {
        type: 'duplicate',
        message: `A settlement covering ${formatSettlementDate(incoming.period_start)} – ${formatSettlementDate(incoming.period_end)} with a similar payout already exists (${fingerprint.settlement_id}). This appears to be a duplicate.`,
      };
    }

    // Gap detection: newest existing settlement end should match this start
    if (existing.length > 0) {
      const newest = [...existing].sort((a, b) => b.period_end.localeCompare(a.period_end))[0];
      if (incoming.period_start > newest.period_end) {
        return {
          type: 'gap',
          message: `Expected next settlement to start ${formatSettlementDate(newest.period_end)}, but this one starts ${formatSettlementDate(incoming.period_start)}. You may have a missing settlement.`,
        };
      }
    }

    return null;
  }

  // ─── Single file upload ────────────────────────────────────────────────────

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    // BULK mode: multiple files selected
    if (files.length > 1) {
      const arr = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.pdf'));
      // Sort chronologically by filename date pattern (e.g. BUN-2301-2026-02-15 → 2026-02-15)
      arr.sort((a, b) => {
        const dateA = a.name.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || a.name;
        const dateB = b.name.match(/(\d{4}-\d{2}-\d{2})/)?.[1] || b.name;
        return dateA.localeCompare(dateB);
      });
      setBulkFiles(arr);
      setFile(null);
      setParsed(null);
      setUploadWarning(null);
      setSavedSettlementId(null);
      setBulkBatch([]);
      await processBulkFiles(arr);
      return;
    }

    // SINGLE mode
    const f = files[0];
    if (!f.name.toLowerCase().endsWith('.pdf')) {
      // Non-PDF — check if it's an Amazon file uploaded to wrong tab
      const { detectFileMarketplace, MARKETPLACE_LABELS } = await import('@/utils/file-marketplace-detector');
      const detected = await detectFileMarketplace(f);
      if (detected === 'amazon_au') {
        toast.warning(
          `This looks like an ${MARKETPLACE_LABELS[detected]} settlement (TSV/CSV). Switch to the Amazon AU tab to upload it.`,
          { duration: 6000 }
        );
      } else {
        toast.error('Please upload a PDF file (Summary of Transactions).');
      }
      return;
    }

    // PDF uploaded — quick check it's not mislabelled
    {
      const { detectFileMarketplace, MARKETPLACE_LABELS } = await import('@/utils/file-marketplace-detector');
      const detected = await detectFileMarketplace(f);
      if (detected === 'amazon_au') {
        toast.warning(
          `This PDF looks like an Amazon file. Switch to the Amazon AU tab to upload it.`,
          { duration: 6000 }
        );
        return;
      }
    }

    setBulkFiles(null);
    setBulkBatch([]);
    setFile(f);
    setParsed(null);
    setExtra(null);
    setParseError(null);
    setSavedSettlementId(null);
    setUploadWarning(null);
    setParsing(true);

    try {
      const result = await parseBunningsSummaryPdf(f);
      if (result.success) {
        setParsed(result.settlement);
        setExtra(result.extra);
        const warning = checkDuplicateAndGap(result.settlement, settlements);
        setUploadWarning(warning);
        // Persist to localStorage so state survives navigation / logout
        saveParsedToStorage(result.settlement, result.extra, warning, null);
        if (warning?.type === 'duplicate') {
          toast.warning('Duplicate detected — review before saving.');
        } else if (warning?.type === 'gap') {
          toast.warning('Gap detected — you may have a missing settlement.');
        } else {
          toast.success('Parsed successfully!');
        }
        setActiveTab('review');
      } else {
        const errMsg = (result as any).error || 'Unknown error';
        setParseError(errMsg);
        toast.error(errMsg);
      }
    } catch (err: any) {
      setParseError(err.message || 'Unknown parsing error');
      toast.error('Failed to parse PDF');
    } finally {
      setParsing(false);
    }
  };

  // ─── Bulk processing ───────────────────────────────────────────────────────

  const processBulkFiles = async (files: File[]) => {
    setBulkProcessing(true);
    const items: BatchItem[] = files.map(f => ({
      file: f,
      fileName: f.name,
      parsed: null,
      extra: null,
      error: null,
      saved: false,
      saving: false,
      skipped: false,
      isDuplicate: false,
    }));
    setBulkBatch([...items]);

    // Parse all
    const current = await supabase
      .from('settlements')
      .select('*')
      .eq('marketplace', 'bunnings')
      .order('period_end', { ascending: false });
    const existing = (current.data || []) as SettlementRecord[];

    for (let i = 0; i < items.length; i++) {
      try {
        const result = await parseBunningsSummaryPdf(items[i].file!);
        if (result.success) {
          items[i].parsed = result.settlement;
          items[i].extra = result.extra;
          const dupe = existing.find(s => s.settlement_id === result.settlement.settlement_id);
          if (dupe) items[i].isDuplicate = true;
        } else {
          items[i].error = (result as any).error || 'Parse failed';
        }
      } catch (err: any) {
        items[i].error = err.message || 'Parse error';
      }
      setBulkBatch([...items]);
    }

    // Persist bulk batch to localStorage
    saveBulkToStorage(items);
    setBulkProcessing(false);
    setActiveTab('review');
  };

  const handleBulkSaveAll = async () => {
    const toSave = bulkBatch.filter(b => b.parsed && !b.saved && !b.skipped && !b.isDuplicate);
    for (const item of toSave) {
      item.saving = true;
      setBulkBatch([...bulkBatch]);
      const result = await saveSettlement(item.parsed!);
      item.saving = false;
      item.saved = result.success;
      if (!result.success) item.error = result.error || 'Save failed';
      setBulkBatch([...bulkBatch]);
    }
    saveBulkToStorage(bulkBatch);
    await loadHistory();
    toast.success(`Saved ${toSave.length} settlements.`);
    // After saving, clear bulk state and switch to history
    clearBulkStorage();
    setActiveTab('history');
  };

  const handleBulkSkipDuplicates = () => {
    const updated = bulkBatch.map(b => ({ ...b, skipped: b.skipped || b.isDuplicate }));
    setBulkBatch(updated);
  };

  // ─── Save single ───────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!parsed) return;
    setSaving(true);
    const result = await saveSettlement(parsed);
    if (result.success) {
      setSavedSettlementId(parsed.settlement_id);
      // Persist the saved ID so the Push to Xero button still shows after navigation
      saveParsedToStorage(parsed, extra, uploadWarning, parsed.settlement_id);
      toast.success('Settlement saved!');
      loadHistory();
    } else {
      toast.error(result.error || 'Failed to save');
    }
    setSaving(false);
  };

  const handlePushToXero = async (settlementId?: string) => {
    const targetId = settlementId || savedSettlementId || parsed?.settlement_id;
    if (!targetId) return;
    setPushing(true);
    const result = await syncSettlementToXero(targetId, 'bunnings');
    if (result.success) {
      // Clear persisted state — successfully sent to Xero, no longer pending
      clearParsedStorage();
      toast.success('Invoice created in Xero!');
      loadHistory();
    } else {
      toast.error(result.error || 'Failed to push to Xero');
    }
    setPushing(false);
  };

  const handleDelete = async (id: string) => {
    const result = await deleteSettlement(id);
    if (result.success) {
      toast.success('Settlement deleted');
      loadHistory();
    } else {
      toast.error(result.error || 'Failed to delete');
    }
  };

  const clearUpload = () => {
    setFile(null);
    setBulkFiles(null);
    setBulkBatch([]);
    setParsed(null);
    setExtra(null);
    setParseError(null);
    setSavedSettlementId(null);
    setUploadWarning(null);
    clearParsedStorage();
    clearBulkStorage();
    if (inputRef.current) inputRef.current.value = '';
    setActiveTab('upload');
  };

  const handleMarkAlreadySynced = async (settlementId: string) => {
    const { error } = await supabase
      .from('settlements')
      .update({ status: 'synced_external' })
      .eq('settlement_id', settlementId);
    if (error) {
      toast.error('Failed to update status');
    } else {
      toast.success('Marked as Already in Xero');
      loadHistory();
    }
  };

  const handleBulkMarkSynced = async () => {
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
      loadHistory();
    }
  };

  const isBulkMode = (!!bulkFiles && bulkFiles.length > 0) || bulkBatch.length > 0;

  return (
    <div className="space-y-6">
      {/* Alerts Banner */}
      <MarketplaceAlertsBanner marketplaceCode="bunnings" />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold flex items-center gap-2">
            <span className="text-xl">🔨</span>
            Bunnings Settlements
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            Upload your Summary of Transactions PDF → Review → Push to Xero.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <MarketplaceInfoPanel marketplaceCode="bunnings" />
          <XeroConnectionStatus />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="upload" className="flex items-center gap-1.5">
            <Upload className="h-3.5 w-3.5" />
            Upload
          </TabsTrigger>
          <TabsTrigger value="review" className="flex items-center gap-1.5" disabled={!parsed && bulkBatch.length === 0 && !savedSettlementId}>
            <Eye className="h-3.5 w-3.5" />
            Review
            {isBulkMode && bulkBatch.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] h-4 px-1">{bulkBatch.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="flex items-center gap-1.5">
            <History className="h-3.5 w-3.5" />
            History
          </TabsTrigger>
        </TabsList>

        {/* ─── UPLOAD TAB ─── */}
        <TabsContent value="upload" className="space-y-4 mt-4">
          {/* Help card */}
          <Card className="border-2 border-primary/20 bg-primary/5">
            <CardContent className="py-4">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium text-foreground">Upload your Bunnings "Summary of Transactions" PDF</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    This is the fortnightly Summary of Transactions from your Bunnings Mirakl seller portal. 
                    We'll extract the totals and create a matching Xero invoice automatically.
                    <strong className="text-foreground"> Select multiple PDFs at once</strong> to import in bulk.
                  </p>

                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <Button variant="ghost" size="sm" className="mt-2 h-7 px-2 text-xs text-primary gap-1">
                        <HelpCircle className="h-3 w-3" />
                        How to find the right file
                        <ChevronDown className="h-3 w-3" />
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-3 space-y-3">
                      <div className="rounded-md border border-border bg-background p-3 text-xs space-y-2">
                        <p className="font-medium text-foreground">Step-by-step:</p>
                        <ol className="list-decimal list-inside space-y-1.5 text-muted-foreground">
                          <li>Log in to your <strong>Bunnings Mirakl seller portal</strong></li>
                          <li>Navigate to <strong>Billing and documents → Billing cycles</strong></li>
                          <li>Find the settlement period you want to import</li>
                          <li>Click the <strong>three dots (⋮)</strong> on the right side of the row</li>
                          <li>Select <strong>"Summary of transactions"</strong> to download the PDF</li>
                          <li>Upload that PDF here (select multiple to bulk import)</li>
                        </ol>
                        <div className="mt-3 rounded border border-border overflow-hidden">
                          <img
                            src={bunningsBillingImg}
                            alt="Bunnings Mirakl portal — Billing cycles showing the Summary of transactions download option"
                            className="w-full"
                          />
                          <p className="text-[10px] text-muted-foreground px-2 py-1.5 bg-muted/50">
                            Bunnings Mirakl portal → Billing cycles → click ⋮ → "Summary of transactions"
                          </p>
                        </div>
                        <div className="rounded border border-border bg-muted/40 p-2 space-y-1 mt-2">
                          <p className="font-medium text-foreground">Which files does Bunnings provide?</p>
                          <ul className="space-y-1 text-muted-foreground">
                            <li><span className="text-primary font-medium">✓ Summary of Transactions PDF</span> — <strong>this is the one to upload.</strong> Contains the billing period totals, sales, commission and net payout.</li>
                            <li><span className="text-muted-foreground">✗ Invoice PDF</span> — a tax invoice for the same period; not needed here.</li>
                            <li><span className="text-muted-foreground">✗ Billing cycle orders CSV</span> — order-level detail; not required for accounting import.</li>
                          </ul>
                        </div>
                      </div>
                    </CollapsibleContent>
                  </Collapsible>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* File input */}
          <Card className={`border-2 transition-colors ${file && !parseError ? 'border-primary/40 bg-primary/5' : 'border-dashed border-muted-foreground/25 hover:border-primary/40'}`}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                {isBulkMode ? <FolderUp className="h-4 w-4 text-primary" /> : <FileText className="h-4 w-4 text-primary" />}
                Summary of Transactions
                {parsing && <Loader2 className="h-4 w-4 animate-spin ml-auto" />}
                {parsed && !isBulkMode && <CheckCircle2 className="h-4 w-4 text-primary ml-auto" />}
                {parseError && <XCircle className="h-4 w-4 text-destructive ml-auto" />}
              </CardTitle>
              <CardDescription className="text-xs">
                Upload the PDF from Bunnings Mirakl → Billing cycles → ⋮ → "Summary of transactions"
              </CardDescription>
            </CardHeader>
            <CardContent>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf"
                multiple
                onChange={handleFileChange}
                disabled={parsing || bulkProcessing}
                className="block w-full text-sm text-muted-foreground
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-md file:border-0
                  file:text-sm file:font-medium
                  file:bg-primary file:text-primary-foreground
                  hover:file:opacity-90 file:cursor-pointer"
              />
              {isBulkMode ? (
                <div className="mt-2 flex items-center gap-2">
                  {bulkProcessing
                    ? <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                    : <CheckCircle2 className="h-3.5 w-3.5 text-primary" />}
                  <p className="text-xs text-muted-foreground">
                    {bulkProcessing ? `Parsing ${bulkFiles.length} files…` : `${bulkFiles.length} files ready for review`}
                  </p>
                </div>
              ) : file && (
                <div className="flex items-center justify-between mt-2">
                  <p className={`text-xs font-medium ${parseError ? 'text-destructive' : 'text-primary'}`}>
                    {parseError ? `✗ ${parseError}` : `✓ ${file.name} (${(file.size / 1024).toFixed(1)} KB)`}
                  </p>
                  <Button variant="ghost" size="sm" className="text-xs h-6" onClick={clearUpload}>
                    Clear
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── REVIEW TAB ─── */}
        <TabsContent value="review" className="space-y-4 mt-4">

          {/* BULK review */}
          {isBulkMode && bulkBatch.length > 0 ? (
            <>
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {bulkBatch.filter(b => b.saved).length} of {bulkBatch.length} saved
                </p>
                <div className="flex gap-2">
                  {bulkBatch.some(b => b.isDuplicate && !b.skipped) && (
                    <Button variant="outline" size="sm" onClick={handleBulkSkipDuplicates}>
                      <SkipForward className="h-3.5 w-3.5 mr-1" />
                      Skip Duplicates
                    </Button>
                  )}
                  <Button
                    size="sm"
                    onClick={handleBulkSaveAll}
                    disabled={bulkBatch.every(b => b.saved || b.skipped || b.error || !b.parsed)}
                  >
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                    Save All
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                {bulkBatch.map((item, idx) => (
                  <Card key={idx} className={`border ${item.isDuplicate && !item.skipped ? 'border-warning/40 bg-warning/5' : item.error ? 'border-destructive/30' : item.saved ? 'border-primary/30 bg-primary/5' : 'border-border'}`}>
                    <CardContent className="py-3 flex items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium truncate">{item.fileName || item.file?.name || 'Unknown file'}</p>
                          {item.isDuplicate && !item.skipped && (
                            <Badge variant="outline" className="text-[10px] border-primary/40 text-foreground">Duplicate</Badge>
                          )}
                          {item.skipped && (
                            <Badge variant="outline" className="text-[10px]">Skipped</Badge>
                          )}
                          {item.saved && (
                            <Badge className="text-[10px] bg-primary/10 text-primary border-primary/20">Saved</Badge>
                          )}
                          {item.error && (
                            <Badge variant="destructive" className="text-[10px]">Error</Badge>
                          )}
                        </div>
                        {item.parsed && (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatSettlementDate(item.parsed.period_start)} – {formatSettlementDate(item.parsed.period_end)} •{' '}
                            Net: {formatAUD(item.parsed.net_payout)}
                          </p>
                        )}
                        {item.error && (
                          <p className="text-xs text-destructive mt-0.5">{item.error}</p>
                        )}
                        {item.isDuplicate && !item.skipped && (
                          <p className="text-xs text-muted-foreground mt-0.5">Already saved — skip or overwrite</p>
                        )}
                      </div>
                      <div>
                        {item.saving ? (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        ) : item.saved ? (
                          <CheckCircle2 className="h-4 w-4 text-primary" />
                        ) : item.error || item.skipped ? (
                          <XCircle className="h-4 w-4 text-muted-foreground" />
                        ) : null}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              <Button variant="outline" onClick={clearUpload} className="w-full">
                Upload Another Batch
              </Button>
            </>
          ) : parsed ? (

            /* SINGLE review */
            <>
              {/* Upload warning */}
              {uploadWarning && (
                <Card className={`border ${uploadWarning.type === 'duplicate' ? 'border-primary/40 bg-primary/5' : 'border-primary/30 bg-primary/5'}`}>
                  <CardContent className="py-3 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0 text-primary" />
                    <p className="text-xs">{uploadWarning.message}</p>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">Settlement Summary</CardTitle>
                    <div className="flex items-center gap-2">
                      {parsed.reconciles ? (
                        <Badge className="bg-primary/10 text-primary border-primary/20">
                          <CheckCircle2 className="h-3 w-3 mr-1" /> Reconciled
                        </Badge>
                      ) : (
                        <Badge variant="destructive">
                          <AlertTriangle className="h-3 w-3 mr-1" /> Mismatch
                        </Badge>
                      )}
                    </div>
                  </div>
                  <CardDescription>
                    {extra?.shopName || 'Bunnings'} • {formatSettlementDate(parsed.period_start)} – {formatSettlementDate(parsed.period_end)}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                      <span className="text-muted-foreground">Gross Sales (excl. GST)</span>
                      <span className="font-medium text-right">{formatAUD(parsed.sales_ex_gst)}</span>

                      <span className="text-muted-foreground">GST Collected</span>
                      <span className="font-medium text-right">{formatAUD(parsed.gst_on_sales)}</span>

                      <span className="text-muted-foreground">Commission (excl. GST)</span>
                      <span className="font-medium text-right text-destructive">{formatAUD(parsed.fees_ex_gst)}</span>

                      <span className="text-muted-foreground">GST on Commission</span>
                      <span className="font-medium text-right text-destructive">-{formatAUD(parsed.gst_on_fees)}</span>
                    </div>

                    <div className="border-t border-border pt-3">
                      <div className="grid grid-cols-2 gap-x-8 text-sm">
                        <span className="font-semibold">Net Settlement</span>
                        <span className="font-bold text-right text-lg">{formatAUD(parsed.net_payout)}</span>
                      </div>
                    </div>

                    {/* Reconciliation check */}
                    <div className={`rounded-md border p-3 text-xs space-y-1.5 ${parsed.reconciles ? 'border-primary/20 bg-primary/5' : 'border-destructive/30 bg-destructive/5'}`}>
                      <p className="font-medium text-foreground">Reconciliation Check</p>
                      <div className="grid grid-cols-2 gap-x-6 gap-y-1">
                        <span className="text-muted-foreground">Gross sales (inc GST)</span>
                        <span className="text-right tabular-nums">{formatAUD(parsed.sales_ex_gst + parsed.gst_on_sales)}</span>
                        <span className="text-muted-foreground">Marketplace fees (inc GST)</span>
                        <span className="text-right tabular-nums text-destructive">-{formatAUD(Math.abs(parsed.fees_ex_gst) + parsed.gst_on_fees)}</span>
                      </div>
                      <div className="border-t border-border pt-1.5 grid grid-cols-2 gap-x-6">
                        <span className="text-muted-foreground">Expected payout</span>
                        <span className="text-right tabular-nums font-medium">{formatAUD((parsed.sales_ex_gst + parsed.gst_on_sales) - (Math.abs(parsed.fees_ex_gst) + parsed.gst_on_fees))}</span>
                        <span className="text-muted-foreground">Settlement file</span>
                        <span className="text-right tabular-nums font-medium">{formatAUD(parsed.net_payout)}</span>
                      </div>
                      <p className={`font-medium ${parsed.reconciles ? 'text-primary' : 'text-destructive'}`}>
                        {parsed.reconciles ? '✓ Balanced — amounts match' : '⚠ Mismatch — review amounts'}
                      </p>
                    </div>

                    {parsed.settlement_id && (
                      <p className="text-xs text-muted-foreground mt-2">
                        Settlement ID: {parsed.settlement_id}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Xero Preview */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Xero Invoice Preview</CardTitle>
                  <CardDescription>This is what will be created in Xero</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border border-border overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium">Description</th>
                          <th className="text-left px-3 py-2 font-medium">Account</th>
                          <th className="text-right px-3 py-2 font-medium">Amount</th>
                          <th className="text-left px-3 py-2 font-medium">Tax</th>
                        </tr>
                      </thead>
                      <tbody>
                        <tr className="border-t border-border">
                          <td className="px-3 py-2">Marketplace Sales</td>
                          <td className="px-3 py-2 text-muted-foreground">200 – Sales</td>
                          <td className="px-3 py-2 text-right font-medium">{formatAUD(parsed.sales_ex_gst)}</td>
                          <td className="px-3 py-2 text-muted-foreground">GST on Income</td>
                        </tr>
                        <tr className="border-t border-border">
                          <td className="px-3 py-2">Marketplace Commission</td>
                          <td className="px-3 py-2 text-muted-foreground">407 – Seller Fees</td>
                          <td className="px-3 py-2 text-right font-medium text-destructive">{formatAUD(parsed.fees_ex_gst)}</td>
                          <td className="px-3 py-2 text-muted-foreground">GST on Expenses</td>
                        </tr>
                      </tbody>
                      <tfoot className="bg-muted/30 border-t border-border">
                        <tr>
                          <td colSpan={2} className="px-3 py-2 font-semibold">Invoice Total</td>
                          <td className="px-3 py-2 text-right font-bold">{formatAUD(parsed.net_payout)}</td>
                          <td></td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                  <p className="text-xs text-muted-foreground mt-2">
                    Contact: Bunnings Marketplace • Ref: Bunnings Settlement {formatSettlementDate(parsed.period_start)} – {formatSettlementDate(parsed.period_end)}
                  </p>
                </CardContent>
              </Card>

              {/* Actions */}
              <div className="flex gap-3">
                {!savedSettlementId ? (
                  <Button onClick={handleSave} disabled={saving} className="flex-1">
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <CheckCircle2 className="h-4 w-4 mr-2" />}
                    Save Settlement
                  </Button>
                ) : (
                  <Button onClick={() => handlePushToXero()} disabled={pushing} className="flex-1">
                    {pushing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                    Send to Xero
                  </Button>
                )}
                <Button variant="outline" onClick={clearUpload}>
                  Upload Another
                </Button>
              </div>
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center">
                <FileText className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">Upload a Bunnings PDF to see the settlement review here.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ─── HISTORY TAB ─── */}
        <TabsContent value="history" className="space-y-4 mt-4">
          {historyLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : settlements.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center">
                <History className="h-10 w-10 text-muted-foreground/30 mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">No Bunnings settlements yet. Upload your first PDF above.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {/* Bulk actions */}
              {settlements.some(s => s.status === 'saved' || s.status === 'parsed') && (
                <div className="flex justify-end">
                  <Button variant="outline" size="sm" onClick={handleBulkMarkSynced}>
                    <SkipForward className="h-3.5 w-3.5 mr-1" />
                    Mark All as Already in Xero
                  </Button>
                </div>
              )}
              {settlements.map((s, idx) => {
                // Gap indicator: check if there's a gap to the previous settlement
                const prev = settlements[idx + 1];
                const hasGap = prev && s.period_start > prev.period_end;
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
                    <Card className="hover:border-primary/20 transition-colors">
                      <CardContent className="py-4">
                        <div className="flex items-center justify-between">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <p className="text-sm font-medium">
                                {formatSettlementDate(s.period_start)} – {formatSettlementDate(s.period_end)}
                              </p>
                              {statusBadge(s.status)}
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Sales: {formatAUD(s.sales_principal)} • Commission: {formatAUD(s.seller_fees)} • Net: {formatAUD(s.bank_deposit)}
                            </p>
                            <p className="text-xs text-muted-foreground">ID: {s.settlement_id}</p>
                          </div>
                          <div className="flex items-center gap-2">
                            {(s.status === 'saved' || s.status === 'parsed') && (
                              <>
                                <Button
                                  size="sm"
                                  variant="default"
                                  onClick={() => handlePushToXero(s.settlement_id)}
                                  disabled={pushing}
                                >
                                  {pushing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                                  Push to Xero
                                </Button>
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
                            {s.status !== 'synced' && s.status !== 'synced_external' && (
                              <Button
                                size="sm"
                                variant="ghost"
                                className="text-destructive hover:text-destructive"
                                onClick={() => handleDelete(s.id)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  </React.Fragment>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
