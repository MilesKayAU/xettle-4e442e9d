/**
 * PublicDemoUpload — "Try it free" demo on the landing page.
 * 
 * No auth required. File is analysed client-side only.
 * Parsed data stored in sessionStorage for post-signup transfer.
 */

import { useState, useRef, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Upload, CheckCircle2, AlertTriangle, Loader2,
  FileSpreadsheet, FileText, ArrowRight, Shield, XCircle,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { detectFile, MARKETPLACE_LABELS, type FileDetectionResult } from '@/utils/file-fingerprint-engine';
import { type StandardSettlement } from '@/utils/settlement-engine';

// ─── Types ──────────────────────────────────────────────────────────────────

type DemoStep = 'idle' | 'detecting' | 'detected' | 'wrong_file' | 'error';

interface DemoState {
  step: DemoStep;
  fileName?: string;
  detection?: FileDetectionResult;
  settlements?: StandardSettlement[];
  error?: string;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatAUD(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(amount).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d: string): string {
  if (!d) return '—';
  const dt = new Date(d + 'T00:00:00');
  return dt.toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
}

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const ALLOWED_TYPES = ['.csv', '.tsv', '.txt', '.xlsx', '.xls', '.pdf'];

const MARKETPLACE_ICONS: Record<string, string> = {
  amazon_au: '📦',
  bunnings: '🔨',
  shopify_payments: '💳',
  kogan: '🛒',
  catch: '🎯',
  mydeal: '🏷️',
  woolworths: '🛍️',
};

// ─── Component ──────────────────────────────────────────────────────────────

export default function PublicDemoUpload() {
  const [state, setState] = useState<DemoState>({ step: 'idle' });
  const [isDragging, setIsDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currentUser, setCurrentUser] = useState<any>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  // Check if user is already logged in
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => setCurrentUser(user));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setCurrentUser(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const processFile = useCallback(async (file: File) => {
    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      setState({ step: 'error', fileName: file.name, error: 'File too large — max 5MB for the demo.' });
      return;
    }

    // Validate file type
    const ext = '.' + file.name.split('.').pop()?.toLowerCase();
    if (!ALLOWED_TYPES.includes(ext)) {
      setState({ step: 'error', fileName: file.name, error: `Unsupported file type. Try CSV, TSV, XLSX, or PDF.` });
      return;
    }

    setState({ step: 'detecting', fileName: file.name });

    try {
      // Step 1: Detect marketplace
      const detection = await detectFile(file);

      if (!detection) {
        setState({ step: 'error', fileName: file.name, error: 'Could not read this file. Try a different format.' });
        return;
      }

      if (!detection.isSettlementFile) {
        setState({
          step: 'wrong_file',
          fileName: file.name,
          detection,
        });
        return;
      }

      // Step 2: Parse settlements client-side
      const marketplace = detection.marketplace;
      let settlements: StandardSettlement[] = [];

      if (marketplace === 'bunnings' && file.name.toLowerCase().endsWith('.pdf')) {
        const { parseBunningsSummaryPdf } = await import('@/utils/bunnings-summary-parser');
        const result = await parseBunningsSummaryPdf(file);
        if (result.success) settlements = [result.settlement];
      } else if (marketplace === 'shopify_payments') {
        const { parseShopifyPayoutCSV } = await import('@/utils/shopify-payments-parser');
        const text = await file.text();
        const result = parseShopifyPayoutCSV(text);
        if (result.success) settlements = result.settlements;
      } else if (marketplace === 'amazon_au') {
        // Amazon TSV parser
        const { parseSettlementTSV } = await import('@/utils/settlement-parser');
        const text = await file.text();
        const parsed = parseSettlementTSV(text, { gstRate: 10 });
        // Convert ParsedSettlement to StandardSettlement for display
        settlements = [{
          marketplace: 'amazon_au',
          settlement_id: parsed.header.settlementId,
          period_start: parsed.header.periodStart,
          period_end: parsed.header.periodEnd,
          sales_ex_gst: parsed.summary.salesPrincipal,
          gst_on_sales: parsed.summary.gstOnIncome,
          fees_ex_gst: -(Math.abs(parsed.summary.sellerFees) + Math.abs(parsed.summary.fbaFees)),
          gst_on_fees: parsed.summary.gstOnExpenses,
          net_payout: parsed.summary.bankDeposit,
          source: 'csv_upload',
          reconciles: parsed.summary.reconciliationMatch,
          metadata: {
            salesShipping: parsed.summary.salesShipping,
            sellerFees: parsed.summary.sellerFees,
            fbaFees: parsed.summary.fbaFees,
            storageFees: parsed.summary.storageFees,
            refunds: parsed.summary.refunds,
            reimbursements: parsed.summary.reimbursements,
            promotionalDiscounts: parsed.summary.promotionalDiscounts,
            otherFees: parsed.summary.otherFees,
          },
        }];
      } else {
        // Generic CSV parser
        const { parseGenericCSV } = await import('@/utils/generic-csv-parser');
        const text = await file.text();
        const mapping = detection.columnMapping || {};
        const result = parseGenericCSV(text, {
          marketplace,
          mapping,
          gstModel: 'seller',
          gstRate: 10,
          groupBySettlement: !!mapping.settlement_id,
          fallbackSettlementId: `${marketplace}-demo-${Date.now()}`,
        });
        if (result.success) settlements = result.settlements;
      }

      if (settlements.length === 0) {
        setState({ step: 'error', fileName: file.name, error: 'Could not parse settlement data from this file.' });
        return;
      }

      // Store in sessionStorage for post-signup transfer
      try {
        sessionStorage.setItem('xettle_demo_settlements', JSON.stringify(settlements));
        sessionStorage.setItem('xettle_demo_marketplace', marketplace);
      } catch { /* quota exceeded */ }

      setState({
        step: 'detected',
        fileName: file.name,
        detection,
        settlements,
      });
    } catch (err: any) {
      setState({ step: 'error', fileName: file.name, error: err.message || 'Analysis failed' });
    }
  }, []);

  const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
    if (inputRef.current) inputRef.current.value = '';
  }, [processFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }, [processFile]);

  const reset = () => setState({ step: 'idle' });

  // ─── Render: Idle / Drop Zone ─────────────────────────────────────────────

  if (state.step === 'idle') {
    return (
      <div className="w-full max-w-3xl mx-auto">
        <div
          className={`border-[3px] border-dashed rounded-2xl transition-all cursor-pointer ${
            isDragging
              ? 'border-primary bg-primary/15 scale-[1.01] shadow-lg shadow-primary/20'
              : 'border-primary/40 hover:border-primary hover:bg-primary/10 bg-primary/5'
          }`}
          onDrop={handleDrop}
          onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
          onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
          onClick={() => inputRef.current?.click()}
        >
          <div className="py-14 md:py-16 px-6 text-center">
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xls,.pdf"
              onChange={handleFileSelect}
              className="hidden"
            />
            <div className="h-16 w-16 rounded-2xl bg-primary/15 flex items-center justify-center mx-auto mb-5">
              <Upload className="h-8 w-8 text-primary" />
            </div>
            <p className="text-xl md:text-2xl font-bold text-foreground mb-2">
              Drop your settlement file here
            </p>
            <p className="text-base text-muted-foreground mb-5">
              Amazon TSV · Shopify CSV · Bunnings PDF · Any marketplace
            </p>
            <Button size="lg" variant="outline" className="mb-5 pointer-events-none border-primary/30 text-primary font-semibold">
              <Upload className="h-4 w-4 mr-2" />
              Choose file or drag & drop
            </Button>
            <div className="flex flex-wrap justify-center gap-2 mb-4">
              {['CSV', 'TSV', 'XLSX', 'PDF'].map(f => (
                <Badge key={f} variant="outline" className="text-xs px-2.5 py-0.5">{f}</Badge>
              ))}
            </div>
            <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground/70">
              <Shield className="h-3.5 w-3.5" />
              Max 5MB · Analysed in your browser · Never stored
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ─── Render: Detecting ────────────────────────────────────────────────────

  if (state.step === 'detecting') {
    return (
      <div className="w-full max-w-2xl mx-auto">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="py-10 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary mx-auto mb-4" />
            <p className="text-sm font-medium text-foreground">Analysing your file…</p>
            <p className="text-xs text-muted-foreground mt-1">{state.fileName}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Render: Error ────────────────────────────────────────────────────────

  if (state.step === 'error') {
    return (
      <div className="w-full max-w-2xl mx-auto">
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="py-8 text-center">
            <XCircle className="h-8 w-8 text-destructive mx-auto mb-3" />
            <p className="text-sm font-medium text-foreground mb-1">{state.error}</p>
            <p className="text-xs text-muted-foreground mb-4">{state.fileName}</p>
            <Button variant="outline" size="sm" onClick={reset}>
              Try another file
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Render: Wrong File ───────────────────────────────────────────────────

  if (state.step === 'wrong_file' && state.detection) {
    return (
      <div className="w-full max-w-2xl mx-auto space-y-4">
        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-6">
            <div className="flex items-start gap-3">
              <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-foreground">
                  This looks like a {state.detection.marketplaceLabel} file, but not a settlement report
                </p>
                {state.detection.wrongFileMessage && (
                  <p className="text-sm text-muted-foreground mt-1">{state.detection.wrongFileMessage}</p>
                )}
                {state.detection.correctReportPath && (
                  <div className="mt-3 bg-background rounded-lg border border-border p-3">
                    <p className="text-xs font-medium text-foreground mb-1">How to get the right file:</p>
                    <p className="text-xs text-muted-foreground">{state.detection.correctReportPath}</p>
                  </div>
                )}
                <Button variant="outline" size="sm" className="mt-4" onClick={reset}>
                  Try again
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Render: Detected — Settlement Preview + Xero Preview ─────────────────

  if (state.step === 'detected' && state.settlements && state.detection) {
    const s = state.settlements[0];
    const marketplace = state.detection.marketplace;
    const icon = MARKETPLACE_ICONS[marketplace] || '📋';
    const label = state.detection.marketplaceLabel;
    const meta = s.metadata || {};
    const isAmazon = marketplace === 'amazon_au';

    return (
      <div className="w-full max-w-2xl mx-auto space-y-4">
        {/* Detection Result */}
        <div className="flex items-center gap-3 bg-primary/10 border border-primary/20 rounded-xl px-4 py-3">
          <CheckCircle2 className="h-5 w-5 text-primary flex-shrink-0" />
          <div className="flex-1">
            <p className="text-sm font-semibold text-foreground">
              Detected: {label} Settlement
              {state.settlements.length > 1 && (
                <Badge variant="secondary" className="ml-2 text-[10px]">{state.settlements.length} settlements</Badge>
              )}
            </p>
            <p className="text-xs text-muted-foreground">
              {state.settlements.length === 1
                ? `Period: ${formatDate(s.period_start)} – ${formatDate(s.period_end)} · Deposit: ${formatAUD(s.net_payout)}`
                : `${state.settlements.length} settlement periods detected`
              }
            </p>
          </div>
          <span className="text-2xl">{icon}</span>
        </div>

        {/* Marketplace tab animation */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-primary bg-primary/10 text-foreground font-medium text-sm">
            <span>{icon}</span>
            <span>{label}</span>
            <CheckCircle2 className="h-3 w-3 text-primary" />
          </div>
          <span className="text-xs text-muted-foreground">← Your marketplace tab, ready to go</span>
        </div>

        {/* Settlement Summary Card */}
        <Card className="border-border">
          <CardContent className="py-0">
            <div className="py-4 border-b border-border">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-lg">{icon}</span>
                <h3 className="text-base font-semibold text-foreground">{label} Settlement</h3>
              </div>
              <p className="text-xs text-muted-foreground">
                {formatDate(s.period_start)} – {formatDate(s.period_end)}
                {s.settlement_id && ` · ID: ${s.settlement_id}`}
              </p>
            </div>

            <div className="py-4 space-y-2">
              {/* Line items — varies by marketplace */}
              {isAmazon ? (
                <>
                  <LineItem label="Amazon Sales — Principal" amount={meta.salesPrincipal ?? s.sales_ex_gst} />
                  {meta.salesShipping ? <LineItem label="Amazon Sales — Shipping" amount={meta.salesShipping} /> : null}
                  {meta.promotionalDiscounts ? <LineItem label="Promotional Discounts" amount={-Math.abs(meta.promotionalDiscounts)} /> : null}
                  <LineItem label="Seller Fees" amount={meta.sellerFees ?? s.fees_ex_gst} />
                  {meta.fbaFees ? <LineItem label="FBA Fees" amount={meta.fbaFees} /> : null}
                  {meta.storageFees ? <LineItem label="Storage Fees" amount={meta.storageFees} /> : null}
                  {meta.refunds ? <LineItem label="Refunds" amount={meta.refunds} /> : null}
                  {meta.reimbursements ? <LineItem label="Reimbursements" amount={meta.reimbursements} /> : null}
                  {meta.otherFees ? <LineItem label="Other Fees" amount={meta.otherFees} /> : null}
                </>
              ) : (
                <>
                  <LineItem label="Sales (ex GST)" amount={s.sales_ex_gst} />
                  <LineItem label="Marketplace Fees (ex GST)" amount={s.fees_ex_gst} />
                  {meta.refundsExGst ? <LineItem label="Refunds" amount={meta.refundsExGst} /> : null}
                  {meta.shippingExGst ? <LineItem label="Shipping Revenue" amount={meta.shippingExGst} /> : null}
                  {meta.subscriptionAmount ? <LineItem label="Subscription" amount={meta.subscriptionAmount} /> : null}
                </>
              )}

              <div className="border-t border-border pt-2 mt-2 space-y-1.5">
                {s.gst_on_sales > 0 && <LineItem label="GST on Income" amount={s.gst_on_sales} muted />}
                {s.gst_on_fees > 0 && <LineItem label="GST on Expenses" amount={-s.gst_on_fees} muted />}
              </div>

              <div className="border-t border-border pt-2 mt-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-foreground">Bank Deposit</span>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold text-primary">{formatAUD(s.net_payout)}</span>
                    {s.reconciles ? (
                      <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">
                        <CheckCircle2 className="h-3 w-3 mr-0.5" /> Reconciled
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-500/40 text-amber-600 text-[10px]">
                        <AlertTriangle className="h-3 w-3 mr-0.5" /> Check
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Xero Invoice Preview */}
        <Card className="border-border bg-card">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="h-6 w-6 rounded bg-[#13B5EA]/10 flex items-center justify-center">
                <span className="text-[10px] font-bold text-[#13B5EA]">X</span>
              </div>
              <span className="text-sm font-semibold text-foreground">Xero Invoice Preview</span>
            </div>
            <div className="bg-muted/50 rounded-lg border border-border p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Invoice</span>
                <span className="font-mono text-foreground">INV-XXXX</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Contact</span>
                <span className="font-medium text-foreground">
                  {marketplace === 'amazon_au' ? 'Amazon.com.au' :
                   marketplace === 'bunnings' ? 'Bunnings Marketplace' :
                   marketplace === 'shopify_payments' ? 'Shopify Payments' :
                   `${label} Marketplace`}
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Date</span>
                <span className="text-foreground">{formatDate(s.period_end)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Amount</span>
                <span className="font-semibold text-foreground">AUD {formatAUD(s.net_payout)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Status</span>
                <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">Ready to post</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* CTA */}
        <div className="space-y-3">
          {currentUser ? (
            <Button
              size="lg"
              className="w-full text-base py-6"
              disabled={saving}
              onClick={async () => {
                if (!state.settlements || !state.detection) return;
                setSaving(true);
                try {
                  const marketplace = state.detection.marketplace;
                  const { saveSettlement } = await import('@/utils/settlement-engine');
                  const { MARKETPLACE_CATALOG } = await import('@/components/admin/accounting/MarketplaceSwitcher');

                  // Ensure marketplace connection exists
                  const { data: existing } = await supabase
                    .from('marketplace_connections')
                    .select('id')
                    .eq('marketplace_code', marketplace)
                    .maybeSingle();

                  if (!existing) {
                    const catDef = MARKETPLACE_CATALOG.find(m => m.code === marketplace);
                    await supabase.from('marketplace_connections').insert({
                      user_id: currentUser.id,
                      marketplace_code: marketplace,
                      marketplace_name: catDef?.name || marketplace,
                      country_code: catDef?.country || 'AU',
                      connection_type: 'auto_detected',
                      connection_status: 'active',
                    } as any);
                  }

                  // Save settlements
                  for (const s of state.settlements) {
                    await saveSettlement(s);
                  }

                  navigate('/dashboard');
                } catch (err: any) {
                  console.error('Failed to save:', err);
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? <Loader2 className="h-5 w-5 animate-spin mr-2" /> : null}
              Save to my account & go to dashboard
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          ) : (
            <Button
              size="lg"
              className="w-full text-base py-6"
              onClick={() => navigate('/auth?tab=signup&demo=1')}
            >
              Push to Xero — Create free account
              <ArrowRight className="ml-2 h-5 w-5" />
            </Button>
          )}
          <p className="text-xs text-muted-foreground/70 text-center flex items-center justify-center gap-1.5">
            <Shield className="h-3 w-3" />
            {currentUser
              ? 'Your settlement will be saved to your account and ready to sync.'
              : 'Your file was analysed in your browser only. Nothing was stored.'
            }
          </p>
          <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={reset}>
            Try another file
          </Button>
        </div>
      </div>
    );
  }

  return null;
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function LineItem({ label, amount, muted }: { label: string; amount: number; muted?: boolean }) {
  if (amount === 0) return null;
  return (
    <div className="flex justify-between text-sm">
      <span className={muted ? 'text-muted-foreground text-xs' : 'text-muted-foreground'}>{label}</span>
      <span className={`font-medium tabular-nums ${amount < 0 ? 'text-destructive' : muted ? 'text-muted-foreground text-xs' : 'text-foreground'}`}>
        {formatAUD(amount)}
      </span>
    </div>
  );
}
