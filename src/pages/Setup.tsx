/**
 * Setup Hub — Post-wizard orchestration page.
 * Runs existing edge functions in correct sequence and surfaces full data depth.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { detectCapabilities, callEdgeFunctionSafe, type SyncCapabilities } from '@/utils/sync-capabilities';
import { provisionAllMarketplaceConnections } from '@/utils/marketplace-token-map';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  CheckCircle2, AlertTriangle, SkipForward, RefreshCw, ArrowRight,
  Loader2, Plus, LayoutDashboard, X, Upload, ExternalLink, ArrowLeft, Copy, Check
} from 'lucide-react';
import SubChannelSetupModal from '@/components/shopify/SubChannelSetupModal';
import XettleLogo from '@/components/shared/XettleLogo';
import type { DetectedSubChannel } from '@/utils/sub-channel-detection';

// ─── Types ──────────────────────────────────────────────────────────
type StepStatus = 'idle' | 'running' | 'success' | 'error' | 'skipped';

interface StepState {
  status: StepStatus;
  message: string;
  error?: string;
}

interface MarketplaceValidationRow {
  overall_status: string;
  marketplace_code: string;
  period_start: string;
  period_end: string;
  period_label: string;
  settlement_net: number | null;
  bank_amount: number | null;
  bank_matched: boolean | null;
  xero_pushed: boolean | null;
  settlement_uploaded: boolean | null;
}

interface MarketplacePeriodDetail {
  period_label: string;
  period_start: string;
  period_end: string;
  status: string;
  settlement_net: number | null;
  bank_amount: number | null;
  bank_matched: boolean;
  xero_pushed: boolean;
  settlement_uploaded: boolean;
}

interface MarketplaceBreakdown {
  code: string;
  name: string;
  periods: MarketplacePeriodDetail[];
}

interface DetectedMarketplace {
  name: string;
  code: string;
  orderCount?: number;
  source: string; // 'shopify_orders' | 'shopify_tags' | 'xero_contact' | 'settlement' | 'file_fingerprint' | 'api_connection'
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

const MARKETPLACE_DISPLAY: Record<string, string> = {
  amazon_au: 'Amazon AU',
  shopify_payments: 'Shopify Payments',
  bigw: 'BigW',
  kogan: 'Kogan',
  mydeal: 'MyDeal',
  bunnings: 'Bunnings',
  catch: 'Catch',
  ebay_au: 'eBay AU',
  woolworths: 'Everyday Market',
  theiconic: 'The Iconic',
  etsy: 'Etsy',
  paypal: 'PayPal',
};

function displayName(code: string, fallback?: string): string {
  return MARKETPLACE_DISPLAY[code] || fallback || code.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatCurrency(n: number | null | undefined): string {
  if (n == null) return '$0.00';
  return '$' + Math.abs(n).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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
  const [detectedMarketplaces, setDetectedMarketplaces] = useState<DetectedMarketplace[]>([]);
  const [showAddManual, setShowAddManual] = useState(false);
  const [manualChannel, setManualChannel] = useState<DetectedSubChannel | null>(null);

  // Phase 3
  const [phase3Running, setPhase3Running] = useState(false);
  const [phase3Breakdown, setPhase3Breakdown] = useState<MarketplaceBreakdown[]>([]);

  const mountedRef = useRef(true);
  const phase1StartedRef = useRef(false);

  // Abort controllers for stop/pause
  const xeroAbortRef = useRef<AbortController | null>(null);
  const shopifyAbortRef = useRef<AbortController | null>(null);
  const amazonAbortRef = useRef<AbortController | null>(null);

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

      const dismissed = await getSetting('setup_hub_dismissed');
      if (dismissed === 'true') {
        navigate('/dashboard');
        return;
      }

      setCaps(c);

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

    // B1: Realistic timers — Xero 60s, Shopify 120s, Amazon 180s
    if (caps.hasXero && !phase1Xero) startProgressTimer(setXeroProgress, 150000);
    if (caps.hasShopify && !phase1Shopify) startProgressTimer(setShopifyProgress, 120000);
    if (caps.hasAmazon && !phase1Amazon) startProgressTimer(setAmazonProgress, 180000);

    // Run scans: Xero & Amazon in parallel, Shopify sequential internally
    if (caps.hasXero && !phase1Xero) runXeroScan(token, userId);
    if (caps.hasShopify && !phase1Shopify) runShopifyScan(token, userId);
    if (caps.hasAmazon && !phase1Amazon) runAmazonScan(token, userId);

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
    const increment = (interval / durationMs) * 95;
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
    const ac = new AbortController();
    xeroAbortRef.current = ac;
    setXeroStep({ status: 'running', message: 'Scanning Xero invoices, contacts & bank transactions...' });
    const result = await callEdgeFunctionSafe('scan-xero-history', token, {}, { signal: ac.signal });

    xeroAbortRef.current = null;
    if (!mountedRef.current) return;

    if (result.aborted) {
      setXeroStep({ status: 'error', message: 'Xero scan stopped', error: 'Stopped by user' });
      setXeroProgress(0);
      return;
    }

    if (result.ok) {
      const d = result.data || {};
      const invoiceCount = d.detected_settlements?.length || 0;
      const boundary = d.accounting_boundary_date;
      const standaloneCount = d.standalone_contacts?.length || 0;

      const { count: bankMatchCount } = await supabase
        .from('xero_accounting_matches')
        .select('*', { count: 'exact', head: true });

      const parts = [`Found ${invoiceCount} marketplace records in Xero`];
      if (standaloneCount > 0) parts.push(`${standaloneCount} contacts without invoices`);
      if (boundary) parts.push(`Boundary: ${boundary}`);
      if (bankMatchCount && bankMatchCount > 0) {
        parts.push(`${bankMatchCount} bank-verified`);
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
    setShopifyPayoutsStep({ status: 'running', message: 'Fetching payouts...' });
    const payoutsResult = await callEdgeFunctionSafe('fetch-shopify-payouts', token);
    if (!mountedRef.current) return;

    if (!payoutsResult.ok) {
      // Cooldown (429) or timeout is non-fatal — existing data is valid, continue pipeline
      const isCooldown = payoutsResult.error?.includes('429');
      const isTimeout = payoutsResult.error?.includes('timed out');
      if (isCooldown || isTimeout) {
        setShopifyPayoutsStep({ status: 'success', message: '✅ Payouts already synced recently' });
      } else {
        setShopifyPayoutsStep({ status: 'error', message: 'Payouts fetch failed', error: payoutsResult.error });
        // Don't halt — continue to orders & channels even if payouts fail
      }
    } else {
      const payoutCount = payoutsResult.data?.synced || payoutsResult.data?.count || 0;
      const skipped = payoutsResult.data?.skipped || 0;
      const msg = payoutCount > 0
        ? `✅ ${payoutCount} payouts fetched`
        : skipped > 0
          ? `✅ ${skipped} payouts already up to date`
          : '✅ No new payouts found';
      setShopifyPayoutsStep({ status: 'success', message: msg });
    }

    setShopifyOrdersStep({ status: 'running', message: 'Fetching orders (this may take a while)...' });
    const ordersResult = await callEdgeFunctionSafe('fetch-shopify-orders', token);
    if (!mountedRef.current) return;

    if (!ordersResult.ok) {
      setShopifyOrdersStep({ status: 'error', message: 'Orders fetch failed', error: ordersResult.error });
      setShopifyProgress(0);
      return;
    }
    const ordersFetched = ordersResult.data?.orders_saved || ordersResult.data?.count || 0;
    setShopifyOrdersStep({ status: 'success', message: `✅ ${ordersFetched} orders fetched` });

    const { count: actualOrderCount } = await supabase
      .from('shopify_orders')
      .select('*', { count: 'exact', head: true });

    if (!actualOrderCount || actualOrderCount === 0) {
      setShopifyChannelsStep({
        status: 'error',
        message: '⚠️ No orders in database — channel detection skipped.',
      });
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
    setAmazonStep({ status: 'running', message: 'Fetching Amazon settlements (this can take several minutes)...' });
    const result = await callEdgeFunctionSafe('fetch-amazon-settlements', token);
    if (!mountedRef.current) return;

    if (result.ok) {
      const { data: settlements } = await supabase
        .from('settlements')
        .select('period_start, period_end')
        .eq('marketplace', 'amazon_au')
        .order('period_start', { ascending: true });

      if (settlements && settlements.length > 0) {
        const earliest = settlements[0].period_start;
        const latest = settlements[settlements.length - 1].period_end;

        const gaps: string[] = [];
        for (let i = 1; i < settlements.length; i++) {
          const prevEnd = new Date(settlements[i - 1].period_end);
          const nextStart = new Date(settlements[i].period_start);
          const daysDiff = (nextStart.getTime() - prevEnd.getTime()) / (1000 * 60 * 60 * 24);
          if (daysDiff > 21) {
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
      startProgressTimer(setXeroProgress, 150000);
      runXeroScan(token, userId);
    } else if (api === 'shopify') {
      setShopifyProgress(0);
      startProgressTimer(setShopifyProgress, 120000);
      setShopifyPayoutsStep({ status: 'idle', message: '' });
      setShopifyOrdersStep({ status: 'idle', message: '' });
      setShopifyChannelsStep({ status: 'idle', message: '' });
      runShopifyScan(token, userId);
    } else {
      setAmazonProgress(0);
      startProgressTimer(setAmazonProgress, 180000);
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

  // ─── B2: Phase 2 gate — ALL connected APIs must complete ──────────
  const allConnectedPhase1Done =
    (!caps?.hasXero || phase1Xero) &&
    (!caps?.hasShopify || phase1Shopify) &&
    (!caps?.hasAmazon || phase1Amazon);

  const phase2GateReason = (): string | null => {
    if (!caps) return 'Initialising...';
    const waiting: string[] = [];
    if (caps.hasXero && !phase1Xero) waiting.push('Xero');
    if (caps.hasShopify && !phase1Shopify) waiting.push('Shopify');
    if (caps.hasAmazon && !phase1Amazon) waiting.push('Amazon');
    if (waiting.length === 0) return null;
    return `Waiting for ${waiting.join(' and ')} to finish...`;
  };

  // ─── B3: Phase 2 — reads ALL 5 detection sources ─────────────────
  const runPhase2 = useCallback(async () => {
    if (!caps?.userId || !caps?.accessToken) return;
    setPhase2Running(true);

    try {
      await provisionAllMarketplaceConnections(caps.userId);

      // Query all 5 sources in parallel
      const [subChannelsRes, alertsRes, connectionsRes, settlementsRes, fingerprintsRes] = await Promise.all([
        supabase.from('shopify_sub_channels').select('source_name, marketplace_label, marketplace_code, order_count, total_revenue'),
        supabase.from('channel_alerts').select('source_name, order_count, detected_label, detection_method, total_revenue'),
        supabase.from('marketplace_connections').select('marketplace_name, marketplace_code, connection_type, settings'),
        supabase.from('settlements').select('marketplace').neq('marketplace', null),
        supabase.from('marketplace_file_fingerprints').select('marketplace_code'),
      ]);

      const marketplaces: DetectedMarketplace[] = [];
      const seen = new Set<string>();

      // Source 1: shopify_sub_channels (source_name detection)
      for (const ch of subChannelsRes.data || []) {
        const code = ch.marketplace_code || ch.source_name;
        if (code && !seen.has(code)) {
          seen.add(code);
          marketplaces.push({
            name: ch.marketplace_label || displayName(code),
            code,
            orderCount: ch.order_count ?? undefined,
            source: 'Shopify orders (source_name)',
          });
        }
      }

      // Source 2: channel_alerts (tag detection + xero contacts)
      for (const alert of alertsRes.data || []) {
        const code = alert.source_name;
        if (code && !seen.has(code)) {
          seen.add(code);
          const method = alert.detection_method === 'tag' ? 'Shopify orders (tag detection)'
            : alert.detection_method === 'xero_contact_standalone' ? 'Xero contacts'
            : 'Detected from orders';
          marketplaces.push({
            name: alert.detected_label || displayName(code),
            code,
            orderCount: alert.order_count ?? undefined,
            source: method,
          });
        }
      }

      // Source 3: marketplace_connections (Xero scan + API connections)
      for (const conn of connectionsRes.data || []) {
        if (!seen.has(conn.marketplace_code)) {
          seen.add(conn.marketplace_code);
          const settings = conn.settings as Record<string, any> | null;
          const detectedFrom = settings?.detected_from;
          const source = detectedFrom === 'xero_scan' ? 'Xero invoice history'
            : detectedFrom === 'xero_contact' ? 'Xero contacts'
            : conn.connection_type === 'api' ? 'API connection'
            : 'Auto-detected';
          marketplaces.push({
            name: conn.marketplace_name,
            code: conn.marketplace_code,
            source,
          });
        }
      }

      // Source 4: settlements (marketplaces with actual data)
      for (const s of settlementsRes.data || []) {
        const code = s.marketplace;
        if (code && !seen.has(code)) {
          seen.add(code);
          marketplaces.push({
            name: displayName(code),
            code,
            source: 'Existing settlement data',
          });
        }
      }

      // Source 5: file fingerprints
      for (const fp of fingerprintsRes.data || []) {
        if (fp.marketplace_code && !seen.has(fp.marketplace_code)) {
          seen.add(fp.marketplace_code);
          marketplaces.push({
            name: displayName(fp.marketplace_code),
            code: fp.marketplace_code,
            source: 'Previous CSV upload',
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

  // ─── B4: Phase 3 — per-marketplace breakdown ─────────────────────
  const runPhase3 = useCallback(async () => {
    if (!caps?.accessToken || !caps?.userId) return;
    setPhase3Running(true);

    try {
      if (caps.hasXero) {
        await callEdgeFunctionSafe('match-bank-deposits', caps.accessToken);
      }

      await callEdgeFunctionSafe('run-validation-sweep', caps.accessToken);

      const { data: validations } = await supabase
        .from('marketplace_validation')
        .select('overall_status, marketplace_code, period_start, period_end, period_label, settlement_net, bank_amount, bank_matched, xero_pushed, settlement_uploaded')
        .order('marketplace_code')
        .order('period_start', { ascending: false });

      // Group by marketplace
      const byMarketplace = new Map<string, MarketplacePeriodDetail[]>();
      for (const v of (validations || []) as MarketplaceValidationRow[]) {
        const code = v.marketplace_code;
        if (!byMarketplace.has(code)) byMarketplace.set(code, []);
        byMarketplace.get(code)!.push({
          period_label: v.period_label,
          period_start: v.period_start,
          period_end: v.period_end,
          status: v.overall_status,
          settlement_net: v.settlement_net,
          bank_amount: v.bank_amount,
          bank_matched: v.bank_matched || false,
          xero_pushed: v.xero_pushed || false,
          settlement_uploaded: v.settlement_uploaded || false,
        });
      }

      const breakdown: MarketplaceBreakdown[] = Array.from(byMarketplace.entries()).map(([code, periods]) => ({
        code,
        name: displayName(code),
        periods,
      }));

      setPhase3Breakdown(breakdown);
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

  function StepRow({ step: s, onRetry }: { step: StepState; onRetry?: () => void }) {
    const [copied, setCopied] = useState(false);
    const copyError = () => {
      if (s.error) {
        navigator.clipboard.writeText(s.error);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    };
    return (
      <div className="space-y-1">
        <div className="flex items-start gap-3 py-1.5">
          <StatusIcon status={s.status} />
          <span className="text-sm text-foreground flex-1">{s.message}</span>
          {s.status === 'error' && onRetry && (
            <Button variant="ghost" size="sm" onClick={onRetry} className="h-6 px-2 text-xs">
              <RefreshCw className="h-3 w-3 mr-1" /> Retry
            </Button>
          )}
        </div>
        {s.status === 'error' && s.error && (
          <div className="ml-7 rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs space-y-1.5">
            <div className="flex items-center justify-between">
              <p className="font-medium text-destructive">Error details (share with support):</p>
              <Button variant="ghost" size="sm" onClick={copyError} className="h-5 px-1.5 text-[10px] text-destructive hover:text-destructive">
                {copied ? <Check className="h-3 w-3 mr-0.5" /> : <Copy className="h-3 w-3 mr-0.5" />}
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
            <code className="block whitespace-pre-wrap break-all font-mono text-[11px] text-destructive/80">{s.error}</code>
          </div>
        )}
      </div>
    );
  }

  function periodStatusIcon(status: string) {
    switch (status) {
      case 'complete': return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
      case 'pushed_to_xero': return <CheckCircle2 className="h-3.5 w-3.5 text-blue-500" />;
      case 'ready_to_push': return <ArrowRight className="h-3.5 w-3.5 text-blue-500" />;
      case 'settlement_needed':
      case 'missing': return <X className="h-3.5 w-3.5 text-destructive" />;
      case 'gap_detected': return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
      case 'already_recorded': return <CheckCircle2 className="h-3.5 w-3.5 text-muted-foreground" />;
      default: return <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  }

  function periodStatusText(p: MarketplacePeriodDetail): string {
    switch (p.status) {
      case 'complete':
        return `${formatCurrency(p.settlement_net)} — in Xero, bank deposit matched ✓`;
      case 'pushed_to_xero':
        return `${formatCurrency(p.settlement_net)} — in Xero, awaiting bank match`;
      case 'ready_to_push':
        return `${formatCurrency(p.settlement_net)} — validated, ready to push to Xero`;
      case 'settlement_needed':
      case 'missing':
        return 'No settlement file found';
      case 'gap_detected':
        return 'Settlement gap detected — possible missing period';
      case 'already_recorded':
        return 'Pre-boundary historical record';
      default:
        return p.status;
    }
  }

  function periodAction(p: MarketplacePeriodDetail, marketplaceCode: string) {
    if (p.status === 'ready_to_push') {
      return (
        <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => navigate('/dashboard')}>
          Push to Xero →
        </Button>
      );
    }
    if (p.status === 'settlement_needed' || p.status === 'missing') {
      return (
        <Button size="sm" variant="outline" className="h-6 text-xs" onClick={() => navigate('/dashboard')}>
          <Upload className="h-3 w-3 mr-1" /> Upload file
        </Button>
      );
    }
    if (p.status === 'complete' || p.status === 'pushed_to_xero') {
      return null; // Already handled
    }
    return null;
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
  const gateReason = phase2GateReason();

  // Progress bar status text
  function progressStatus(progress: number, done: boolean, apiName: string): string {
    if (done) return 'Complete';
    if (progress >= 95) return 'Still working...';
    return 'Scanning...';
  }

  // ─── Render ───────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-background">
      {/* App header — matches Dashboard */}
      <header className="border-b border-border bg-card">
        <div className="max-w-4xl mx-auto flex items-center justify-between h-14 px-4">
          <Link to="/" className="flex items-center">
            <XettleLogo height={28} />
          </Link>
          <Button variant="ghost" size="sm" onClick={() => navigate('/dashboard')}>
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Dashboard
          </Button>
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-4 py-10 space-y-8">
        {/* Header */}
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground">Setting up your account</h1>
          <p className="text-muted-foreground text-sm">
            Some steps run automatically — others wait until your data is ready. You can leave and come back.
          </p>
        </div>

        {/* ─── Phase 1 ─────────────────────────────────────────────── */}
        <Card>
          <CardContent className="pt-6 space-y-5">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
              Phase 1 — Fetching your data
            </h2>

            {caps.hasXero && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm font-medium text-foreground">
                  <span>Xero</span>
                  <span className="text-xs text-muted-foreground">
                    {progressStatus(xeroProgress, phase1Xero, 'Xero')}
                  </span>
                </div>
                <Progress value={xeroProgress} className="h-1.5" />
                {xeroStep.status !== 'idle' && (
                  <StepRow step={xeroStep} onRetry={() => retryStep('xero')} />
                )}
              </div>
            )}

            {caps.hasShopify && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm font-medium text-foreground">
                  <span>Shopify</span>
                  <span className="text-xs text-muted-foreground">
                    {progressStatus(shopifyProgress, phase1Shopify, 'Shopify')}
                  </span>
                </div>
                <Progress value={shopifyProgress} className="h-1.5" />
                {shopifyPayoutsStep.status !== 'idle' && (
                  <StepRow step={shopifyPayoutsStep} onRetry={() => retryStep('shopify')} />
                )}
                {shopifyOrdersStep.status !== 'idle' && (
                  <StepRow step={shopifyOrdersStep} onRetry={() => retryStep('shopify')} />
                )}
                {shopifyChannelsStep.status !== 'idle' && (
                  <StepRow step={shopifyChannelsStep} onRetry={() => retryStep('shopify')} />
                )}
              </div>
            )}

            {caps.hasAmazon && (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-sm font-medium text-foreground">
                  <span>Amazon</span>
                  <span className="text-xs text-muted-foreground">
                    {progressStatus(amazonProgress, phase1Amazon, 'Amazon')}
                  </span>
                </div>
                <Progress value={amazonProgress} className="h-1.5" />
                {amazonStep.status !== 'idle' && (
                  <StepRow step={amazonStep} onRetry={() => retryStep('amazon')} />
                )}
              </div>
            )}

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
              <div className="space-y-4">
                <div className="flex items-center gap-2 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" />
                  <span>{detectedMarketplaces.length} marketplace{detectedMarketplaces.length !== 1 ? 's' : ''} identified</span>
                </div>

                {/* Group by source */}
                {(() => {
                  const bySource = new Map<string, DetectedMarketplace[]>();
                  for (const m of detectedMarketplaces) {
                    if (!bySource.has(m.source)) bySource.set(m.source, []);
                    bySource.get(m.source)!.push(m);
                  }
                  return Array.from(bySource.entries()).map(([source, items]) => (
                    <div key={source} className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">{source}:</p>
                      <div className="flex flex-wrap gap-2 pl-2">
                        {items.map(m => (
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
                    </div>
                  ));
                })()}

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
                      disabled={!allConnectedPhase1Done || phase2Running}
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
                {gateReason && (
                  <TooltipContent>{gateReason}</TooltipContent>
                )}
              </Tooltip>
            )}
          </CardContent>
        </Card>

        {/* ─── Phase 3 ─────────────────────────────────────────────── */}
        <Card>
          <CardContent className="pt-6 space-y-4">
            <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
              Phase 3 — Settlement status by marketplace
            </h2>

            {phase3Complete && phase3Breakdown.length > 0 ? (
              <div className="space-y-6">
                {phase3Breakdown.map(mp => (
                  <div key={mp.code} className="space-y-2">
                    <h3 className="text-sm font-semibold text-foreground">{mp.name}</h3>
                    <div className="space-y-1.5 pl-2">
                      {mp.periods.map((p, i) => (
                        <div key={i} className="flex items-center gap-2 text-sm">
                          {periodStatusIcon(p.status)}
                          <span className="text-muted-foreground font-medium min-w-[80px]">{p.period_label}</span>
                          <span className="text-foreground flex-1">{periodStatusText(p)}</span>
                          {periodAction(p, mp.code)}
                        </div>
                      ))}
                    </div>
                    {/* Marketplace-level action hint */}
                    {mp.periods.some(p => p.status === 'settlement_needed' || p.status === 'missing') && (
                      <p className="text-xs text-muted-foreground pl-2 pt-1">
                        → Download your {mp.name} settlement and upload it here
                      </p>
                    )}
                    {mp.periods.some(p => p.status === 'ready_to_push') && !mp.periods.some(p => p.status === 'settlement_needed' || p.status === 'missing') && (
                      <p className="text-xs text-muted-foreground pl-2 pt-1">
                        → Push these to Xero to complete your reconciliation
                      </p>
                    )}
                  </div>
                ))}

                <div className="flex gap-3 pt-4 border-t border-border">
                  <Button onClick={goToDashboard}>
                    <LayoutDashboard className="h-4 w-4 mr-2" /> Go to Dashboard
                  </Button>
                </div>
              </div>
            ) : phase3Complete && phase3Breakdown.length === 0 ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">No validation data found. Upload settlement files from the dashboard.</p>
                <Button onClick={goToDashboard}>
                  <LayoutDashboard className="h-4 w-4 mr-2" /> Go to Dashboard
                </Button>
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
                        <>Check settlement status <ArrowRight className="h-4 w-4 ml-2" /></>
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

        {!hasAnyApi && (
          <div className="text-center">
            <Button onClick={goToDashboard} variant="outline">
              <LayoutDashboard className="h-4 w-4 mr-2" /> Skip to Dashboard
            </Button>
          </div>
        )}
      </div>

      {showAddManual && manualChannel && (
        <SubChannelSetupModal
          channel={manualChannel}
          open={showAddManual}
          onClose={() => { setShowAddManual(false); setManualChannel(null); }}
          onComplete={() => {
            setShowAddManual(false);
            setManualChannel(null);
            runPhase2();
          }}
        />
      )}
    </div>
  );
}
