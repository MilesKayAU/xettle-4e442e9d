import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Upload, FileText, CheckCircle2, XCircle, AlertTriangle,
  History, Loader2, Send, Eye, Trash2, Info, ChevronDown, SkipForward,
  CheckSquare, Square
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { parseShopifyPayoutCSV, buildShopifyInvoiceLines, type ShopifyParseExtra } from '@/utils/shopify-payments-parser';
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

interface UploadWarning {
  type: 'duplicate' | 'gap';
  message: string;
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
  // Restore persisted state
  const persisted = (() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  })();

  const [activeTab, setActiveTab] = useState(persisted?.parsed ? 'review' : 'upload');
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parsed, setParsed] = useState<StandardSettlement | null>(persisted?.parsed ?? null);
  const [extra, setExtra] = useState<ShopifyParseExtra | null>(persisted?.extra ?? null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [savedSettlementId, setSavedSettlementId] = useState<string | null>(persisted?.savedId ?? null);
  const [uploadWarning, setUploadWarning] = useState<UploadWarning | null>(persisted?.warning ?? null);

  const [settlements, setSettlements] = useState<SettlementRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function persistState(p: StandardSettlement | null, e: ShopifyParseExtra | null, w: UploadWarning | null, sid: string | null) {
    try { localStorage.setItem(LS_KEY, JSON.stringify({ parsed: p, extra: e, warning: w, savedId: sid })); } catch { /* ignore */ }
  }
  function clearPersistedState() {
    try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
  }

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase
        .from('settlements')
        .select('*')
        .eq('marketplace', 'shopify_payments')
        .order('period_end', { ascending: false })
        .limit(50);
      if (error) throw error;
      setSettlements((data || []) as SettlementRecord[]);
    } catch { /* silent */ } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // ─── Duplicate / gap checks ─────────────────────────────────────────────

  function checkDuplicateAndGap(incoming: StandardSettlement, existing: SettlementRecord[]): UploadWarning | null {
    const exactMatch = existing.find(s => s.settlement_id === incoming.settlement_id);
    if (exactMatch) {
      return {
        type: 'duplicate',
        message: `Payout ${incoming.settlement_id} is already saved (${formatSettlementDate(exactMatch.period_start)}). Saving will overwrite it.`,
      };
    }
    const fingerprint = existing.find(s =>
      s.period_start === incoming.period_start &&
      s.period_end === incoming.period_end &&
      Math.abs((s.bank_deposit || 0) - incoming.net_payout) < 1.00
    );
    if (fingerprint) {
      return {
        type: 'duplicate',
        message: `A payout on ${formatSettlementDate(incoming.period_start)} with similar amount already exists (${fingerprint.settlement_id}). This appears to be a duplicate.`,
      };
    }
    return null;
  }

  // ─── CSV Upload & Parse ─────────────────────────────────────────────────

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    // Cross-marketplace detection
    const { detectFileMarketplace, MARKETPLACE_LABELS } = await import('@/utils/file-marketplace-detector');
    const detected = await detectFileMarketplace(f);
    if (detected && detected !== 'shopify_payments') {
      toast.warning(`This looks like a ${MARKETPLACE_LABELS[detected] || detected} file. Switch to the correct tab to upload it.`, { duration: 6000 });
      return;
    }

    setFile(f);
    setParsed(null);
    setExtra(null);
    setParseError(null);
    setSavedSettlementId(null);
    setUploadWarning(null);
    setParsing(true);

    try {
      const text = await f.text();
      const result = parseShopifyPayoutCSV(text);
      if (result.success) {
        setParsed(result.settlement);
        setExtra(result.extra);
        const warning = checkDuplicateAndGap(result.settlement, settlements);
        setUploadWarning(warning);
        persistState(result.settlement, result.extra, warning, null);
        if (warning?.type === 'duplicate') {
          toast.warning('Duplicate detected — review before saving.');
        } else if (result.settlement.reconciles) {
          toast.success(`Payout ${result.settlement.settlement_id} parsed & reconciled ✓`);
        } else {
          toast.warning(`Payout parsed but reconciliation failed — diff: ${formatAUD(result.settlement.metadata?.reconciliationDiff || 0)}`);
        }
        setActiveTab('review');
      } else {
        const errMsg = result.error;
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

  // ─── Save ───────────────────────────────────────────────────────────────

  const handleSave = async () => {
    if (!parsed) return;
    if (!parsed.reconciles) {
      toast.error('Cannot save — payout does not reconcile within $0.05');
      return;
    }
    setSaving(true);
    const result = await saveSettlement(parsed);
    if (result.success) {
      setSavedSettlementId(parsed.settlement_id);
      persistState(parsed, extra, uploadWarning, parsed.settlement_id);
      toast.success('Payout saved!');
      loadHistory();
    } else if (result.duplicate) {
      toast.warning('Already saved — use overwrite if needed.');
    } else {
      toast.error(result.error || 'Failed to save');
    }
    setSaving(false);
  };

  // ─── Push to Xero ──────────────────────────────────────────────────────

  const handlePushToXero = async (settlementId?: string, settlementData?: StandardSettlement) => {
    const targetId = settlementId || savedSettlementId || parsed?.settlement_id;
    if (!targetId) return;

    const dataToCheck = settlementData || parsed;
    if (dataToCheck) {
      const reconResult = runUniversalReconciliation(dataToCheck);
      if (!reconResult.canSync) {
        toast.error('Critical reconciliation issues — resolve before syncing to Xero.');
        return;
      }
    }

    setPushing(true);
    const lineItems = dataToCheck ? buildShopifyInvoiceLines(dataToCheck) : undefined;
    const result = await syncSettlementToXero(targetId, 'shopify_payments', {
      lineItems,
      contactName: 'Shopify Payments',
    });
    if (result.success) {
      clearPersistedState();
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
    toast.success(`Deleted ${deleted} payout${deleted !== 1 ? 's' : ''}`);
    loadHistory();
  };

  const clearUpload = () => {
    setFile(null);
    setParsed(null);
    setExtra(null);
    setParseError(null);
    setSavedSettlementId(null);
    setUploadWarning(null);
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

  const meta = parsed?.metadata || {};

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <span className="text-xl">💳</span>
          Shopify Payments Settlements
        </h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Upload payout CSVs, reconcile, and sync to Xero.
        </p>
      </div>

      <MarketplaceAlertsBanner marketplaceCode="shopify_payments" />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="upload" className="gap-1.5">
            <Upload className="h-3.5 w-3.5" /> Upload
          </TabsTrigger>
          <TabsTrigger value="review" className="gap-1.5" disabled={!parsed}>
            <Eye className="h-3.5 w-3.5" /> Review
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
                Shopify Payments Payout CSV
                {file && <CheckCircle2 className="h-4 w-4 text-green-600 ml-auto" />}
              </CardTitle>
              <CardDescription className="text-xs">
                Export from Shopify Admin → Settings → Payments → View payouts → Export.
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
                  <Loader2 className="h-4 w-4 animate-spin" /> Parsing...
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
                  <p className="font-medium text-foreground">How to export your Shopify Payments payout</p>
                  <ol className="list-decimal list-inside space-y-0.5">
                    <li>Go to Shopify Admin → Settings → Payments → View payouts</li>
                    <li>Click on a specific payout to see its details</li>
                    <li>Click "Export" to download the CSV</li>
                    <li>Upload the CSV here</li>
                  </ol>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Review Tab ─────────────────────────────────────────── */}
        <TabsContent value="review" className="space-y-4">
          {parsed && (
            <>
              {/* Warning banner */}
              {uploadWarning && (
                <div className={`p-3 rounded-md border ${uploadWarning.type === 'duplicate' ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-blue-50 border-blue-200 text-blue-800'}`}>
                  <p className="text-sm flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4" /> {uploadWarning.message}
                  </p>
                </div>
              )}

              {/* Reconciliation status */}
              <Card className={parsed.reconciles ? 'border-green-300 bg-green-50/30' : 'border-destructive bg-destructive/5'}>
                <CardContent className="py-4">
                  <div className="flex items-center gap-3">
                    {parsed.reconciles ? (
                      <CheckCircle2 className="h-5 w-5 text-green-600" />
                    ) : (
                      <XCircle className="h-5 w-5 text-destructive" />
                    )}
                    <div>
                      <p className="text-sm font-medium">
                        {parsed.reconciles ? 'Reconciled ✓' : 'Reconciliation FAILED'}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Gross {formatAUD(meta.grossSalesInclGst || 0)} + Refunds {formatAUD(meta.refundsInclGst || 0)} + Fees {formatAUD(meta.chargesInclGst || 0)}
                        {meta.adjustments ? ` + Adj ${formatAUD(meta.adjustments)}` : ''}
                        {' '}= {formatAUD(meta.calculatedNet || 0)} vs Bank Deposit {formatAUD(parsed.net_payout)}
                        {!parsed.reconciles && ` (diff: ${formatAUD(meta.reconciliationDiff || 0)})`}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Payout summary */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">
                    Payout {parsed.settlement_id}
                  </CardTitle>
                  <CardDescription>
                    {formatSettlementDate(parsed.period_start)}
                    {parsed.period_start !== parsed.period_end && ` – ${formatSettlementDate(parsed.period_end)}`}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                    <div>
                      <p className="text-xs text-muted-foreground">Gross Sales</p>
                      <p className="font-mono font-medium text-green-700">{formatAUD(meta.grossSalesInclGst || 0)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Refunds</p>
                      <p className="font-mono font-medium text-red-600">{formatAUD(meta.refundsInclGst || 0)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Shopify Fees</p>
                      <p className="font-mono font-medium text-red-600">{formatAUD(meta.chargesInclGst || 0)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Net Payout (Bank)</p>
                      <p className="font-mono font-semibold text-foreground">{formatAUD(parsed.net_payout)}</p>
                    </div>
                  </div>

                  {/* Xero mapping preview */}
                  <div className="mt-6 border-t pt-4">
                    <p className="text-xs font-medium text-muted-foreground mb-2">Xero Invoice Preview</p>
                    <div className="text-xs space-y-1 font-mono">
                      <div className="flex justify-between">
                        <span>Sales (200, GST on Income)</span>
                        <span className="text-green-700">{formatAUD(parsed.sales_ex_gst)}</span>
                      </div>
                      {meta.refundsExGst && meta.refundsExGst !== 0 && (
                        <div className="flex justify-between">
                          <span>Refunds (200, GST on Income)</span>
                          <span className="text-red-600">{formatAUD(meta.refundsExGst)}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span>Shopify Fees (404, GST on Expenses)</span>
                        <span className="text-red-600">{formatAUD(parsed.fees_ex_gst)}</span>
                      </div>
                      <div className="flex justify-between border-t pt-1 font-medium">
                        <span>Invoice Total</span>
                        <span>{formatAUD(parsed.net_payout)}</span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Action buttons */}
              <div className="flex gap-3">
                <Button variant="outline" onClick={clearUpload}>
                  Clear
                </Button>
                {!savedSettlementId ? (
                  <Button onClick={handleSave} disabled={saving || !parsed.reconciles}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Save Payout
                  </Button>
                ) : (
                  <Button onClick={() => handlePushToXero()} disabled={pushing}>
                    {pushing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                    Push to Xero
                  </Button>
                )}
              </div>
            </>
          )}
          {!parsed && (
            <Card>
              <CardContent className="py-12 text-center text-muted-foreground">
                <Upload className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">Upload a Shopify Payments payout CSV to review.</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ─── History Tab ────────────────────────────────────────── */}
        <TabsContent value="history" className="space-y-4">
          {/* Xero connection status */}
          <XeroConnectionStatus />

          {/* Bulk actions */}
          {settlements.length > 0 && (
            <div className="flex items-center gap-3 text-sm">
              <button onClick={toggleSelectAll} className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground">
                {selected.size === settlements.length ? <CheckSquare className="h-4 w-4" /> : <Square className="h-4 w-4" />}
                {selected.size > 0 ? `${selected.size} selected` : 'Select all'}
              </button>
              {selected.size > 0 && (
                <Button variant="destructive" size="sm" onClick={handleBulkDelete} disabled={bulkDeleting}>
                  {bulkDeleting ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Trash2 className="h-3 w-3 mr-1" />}
                  Delete Selected
                </Button>
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
                <p className="text-xs mt-1">Upload a payout CSV to get started.</p>
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
                        {s.status === 'saved' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => handlePushToXero(s.settlement_id)}
                          >
                            <Send className="h-3 w-3 mr-1" /> Push
                          </Button>
                        )}
                        {s.status !== 'synced' && (
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