import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Upload, FileText, CheckCircle2, XCircle, AlertTriangle,
  History, Loader2, Send, Eye, Trash2, Info,
  CheckSquare, Square, X
} from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { parseShopifyPayoutCSV, buildShopifyInvoiceLines } from '@/utils/shopify-payments-parser';
import {
  type StandardSettlement,
  saveSettlement,
  syncSettlementToXero,
  deleteSettlement,
  formatSettlementDate,
  formatAUD,
} from '@/utils/settlement-engine';
import { runUniversalReconciliation } from '@/utils/universal-reconciliation';
import XeroConnectionStatus from '@/components/admin/XeroConnectionStatus';
import MarketplaceAlertsBanner from '@/components/MarketplaceAlertsBanner';

interface ShopifyPaymentsDashboardProps {
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

const LS_KEY = 'shopify_payments_pending_upload';

export default function ShopifyPaymentsDashboard({ marketplace }: ShopifyPaymentsDashboardProps) {
  const persisted = (() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  })();

  const [activeTab, setActiveTab] = useState(persisted?.parsed ? 'review' : 'upload');
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);

  // Bulk: array of parsed settlements
  const [parsedPayouts, setParsedPayouts] = useState<StandardSettlement[]>(persisted?.parsed || []);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set(persisted?.savedIds || []));
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkPushing, setBulkPushing] = useState(false);

  const [settlements, setSettlements] = useState<SettlementRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [singleDeleteId, setSingleDeleteId] = useState<string | null>(null);
  const [uploadWarning, setUploadWarning] = useState<{ type: 'duplicate' | 'gap'; message: string; duplicateIds?: string[] } | null>(null);
  const [expandedRecon, setExpandedRecon] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);

  function persistState(p: StandardSettlement[], sIds: string[]) {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ parsed: p, savedIds: sIds })); } catch { /* */ }
  }
  function clearPersistedState() {
    try { localStorage.removeItem(LS_KEY); } catch { /* */ }
  }

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase
        .from('settlements')
        .select('*')
        .eq('marketplace', 'shopify_payments')
        .order('period_end', { ascending: false })
        .limit(200);
      if (error) throw error;
      setSettlements((data || []) as SettlementRecord[]);
    } catch { /* silent */ } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // ─── CSV Upload & Parse ─────────────────────────────────────────────────

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    const { detectFileMarketplace, MARKETPLACE_LABELS } = await import('@/utils/file-marketplace-detector');
    const detected = await detectFileMarketplace(f);
    if (detected && detected !== 'shopify_payments') {
      toast.warning(`This looks like a ${MARKETPLACE_LABELS[detected] || detected} file. Switch to the correct tab to upload it.`, { duration: 6000 });
      return;
    }

    setFile(f);
    setParsedPayouts([]);
    setSavedIds(new Set());
    setParseError(null);
    setUploadWarning(null);
    setParsing(true);

    try {
      const text = await f.text();
      const result = parseShopifyPayoutCSV(text);
      if (result.success) {
        const payouts = result.settlements;
        setParsedPayouts(payouts);
        persistState(payouts, []);

        // ── Duplicate detection ──
        const duplicateIds: string[] = [];
        for (const p of payouts) {
          const exactMatch = settlements.find(s => s.settlement_id === p.settlement_id);
          const fingerprint = !exactMatch ? settlements.find(s =>
            s.period_start === p.period_start &&
            s.period_end === p.period_end &&
            Math.abs((s.bank_deposit || 0) - p.net_payout) < 0.01
          ) : null;
          if (exactMatch || fingerprint) duplicateIds.push(p.settlement_id);
        }

        if (duplicateIds.length > 0) {
          setUploadWarning({
            type: 'duplicate',
            message: duplicateIds.length === 1
              ? `Payout ${duplicateIds[0]} already exists. Saving will skip duplicates.`
              : `${duplicateIds.length} of ${payouts.length} payouts already exist and will be skipped on save.`,
            duplicateIds,
          });
        }

        // ── Gap detection ──
        if (!duplicateIds.length && settlements.length > 0) {
          const latestHistoryEnd = settlements[0]?.period_end;
          const earliestParsed = [...payouts].sort((a, b) => a.period_start.localeCompare(b.period_start))[0];
          if (latestHistoryEnd && earliestParsed && earliestParsed.period_start > latestHistoryEnd) {
            setUploadWarning({
              type: 'gap',
              message: `Gap detected: last saved payout ends ${formatSettlementDate(latestHistoryEnd)}, but this upload starts ${formatSettlementDate(earliestParsed.period_start)}. You may be missing payouts.`,
            });
          }
        }

        const reconciledCount = payouts.filter(p => p.reconciles).length;
        const total = payouts.length;

        if (total === 1) {
          if (payouts[0].reconciles) {
            toast.success(`Payout ${payouts[0].settlement_id} parsed & reconciled ✓`);
          } else {
            toast.warning(`Payout parsed but reconciliation failed — diff: ${formatAUD(payouts[0].metadata?.reconciliationDiff || 0)}`);
          }
        } else {
          toast.success(`${total} payouts parsed — ${reconciledCount}/${total} reconciled ✓`);
        }
        setActiveTab('review');
      } else {
        const errMsg = (result as { success: false; error: string }).error;
        setParseError(errMsg);
        toast.error(errMsg);
      }
    } catch (err: any) {
      setParseError(err.message || 'Unknown error');
      toast.error('Failed to parse CSV');
    } finally {
      setParsing(false);
    }
  };

  // ─── Save All ───────────────────────────────────────────────────────────

  const handleSaveAll = async () => {
    const toSave = parsedPayouts.filter(p => p.reconciles && !savedIds.has(p.settlement_id));
    if (toSave.length === 0) {
      toast.warning('No reconciled payouts to save.');
      return;
    }
    setBulkSaving(true);
    let saved = 0;
    const newSavedIds = new Set(savedIds);

    for (const payout of toSave) {
      const result = await saveSettlement(payout);
      if (result.success || result.duplicate) {
        saved++;
        newSavedIds.add(payout.settlement_id);
      }
    }

    setSavedIds(newSavedIds);
    persistState(parsedPayouts, Array.from(newSavedIds));
    setBulkSaving(false);
    toast.success(`Saved ${saved} of ${toSave.length} payouts`);
    loadHistory();
  };

  // ─── Push All to Xero ──────────────────────────────────────────────────

  const handlePushAllToXero = async () => {
    const toPush = parsedPayouts.filter(p => savedIds.has(p.settlement_id));
    if (toPush.length === 0) {
      toast.warning('Save payouts first before pushing to Xero.');
      return;
    }
    setBulkPushing(true);
    let pushed = 0;

    for (const payout of toPush) {
      const reconResult = runUniversalReconciliation(payout);
      if (!reconResult.canSync) continue;

      const lineItems = buildShopifyInvoiceLines(payout);
      const result = await syncSettlementToXero(payout.settlement_id, 'shopify_payments', {
        lineItems,
        contactName: 'Shopify Payments',
      });
      if (result.success) pushed++;
    }

    setBulkPushing(false);
    clearPersistedState();
    toast.success(`Pushed ${pushed} of ${toPush.length} payouts to Xero`);
    loadHistory();
  };

  // ─── Single payout push from history ────────────────────────────────────

  const handlePushToXero = async (settlementId: string) => {
    setPushing(true);
    const result = await syncSettlementToXero(settlementId, 'shopify_payments', {
      contactName: 'Shopify Payments',
    });
    if (result.success) {
      toast.success(`Invoice created in Xero! (${result.invoiceId})`);
      loadHistory();
    } else {
      toast.error(result.error || 'Failed to push to Xero');
    }
    setPushing(false);
  };

  // ─── Delete ─────────────────────────────────────────────────────────────

  const handleDelete = async (id: string) => {
    const result = await deleteSettlement(id);
    if (result.success) {
      toast.success('Payout deleted');
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
      loadHistory();
    } else {
      toast.error(result.error || 'Failed to delete');
    }
  };

  const handleBulkDelete = async () => {
    if (selected.size === 0) return;
    setBulkDeleting(true);
    let deleted = 0;
    for (const id of selected) {
      const result = await deleteSettlement(id);
      if (result.success) deleted++;
    }
    setSelected(new Set());
    setBulkDeleting(false);
    setDeleteConfirmOpen(false);
    toast.success(`Deleted ${deleted} payout${deleted !== 1 ? 's' : ''}`);
    loadHistory();
  };

  const handleSingleSyncedDelete = async () => {
    if (!singleDeleteId) return;
    const result = await deleteSettlement(singleDeleteId);
    if (result.success) {
      toast.success('Payout deleted (Xero invoice unchanged)');
      setSelected(prev => { const n = new Set(prev); n.delete(singleDeleteId); return n; });
      loadHistory();
    } else {
      toast.error(result.error || 'Failed to delete');
    }
    setSingleDeleteId(null);
  };

  const selectedSyncedCount = settlements.filter(s => selected.has(s.id) && s.status === 'synced').length;

  const clearUpload = () => {
    setFile(null);
    setParsedPayouts([]);
    setSavedIds(new Set());
    setParseError(null);
    clearPersistedState();
    if (inputRef.current) inputRef.current.value = '';
    setActiveTab('upload');
  };

  const toggleSelect = (id: string) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
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

  const reconciledCount = parsedPayouts.filter(p => p.reconciles).length;
  const allSaved = parsedPayouts.length > 0 && parsedPayouts.every(p => savedIds.has(p.settlement_id));

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <span className="text-xl">💳</span>
          Shopify Payments Settlements
        </h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Upload transaction CSVs, reconcile by payout, and sync to Xero.
        </p>
      </div>

      <MarketplaceAlertsBanner marketplaceCode="shopify_payments" />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="upload" className="gap-1.5">
            <Upload className="h-3.5 w-3.5" /> Upload
          </TabsTrigger>
          <TabsTrigger value="review" className="gap-1.5" disabled={parsedPayouts.length === 0}>
            <Eye className="h-3.5 w-3.5" /> Review
            {parsedPayouts.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5">{parsedPayouts.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History className="h-3.5 w-3.5" /> History
            {settlements.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5">{settlements.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ─── Upload Tab ─────────────────────────────────────────── */}
        <TabsContent value="upload" className="space-y-4">
          <Card className={`border-2 transition-colors ${file ? 'border-green-400 bg-green-50/30' : 'border-dashed border-muted-foreground/25 hover:border-primary/40'}`}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                Shopify Payments Transaction CSV
                {file && <CheckCircle2 className="h-4 w-4 text-green-600 ml-auto" />}
              </CardTitle>
              <CardDescription className="text-xs">
                Export from Shopify Admin → Settings → Payments → View payouts → Export transactions.
                Supports bulk upload — all payouts in the file will be grouped automatically.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.tsv,.txt"
                onChange={handleFileChange}
                className="block w-full text-sm text-muted-foreground
                  file:mr-4 file:py-2 file:px-4
                  file:rounded-md file:border-0
                  file:text-sm file:font-medium
                  file:bg-primary file:text-primary-foreground
                  hover:file:opacity-90 file:cursor-pointer"
              />
              {parsing && (
                <div className="flex items-center gap-2 mt-3 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Parsing transactions...
                </div>
              )}
              {parseError && (
                <div className="mt-3 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                  <p className="text-sm text-destructive flex items-center gap-2">
                    <XCircle className="h-4 w-4" /> {parseError}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="border-muted bg-muted/30">
            <CardContent className="py-4">
              <div className="flex items-start gap-3">
                <Info className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" />
                <div className="text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">How to export Shopify Payments transactions</p>
                  <ol className="list-decimal list-inside space-y-0.5">
                    <li>Go to Shopify Admin → Settings → Payments → View payouts</li>
                    <li>Click "Export" → "Transactions" to download the CSV</li>
                    <li>The file contains all transactions grouped by Payout ID</li>
                    <li>Upload here — Xettle will group by payout automatically</li>
                  </ol>
                  <p className="mt-2 text-muted-foreground/80">
                    💡 One CSV can contain hundreds of payouts — they'll all be parsed at once.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Review Tab ─────────────────────────────────────────── */}
        <TabsContent value="review" className="space-y-4">
          {parsedPayouts.length > 0 ? (
            <>
              {/* Summary banner */}
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="py-4">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <p className="text-sm font-medium">
                        {parsedPayouts.length} payout{parsedPayouts.length !== 1 ? 's' : ''} found
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {reconciledCount}/{parsedPayouts.length} reconciled •{' '}
                        Total: {formatAUD(parsedPayouts.reduce((sum, p) => sum + p.net_payout, 0))}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={clearUpload}>
                        Clear
                      </Button>
                      {!allSaved ? (
                        <Button size="sm" onClick={handleSaveAll} disabled={bulkSaving || reconciledCount === 0}>
                          {bulkSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : null}
                          Save All ({reconciledCount})
                        </Button>
                      ) : (
                        <Button size="sm" onClick={handlePushAllToXero} disabled={bulkPushing}>
                          {bulkPushing ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" /> : <Send className="h-3.5 w-3.5 mr-1" />}
                          Push All to Xero
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Duplicate / Gap warning */}
              {uploadWarning && (
                <Card className={`border-2 ${uploadWarning.type === 'duplicate' ? 'border-yellow-400 bg-yellow-50/30' : 'border-orange-400 bg-orange-50/30'}`}>
                  <CardContent className="py-3">
                    <div className="flex items-start gap-2">
                      <AlertTriangle className={`h-4 w-4 flex-shrink-0 mt-0.5 ${uploadWarning.type === 'duplicate' ? 'text-yellow-600' : 'text-orange-600'}`} />
                      <p className="text-sm">{uploadWarning.message}</p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Individual payout cards with reconciliation checks */}
              <div className="space-y-2">
                {parsedPayouts.map((payout) => {
                  const meta = payout.metadata || {};
                  const isSaved = savedIds.has(payout.settlement_id);
                  const isDuplicate = uploadWarning?.duplicateIds?.includes(payout.settlement_id);
                  const reconResult = runUniversalReconciliation(payout);
                  const isExpanded = expandedRecon.has(payout.settlement_id);
                  return (
                    <Card key={payout.settlement_id} className={`transition-colors ${isDuplicate ? 'border-yellow-400/50 opacity-60' : payout.reconciles ? '' : 'border-destructive/30'}`}>
                      <CardContent className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="flex-shrink-0">
                            {payout.reconciles ? (
                              <CheckCircle2 className="h-4 w-4 text-green-600" />
                            ) : (
                              <XCircle className="h-4 w-4 text-destructive" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-sm font-medium font-mono">{payout.settlement_id}</span>
                              {isSaved && <Badge variant="secondary" className="text-[10px]">Saved</Badge>}
                              {isDuplicate && <Badge variant="outline" className="text-[10px] border-yellow-500 text-yellow-700">Duplicate</Badge>}
                              {!payout.reconciles && (
                                <Badge variant="destructive" className="text-[10px]">
                                  Diff: {formatAUD(meta.reconciliationDiff || 0)}
                                </Badge>
                              )}
                              {reconResult.overallStatus === 'warn' && payout.reconciles && (
                                <Badge variant="outline" className="text-[10px] border-yellow-500 text-yellow-700">Warnings</Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground mt-0.5">
                              {formatSettlementDate(payout.period_start)}
                              {payout.period_start !== payout.period_end && ` – ${formatSettlementDate(payout.period_end)}`}
                              {' • '}{meta.transactionCount || 0} txns
                              {meta.payoutDate && ` • Payout: ${formatSettlementDate(meta.payoutDate)}`}
                            </p>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className="text-sm font-mono font-medium">{formatAUD(payout.net_payout)}</p>
                            <p className="text-[10px] text-muted-foreground">
                              Sales {formatAUD(meta.grossSalesInclGst || 0)} • Fees {formatAUD(meta.chargesInclGst || 0)}
                            </p>
                          </div>
                          <button
                            className="text-xs text-muted-foreground hover:text-foreground underline flex-shrink-0"
                            onClick={() => setExpandedRecon(prev => {
                              const n = new Set(prev);
                              n.has(payout.settlement_id) ? n.delete(payout.settlement_id) : n.add(payout.settlement_id);
                              return n;
                            })}
                          >
                            {isExpanded ? 'Hide' : 'Checks'}
                          </button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive flex-shrink-0"
                            onClick={() => {
                              const updated = parsedPayouts.filter(p => p.settlement_id !== payout.settlement_id);
                              setParsedPayouts(updated);
                              const newSaved = new Set(savedIds);
                              newSaved.delete(payout.settlement_id);
                              setSavedIds(newSaved);
                              persistState(updated, Array.from(newSaved));
                              toast.info(`Removed payout ${payout.settlement_id} from review`);
                              if (updated.length === 0) clearUpload();
                            }}
                            title="Remove from review"
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        {/* Expandable reconciliation checks */}
                        {isExpanded && (
                          <div className="mt-3 pt-3 border-t border-border space-y-1.5">
                            {reconResult.checks.map(check => (
                              <div key={check.id} className="flex items-start gap-2 text-xs">
                                {check.status === 'pass' ? (
                                  <CheckCircle2 className="h-3.5 w-3.5 text-green-600 flex-shrink-0 mt-0.5" />
                                ) : check.status === 'warn' ? (
                                  <AlertTriangle className="h-3.5 w-3.5 text-yellow-600 flex-shrink-0 mt-0.5" />
                                ) : (
                                  <XCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0 mt-0.5" />
                                )}
                                <div>
                                  <span className="font-medium">{check.label}:</span>{' '}
                                  <span className="text-muted-foreground">{check.detail}</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}
              </div>

              {/* Xero mapping preview for first payout */}
              {parsedPayouts.length > 0 && (
                <Card className="border-muted">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Xero Mapping Preview (per payout)</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="text-xs space-y-1 font-mono">
                      <div className="flex justify-between">
                        <span>Sales (200, GST on Income)</span>
                        <span className="text-green-700">ex GST amount</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Refunds (200, GST on Income)</span>
                        <span className="text-red-600">negative if applicable</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Shopify Fees (404, GST on Expenses)</span>
                        <span className="text-red-600">ex GST fees</span>
                      </div>
                      <div className="flex justify-between border-t pt-1 text-muted-foreground">
                        <span>Contact: Shopify Payments</span>
                        <span>1 invoice per payout</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Upload className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Upload a Shopify Payments CSV to review.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ─── History Tab ────────────────────────────────────────── */}
        <TabsContent value="history" className="space-y-4">
          <XeroConnectionStatus />

          {settlements.length > 0 && (
            <div className="flex items-center gap-3 text-sm">
              <button onClick={toggleSelectAll} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                {selected.size === settlements.length ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                {selected.size > 0 ? (
                  <span>
                    {selected.size} selected
                    {selectedSyncedCount > 0 && (
                      <span className="text-muted-foreground"> ({selectedSyncedCount} synced to Xero)</span>
                    )}
                  </span>
                ) : 'Select all'}
              </button>
              {selected.size > 0 && (
                <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
                  <AlertDialogTrigger asChild>
                    <Button variant="destructive" size="sm" disabled={bulkDeleting}>
                      {bulkDeleting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Trash2 className="h-3 w-3 mr-1" />}
                      Delete Selected
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Delete {selected.size} settlement{selected.size !== 1 ? 's' : ''}?</AlertDialogTitle>
                      <AlertDialogDescription>
                        {selectedSyncedCount > 0
                          ? `${selectedSyncedCount} of these settlement${selectedSyncedCount !== 1 ? 's are' : ' is'} already synced to Xero. Deleting will NOT remove the Xero invoice. This action cannot be undone.`
                          : 'This action cannot be undone. The selected settlements will be permanently deleted.'}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Cancel</AlertDialogCancel>
                      <AlertDialogAction onClick={handleBulkDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                        {bulkDeleting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
                        Delete
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          )}

          {historyLoading ? (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading...
            </div>
          ) : settlements.length === 0 ? (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <History className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No Shopify Payments settlements yet.</p>
                <p className="text-xs mt-1">Upload a transaction CSV to get started.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {settlements.map((s) => (
                <Card key={s.id} className="hover:shadow-sm transition-shadow">
                  <CardContent className="py-3 px-4">
                    <div className="flex items-center gap-3">
                      <button onClick={() => toggleSelect(s.id)} className="text-muted-foreground hover:text-foreground">
                        {selected.has(s.id) ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                      </button>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium">{s.settlement_id}</span>
                          {statusBadge(s.status)}
                          {s.status === 'synced' && selected.has(s.id) && (
                            <Badge variant="outline" className="text-[10px] border-primary/30 text-primary">Xero ✓</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {formatSettlementDate(s.period_start)}
                          {s.period_start !== s.period_end && ` – ${formatSettlementDate(s.period_end)}`}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-mono font-medium">{formatAUD(s.bank_deposit)}</p>
                        <p className="text-xs text-muted-foreground">Net payout</p>
                      </div>
                      <div className="flex items-center gap-1">
                        {(s.status === 'saved' || s.status === 'parsed') && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => handlePushToXero(s.settlement_id)}
                            disabled={pushing}
                          >
                            <Send className="h-3 w-3 mr-1" /> Push
                          </Button>
                        )}
                        {s.status === 'synced' ? (
                          <AlertDialog open={singleDeleteId === s.id} onOpenChange={(open) => !open && setSingleDeleteId(null)}>
                            <AlertDialogTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 text-xs text-destructive hover:text-destructive"
                                onClick={() => setSingleDeleteId(s.id)}
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete synced settlement?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  This settlement has been synced to Xero. Deleting it here will NOT remove the Xero invoice. Continue?
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction onClick={handleSingleSyncedDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        ) : (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs text-destructive hover:text-destructive"
                            onClick={() => handleDelete(s.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
