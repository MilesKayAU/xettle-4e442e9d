/**
 * ShopifyOrdersDashboard — Marketplace & gateway splitting from Shopify Orders CSV
 *
 * Shows per-marketplace/gateway breakdown with order counts, amounts, and
 * $0.00 clearing invoice previews. Supports unknown group review and AI suggestions.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import ShopifyOnboarding from './ShopifyOnboarding';
import SkuCostManager from './SkuCostManager';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Upload, FileText, CheckCircle2, XCircle, AlertTriangle,
  History, Loader2, Send, Eye, Trash2, Info, ShoppingCart,
  SkipForward, HelpCircle, Sparkles, ArrowRight, Package, TrendingUp,
} from 'lucide-react';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  detectFromFingerprints,
  saveFingerprint,
  incrementFingerprintMatch,
} from '@/utils/fingerprint-library';
import {
  parseShopifyOrdersCSV,
  buildShopifyOrdersInvoiceLines,
  buildSettlementsFromGroups,
  type MarketplaceGroup,
  type ShopifyOrdersParseResult,
} from '@/utils/shopify-orders-parser';
import {
  MARKETPLACE_REGISTRY,
  getRegistryEntry,
} from '@/utils/marketplace-registry';
import {
  type StandardSettlement,
  saveSettlement,
  syncSettlementToXero,
  deleteSettlement,
  formatSettlementDate,
  formatAUD,
} from '@/utils/settlement-engine';
import {
  extractUniqueSKUs,
  calculateProfit,
  type ProductCost,
  type ProfitEngineResult,
} from '@/utils/profit-engine';

interface SettlementRecord {
  id: string;
  settlement_id: string;
  period_start: string;
  period_end: string;
  bank_deposit: number;
  sales_principal: number;
  seller_fees: number;
  sales_shipping: number;
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

export default function ShopifyOrdersDashboard() {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [activeTab, setActiveTab] = useState('upload');
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);

  // Parsed data
  const [parseResult, setParseResult] = useState<ShopifyOrdersParseResult | null>(null);
  const [settlements, setSettlements] = useState<StandardSettlement[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());

  // History
  const [history, setHistory] = useState<SettlementRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [expandedHistoryId, setExpandedHistoryId] = useState<string | null>(null);
  const [showBookkeeperInfo, setShowBookkeeperInfo] = useState(false);
  const [pushStats, setPushStats] = useState<{ invoiceCount: number; totalRevenue: number; totalGst: number } | null>(null);
  const [aiSuggestions, setAiSuggestions] = useState<Record<number, { marketplace_name: string; marketplace_code: string; confidence: number; reasoning: string; loading: boolean }>>({}); 

  // Profit engine
  const [profitResult, setProfitResult] = useState<ProfitEngineResult | null>(null);
  const [showSkuManager, setShowSkuManager] = useState(false);
  const [detectedSKUs, setDetectedSKUs] = useState<string[]>([]);

  const inputRef = useRef<HTMLInputElement>(null);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { data, error } = await supabase
        .from('settlements')
        .select('*')
        .like('marketplace', 'shopify_orders_%')
        .order('period_end', { ascending: false })
        .limit(200);
      if (error) throw error;
      setHistory((data || []) as SettlementRecord[]);
    } catch { /* silent */ } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Show onboarding ONLY on first visit with no data
  // Once history loads or user uploads, onboarding never returns (unless manually re-triggered)
  useEffect(() => {
    if (!historyLoading && history.length === 0 && !file && !parseResult) {
      setShowOnboarding(true);
    } else if (history.length > 0) {
      setShowOnboarding(false);
    }
  }, [historyLoading, history.length, file, parseResult]);

  const handleOnboardingComplete = (result: ShopifyOrdersParseResult) => {
    setShowOnboarding(false);
    setParseResult(result);
    setSettlements(result.settlements);
    setActiveTab('review');
    toast.success(`${result.paidCount} paid orders parsed — ${result.groups.length} source${result.groups.length !== 1 ? 's' : ''} detected`);
  };

  // ─── Profit calculation — runs when parseResult changes ───────────
  useEffect(() => {
    if (!parseResult) {
      setProfitResult(null);
      setDetectedSKUs([]);
      return;
    }
    const allGroups = [...parseResult.groups, ...parseResult.unknownGroups];
    const skus = extractUniqueSKUs(allGroups);
    setDetectedSKUs(skus);

    // Load costs from DB and calculate
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || skus.length === 0) return;

        const { data } = await supabase
          .from('product_costs')
          .select('sku, cost, label, currency')
          .eq('user_id', user.id);

        const costMap = new Map<string, ProductCost>();
        for (const row of (data || [])) {
          costMap.set(row.sku.toUpperCase().trim(), {
            sku: row.sku.toUpperCase().trim(),
            cost: Number(row.cost),
            currency: row.currency || 'AUD',
            label: row.label || undefined,
          });
        }

        const result = calculateProfit(allGroups, costMap);
        setProfitResult(result);
      } catch { /* silent */ }
    })();
  }, [parseResult]);

  const handleCostsSaved = (costMap: Map<string, ProductCost>) => {
    if (!parseResult) return;
    const allGroups = [...parseResult.groups, ...parseResult.unknownGroups];
    const result = calculateProfit(allGroups, costMap);
    setProfitResult(result);
  };

  // ─── Upload & Parse ─────────────────────────────────────────────────

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;

    setFile(f);
    setParseResult(null);
    setSettlements([]);
    setSavedIds(new Set());
    setParseError(null);
    setParsing(true);

    try {
      const text = await f.text();
      const result = parseShopifyOrdersCSV(text);
      if (result.success) {
        setParseResult(result);
        setSettlements(result.settlements);

        const readyCount = result.groups.length;
        const skippedCount = result.skippedGroups.reduce((s, g) => s + g.orderCount, 0);
        const unknownCount = result.unknownGroups.reduce((s, g) => s + g.orderCount, 0);

        toast.success(
          `${result.paidCount} paid orders parsed — ${readyCount} source${readyCount !== 1 ? 's' : ''} detected` +
          (skippedCount > 0 ? `, ${skippedCount} Shopify Payments skipped` : '') +
          (unknownCount > 0 ? `, ${unknownCount} unknown` : '')
        );
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

  // ─── Assign unknown group to a marketplace ──────────────────────────
  // `fromFingerprint` flag prevents double-saving when fingerprint library already matched
  const assignUnknownGroup = (groupIdx: number, marketplaceKey: string, fromFingerprint = false) => {
    if (!parseResult) return;
    const group = parseResult.unknownGroups[groupIdx];
    if (!group) return;

    if (marketplaceKey === 'skip') {
      const newUnknown = parseResult.unknownGroups.filter((_, i) => i !== groupIdx);
      const newSkipped = [...parseResult.skippedGroups, { ...group, skipped: true, status: 'skipped' as const, skipReason: 'Manually skipped' }];
      setParseResult({ ...parseResult, unknownGroups: newUnknown, skippedGroups: newSkipped });
      return;
    }

    // Save fingerprint from manual assignment (user_confirmed = highest trust)
    // Skip if this assignment came from the fingerprint library (already stored)
    if (!fromFingerprint) {
      const sampleNote = (group.sampleNoteAttributes || [])[0] || '';
      const sampleTag = (group.sampleTags || [])[0] || '';
      const samplePm = group.orders[0]?.paymentMethod || '';
      // Truncate to max 200 chars to avoid saving giant note attribute blobs
      const truncate = (s: string) => s.length > 200 ? s.substring(0, 200) : s;
      if (sampleNote) {
        saveFingerprint({ marketplace_code: marketplaceKey, field: 'note_attributes', pattern: truncate(sampleNote), confidence: 1.0, source: 'user_confirmed' });
      } else if (sampleTag) {
        saveFingerprint({ marketplace_code: marketplaceKey, field: 'tags', pattern: truncate(sampleTag), confidence: 1.0, source: 'user_confirmed' });
      } else if (samplePm) {
        saveFingerprint({ marketplace_code: marketplaceKey, field: 'payment_method', pattern: truncate(samplePm), confidence: 1.0, source: 'user_confirmed' });
      }
    }

    const entry = getRegistryEntry(marketplaceKey);
    const updatedGroup: MarketplaceGroup = {
      ...group,
      marketplaceKey,
      registryEntry: entry,
      status: 'ready',
    };

    const newUnknown = parseResult.unknownGroups.filter((_, i) => i !== groupIdx);
    const newReady = [...parseResult.groups, updatedGroup];
    const newSettlements = buildSettlementsFromGroups(newReady);

    setParseResult({ ...parseResult, groups: newReady, unknownGroups: newUnknown, settlements: newSettlements });
    setSettlements(newSettlements);
  };

  // ─── Save All ───────────────────────────────────────────────────────

  const handleSaveAll = async () => {
    if (settlements.length === 0) {
      toast.warning('No settlements to save.');
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
        if (result.duplicate) {
          toast.info(`${s.metadata?.displayName || s.marketplace} already exists — skipped.`);
        }
      }
    }

    setSavedIds(newSavedIds);
    setSaving(false);
    toast.success(`Saved ${saved} of ${settlements.length} clearing invoices`);
    loadHistory();
  };

  // ─── Push All to Xero ──────────────────────────────────────────────

  const handlePushAllToXero = async () => {
    const toPush = settlements.filter(s => savedIds.has(s.settlement_id));
    if (toPush.length === 0) {
      toast.warning('Save clearing invoices first before pushing to Xero.');
      return;
    }
    setPushing(true);
    let pushed = 0;
    let totalRevenue = 0;
    let totalGst = 0;

    for (const s of toPush) {
      const lineItems = buildShopifyOrdersInvoiceLines(s);
      const meta = s.metadata || {};

      // Verify $0.00 balance before pushing
      const lineTotal = lineItems.reduce((sum, l) => sum + round2(l.UnitAmount * l.Quantity) + (l.TaxAmount || 0), 0);
      if (Math.abs(lineTotal) > 0.02) {
        toast.error(`Invoice balancing error for ${meta.displayName} — please contact support`);
        continue;
      }

      const result = await syncSettlementToXero(s.settlement_id, s.marketplace, {
        lineItems,
        contactName: meta.contactName || meta.displayName || 'Marketplace',
        reference: meta.reference,
      });
      if (result.success) {
        pushed++;
        totalRevenue += (meta.salesInclGst || 0) + (meta.shippingInclGst || 0);
        totalGst += (meta.gstOnSales || 0) + (meta.gstOnShipping || 0);
      }
    }

    setPushing(false);
    setPushStats({ invoiceCount: pushed, totalRevenue, totalGst });
    toast.success(`Pushed ${pushed} of ${toPush.length} clearing invoices to Xero`);
    setShowBookkeeperInfo(true);
    loadHistory();
  };

// ─── AI Detection Cache (session-level, survives re-renders) ────────
  // Key: hash of note_attributes + tags + payment_method → cached result
  const aiCacheRef = useRef<Map<string, { marketplace_name: string; marketplace_code: string; confidence: number; reasoning: string; loading: boolean }>>(new Map());

  const buildCacheKey = (group: MarketplaceGroup): string => {
    const attrs = JSON.stringify(group.sampleNoteAttributes || []);
    const tags = JSON.stringify(group.sampleTags || []);
    const pm = group.orders[0]?.paymentMethod || '';
    return `${attrs}|${tags}|${pm}`;
  };

  // ─── AI Marketplace Detection for Unknown Groups ──────────────────
  const requestAiDetection = async (groupIdx: number, group: MarketplaceGroup) => {
    if (group.orderCount < 3) return;

    // Check in-memory cache first
    const cacheKey = buildCacheKey(group);
    const cached = aiCacheRef.current.get(cacheKey);
    if (cached) {
      setAiSuggestions(prev => ({ ...prev, [groupIdx]: cached }));
      if (cached.confidence >= 90 && cached.marketplace_code) {
        assignUnknownGroup(groupIdx, cached.marketplace_code);
      }
      return;
    }

    // ── Level 2: Fingerprint library check (DB, fast) ──────────────
    try {
      const sampleNote = (group.sampleNoteAttributes || []).join(' ');
      const sampleTags = (group.sampleTags || []).join(', ');
      const samplePm = group.orders[0]?.paymentMethod || '';

      const fpMatch = await detectFromFingerprints(sampleNote, sampleTags, samplePm);
      if (fpMatch && fpMatch.confidence >= 0.85) {
        const fpResult = {
          marketplace_name: fpMatch.marketplace_code.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
          marketplace_code: fpMatch.marketplace_code,
          confidence: Math.round(fpMatch.confidence * 100),
          reasoning: `Matched fingerprint: "${fpMatch.pattern}" in ${fpMatch.field} (${fpMatch.match_count} prior matches)`,
          loading: false,
        };
        aiCacheRef.current.set(cacheKey, fpResult);
        setAiSuggestions(prev => ({ ...prev, [groupIdx]: fpResult }));
        incrementFingerprintMatch(fpMatch.field, fpMatch.pattern);

        if (fpResult.confidence >= 90) {
          assignUnknownGroup(groupIdx, fpResult.marketplace_code, true);
          toast.success(`Fingerprint detected: ${fpResult.marketplace_name} (instant)`);
        }
        return;
      }
    } catch {
      // Fingerprint lookup failed — fall through to AI
    }

    // ── Level 3: AI fallback ────────────────────────────────────────
    setAiSuggestions(prev => ({ ...prev, [groupIdx]: { marketplace_name: '', marketplace_code: '', confidence: 0, reasoning: '', loading: true } }));

    try {
      const invokePromise = supabase.functions.invoke('ai-file-interpreter', {
        body: {
          action: 'detect_marketplace',
          note_attributes_samples: group.sampleNoteAttributes || [],
          tags_samples: group.sampleTags || [],
          payment_method: group.orders[0]?.paymentMethod || '',
          row_count: group.orderCount,
        },
      });
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('AI detection timed out')), 5000)
      );

      const { data, error } = await Promise.race([invokePromise, timeoutPromise]);
      if (error) throw error;

      const suggestion = {
        marketplace_name: data.marketplace_name || '',
        marketplace_code: data.marketplace_code || '',
        confidence: data.confidence || 0,
        reasoning: data.reasoning || '',
        loading: false,
      };

      aiCacheRef.current.set(cacheKey, suggestion);
      setAiSuggestions(prev => ({ ...prev, [groupIdx]: suggestion }));

      // Save AI detection as a fingerprint for future uploads
      if (suggestion.confidence >= 70 && suggestion.marketplace_code && data.detection_field && data.pattern) {
        saveFingerprint({
          marketplace_code: suggestion.marketplace_code,
          field: data.detection_field,
          pattern: data.pattern,
          confidence: suggestion.confidence / 100,
          source: 'ai_detected',
        });
      }

      if (suggestion.confidence >= 90 && suggestion.marketplace_code) {
        assignUnknownGroup(groupIdx, suggestion.marketplace_code);
        toast.success(`AI auto-detected: ${suggestion.marketplace_name} (${suggestion.confidence}% confidence)`);
      }
    } catch (err) {
      const reason = err instanceof Error && err.message === 'AI detection timed out'
        ? 'AI detection timed out — choose manually'
        : 'AI detection failed';
      const failResult = { marketplace_name: '', marketplace_code: '', confidence: 0, reasoning: reason, loading: false };
      aiCacheRef.current.set(cacheKey, failResult);
      setAiSuggestions(prev => ({ ...prev, [groupIdx]: failResult }));
    }
  };

  // Trigger AI detection for unknown groups with 3+ orders on parse
  useEffect(() => {
    if (!parseResult) return;
    parseResult.unknownGroups.forEach((g, idx) => {
      if (g.orderCount >= 3 && !aiSuggestions[idx]) {
        requestAiDetection(idx, g);
      }
    });
  }, [parseResult?.unknownGroups.length]);

  // ─── Push single from history ──────────────────────────────────────

  const handlePushToXero = async (settlementId: string, marketplace: string) => {
    setPushing(true);
    const result = await syncSettlementToXero(settlementId, marketplace, {
      contactName: marketplace.replace('shopify_orders_', '').split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    });
    if (result.success) {
      toast.success('Clearing invoice created in Xero!');
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
    setParseResult(null);
    setSettlements([]);
    setSavedIds(new Set());
    setParseError(null);
    setShowBookkeeperInfo(false);
    if (inputRef.current) inputRef.current.value = '';
    setActiveTab('upload');
  };

  const allSaved = settlements.length > 0 && settlements.every(s => savedIds.has(s.settlement_id));

  // Show onboarding flow for first-time users
  if (showOnboarding && !historyLoading) {
    return (
      <ShopifyOnboarding
        onComplete={handleOnboardingComplete}
        onMarketplacesChanged={loadHistory}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <span className="text-xl">🛒</span>
          All Marketplace & Gateway Orders
        </h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Recognise revenue from MyDeal, Bunnings, Kogan, PayPal, Afterpay and all other channels in one upload.
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="upload" className="gap-1.5">
            <Upload className="h-3.5 w-3.5" /> Upload
          </TabsTrigger>
          <TabsTrigger value="review" className="gap-1.5" disabled={!parseResult}>
            <Eye className="h-3.5 w-3.5" /> Review
            {parseResult && (
              <Badge variant="secondary" className="ml-1 text-[10px] px-1.5">
                {parseResult.groups.length + parseResult.unknownGroups.length}
              </Badge>
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
          <Card className={`border-2 transition-colors ${file ? 'border-green-400 bg-green-50/30 dark:bg-green-950/10' : 'border-dashed border-muted-foreground/25 hover:border-primary/40'}`}>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <FileText className="h-4 w-4 text-primary" />
                Shopify Orders Export CSV
                {file && <CheckCircle2 className="h-4 w-4 text-green-600 ml-auto" />}
              </CardTitle>
              <CardDescription className="text-xs">
                Export from Shopify Admin → Orders → Export. Xettle reads Note Attributes, Tags, and Payment Method
                to split orders by marketplace and gateway automatically.
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
                  <Loader2 className="h-4 w-4 animate-spin" /> Parsing orders and detecting marketplaces...
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
                    <li>Xettle reads <strong>Note Attributes</strong>, <strong>Tags</strong>, and <strong>Payment Method</strong></li>
                    <li>Orders are grouped by marketplace (MyDeal, Bunnings, Kogan…) and gateway (PayPal, Afterpay…)</li>
                    <li>Shopify Payments orders are <strong>skipped</strong> — use the Shopify Payments section above</li>
                    <li>Each source gets a <strong>$0.00 clearing invoice</strong> in Xero</li>
                  </ol>
                  <p className="mt-2 text-foreground font-medium">Invoice structure (per source):</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    <li>Line 1: Sales (ex GST) — GST on Income</li>
                    <li>Line 2: Shipping Revenue (ex GST) — GST on Income</li>
                    <li>Line 3: Clearing — negative total, BAS Excluded</li>
                    <li><strong>Invoice total = $0.00</strong></li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Re-run setup button */}
          <div className="flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="text-xs text-muted-foreground"
              onClick={() => { clearUpload(); setShowOnboarding(true); }}
            >
              <ShoppingCart className="h-3.5 w-3.5 mr-1" />
              Re-run Shopify setup
            </Button>
          </div>
        </TabsContent>

        {/* ─── Review Tab ─────────────────────────────────────────── */}
        <TabsContent value="review" className="space-y-4">
          {parseResult && (
            <>
              {/* Summary header */}
              <Card className="border-primary/20 bg-primary/5">
                <CardContent className="py-4">
                  <div className="flex items-center justify-between flex-wrap gap-3">
                    <div>
                      <p className="text-sm font-semibold text-foreground">
                        Shopify Orders Export
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatSettlementDate(parseResult.periodStart)} to {formatSettlementDate(parseResult.periodEnd)} ·{' '}
                        {parseResult.totalOrderCount} total orders · {parseResult.paidCount} paid ·{' '}
                        {parseResult.unpaidCount > 0 && <span className="text-amber-600">{parseResult.unpaidCount} skipped (unpaid)</span>}
                      </p>
                    </div>
                    <Button variant="outline" size="sm" onClick={clearUpload}>
                      <Trash2 className="h-3.5 w-3.5 mr-1" /> Clear
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Partial period warning */}
              {parseResult.partialPeriodWarning && (
                <Card className="border-orange-400/50 bg-orange-50/30 dark:bg-orange-950/10">
                  <CardContent className="py-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-orange-600" />
                      <p className="text-sm text-orange-700 dark:text-orange-400">
                        ⚠ These orders include the last 3 days. You may not yet have all marketplace orders.
                        Importing a partial period can cause incomplete revenue recognition.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              {parseResult.unpaidCount > 0 && (
                <Card className="border-amber-400/50 bg-amber-50/30 dark:bg-amber-950/10">
                  <CardContent className="py-3">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <p className="text-sm text-amber-700 dark:text-amber-400">
                        {parseResult.unpaidCount} order{parseResult.unpaidCount !== 1 ? 's are' : ' is'} unpaid — skipped. Only paid orders create accounting entries.
                        {parseResult.duplicateLineItemCount > 0 && (
                          <> · {parseResult.duplicateLineItemCount} duplicate line item row{parseResult.duplicateLineItemCount !== 1 ? 's' : ''} merged.</>
                        )}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}

              <div className="text-sm font-semibold text-foreground">Detected sources:</div>

              <div className="space-y-3">
                {/* ── Ready groups ── */}
                {parseResult.groups.map((g, idx) => {
                  const s = settlements.find(s => s.metadata?.marketplaceKey === g.marketplaceKey && s.metadata?.currency === g.currency);
                  const isSaved = s ? savedIds.has(s.settlement_id) : false;
                  return (
                    <Card key={`${g.marketplaceKey}_${g.currency}`} className={`border ${isSaved ? 'border-green-400/50 bg-green-50/20 dark:bg-green-950/10' : 'border-primary/20'}`}>
                      <CardContent className="py-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <CheckCircle2 className="h-5 w-5 text-primary" />
                            <div>
                              <p className="text-sm font-semibold text-foreground">
                                {g.registryEntry.display_name}
                                {g.currency !== 'AUD' && <Badge variant="outline" className="ml-2 text-[10px]">{g.currency}</Badge>}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {g.orderCount} order{g.orderCount !== 1 ? 's' : ''} · {formatSettlementDate(g.periodStart)} – {formatSettlementDate(g.periodEnd)}
                              </p>
                            </div>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-bold text-foreground">{formatAUD(g.totalAmount)} {g.currency}</p>
                            {isSaved && <Badge variant="secondary" className="text-[10px] mt-1">✓ Saved</Badge>}
                          </div>
                        </div>

                        {/* Invoice line preview */}
                        {s && (
                          <div className="mt-3 bg-muted/40 rounded-lg p-3 space-y-1.5 text-xs">
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">Sales (ex GST) → {s.metadata?.salesAccountCode}</span>
                              <span className="font-medium">{formatAUD(s.metadata?.salesExGst || 0)}</span>
                            </div>
                            {(s.metadata?.shippingExGst || 0) > 0 && (
                              <div className="flex justify-between">
                                <span className="text-muted-foreground">Shipping Revenue (ex GST) → {s.metadata?.shippingAccountCode}</span>
                                <span className="font-medium">{formatAUD(s.metadata?.shippingExGst || 0)}</span>
                              </div>
                            )}
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">GST on Income</span>
                              <span className="font-medium">{formatAUD(s.gst_on_sales)}</span>
                            </div>
                            <div className="flex justify-between">
                              <span className="text-muted-foreground">{g.registryEntry.display_name} Clearing → {s.metadata?.clearingAccountCode}</span>
                              <span className="font-medium">{formatAUD(s.metadata?.clearingAmount || 0)}</span>
                            </div>
                            <Separator className="my-1" />
                            <div className="flex justify-between font-semibold text-foreground">
                              <span>Invoice Total</span>
                              <span className="text-primary">$0.00</span>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  );
                })}

                {/* ── Skipped groups ── */}
                {parseResult.skippedGroups.map((g) => (
                  <Card key={`skip_${g.marketplaceKey}_${g.currency}`} className="border border-muted bg-muted/20">
                    <CardContent className="py-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <SkipForward className="h-5 w-5 text-muted-foreground" />
                          <div>
                            <p className="text-sm font-semibold text-muted-foreground">
                              {g.registryEntry.display_name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {g.orderCount} order{g.orderCount !== 1 ? 's' : ''} — <span className="italic">{g.skipReason || 'skipped'}</span>
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-medium text-muted-foreground">{formatAUD(g.totalAmount)} {g.currency}</p>
                          <Badge variant="outline" className="text-[10px] mt-1 text-muted-foreground">skipped</Badge>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}

                {/* ── Unknown groups ── */}
                {parseResult.unknownGroups.map((g, idx) => (
                  <Card key={`unknown_${idx}`} className="border border-amber-400/50 bg-amber-50/20 dark:bg-amber-950/10">
                    <CardContent className="py-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <HelpCircle className="h-5 w-5 text-amber-600" />
                          <div>
                            <p className="text-sm font-semibold text-amber-700 dark:text-amber-400">
                              Unknown Source
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {g.orderCount} order{g.orderCount !== 1 ? 's' : ''} · needs review
                            </p>
                          </div>
                        </div>
                        <p className="text-sm font-bold text-amber-700 dark:text-amber-400">{formatAUD(g.totalAmount)} {g.currency}</p>
                      </div>

                      {/* Sample data */}
                      <div className="bg-muted/40 rounded-lg p-3 space-y-2 text-xs">
                        {g.sampleNoteAttributes && g.sampleNoteAttributes.length > 0 && (
                          <div>
                            <span className="font-medium text-foreground">Note Attributes: </span>
                            {g.sampleNoteAttributes.map((n, i) => (
                              <span key={i} className="text-muted-foreground">
                                {i > 0 && ' | '}{n.substring(0, 80)}{n.length > 80 ? '…' : ''}
                              </span>
                            ))}
                          </div>
                        )}
                        {g.sampleTags && g.sampleTags.length > 0 && (
                          <div>
                            <span className="font-medium text-foreground">Tags: </span>
                            {g.sampleTags.map((t, i) => (
                              <span key={i} className="text-muted-foreground">
                                {i > 0 && ' | '}{t.substring(0, 60)}{t.length > 60 ? '…' : ''}
                              </span>
                            ))}
                          </div>
                        )}
                        <div>
                          <span className="font-medium text-foreground">Payment Method: </span>
                          <span className="text-muted-foreground">{g.orders[0]?.paymentMethod || '—'}</span>
                        </div>
                      </div>

                      {/* AI suggestion */}
                      {aiSuggestions[idx] && !aiSuggestions[idx].loading && aiSuggestions[idx].confidence >= 70 && aiSuggestions[idx].confidence < 90 && (
                        <div className="flex items-center gap-2 bg-primary/5 border border-primary/20 rounded-lg p-2">
                          <Sparkles className="h-4 w-4 text-primary flex-shrink-0" />
                          <div className="flex-1 text-xs">
                            <span className="font-medium text-foreground">AI thinks this is: {aiSuggestions[idx].marketplace_name}</span>
                            <Badge variant="secondary" className="ml-2 text-[10px]">{aiSuggestions[idx].confidence}%</Badge>
                            <p className="text-muted-foreground mt-0.5">{aiSuggestions[idx].reasoning}</p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => assignUnknownGroup(idx, aiSuggestions[idx].marketplace_code)}
                          >
                            Accept
                          </Button>
                        </div>
                      )}
                      {aiSuggestions[idx]?.loading && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>AI analysing pattern…</span>
                        </div>
                      )}

                      {/* Manual assignment */}
                      <div className="flex items-center gap-2">
                        <Select onValueChange={(val) => assignUnknownGroup(idx, val)}>
                          <SelectTrigger className="w-48 h-8 text-xs">
                            <SelectValue placeholder="Assign to marketplace…" />
                          </SelectTrigger>
                          <SelectContent>
                            {Object.entries(MARKETPLACE_REGISTRY)
                              .filter(([, e]) => !e.skip)
                              .map(([key, entry]) => (
                                <SelectItem key={key} value={key} className="text-xs">
                                  {entry.display_name}
                                </SelectItem>
                              ))}
                            <SelectItem value="skip" className="text-xs text-muted-foreground">
                              Skip this group
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* ── Profit Summary ── */}
              {profitResult && profitResult.totalRevenue > 0 && (
                <Card className="border-primary/20">
                  <CardContent className="py-4 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <TrendingUp className="h-5 w-5 text-primary" />
                        <span className="text-sm font-semibold text-foreground">Marketplace Profit</span>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="text-xs gap-1.5"
                        onClick={() => setShowSkuManager(!showSkuManager)}
                      >
                        <Package className="h-3 w-3" />
                        {showSkuManager ? 'Hide costs' : 'Edit product costs'}
                      </Button>
                    </div>

                    {profitResult.uncostedSKUs.length > 0 && (
                      <div className="flex items-center gap-1.5 text-xs text-amber-600">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {profitResult.uncostedSKUs.length} of {profitResult.allSKUs.length} SKUs missing cost data — profit is estimated
                      </div>
                    )}

                    {/* Per-marketplace profit cards */}
                    <div className="grid gap-2">
                      {profitResult.marketplaces.map(mp => (
                        <div key={mp.marketplaceKey} className="bg-muted/40 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-semibold text-foreground">{mp.marketplaceLabel}</span>
                            {mp.isEstimated && (
                              <Badge variant="outline" className="text-[9px] text-amber-600 border-amber-300">estimated</Badge>
                            )}
                          </div>
                          <div className="grid grid-cols-4 gap-2 text-xs">
                            <div>
                              <span className="text-muted-foreground">Revenue</span>
                              <p className="font-medium text-foreground">{formatAUD(mp.revenue)}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">COGS</span>
                              <p className="font-medium text-foreground">{formatAUD(mp.cogs)}</p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Profit</span>
                              <p className={`font-bold ${mp.grossProfit >= 0 ? 'text-primary' : 'text-destructive'}`}>
                                {formatAUD(mp.grossProfit)}
                              </p>
                            </div>
                            <div>
                              <span className="text-muted-foreground">Margin</span>
                              <p className={`font-bold ${mp.marginPct >= 30 ? 'text-primary' : mp.marginPct >= 15 ? 'text-foreground' : 'text-destructive'}`}>
                                {mp.marginPct.toFixed(1)}%
                              </p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Totals row */}
                    {profitResult.marketplaces.length > 1 && (
                      <div className="bg-primary/5 rounded-lg p-3 border border-primary/20">
                        <div className="grid grid-cols-4 gap-2 text-xs">
                          <div>
                            <span className="text-muted-foreground font-medium">Total Revenue</span>
                            <p className="font-bold text-foreground">{formatAUD(profitResult.totalRevenue)}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground font-medium">Total COGS</span>
                            <p className="font-bold text-foreground">{formatAUD(profitResult.totalCogs)}</p>
                          </div>
                          <div>
                            <span className="text-muted-foreground font-medium">Total Profit</span>
                            <p className={`font-bold ${profitResult.totalProfit >= 0 ? 'text-primary' : 'text-destructive'}`}>
                              {formatAUD(profitResult.totalProfit)}
                            </p>
                          </div>
                          <div>
                            <span className="text-muted-foreground font-medium">Avg Margin</span>
                            <p className="font-bold text-foreground">{profitResult.totalMarginPct.toFixed(1)}%</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* ── SKU Cost Manager (expandable) ── */}
              {showSkuManager && detectedSKUs.length > 0 && (
                <SkuCostManager
                  skus={detectedSKUs}
                  onCostsSaved={handleCostsSaved}
                  compact
                />
              )}

              {/* SKU prompt for users with no costs set */}
              {profitResult && profitResult.costedSKUs.length === 0 && detectedSKUs.length > 0 && !showSkuManager && (
                <Card className="border-dashed border-primary/30">
                  <CardContent className="py-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Package className="h-4 w-4 text-primary" />
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            We found {detectedSKUs.length} unique SKUs
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Add product costs to see profit per marketplace
                          </p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" className="text-xs" onClick={() => setShowSkuManager(true)}>
                          Add costs now
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Action buttons */}
              <div className="flex items-center gap-3 pt-2">
                {!allSaved ? (
                  <Button onClick={handleSaveAll} disabled={saving || settlements.length === 0}>
                    {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
                    Save All ({settlements.length} invoice{settlements.length !== 1 ? 's' : ''})
                  </Button>
                ) : (
                  <Button onClick={handlePushAllToXero} disabled={pushing}>
                    {pushing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Send className="h-4 w-4 mr-1" />}
                    Confirm and push all to Xero →
                  </Button>
                )}
                {parseResult.unknownGroups.length > 0 && (
                  <p className="text-xs text-amber-600">
                    ⚠ {parseResult.unknownGroups.length} unknown group{parseResult.unknownGroups.length !== 1 ? 's' : ''} — assign or skip before pushing
                  </p>
                )}
              </div>

              {/* Bookkeeper instructions */}
              {showBookkeeperInfo && (
                <Card className="border-primary/30 bg-primary/5">
                  <CardContent className="py-4 space-y-3">
                    <p className="text-sm font-semibold text-foreground flex items-center gap-2">
                      <CheckCircle2 className="h-4 w-4 text-primary" /> Revenue recognised ✅
                    </p>
                    {pushStats && (
                      <div className="grid grid-cols-3 gap-3 text-xs">
                        <div className="bg-background rounded-lg p-2 text-center">
                          <p className="text-muted-foreground">Invoices pushed</p>
                          <p className="text-lg font-bold text-foreground">{pushStats.invoiceCount}</p>
                        </div>
                        <div className="bg-background rounded-lg p-2 text-center">
                          <p className="text-muted-foreground">Total revenue</p>
                          <p className="text-lg font-bold text-foreground">{formatAUD(pushStats.totalRevenue)}</p>
                        </div>
                        <div className="bg-background rounded-lg p-2 text-center">
                          <p className="text-muted-foreground">Total GST</p>
                          <p className="text-lg font-bold text-foreground">{formatAUD(pushStats.totalGst)}</p>
                        </div>
                      </div>
                    )}
                    <div className="text-xs text-muted-foreground space-y-2">
                      <p className="font-medium text-foreground">To complete reconciliation in Xero:</p>
                      <div>
                        <p className="font-medium">Marketplace bank transfers (Bunnings, MyDeal, Kogan, Big W):</p>
                        <p>→ Upload their settlement CSV/PDF to Xettle, OR when bank transfer arrives match it to Account 613 in Xero bank feed</p>
                      </div>
                      <div>
                        <p className="font-medium">PayPal / Afterpay / Stripe payouts:</p>
                        <p>→ When payout hits your bank, match it to Account 613 in Xero bank feed</p>
                      </div>
                      <div>
                        <p className="font-medium">Shopify Payments:</p>
                        <p>→ Upload Shopify Payments payout CSV to the section above — Xettle creates the bank-matching invoice</p>
                      </div>
                      <p className="mt-2 text-foreground font-medium">Account 613 should net to zero each period once all payments are received.</p>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          )}
        </TabsContent>

        {/* ─── History Tab ─────────────────────────────────────────── */}
        <TabsContent value="history" className="space-y-4">
          {historyLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-8 justify-center">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading history...
            </div>
          ) : history.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="py-8 text-center">
                <p className="text-sm text-muted-foreground">No Shopify Orders clearing invoices yet.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
          {history.map((s) => {
                const mktKey = s.marketplace.replace('shopify_orders_', '');
                const entry = getRegistryEntry(mktKey);
                const revenue = (s.sales_principal || 0) + (s.gst_on_income || 0);
                const isExpanded = expandedHistoryId === s.id;
                return (
                  <Card key={s.id}>
                    <CardContent className="py-3">
                      <div className="flex items-center justify-between">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-sm font-medium text-foreground truncate">
                              {entry.display_name}
                            </p>
                            {statusBadge(s.status)}
                          </div>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatSettlementDate(s.period_start)} – {formatSettlementDate(s.period_end)}
                          </p>
                        </div>
                        <div className="flex items-center gap-3">
                          <div className="text-right">
                            <span className="text-sm font-semibold text-foreground">{formatAUD(revenue)}</span>
                            <p className="text-[10px] text-muted-foreground">clearing invoice: $0.00</p>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            onClick={() => setExpandedHistoryId(isExpanded ? null : s.id)}
                          >
                            <Eye className="h-3.5 w-3.5" />
                          </Button>
                          {s.status !== 'synced' && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs gap-1"
                              disabled={pushing}
                              onClick={() => handlePushToXero(s.settlement_id, s.marketplace)}
                            >
                              <Send className="h-3 w-3" /> Push
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-destructive hover:text-destructive"
                            onClick={() => setDeleteConfirmId(s.id)}
                          >
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                      {isExpanded && (
                        <div className="mt-3 pt-3 border-t border-border space-y-1.5">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Sales ex GST</span>
                            <span className="font-medium text-foreground">{formatAUD(s.sales_principal || 0)}</span>
                          </div>
                          {(s.gst_on_income || 0) !== 0 && (
                            <div className="flex justify-between text-xs">
                              <span className="text-muted-foreground">GST on Sales</span>
                              <span className="font-medium text-foreground">{formatAUD(s.gst_on_income || 0)}</span>
                            </div>
                          )}
                          {(s.seller_fees || 0) !== 0 && (
                            <div className="flex justify-between text-xs">
                              <span className="text-muted-foreground">Fees</span>
                              <span className="font-medium text-foreground">{formatAUD(s.seller_fees || 0)}</span>
                            </div>
                          )}
                          <div className="flex justify-between text-xs pt-1 border-t border-border/50">
                            <span className="text-muted-foreground">Clearing Line</span>
                            <span className="font-medium text-foreground">{formatAUD(-(s.sales_principal || 0) - (s.gst_on_income || 0))}</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground pt-1">
                            Net invoice total: $0.00 — revenue offset by gateway clearing account
                          </p>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this clearing invoice?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the settlement record. Any invoice already in Xero will not be affected.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteConfirmId && handleDelete(deleteConfirmId)}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
