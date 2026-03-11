/**
 * Setup Hub — Post-wizard orchestration page.
 * Runs existing edge functions in correct sequence and surfaces full data depth.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { detectCapabilities, callEdgeFunctionSafe, type SyncCapabilities } from '@/utils/sync-capabilities';
import { provisionAllMarketplaceConnections } from '@/utils/marketplace-token-map';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  CheckCircle2, AlertTriangle, SkipForward, RefreshCw, ArrowRight,
  Loader2, Plus, LayoutDashboard, X
} from 'lucide-react';
import SubChannelSetupModal from '@/components/shopify/SubChannelSetupModal';
import type { DetectedSubChannel } from '@/utils/sub-channel-detection';

// ─── Types ──────────────────────────────────────────────────────────
type StepStatus = 'idle' | 'running' | 'success' | 'error' | 'skipped';

interface StepState {
  status: StepStatus;
  message: string;
  error?: string;
}

interface Phase3Results {
  complete: number;
  pushedNoBank: number;
  readyToPush: number;
  unmatchedDeposits: number;
  uploadNeeded: number;
  gapDetails: string[];
}

// ─── Helpers ────────────────────────────────────────────────────────
async function upsertSetting(userId: string, key: string, value: string) {
  await supabase.from('app_settings').upsert(
    { user_id: userId, key, value },
    { onConflict: 'user_id,key' }
  );
}

async function getSetting(key: string): Promise<string | null> {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', key)
    .maybeSingle();
  return data?.value ?? null;
}

// ─── Component ──────────────────────────────────────────────────────
export default function Setup() {
  const navigate = useNavigate();
  const [caps, setCaps] = useState<SyncCapabilities | null>(null);
  const [loading, setLoading] = useState(true);

  // Phase 1
  const [xeroStep, setXeroStep] = useState<StepState>({ status: 'idle', message: '' });
  const [shopifyPayoutsStep, setShopifyPayoutsStep] = useState<StepState>({ status: 'idle', message: '' });
  const [shopifyOrdersStep, setShopifyOrdersStep] = useState<StepState>({ status: 'idle', message: '' });
  const [shopifyChannelsStep, setShopifyChannelsStep] = useState<StepState>({ status: 'idle', message: '' });
  const [amazonStep, setAmazonStep] = useState<StepState>({ status: 'idle', message: '' });

  // Progress bars (time-based)
  const [xeroProgress, setXeroProgress] = useState(0);
  const [shopifyProgress, setShopifyProgress] = useState(0);
  const [amazonProgress, setAmazonProgress] = useState(0);

  // Phase flags
  const [phase1Xero, setPhase1Xero] = useState(false);
  const [phase1Shopify, setPhase1Shopify] = useState(false);
  const [phase1Amazon, setPhase1Amazon] = useState(false);
  const [phase2Complete, setPhase2Complete] = useState(false);
  const [phase3Complete, setPhase3Complete] = useState(false);

  // Phase 2
  const [phase2Running, setPhase2Running] = useState(false);
  const [detectedMarketplaces, setDetectedMarketplaces] = useState<
    { name: string; code: string; orderCount?: number }[]
  >([]);
  const [showAddManual, setShowAddManual] = useState(false);
  const [manualChannel, setManualChannel] = useState<DetectedSubChannel | null>(null);

  // Phase 3
  const [phase3Running, setPhase3Running] = useState(false);
  const [phase3Results, setPhase3Results] = useState<Phase3Results | null>(null);

  const mountedRef = useRef(true);
  const phase1StartedRef = useRef(false);

  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);

  // ─── Init: detect capabilities & check existing flags ─────────────
  useEffect(() => {
    (async () => {
      const c = await detectCapabilities();
      if (!c.userId) {
        navigate('/auth');
        return;
      }

      // Check if already dismissed
      const dismissed = await getSetting('setup_hub_dismissed');
      if (dismissed === 'true') {
        navigate('/dashboard');
        return;
      }

      setCaps(c);

      // Load existing phase flags
      const [p1x, p1s, p1a, p2, p3] = await Promise.all([
        getSetting('setup_phase1_xero'),
        getSetting('setup_phase1_shopify'),
        getSetting('setup_phase1_amazon'),
        getSetting('setup_phase2_complete'),
        getSetting('setup_phase3_complete'),
      ]);
      if (p1x === 'true') setPhase1Xero(true);
      if (p1s === 'true') setPhase1Shopify(true);
      if (p1a === 'true') setPhase1Amazon(true);
      if (p2 === 'true') setPhase2Complete(true);
      if (p3 === 'true') setPhase3Complete(true);

      setLoading(false);
    })();
  }, [navigate]);

  // ─── Phase 1: auto-start scans on mount ───────────────────────────
  useEffect(() => {
    if (!caps || loading || phase1StartedRef.current) return;
    phase1StartedRef.current = true;

    const token = caps.accessToken!;
    const userId = caps.userId!;

    // Start time-based progress bars
    if (caps.hasXero && !phase1Xero) startProgressTimer(setXeroProgress, 30000);
    if (caps.hasShopify && !phase1Shopify) startProgressTimer(setShopifyProgress, 60000);
    if (caps.hasAmazon && !phase1Amazon) startProgressTimer(setAmazonProgress, 120000);

    // Run scans in parallel per API
    if (caps.hasXero && !phase1Xero) runXeroScan(token, userId);
    if (caps.hasShopify && !phase1Shopify) runShopifyScan(token, userId);
    if (caps.hasAmazon && !phase1Amazon) runAmazonScan(token, userId);

    // Mark already-complete bars
    if (phase1Xero) setXeroProgress(100);
    if (phase1Shopify) setShopifyProgress(100);
    if (phase1Amazon) setAmazonProgress(100);
  }, [caps, loading]);

  // ─── Progress timer helper ────────────────────────────────────────
  function startProgressTimer(
    setter: React.Dispatch<React.SetStateAction<number>>,
    durationMs: number
  ) {
    const interval = 200;
    const increment = (interval / durationMs) * 95; // cap at 95%
    const id = setInterval(() => {
      setter(prev => {
        if (prev >= 95 || !mountedRef.current) {
          clearInterval(id);
          return prev;
        }
        return Math.min(prev + increment, 95);
      });
    }, interval);
  }

  // ─── Xero scan ────────────────────────────────────────────────────
  async function runXeroScan(token: string, userId: string) {
    setXeroStep({ status: 'running', message: 'Scanning your Xero history...' });
    const result = await callEdgeFunctionSafe('scan-xero-history', token);

    if (!mountedRef.current) return;

    if (result.ok) {
      const d = result.data || {};
      const invoiceCount = d.detected_settlements?.length || 0;
      const boundary = d.accounting_boundary_date;

      // Also check xero_accounting_matches for bank verification count
      const { count: bankMatchCount } = await supabase
        .from('xero_accounting_matches')
        .select('*', { count: 'exact', head: true });

      const parts = [`Found ${invoiceCount} existing marketplace invoices in Xero`];
      if (boundary) parts.push(`Accounting boundary: ${boundary}`);
      if (bankMatchCount && bankMatchCount > 0) {
        parts.push(`${bankMatchCount} bank-verified records`);
      }
      if (d.bank_scan_error) {
        parts.push(`⚠️ ${d.bank_scan_error}`);
      }

      setXeroStep({ status: 'success', message: parts.join(' · ') });
      setXeroProgress(100);
      setPhase1Xero(true);
      await upsertSetting(userId, 'setup_phase1_xero', 'true');
    } else {
      setXeroStep({ status: 'error', message: 'Xero scan failed', error: result.error });
      setXeroProgress(0);
    }
  }

  // ─── Shopify scan (enforced A→B→C sequence) ──────────────────────
  async function runShopifyScan(token: string, userId: string) {
    // Step A: Payouts
    setShopifyPayoutsStep({ status: 'running', message: 'Fetching payouts...' });
    const payoutsResult = await callEdgeFunctionSafe('fetch-shopify-payouts', token);
    if (!mountedRef.current) return;

    if (!payoutsResult.ok) {
      setShopifyPayoutsStep({ status: 'error', message: 'Payouts fetch failed', error: payoutsResult.error });
      setShopifyProgress(0);
      return;
    }
    const payoutCount = payoutsResult.data?.count || payoutsResult.data?.settlements_created || 0;
    setShopifyPayoutsStep({ status: 'success', message: `✅ ${payoutCount} payouts fetched` });

    // Step B: Orders
    setShopifyOrdersStep({ status: 'running', message: 'Fetching orders...' });
    const ordersResult = await callEdgeFunctionSafe('fetch-shopify-orders', token);
    if (!mountedRef.current) return;

    if (!ordersResult.ok) {
      setShopifyOrdersStep({ status: 'error', message: 'Orders fetch failed', error: ordersResult.error });
      setShopifyProgress(0);
      return;
    }
    const ordersFetched = ordersResult.data?.orders_saved || ordersResult.data?.count || 0;
    setShopifyOrdersStep({ status: 'success', message: `✅ ${ordersFetched} orders fetched` });

    // Step C: Guard — verify shopify_orders count > 0
    const { count: actualOrderCount } = await supabase
      .from('shopify_orders')
      .select('*', { count: 'exact', head: true });

    if (!actualOrderCount || actualOrderCount === 0) {
      setShopifyChannelsStep({
        status: 'error',
        message: '⚠️ Orders fetch returned 0 results — sub-channel detection skipped. This may mean your Shopify store has no orders yet.',
      });
      // Still mark Phase 1 Shopify as done since payouts succeeded
      setShopifyProgress(100);
      setPhase1Shopify(true);
      await upsertSetting(userId, 'setup_phase1_shopify', 'true');
      return;
    }

    setShopifyChannelsStep({ status: 'running', message: 'Scanning for sales channels...' });
    const channelsResult = await callEdgeFunctionSafe('scan-shopify-channels', token);
    if (!mountedRef.current) return;

    if (channelsResult.ok) {
      const { count: subChannelCount } = await supabase
        .from('shopify_sub_channels')
        .select('*', { count: 'exact', head: true });
      setShopifyChannelsStep({
        status: 'success',
        message: `✅ ${subChannelCount || 0} sales channels detected`,
      });
    } else {
      setShopifyChannelsStep({ status: 'error', message: 'Channel scan failed', error: channelsResult.error });
    }

    setShopifyProgress(100);
    setPhase1Shopify(true);
    await upsertSetting(userId, 'setup_phase1_shopify', 'true');
  }

  // ─── Amazon scan ──────────────────────────────────────────────────
  async function runAmazonScan(token: string, userId: string) {
    setAmazonStep({ status: 'running', message: 'Fetching Amazon settlements...' });
    const result = await callEdgeFunctionSafe('fetch-amazon-settlements', token);
    if (!mountedRef.current) return;

    if (result.ok) {
      // Query settlements for count and date range
      const { data: settlements } = await supabase
        .from('settlements')
        .select('period_start, period_end')
        .eq('marketplace', 'amazon_au')
        .order('period_start', { ascending: true });

      if (settlements && settlements.length > 0) {
        const earliest = settlements[0].period_start;
        const latest = settlements[settlements.length - 1].period_end;

        // Gap detection: Amazon settles every ~14 days
        const gaps: string[] = [];
        for (let i = 1; i < settlements.length; i++) {
          const prevEnd = new Date(settlements[i - 1].period_end);
          const nextStart = new Date(settlements[i].period_start);
          const daysDiff = (nextStart.getTime() - prevEnd.getTime()) / (1000 * 60 * 60 * 24);
          if (daysDiff > 21) { // more than 21 days = likely a gap
            gaps.push(`${settlements[i - 1].period_end} to ${settlements[i].period_start}`);
          }
        }

        let msg = `✅ ${settlements.length} settlements covering ${earliest} to ${latest}`;
        if (gaps.length > 0) {
          msg += ` · ${gaps.length} gap${gaps.length > 1 ? 's' : ''} detected`;
        }
        setAmazonStep({ status: 'success', message: msg });
      } else {
        setAmazonStep({ status: 'success', message: '✅ Fetch complete — no settlement data found yet' });
      }

      setAmazonProgress(100);
      setPhase1Amazon(true);
      await upsertSetting(userId, 'setup_phase1_amazon', 'true');
    } else {
      setAmazonStep({ status: 'error', message: 'Amazon fetch failed', error: result.error });
      setAmazonProgress(0);
    }
  }

  // ─── Retry helper ─────────────────────────────────────────────────
  const retryStep = useCallback((api: 'xero' | 'shopify' | 'amazon') => {
    if (!caps) return;
    const token = caps.accessToken!;
    const userId = caps.userId!;
    if (api === 'xero') {
      setXeroProgress(0);
      startProgressTimer(setXeroProgress, 30000);
      runXeroScan(token, userId);
    } else if (api === 'shopify') {
      setShopifyProgress(0);
      startProgressTimer(setShopifyProgress, 60000);
      setShopifyPayoutsStep({ status: 'idle', message: '' });
      setShopifyOrdersStep({ status: 'idle', message: '' });
      setShopifyChannelsStep({ status: 'idle', message: '' });
      runShopifyScan(token, userId);
    } else {
      setAmazonProgress(0);
      startProgressTimer(setAmazonProgress, 120000);
      runAmazonScan(token, userId);
    }
  }, [caps]);

  // ─── Polling for phase flags ──────────────────────────────────────
  useEffect(() => {
    if (!caps || loading) return;
    const anyPhase1Needed =
      (caps.hasXero && !phase1Xero) ||
      (caps.hasShopify && !phase1Shopify) ||
      (caps.hasAmazon && !phase1Amazon);
    if (!anyPhase1Needed) return;

    const id = setInterval(async () => {
      const [p1x, p1s, p1a] = await Promise.all([
        getSetting('setup_phase1_xero'),
        getSetting('setup_phase1_shopify'),
        getSetting('setup_phase1_amazon'),
      ]);
      if (p1x === 'true' && !phase1Xero) { setPhase1Xero(true); setXeroProgress(100); }
      if (p1s === 'true' && !phase1Shopify) { setPhase1Shopify(true); setShopifyProgress(100); }
      if (p1a === 'true' && !phase1Amazon) { setPhase1Amazon(true); setAmazonProgress(100); }
    }, 5000);

    return () => clearInterval(id);
  }, [caps, loading, phase1Xero, phase1Shopify, phase1Amazon]);

  // ─── Phase 2: Identify marketplaces ───────────────────────────────
  const anyPhase1Done = phase1Xero || phase1Shopify || phase1Amazon;

  const runPhase2 = useCallback(async () => {
    if (!caps?.userId || !caps?.accessToken) return;
    setPhase2Running(true);

    try {
      await provisionAllMarketplaceConnections(caps.userId);

      // Query results
      const [alertsRes, connectionsRes] = await Promise.all([
        supabase.from('channel_alerts').select('source_name, order_count, detected_label, alert_type'),
        supabase.from('marketplace_connections').select('marketplace_name, marketplace_code'),
      ]);

      const marketplaces: { name: string; code: string; orderCount?: number }[] = [];
      const seen = new Set<string>();

      // From marketplace_connections
      for (const conn of connectionsRes.data || []) {
        if (!seen.has(conn.marketplace_code)) {
          seen.add(conn.marketplace_code);
          const alert = (alertsRes.data || []).find(
            a => a.source_name === conn.marketplace_code || a.detected_label === conn.marketplace_name
          );
          marketplaces.push({
            name: conn.marketplace_name,
            code: conn.marketplace_code,
            orderCount: alert?.order_count ?? undefined,
          });
        }
      }

      setDetectedMarketplaces(marketplaces);
      setPhase2Complete(true);
      await upsertSetting(caps.userId, 'setup_phase2_complete', 'true');
    } catch (err) {
      console.error('[setup] Phase 2 error:', err);
    } finally {
      setPhase2Running(false);
    }
  }, [caps]);

  // ─── Phase 3: Validation & bank matching ──────────────────────────
  const runPhase3 = useCallback(async () => {
    if (!caps?.accessToken || !caps?.userId) return;
    setPhase3Running(true);

    try {
      // 1. Bank deposit matching FIRST
      if (caps.hasXero) {
        await callEdgeFunctionSafe('match-bank-deposits', caps.accessToken);
      }

      // 2. Full validation sweep
      await callEdgeFunctionSafe('run-validation-sweep', caps.accessToken);

      // 3. Query results
      const { data: validations } = await supabase
        .from('marketplace_validation')
        .select('overall_status, marketplace_code, period_start, period_end, settlement_net, bank_amount');

      const { data: deposits } = await supabase
        .from('channel_alerts')
        .select('*')
        .eq('alert_type', 'unmatched_deposit');

      const results: Phase3Results = {
        complete: 0,
        pushedNoBank: 0,
        readyToPush: 0,
        unmatchedDeposits: deposits?.length || 0,
        uploadNeeded: 0,
        gapDetails: [],
      };

      for (const v of validations || []) {
        switch (v.overall_status) {
          case 'complete': results.complete++; break;
          case 'pushed_to_xero': results.pushedNoBank++; break;
          case 'ready_to_push': results.readyToPush++; break;
          case 'missing':
          case 'settlement_needed':
            results.uploadNeeded++;
            break;
          case 'gap_detected':
            results.gapDetails.push(
              `${v.marketplace_code} missing ${v.period_start} to ${v.period_end}`
            );
            break;
        }
      }

      setPhase3Results(results);
      setPhase3Complete(true);
      await upsertSetting(caps.userId, 'setup_phase3_complete', 'true');
    } catch (err) {
      console.error('[setup] Phase 3 error:', err);
    } finally {
      setPhase3Running(false);
    }
  }, [caps]);

  // ─── Navigation ───────────────────────────────────────────────────
  const goToDashboard = useCallback(async () => {
    if (caps?.userId) {
      await upsertSetting(caps.userId, 'setup_hub_dismissed', 'true');
    }
    navigate('/dashboard');
  }, [caps, navigate]);

  const dismissSetup = useCallback(async () => {
    if (caps?.userId) {
      await upsertSetting(caps.userId, 'setup_hub_dismissed', 'true');
    }
  }, [caps]);

  // ─── Render helpers ───────────────────────────────────────────────
  function StatusIcon({ status }: { status: StepStatus }) {
    switch (status) {
      case 'success': return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
      case 'error': return <AlertTriangle className="h-4 w-4 text-destructive" />;
      case 'skipped': return <SkipForward className="h-4 w-4 text-muted-foreground" />;
      case 'running': return <Loader2 className="h-4 w-4 text-primary animate-spin" />;
      default: return <div className="h-4 w-4 rounded-full border border-border" />;
    }
  }

  function StepRow({ step: s, onRetry, api }: { step: StepState; onRetry?: () => void; api?: string }) {
    return (
      <div className="flex items-start gap-3 py-1.5">
        <StatusIcon status={s.status} />
        <span className="text-sm text-foreground flex-1">{s.message}</span>
        {s.status === 'error' && onRetry && (
          <Button variant="ghost" size="sm" onClick={onRetry} className="h-6 px-2 text-xs">
            <RefreshCw className="h-3 w-3 mr-1" /> Retry
          </Button>
        )}
      </div>
    );
  }

  // ─── Loading state ────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!caps) return null;

  const hasAnyApi = caps.hasXero || caps.hasShopify || caps.hasAmazon;

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-2xl mx-auto px-4 py-12 space-y-8">
        {/* Header */}
        <div className="text-center space-y-2">
          <h1 className="text-2xl font-bold text-foreground">Setting up your Xettle account</h1>
          <p className="text-muted-foreground text-sm">
            Some steps run automatically — others wait until your data is ready.
          </p>
        </div>

        {/* ─── Phase 1 ─────────────────────────────────────────────── */}
        <Card>
          <CardContent className="pt-6 space-y-5">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
              Phase 1 — Fetching your data
            </h2>

            {/* Xero row */}
            {caps.hasXero ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm font-medium text-foreground">
                  <span>Xero</span>
                  <span className="text-xs text-muted-foreground">
                    {phase1Xero ? 'Complete' : 'Scanning...'}
                  </span>
                </div>
                <Progress value={xeroProgress} className="h-1.5" />
                {xeroStep.status !== 'idle' && (
                  <StepRow step={xeroStep} onRetry={() => retryStep('xero')} />
                )}
              </div>
            ) : null}

            {/* Shopify row */}
            {caps.hasShopify ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm font-medium text-foreground">
                  <span>Shopify</span>
                  <span className="text-xs text-muted-foreground">
                    {phase1Shopify ? 'Complete' : 'Fetching...'}
                  </span>
                </div>
                <Progress value={shopifyProgress} className="h-1.5" />
                {shopifyPayoutsStep.status !== 'idle' && <StepRow step={shopifyPayoutsStep} />}
                {shopifyOrdersStep.status !== 'idle' && <StepRow step={shopifyOrdersStep} />}
                {shopifyChannelsStep.status !== 'idle' && (
                  <StepRow step={shopifyChannelsStep} onRetry={() => retryStep('shopify')} />
                )}
              </div>
            ) : null}

            {/* Amazon row */}
            {caps.hasAmazon ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm font-medium text-foreground">
                  <span>Amazon</span>
                  <span className="text-xs text-muted-foreground">
                    {phase1Amazon ? 'Complete' : 'Fetching...'}
                  </span>
                </div>
                <Progress value={amazonProgress} className="h-1.5" />
                {amazonStep.status !== 'idle' && (
                  <StepRow step={amazonStep} onRetry={() => retryStep('amazon')} />
                )}
              </div>
            ) : null}

            {!hasAnyApi && (
              <p className="text-sm text-muted-foreground">
                ⏭️ No APIs connected — skip to the dashboard to upload CSV files.
              </p>
            )}
          </CardContent>
        </Card>

        {/* ─── Phase 2 ─────────────────────────────────────────────── */}
        <Card>
          <CardContent className="pt-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
              Phase 2 — Identify your marketplaces
            </h2>

            {phase2Complete ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Marketplaces identified</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {detectedMarketplaces.map(m => (
                    <span
                      key={m.code}
                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-full bg-secondary text-secondary-foreground"
                    >
                      {m.name}
                      {m.orderCount != null && m.orderCount > 0 && (
                        <span className="text-muted-foreground">({m.orderCount} orders)</span>
                      )}
                    </span>
                  ))}
                </div>
                <button
                  onClick={() => {
                    setManualChannel({
                      source_name: '',
                      order_count: 0,
                      total_revenue: 0,
                      sample_order_names: [],
                      is_new: true,
                    });
                    setShowAddManual(true);
                  }}
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <Plus className="h-3 w-3" /> Missing something? Add manually
                </button>
              </div>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      onClick={runPhase2}
                      disabled={!anyPhase1Done || phase2Running}
                      className="w-full"
                    >
                      {phase2Running ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Identifying...</>
                      ) : (
                        <>Identify my marketplaces <ArrowRight className="h-4 w-4 ml-2" /></>
                      )}
                    </Button>
                  </span>
                </TooltipTrigger>
                {!anyPhase1Done && (
                  <TooltipContent>Waiting for your data to load...</TooltipContent>
                )}
              </Tooltip>
            )}
          </CardContent>
        </Card>

        {/* ─── Phase 3 ─────────────────────────────────────────────── */}
        <Card>
          <CardContent className="pt-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
              Phase 3 — Check for missing settlements
            </h2>

            {phase3Complete && phase3Results ? (
              <div className="space-y-3">
                <div className="flex items-center gap-2 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>Validation complete</span>
                </div>
                <div className="space-y-2 text-sm">
                  {phase3Results.complete > 0 && (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      <span>Already in Xero and verified: <strong>{phase3Results.complete}</strong> settlements</span>
                    </div>
                  )}
                  {phase3Results.pushedNoBank > 0 && (
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                      <span>Xero has invoice but no bank match: <strong>{phase3Results.pushedNoBank}</strong> (possible timing difference)</span>
                    </div>
                  )}
                  {phase3Results.readyToPush > 0 && (
                    <div className="flex items-center gap-2">
                      <ArrowRight className="h-3.5 w-3.5 text-primary" />
                      <span>Ready to push to Xero: <strong>{phase3Results.readyToPush}</strong> settlements</span>
                    </div>
                  )}
                  {phase3Results.unmatchedDeposits > 0 && (
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
                      <span>Bank deposit found but no invoice: <strong>{phase3Results.unmatchedDeposits}</strong> (needs attention)</span>
                    </div>
                  )}
                  {phase3Results.uploadNeeded > 0 && (
                    <div className="flex items-center gap-2">
                      <X className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>Upload needed — no data from any source: <strong>{phase3Results.uploadNeeded}</strong></span>
                    </div>
                  )}
                  {phase3Results.gapDetails.map((gap, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                      <span className="text-muted-foreground">Settlement gap: {gap}</span>
                    </div>
                  ))}
                </div>

                <div className="flex gap-3 pt-2">
                  <Button onClick={goToDashboard}>
                    <LayoutDashboard className="h-4 w-4 mr-2" /> Go to Dashboard
                  </Button>
                  <Button variant="outline" onClick={dismissSetup}>
                    Dismiss setup
                  </Button>
                </div>
              </div>
            ) : (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span>
                    <Button
                      onClick={runPhase3}
                      disabled={!phase2Complete || phase3Running}
                      className="w-full"
                    >
                      {phase3Running ? (
                        <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Checking settlements...</>
                      ) : (
                        <>Check for missing settlements <ArrowRight className="h-4 w-4 ml-2" /></>
                      )}
                    </Button>
                  </span>
                </TooltipTrigger>
                {!phase2Complete && (
                  <TooltipContent>Identify your marketplaces first</TooltipContent>
                )}
              </Tooltip>
            )}
          </CardContent>
        </Card>

        {/* No APIs: skip to dashboard */}
        {!hasAnyApi && (
          <div className="text-center">
            <Button onClick={goToDashboard} variant="outline">
              <LayoutDashboard className="h-4 w-4 mr-2" /> Skip to Dashboard
            </Button>
          </div>
        )}
      </div>

      {/* Manual channel modal */}
      {showAddManual && manualChannel && (
        <SubChannelSetupModal
          channel={manualChannel}
          open={showAddManual}
          onClose={() => { setShowAddManual(false); setManualChannel(null); }}
          onComplete={() => {
            setShowAddManual(false);
            setManualChannel(null);
            // Re-run Phase 2 to pick up the new channel
            runPhase2();
          }}
        />
      )}
    </div>
  );
}
