/**
 * ShopifyOnboarding — Guided first-time upload flow
 *
 * 3 phases:
 *   A) Instructions + drag-drop upload
 *   B) Detection animation (sequential progress steps)
 *   C) Results: marketplace cards + next steps
 */

import React, { useState, useRef, useCallback } from 'react';
import SkuCostManager from './SkuCostManager';
import UnknownEntityDialog from './UnknownEntityDialog';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Upload, CheckCircle2, ChevronDown, FileText, ShoppingCart,
  ArrowRight, Loader2, SkipForward, Calendar, Info, Package, Zap,
} from 'lucide-react';
import { extractUniqueSKUs } from '@/utils/profit-engine';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import {
  parseShopifyOrdersCSV,
  buildSettlementsFromGroups,
  type ShopifyOrdersParseResult,
  type MarketplaceGroup,
} from '@/utils/shopify-orders-parser';
import { MARKETPLACE_REGISTRY, getRegistryEntry } from '@/utils/marketplace-registry';
import { convertApiOrdersToRows, type ShopifyApiOrder } from '@/utils/shopify-api-adapter';
import { detectUnknownEntities, type UnknownEntity } from '@/utils/entity-detection';

interface ShopifyOnboardingProps {
  /** Called when onboarding finishes — passes parsed result to parent dashboard */
  onComplete: (result: ShopifyOrdersParseResult) => void;
  /** Called after marketplace connections are auto-created */
  onMarketplacesChanged?: () => void;
}

type Phase = 'upload' | 'detecting' | 'results';

interface DetectionStep {
  label: string;
  done: boolean;
}

const SUPPORTED_MARKETPLACES = [
  'MyDeal', 'Bunnings', 'Kogan', 'Big W', 'Everyday Market',
  'PayPal', 'Afterpay', 'Zip Pay', 'Laybuy',
];

// Marketplace keys for the unknown-group dropdown
const ASSIGNABLE_MARKETPLACES = Object.entries(MARKETPLACE_REGISTRY)
  .filter(([k, v]) => k !== 'unknown' && !v.skip)
  .map(([k, v]) => ({ key: k, label: v.display_name || k }))
  .sort((a, b) => a.label.localeCompare(b.label));

