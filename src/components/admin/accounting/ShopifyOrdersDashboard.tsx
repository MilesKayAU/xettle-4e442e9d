/**
 * ShopifyOrdersDashboard — Gateway clearing invoices from Shopify Orders CSV
 * 
 * Shows per-gateway breakdown with order counts and amounts.
 * Users can review, confirm, save, and push to Xero.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import {
  Upload, FileText, CheckCircle2, XCircle, AlertTriangle,
  History, Loader2, Send, Eye, Trash2, Info, ShoppingCart,
} from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  parseShopifyOrdersCSV,
  buildShopifyOrdersInvoiceLines,
  type GatewayGroup,
} from '@/utils/shopify-orders-parser';
import {
  type StandardSettlement,
  saveSettlement,
  syncSettlementToXero,
  deleteSettlement,
  formatSettlementDate,
  formatAUD,
} from '@/utils/settlement-engine';
import XeroConnectionStatus from '@/components/admin/XeroConnectionStatus';

interface ShopifyOrdersDashboardProps {
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
    default:
      return <Badge variant="outline">{status}</Badge>;
  }
}

export default function ShopifyOrdersDashboard({ marketplace }: ShopifyOrdersDashboardProps) {
  const [activeTab, setActiveTab] = useState('upload');
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Parsed gateway groups
  const [gateways, setGateways] = useState<GatewayGroup[]>([]);
  const [skippedGateways, setSkippedGateways] = useState<GatewayGroup[]>([]);
  const [unpaidCount, setUnpaidCount] = useState(0);
  const [settlements, setSettlements] = useState<StandardSettlement[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  // History
  const [history, setHistory] = useState<SettlementRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);

  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase
        .from('settlements')
        .select('*')
        .eq('marketplace', 'shopify_orders')
        .order('period_end', { ascending: false })
        .limit(200);
      if (error) throw error;
      setHistory((data || []) as SettlementRecord[]);
    } catch { /* silent */ } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // ─── Upload & Parse ─────────────────────────────────────────────────

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    setFile(f);
    setGateways([]);
    setSkippedGateways([]);
    setSettlements([]);
    setSavedIds(new Set());
    setParseError(null);
    setUnpaidCount(0);
    setParsing(true);

    try {
      const text = await f.text();
      const result = parseShopifyOrdersCSV(text);
      if (result.success) {
        setGateways(result.gateways);
        setSkippedGateways(result.skippedGateways);
        setUnpaidCount(result.unpaidCount);
        setSettlements(result.settlements);

        const gwCount = result.gateways.length;
        const skippedCount = result.skippedGateways.reduce((s, g) => s + g.orderCount, 0);
        toast.success(
          `${result.totalOrderCount} orders parsed — ${gwCount} gateway${gwCount !== 1 ? 's' : ''} detected${skippedCount > 0 ? `, ${skippedCount} Shopify Payments orders skipped` : ''}`
        );
        setActiveTab('review');
      } else {
        setParseError(result.error);
        toast.error(result.error);
      }
    } catch (err: any) {
      setParseError(err.message || 'Unknown error');
      toast.error('Failed to parse CSV');
    } finally {
      setParsing(false);
    }
  };

  // ─── Save All ───────────────────────────────────────────────────────

  const handleSaveAll = async () => {
    if (settlements.length === 0) {
      toast.warning('No gateway settlements to save.');
      return;
    }
    setSaving(true);
    let saved = 0;
    const newSavedIds = new Set(savedIds);

    for (const s of settlements) {
      const result = await saveSettlement(s);
      if (result.success || result.duplicate) {
        saved++;
        newSavedIds.add(s.settlement_id);
      }
    }

    setSavedIds(newSavedIds);
    setSaving(false);
    toast.success(`Saved ${saved} of ${settlements.length} gateway clearing invoices`);
    loadHistory();
  };

  // ─── Push All to Xero ──────────────────────────────────────────────

  const handlePushAllToXero = async () => {
    const toPush = settlements.filter(s => savedIds.has(s.settlement_id));
    if (toPush.length === 0) {
      toast.warning('Save gateway invoices first before pushing to Xero.');
      return;
    }
    setPushing(true);
    let pushed = 0;

    for (const s of toPush) {
      const lineItems = buildShopifyOrdersInvoiceLines(s);
      const meta = s.metadata || {};
      const result = await syncSettlementToXero(s.settlement_id, 'shopify_orders', {
        lineItems,
        contactName: meta.contactName || meta.gatewayLabel || 'Shopify Gateway',
        reference: meta.reference,
      });
      if (result.success) pushed++;
    }

    setPushing(false);
    toast.success(`Pushed ${pushed} of ${toPush.length} clearing invoices to Xero`);
    loadHistory();
  };

  // ─── Push single from history ──────────────────────────────────────

  const handlePushToXero = async (settlementId: string) => {
    setPushing(true);
    // Find the settlement in history to get metadata
    const histRec = history.find(h => h.settlement_id === settlementId);
    const result = await syncSettlementToXero(settlementId, 'shopify_orders', {
      contactName: 'Shopify Gateway',
    });
    if (result.success) {
      toast.success(`Clearing invoice created in Xero!`);
      loadHistory();
    } else {
      toast.error(result.error || 'Failed to push to Xero');
    }
    setPushing(false);
  };

  // ─── Delete ─────────────────────────────────────────────────────────

  const handleDelete = async (id: string) => {
    const result = await deleteSettlement(id);
    if (result.success) {
      toast.success('Settlement deleted');
      loadHistory();
    } else {
      toast.error(result.error || 'Failed to delete');
    }
    setDeleteConfirmId(null);
  };

  const clearUpload = () => {
    setFile(null);
    setGateways([]);
    setSkippedGateways([]);
    setSettlements([]);
    setSavedIds(new Set());
    setParseError(null);
    setUnpaidCount(0);
    if (inputRef.current) inputRef.current.value = '';
    setActiveTab('upload');
  };

  const allSaved = settlements.length > 0 && settlements.every(s => savedIds.has(s.settlement_id));

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <span className="text-xl">🛒</span>
          Shopify Orders — Gateway Clearing
        </h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Upload your Shopify Orders CSV. Xettle groups orders by payment gateway and creates
          $0.00 clearing invoices for PayPal, Afterpay, Stripe, etc.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="upload" className="gap-1.5">
            <Upload className="h-3.5 w-3.5" /> Upload
          </TabsTrigger>
          <TabsTrigger value="review" className="gap-1.5" disabled={gateways.length === 0}>
            <Eye className="h-3.5 w-3.5" /> Review
            {gateways.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5">{gateways.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <History className="h-3.5 w-3.5" /> History
            {history.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5">{history.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {/* ─── Upload Tab ─────────────────────────────────────────── */}
        <TabsContent value="upload" className="space-y-4">
          <Card className={`border-2 transition-colors ${file ? 'border-green-400 bg-green-50/30' : 'border-dashed border-muted-foreground/25 hover:border-primary/40'}`}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                Shopify Orders CSV
                {file && <CheckCircle2 className="h-4 w-4 text-green-600 ml-auto" />}
              </CardTitle>
              <CardDescription className="text-xs">
                Export from Shopify Admin → Orders → Export. Xettle filters paid orders and groups by payment gateway.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <input
                ref={inputRef}
                type="file"
                accept=".csv"
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
                  <Loader2 className="h-4 w-4 animate-spin" /> Parsing orders...
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
                  <p className="font-medium text-foreground">How this works</p>
                  <ol className="list-decimal list-inside space-y-0.5">
                    <li>Export orders from Shopify Admin → Orders → Export</li>
                    <li>Xettle reads the <strong>Payment Method</strong> column</li>
                    <li>Orders paid via <strong>Shopify Payments</strong> are skipped (use the Shopify Payments tab)</li>
                    <li>Other gateways (PayPal, Afterpay, Stripe…) get a $0.00 clearing invoice each</li>
                  </ol>
                  <p className="mt-2 text-foreground font-medium">Invoice structure (per gateway):</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    <li>Line 1: Shopify Sales (201) — Subtotal ÷ 1.1, GST on Income</li>
                    <li>Line 2: Shopify Shipping Revenue (206) — Shipping ÷ 1.1, GST on Income</li>
                    <li>Line 3: Gateway Clearing (613) — negative Total, BAS Excluded</li>
                    <li><strong>Invoice total = $0.00</strong></li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ─── Review Tab ─────────────────────────────────────────── */}
        <TabsContent value="review" className="space-y-4">
          {unpaidCount > 0 && (
            <Card className="border-amber-400/50 bg-amber-50/30 dark:bg-amber-950/10">
              <CardContent className="py-3">
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <p className="text-sm text-amber-700 dark:text-amber-400">
                    {unpaidCount} order{unpaidCount !== 1 ? 's are' : ' is'} unpaid — skipped. Only paid orders create accounting entries.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="text-sm font-semibold text-foreground mb-2">
            Detected payment methods:
          </div>

          <div className="space-y-3">
            {/* Active gateways */}
            {gateways.map((g, idx) => {
              const s = settlements[idx];
              const isSaved = s ? savedIds.has(s.settlement_id) : false;
              return (
                <Card key={g.gateway} className={`border ${isSaved ? 'border-green-400/50 bg-green-50/20 dark:bg-green-950/10' : 'border-primary/20'}`}>
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="h-5 w-5 text-primary" />
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {g.gatewayLabel}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {g.orderCount} order{g.orderCount !== 1 ? 's' : ''} · {formatSettlementDate(g.periodStart)} – {formatSettlementDate(g.periodEnd)}
                          </p>
                        </div>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-foreground">{formatAUD(g.totalAmount)}</p>
                        {isSaved && (
                          <Badge variant="secondary" className="text-[10px] mt-1">✓ Saved</Badge>
                        )}
                      </div>
                    </div>

                    {/* Invoice breakdown */}
                    <div className="mt-3 bg-muted/40 rounded-lg p-3 space-y-1.5 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Sales (ex GST) → 201</span>
                        <span className="font-medium">{formatAUD(s?.sales_ex_gst || 0)}</span>
                      </div>
                      {s?.metadata?.shippingExGst > 0 && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Shipping Revenue (ex GST) → 206</span>
                          <span className="font-medium">{formatAUD(s.metadata.shippingExGst)}</span>
                        </div>
                      )}
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">GST on Income</span>
                        <span className="font-medium">{formatAUD(s?.gst_on_sales || 0)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">{g.gatewayLabel} Clearing → 613</span>
                        <span className="font-medium">{formatAUD(s?.metadata?.clearingAmount || 0)}</span>
                      </div>
                      <Separator className="my-1" />
                      <div className="flex justify-between font-semibold text-foreground">
                        <span>Invoice Total</span>
                        <span className="text-primary">$0.00</span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}

            {/* Skipped gateways */}
            {skippedGateways.map(g => (
              <Card key={g.gateway} className="border-muted bg-muted/20">
                <CardContent className="py-4">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <AlertTriangle className="h-5 w-5 text-amber-500" />
                      <div>
                        <p className="text-sm font-semibold text-muted-foreground">
                          {g.gatewayLabel}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {g.orderCount} order{g.orderCount !== 1 ? 's' : ''} — <span className="font-medium">skipped</span>
                        </p>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground italic">
                      Use Shopify Payments payout CSV instead
                    </p>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Action buttons */}
          {gateways.length > 0 && (
            <div className="flex gap-3 pt-2">
              {!allSaved ? (
                <Button onClick={handleSaveAll} disabled={saving} className="gap-2 flex-1">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Save {gateways.length} Gateway Invoice{gateways.length !== 1 ? 's' : ''}
                </Button>
              ) : (
                <Button onClick={handlePushAllToXero} disabled={pushing} className="gap-2 flex-1">
                  {pushing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Push All to Xero
                </Button>
              )}
              <Button variant="outline" onClick={clearUpload} className="gap-2">
                <Trash2 className="h-4 w-4" />
                Clear
              </Button>
            </div>
          )}
        </TabsContent>

        {/* ─── History Tab ────────────────────────────────────────── */}
        <TabsContent value="history" className="space-y-4">
          <XeroConnectionStatus variant="compact" />

          {historyLoading ? (
            <div className="flex items-center gap-2 py-8 justify-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" /> Loading history...
            </div>
          ) : history.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center text-muted-foreground">
                <ShoppingCart className="h-8 w-8 mx-auto mb-2 opacity-40" />
                <p className="text-sm">No gateway clearing invoices yet. Upload a Shopify Orders CSV to get started.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {history.map(s => (
                <Card key={s.id} className="border-border">
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {s.settlement_id.replace(/^shopify_/, '').replace(/_/g, ' ')}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {formatSettlementDate(s.period_start)} – {formatSettlementDate(s.period_end)}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        {statusBadge(s.status)}
                        {s.status !== 'synced' && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="gap-1.5 text-xs"
                            disabled={pushing}
                            onClick={() => handlePushToXero(s.settlement_id)}
                          >
                            <Send className="h-3 w-3" />
                            Push to Xero
                          </Button>
                        )}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="text-destructive h-7 w-7 p-0"
                          onClick={() => setDeleteConfirmId(s.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={(open) => !open && setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this settlement?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the settlement record. If already synced to Xero, the invoice will remain unchanged.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