export default function ShopifyOnboarding({ onComplete, onMarketplacesChanged }: ShopifyOnboardingProps) {
  const [phase, setPhase] = useState<Phase>('upload');
  const [dragging, setDragging] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // API fetch state
  const [apiFetching, setApiFetching] = useState(false);
  const [shopDomain, setShopDomain] = useState<string | null>(null);
  const [shopConnected, setShopConnected] = useState(false);
  const [unknownEntities, setUnknownEntities] = useState<UnknownEntity[]>([]);
  const [showEntityDialog, setShowEntityDialog] = useState(false);

  // Check if Shopify is connected on mount
  React.useEffect(() => {
    (async () => {
      try {
        const { data } = await supabase.functions.invoke('shopify-auth', {
          method: 'GET',
          headers: { 'x-action': 'status' },
        });
        if (data?.connected && data?.shops?.length > 0) {
          setShopConnected(true);
          setShopDomain(data.shops[0].shop_domain);
        }
      } catch { /* silent */ }
    })();
  }, []);

  // Detection phase
  const [steps, setSteps] = useState<DetectionStep[]>([
    { label: 'Reading your file...', done: false },
    { label: 'Detecting marketplaces...', done: false },
    { label: 'Found marketplaces', done: false },
    { label: 'Building your account tabs...', done: false },
  ]);
  const [progressPct, setProgressPct] = useState(0);

  // Results phase
  const [result, setResult] = useState<ShopifyOrdersParseResult | null>(null);
  const [unknownAssignments, setUnknownAssignments] = useState<Record<number, string>>({});
  const [pushed, setPushed] = useState(false);
  const [showSkuManager, setShowSkuManager] = useState(false);

  // ─── Upload handling ──────────────────────────────────────────────

  const processFile = useCallback(async (file: File) => {
    if (!file.name.toLowerCase().endsWith('.csv')) {
      toast.error('Please upload a .csv file');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error('File is too large (max 10 MB)');
      return;
    }

    // Switch to detection phase
    setPhase('detecting');
    setProgressPct(0);

    try {
      // Step 1 — Reading
      const text = await file.text();
      await tick(400);
      completeStep(0);
      setProgressPct(25);

      // Step 2 — Detecting
      await tick(500);
      const parsed = parseShopifyOrdersCSV(text);
      completeStep(1);
      setProgressPct(50);

      if (!parsed.success) {
        toast.error((parsed as any).error || 'Could not parse CSV');
        setPhase('upload');
        return;
      }

      const pr = parsed as ShopifyOrdersParseResult;

      // Step 3 — Found X
      await tick(400);
      setSteps(prev => prev.map((s, i) => i === 2 ? { ...s, label: `Found ${pr.groups.length + pr.unknownGroups.length} marketplace${pr.groups.length + pr.unknownGroups.length !== 1 ? 's' : ''}` } : s));
      completeStep(2);
      setProgressPct(75);

      // Step 4 — Building tabs (auto-create marketplace_connections)
      await tick(500);
      await autoCreateConnections(pr.groups);
      completeStep(3);
      setProgressPct(100);

      await tick(300);
      setResult(pr);
      setPhase('results');
    } catch (err: any) {
      toast.error(err.message || 'Failed to process file');
      setPhase('upload');
    }
  }, []);

  function completeStep(idx: number) {
    setSteps(prev => prev.map((s, i) => i === idx ? { ...s, done: true } : s));
  }

  function tick(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Auto-insert marketplace_connections for detected groups
  async function autoCreateConnections(groups: MarketplaceGroup[]) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: existing } = await supabase
        .from('marketplace_connections')
        .select('marketplace_code');

      const existingCodes = new Set((existing || []).map((e: any) => e.marketplace_code));

      for (const g of groups) {
        const code = `shopify_orders_${g.marketplaceKey}`;
        if (existingCodes.has(code)) continue;

        await supabase.from('marketplace_connections').insert({
          user_id: user.id,
          marketplace_code: code,
          marketplace_name: g.registryEntry.display_name || g.marketplaceKey,
          country_code: 'AU',
          connection_type: 'auto_detected',
          connection_status: 'active',
        } as any);
      }

      onMarketplacesChanged?.();
    } catch {
      // Non-fatal — connections can be created later
    }
  }

  // ─── API Fetch ─────────────────────────────────────────────────────
  const handleApiFetch = useCallback(async () => {
    if (!shopDomain) {
      toast.error('No Shopify store connected');
      return;
    }

    setPhase('detecting');
    setProgressPct(0);
    setApiFetching(true);

    try {
      // Step 1 — Fetching
      setSteps([
        { label: 'Fetching orders from Shopify...', done: false },
        { label: 'Detecting marketplaces...', done: false },
        { label: 'Found marketplaces', done: false },
        { label: 'Building your account tabs...', done: false },
      ]);

      const { data, error } = await supabase.functions.invoke('fetch-shopify-orders', {
        body: { shopDomain, limit: 250 },
      });

      if (error || !data?.success) {
        throw new Error(data?.error || error?.message || 'Failed to fetch orders');
      }

      completeStep(0);
      setProgressPct(25);

      // Step 2 — Detect
      await tick(400);
      const apiOrders: ShopifyApiOrder[] = data.orders || [];
      const { rows, unpaidCount } = convertApiOrdersToRows(apiOrders);

      if (rows.length === 0) {
        toast.info('No paid orders found in your Shopify store.');
        setPhase('upload');
        setApiFetching(false);
        return;
      }

      // Group by marketplace
      const groupMap = new Map<string, typeof rows>();
      for (const order of rows) {
        const key = JSON.stringify({ m: order.detectedMarketplace, c: order.currency });
        if (!groupMap.has(key)) groupMap.set(key, []);
        groupMap.get(key)!.push(order);
      }

      const readyGroups: MarketplaceGroup[] = [];
      const unknownGroups: MarketplaceGroup[] = [];
      const skippedGroups: MarketplaceGroup[] = [];

      for (const [key, orders] of groupMap) {
        const { m: mktKey, c: currency } = JSON.parse(key);
        const entry = getRegistryEntry(mktKey);
        const dates = orders.map(o => o.paidAt).filter(Boolean).sort();
        const uniqueNames = new Set(orders.map(o => o.name).filter(Boolean));

        const group: MarketplaceGroup = {
          marketplaceKey: mktKey,
          registryEntry: entry,
          orders,
          orderCount: uniqueNames.size || orders.length,
          totalSubtotal: Math.round(orders.reduce((s, o) => s + o.subtotal, 0) * 100) / 100,
          totalShipping: Math.round(orders.reduce((s, o) => s + o.shipping, 0) * 100) / 100,
          totalTaxes: Math.round(orders.reduce((s, o) => s + o.taxes, 0) * 100) / 100,
          totalAmount: Math.round(orders.reduce((s, o) => s + o.total, 0) * 100) / 100,
          totalDiscounts: Math.round(orders.reduce((s, o) => s + o.discountAmount, 0) * 100) / 100,
          periodStart: dates[0] || '',
          periodEnd: dates[dates.length - 1] || '',
          currency,
          skipped: !!entry.skip,
          skipReason: entry.skip_reason || entry.reason,
          status: entry.skip ? 'skipped' : (mktKey === 'unknown' ? 'unknown' : 'ready'),
          sampleNoteAttributes: [...new Set(orders.map(o => o.noteAttributes).filter(Boolean))].slice(0, 3),
          sampleTags: [...new Set(orders.map(o => o.tags).filter(Boolean))].slice(0, 3),
          statusBreakdown: {
            paid: orders.filter(o => o.financialStatus === 'paid').length,
            partially_refunded: orders.filter(o => o.financialStatus === 'partially_refunded').length,
          },
        };

        if (entry.skip) skippedGroups.push(group);
        else if (mktKey === 'unknown') unknownGroups.push(group);
        else readyGroups.push(group);
      }

      readyGroups.sort((a, b) => b.orderCount - a.orderCount);

      completeStep(1);
      setProgressPct(50);

      // Step 3 — Found
      await tick(400);
      setSteps(prev => prev.map((s, i) => i === 2 ? { ...s, label: `Found ${readyGroups.length + unknownGroups.length} marketplace${readyGroups.length + unknownGroups.length !== 1 ? 's' : ''}` } : s));
      completeStep(2);
      setProgressPct(75);

      // Step 4 — Build tabs
      await tick(500);
      await autoCreateConnections(readyGroups);
      completeStep(3);
      setProgressPct(100);

      const builtSettlements = buildSettlementsFromGroups(readyGroups);
      const allDates = rows.map(o => o.paidAt).filter(Boolean).sort();

      const pr: ShopifyOrdersParseResult = {
        success: true,
        groups: readyGroups,
        skippedGroups,
        unknownGroups,
        unpaidCount,
        totalOrderCount: apiOrders.length,
        paidCount: rows.length,
        duplicateLineItemCount: 0,
        settlements: builtSettlements,
        periodStart: allDates[0] || '',
        periodEnd: allDates[allDates.length - 1] || '',
        partialPeriodWarning: false,
        statusBreakdown: { paid: rows.filter(r => r.financialStatus === 'paid').length, partially_refunded: rows.filter(r => r.financialStatus === 'partially_refunded').length, refunded: 0, other_excluded: 0 },
      };

      await tick(300);
      setResult(pr);
      setPhase('results');

      // Entity detection for unknown tags
      if (rows.length > 0) {
        try {
          const entityResult = await detectUnknownEntities(rows);
          if (entityResult.unknowns.length > 0) {
            setUnknownEntities(entityResult.unknowns);
            setShowEntityDialog(true);
          }
        } catch { /* silent */ }
      }

      // Update last_fetched_at
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from('app_settings').upsert({
            user_id: user.id,
            key: 'shopify_last_fetched_at',
            value: new Date().toISOString(),
          }, { onConflict: 'user_id,key' });
        }
      } catch { /* silent */ }

    } catch (err: any) {
      toast.error(err.message || 'Failed to fetch orders');
      setPhase('upload');
    } finally {
      setApiFetching(false);
    }
  }, [shopDomain]);

  // ─── Drag & Drop ──────────────────────────────────────────────────

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true); };
  const onDragLeave = () => setDragging(false);
  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) processFile(f);
  };
  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) processFile(f);
  };

  // ─── Unknown group assignment ─────────────────────────────────────

  const handleAssign = (idx: number, value: string) => {
    setUnknownAssignments(prev => ({ ...prev, [idx]: value }));
  };

  // ─── Finish ───────────────────────────────────────────────────────

  const handleFinish = () => {
    if (!result) return;
    onComplete(result);
  };

  // ─── Render: Phase A — Upload ─────────────────────────────────────

  if (phase === 'upload') {
    return (
      <div className="max-w-xl mx-auto space-y-6">
        <Card>
          <CardHeader className="text-center pb-4">
            <div className="text-4xl mb-2">🛍</div>
            <CardTitle className="text-xl">Connect your Shopify store</CardTitle>
            <CardDescription>
              Upload your orders file — Xettle builds everything automatically
            </CardDescription>
          </CardHeader>

          <CardContent className="space-y-5">
            {/* Step 1 — Instructions */}
            <Collapsible open={guideOpen} onOpenChange={setGuideOpen}>
              <CollapsibleTrigger asChild>
                <Button variant="outline" className="w-full justify-between text-left">
                  <span className="flex items-center gap-2">
                    <span className="bg-primary/10 text-primary rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">1</span>
                    Download your orders file
                  </span>
                  <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${guideOpen ? 'rotate-180' : ''}`} />
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3">
                <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-3 text-sm">
                  <p className="font-medium text-foreground">In Shopify Admin:</p>
                  <ol className="list-decimal list-inside space-y-1.5 text-muted-foreground">
                    <li>Open <strong className="text-foreground">Shopify Admin</strong></li>
                    <li>Click <strong className="text-foreground">Orders</strong> in the left menu</li>
                    <li>Click <strong className="text-foreground">Export</strong> button (top right)</li>
                    <li>Select: <strong className="text-foreground">All orders</strong></li>
                    <li>Date range: <strong className="text-foreground">This month</strong> (or last month)</li>
                    <li>Click <strong className="text-foreground">Export orders</strong></li>
                    <li>Download the CSV file</li>
                  </ol>
                  <p className="text-xs text-muted-foreground pt-1">
                    💡 For monthly bookkeeping, export last month's orders on the 1st of each month.
                  </p>
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Step 2 — Drop zone */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="bg-primary/10 text-primary rounded-full w-6 h-6 flex items-center justify-center text-xs font-bold">2</span>
                <span className="text-sm font-medium text-foreground">Drop it here</span>
              </div>

              <div
                onDragOver={onDragOver}
                onDragLeave={onDragLeave}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
                className={`relative flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed p-10 cursor-pointer transition-all ${
                  dragging
                    ? 'border-primary bg-primary/5 scale-[1.01]'
                    : 'border-muted-foreground/25 hover:border-primary/40 hover:bg-muted/30'
                }`}
              >
                <Upload className="h-8 w-8 text-muted-foreground" />
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground">Drop your orders export CSV here</p>
                  <p className="text-xs text-muted-foreground mt-1">or click to browse • .csv only • max 10 MB</p>
                </div>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv"
                  onChange={onFileChange}
                  className="hidden"
                />
              </div>
            </div>

            {/* Or fetch via API */}
            {shopConnected && shopDomain && (
              <div className="relative">
                <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
                <div className="relative flex justify-center"><span className="bg-card px-3 text-xs text-muted-foreground">or</span></div>
              </div>
            )}
            {shopConnected && shopDomain && (
              <Button
                onClick={handleApiFetch}
                disabled={apiFetching}
                variant="outline"
                className="w-full gap-2"
              >
                {apiFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Zap className="h-4 w-4" />}
                Fetch orders from {shopDomain} automatically
              </Button>
            )}

            {/* What Xettle does */}
            <div className="rounded-lg border border-border bg-muted/20 p-4 space-y-2">
              <p className="text-xs font-medium text-foreground">That's it. Xettle will:</p>
              <ul className="text-xs text-muted-foreground space-y-1">
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" /> Detect your marketplaces</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" /> Build your account tabs</li>
                <li className="flex items-center gap-2"><CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" /> Create your Xero invoices</li>
              </ul>
            </div>

            {/* Supported marketplaces */}
            <p className="text-xs text-center text-muted-foreground">
              Works with: {SUPPORTED_MARKETPLACES.join(' • ')} and more
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Render: Phase B — Detection Animation ────────────────────────

  if (phase === 'detecting') {
    return (
      <div className="max-w-xl mx-auto">
        <Card>
          <CardHeader className="text-center pb-3">
            <div className="text-4xl mb-2">🔍</div>
            <CardTitle className="text-lg">Analysing your Shopify store...</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <Progress value={progressPct} className="h-2" />
            <div className="space-y-3">
              {steps.map((step, i) => (
                <div key={i} className="flex items-center gap-3 text-sm">
                  {step.done ? (
                    <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
                  ) : i === steps.findIndex(s => !s.done) ? (
                    <Loader2 className="h-5 w-5 text-primary animate-spin shrink-0" />
                  ) : (
                    <div className="h-5 w-5 rounded-full border-2 border-muted-foreground/20 shrink-0" />
                  )}
                  <span className={step.done ? 'text-foreground' : 'text-muted-foreground'}>{step.label}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ─── Render: Phase C — Results ────────────────────────────────────

  if (!result) return null;

  const readyGroups = result.groups;
  const skippedGroups = result.skippedGroups;
  const unknownGroups = result.unknownGroups;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <Card>
        <CardHeader className="text-center pb-3">
          <div className="text-4xl mb-2">🎉</div>
          <CardTitle className="text-xl">We found your marketplaces!</CardTitle>
          <CardDescription>
            {result.paidCount} paid orders across {readyGroups.length + unknownGroups.length} source{readyGroups.length + unknownGroups.length !== 1 ? 's' : ''}
          </CardDescription>
        </CardHeader>
      </Card>

      {/* Ready marketplace cards */}
      <div className="grid gap-3">
        {readyGroups.map((g, i) => (
          <Card key={i} className="overflow-hidden">
            <CardContent className="flex items-center gap-4 p-4">
              <div className="text-2xl">🏪</div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground truncate">{g.registryEntry.display_name || g.marketplaceKey}</p>
                <p className="text-xs text-muted-foreground">
                  {g.orderCount} order{g.orderCount !== 1 ? 's' : ''} • ${g.totalAmount.toLocaleString('en-AU', { minimumFractionDigits: 2 })} {g.currency}
                </p>
              </div>
              <Badge className="bg-primary/10 text-primary border-primary/20 shrink-0">
                <span className="inline-block w-2 h-2 rounded-full bg-primary mr-1.5" />
                Ready
              </Badge>
            </CardContent>
          </Card>
        ))}

        {/* Skipped groups (Shopify Payments etc.) */}
        {skippedGroups.map((g, i) => (
          <Card key={`skip-${i}`} className="overflow-hidden opacity-60">
            <CardContent className="flex items-center gap-4 p-4">
              <div className="text-2xl">💳</div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground truncate">{g.registryEntry.display_name || g.marketplaceKey}</p>
                <p className="text-xs text-muted-foreground">
                  {g.orderCount} order{g.orderCount !== 1 ? 's' : ''} • skipped
                </p>
              </div>
              <Badge variant="secondary" className="shrink-0">
                <span className="inline-block w-2 h-2 rounded-full bg-muted-foreground mr-1.5" />
                {g.skipReason || 'Use payout CSV'}
              </Badge>
            </CardContent>
          </Card>
        ))}

        {/* Unknown groups */}
        {unknownGroups.map((g, i) => (
          <Card key={`unk-${i}`} className="overflow-hidden border-warning/30">
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center gap-4">
                <div className="text-2xl">❓</div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground">{g.orderCount} unidentified order{g.orderCount !== 1 ? 's' : ''}</p>
                  {g.sampleNoteAttributes?.[0] && (
                    <p className="text-xs text-muted-foreground truncate">Note: {g.sampleNoteAttributes[0].substring(0, 80)}</p>
                  )}
                  {g.sampleTags?.[0] && (
                    <p className="text-xs text-muted-foreground truncate">Tags: {g.sampleTags[0].substring(0, 80)}</p>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground shrink-0">Assign to:</span>
                <Select value={unknownAssignments[i] || ''} onValueChange={(v) => handleAssign(i, v)}>
                  <SelectTrigger className="h-8 text-xs flex-1">
                    <SelectValue placeholder="Select marketplace..." />
                  </SelectTrigger>
                  <SelectContent>
                    {ASSIGNABLE_MARKETPLACES.map(m => (
                      <SelectItem key={m.key} value={m.key} className="text-xs">{m.label}</SelectItem>
                    ))}
                    <SelectItem value="skip" className="text-xs text-muted-foreground">Skip these orders</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* SKU cost prompt */}
      {result && !showSkuManager && (() => {
        const allGroups = [...result.groups, ...result.unknownGroups];
        const skus = extractUniqueSKUs(allGroups);
        if (skus.length === 0) return null;
        return (
          <Card className="border-dashed border-primary/30">
            <CardContent className="py-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Package className="h-4 w-4 text-primary" />
                  <div>
                    <p className="text-sm font-medium text-foreground">We found {skus.length} unique SKUs</p>
                    <p className="text-xs text-muted-foreground">Add product costs to see profit per marketplace</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="text-xs" onClick={() => setShowSkuManager(true)}>Add costs now</Button>
                  <Button size="sm" variant="ghost" className="text-xs text-muted-foreground">Skip for now</Button>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })()}

      {showSkuManager && result && (() => {
        const allGroups = [...result.groups, ...result.unknownGroups];
        const skus = extractUniqueSKUs(allGroups);
        if (skus.length === 0) return null;
        return <SkuCostManager skus={skus} compact />;
      })()}

      {/* Actions */}
      <div className="flex gap-3 justify-center">
        <Button onClick={() => { setPushed(true); handleFinish(); }} className="gap-2">
          <ArrowRight className="h-4 w-4" />
          Review & push to Xero
        </Button>
      </div>

      {/* Bookkeeper reconciliation note — shown after push */}
      {pushed && (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-primary shrink-0" />
              <p className="text-sm font-semibold text-foreground">
                {readyGroups.length} invoice{readyGroups.length !== 1 ? 's' : ''} pushed to Xero
              </p>
            </div>
            <div className="flex items-start gap-2">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="text-xs text-muted-foreground space-y-1.5">
                <p className="font-medium text-foreground">Bookkeeper reconciliation:</p>
                {readyGroups.some(g => g.registryEntry.payment_type === 'direct_bank_transfer') && (
                  <p>
                    {readyGroups.filter(g => g.registryEntry.payment_type === 'direct_bank_transfer').map(g => g.registryEntry.display_name || g.marketplaceKey).join(', ')} → match bank transfers to account 613
                  </p>
                )}
                {readyGroups.some(g => g.registryEntry.payment_type === 'gateway_clearing') && (
                  <p>
                    {readyGroups.filter(g => g.registryEntry.payment_type === 'gateway_clearing').map(g => g.registryEntry.display_name || g.marketplaceKey).join(', ')} → match payout to account 613
                  </p>
                )}
                {skippedGroups.length > 0 && (
                  <p>Shopify Payments → upload payout CSV next</p>
                )}
                <p className="pt-1 text-muted-foreground/70">
                  These are $0.00 clearing invoices — they recognise revenue when orders ship, not when you get paid.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Monthly sync card */}
      <Card className="bg-muted/30">
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            <p className="text-sm font-medium text-foreground">Monthly Shopify sync</p>
          </div>
          <p className="text-xs text-muted-foreground">
            Your marketplaces are set up. Every month just:
          </p>
          <ol className="text-xs text-muted-foreground list-decimal list-inside space-y-1">
            <li>Go to Shopify → Orders → Export</li>
            <li>Select last month → Download CSV</li>
            <li>Drop the file here</li>
          </ol>
          <p className="text-xs text-muted-foreground">Takes 2 minutes ⏱</p>
        </CardContent>
      </Card>
    </div>
  );
}
