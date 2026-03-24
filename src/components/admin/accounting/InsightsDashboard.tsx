import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Info, TrendingUp, DollarSign, BarChart3, Store, Clock, Receipt, Plus, Megaphone, Wallet, Truck, AlertTriangle, Upload, FileText, Check, ClipboardPaste } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { MARKETPLACE_LABELS } from '@/utils/settlement-engine';
import LoadingSpinner from '@/components/ui/loading-spinner';
import { loadFulfilmentMethods, loadPostageCosts, loadFreeShippingThresholds, getEffectiveMethod, type FulfilmentMethod } from '@/utils/fulfilment-settings';
import { ReconciliationHealth } from '@/components/shared/ReconciliationStatus';
import MarketplaceProfitComparison from '@/components/insights/MarketplaceProfitComparison';
import SkuComparisonView from '@/components/insights/SkuComparisonView';
import MarketplaceAlertsBanner from '@/components/MarketplaceAlertsBanner';
import { toast } from '@/hooks/use-toast';

import {
  normalizeMarketplace as canonicalNormalizeMarketplace,
  PLATFORM_FAMILIES,
} from '@/utils/insights-fee-attribution';

interface FeeBreakdown {
  label: string;
  amount: number;
  pctOfSales: number;
  color: string;
}

interface MarketplaceStats {
  marketplace: string;
  label: string;
  totalSales: number;
  totalFees: number;
  totalRefunds: number;
  netPayout: number;
  returnRatio: number;
  feeLoad: number;
  settlementCount: number;
  latestPeriodEnd: string | null;
  earliestPeriodStart: string | null;
  avgCommission: number;
  adSpend: number;
  returnAfterAds: number | null;
  shippingCostPerOrder: number;
  estimatedShippingCost: number;
  returnAfterShipping: number | null;
  returnAfterAdsAndShipping: number | null;
  fulfilmentMethod: FulfilmentMethod;
  fulfilmentUnknown: boolean;
  // Data quality flags
  hasEstimatedFees: boolean;
  hasMissingFeeData: boolean;
  hasFeeAnomaly: boolean;
  hasNegativePayout: boolean;
  // Fee breakdown
  commissionTotal: number;
  fbaTotal: number;
  storageTotal: number;
  otherFeesTotal: number;
  feeBreakdown: FeeBreakdown[];
  // PAC shipping estimate
  pacShippingAvg60: number | null;
  pacShippingAvg14: number | null;
  pacShippingSample: number;
  pacEstimateQuality: string | null;
  // Shipping revenue & threshold
  salesShipping: number;
  freeShippingThreshold: number;
}

interface AdSpendRecord {
  marketplace_code: string;
  spend_amount: number;
}

interface ShippingCostRecord {
  marketplace_code: string;
  cost_per_order: number;
}

export default function InsightsDashboard() {
  const [stats, setStats] = useState<MarketplaceStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [adDialogOpen, setAdDialogOpen] = useState(false);
  const [adDialogMarketplace, setAdDialogMarketplace] = useState('');
  const [adMonth, setAdMonth] = useState('');
  const [adAmount, setAdAmount] = useState('');
  const [adCurrency, setAdCurrency] = useState('AUD');
  const [adNotes, setAdNotes] = useState('');
  const [adSaving, setAdSaving] = useState(false);
  const [adUploadParsing, setAdUploadParsing] = useState(false);
  const [adParsedEntries, setAdParsedEntries] = useState<Array<{
    marketplace_code: string;
    marketplace_label: string;
    period_start: string;
    period_end: string;
    spend_amount: number;
    currency: string;
    includes_gst: boolean;
    gst_amount: number | null;
    invoice_number: string | null;
    confidence: number;
  }>>([]);
  const [adUploadMode, setAdUploadMode] = useState<'manual' | 'upload'>('manual');
  const [adPastedText, setAdPastedText] = useState('');
  const [shippingDialogOpen, setShippingDialogOpen] = useState(false);
  const [shippingDialogMarketplace, setShippingDialogMarketplace] = useState('');
  const [shippingCostPerOrder, setShippingCostPerOrder] = useState('');
  const [shippingCurrency, setShippingCurrency] = useState('AUD');
  const [shippingNotes, setShippingNotes] = useState('');
  const [shippingSaving, setShippingSaving] = useState(false);

  useEffect(() => {
    loadStats();
  }, []);

  async function loadStats() {
    try {
      // Insights is an analytics view — include pre-boundary (historical) settlements
      // so that all marketplace sales data contributes to trends and totals.
      const { data: { user: currentUser } } = await supabase.auth.getUser();
      if (!currentUser) { setStats([]); return; }
      const userId = currentUser.id;
      const [settlementsRes, adSpendRes, shippingRes, fulfilmentMethods, postageCosts, profitOrdersRes, observedRatesRes, pacShippingStatsRes, pacQualityRes] = await Promise.all([
        supabase
          .from('settlements')
          .select('settlement_id, marketplace, sales_principal, gst_on_income, seller_fees, refunds, bank_deposit, fba_fees, other_fees, storage_fees, period_end, period_start, is_hidden, is_pre_boundary, source, raw_payload')
          .eq('user_id', userId)
          .eq('is_hidden', false)
          .is('duplicate_of_settlement_id', null)
          .not('status', 'in', '("push_failed_permanent","duplicate_suppressed")')
          .order('period_end', { ascending: false }),
        supabase
          .from('marketplace_ad_spend')
          .select('marketplace_code, spend_amount')
          .eq('user_id', userId),
        supabase
          .from('marketplace_shipping_costs')
          .select('marketplace_code, cost_per_order')
          .eq('user_id', userId),
        loadFulfilmentMethods(userId),
        loadPostageCosts(userId),
        supabase
          .from('settlement_profit')
          .select('settlement_id, marketplace_code, orders_count')
          .eq('user_id', userId),
        supabase
          .from('app_settings')
          .select('key, value')
          .eq('user_id', userId)
          .like('key', 'observed_commission_rate_%'),
        supabase
          .from('marketplace_shipping_stats')
          .select('marketplace_code, avg_shipping_cost_60, avg_shipping_cost_14, sample_size')
          .eq('user_id', userId),
        supabase
          .from('order_shipping_estimates')
          .select('marketplace_code, estimate_quality')
          .eq('user_id', userId),
      ]);

      if (settlementsRes.error) throw settlementsRes.error;
      // Filter out any corrupted rows with impossibly large values or bad GST
      const data = (settlementsRes.data || []).filter(r => 
        r.is_hidden === false && 
        Math.abs(r.sales_principal || 0) < 10_000_000 &&
        // GST cannot exceed sales principal (10% in AU, max ~15% globally)
        (r.gst_on_income || 0) <= (r.sales_principal || 0) * 0.5
      );
      if (data.length === 0) {
        setStats([]);
        return;
      }

      const adSpendByMp: Record<string, number> = {};
      if (adSpendRes.data) {
        for (const row of adSpendRes.data as AdSpendRecord[]) {
          adSpendByMp[row.marketplace_code] = (adSpendByMp[row.marketplace_code] || 0) + Number(row.spend_amount);
        }
      }

      const shippingCostByMp: Record<string, number> = {};
      if (shippingRes.data) {
        for (const row of shippingRes.data as ShippingCostRecord[]) {
          shippingCostByMp[row.marketplace_code] = Number(row.cost_per_order);
        }
      }

      // Aggregate order counts from settlement_profit by marketplace
      // NOTE: profitOrderCounts is built later, after activeSettlementIds is determined
      const _rawProfitOrders = profitOrdersRes.data as any[] || [];

      // Build observed commission rates from app_settings
      const observedRates: Record<string, number> = {};
      if (observedRatesRes.data) {
        for (const row of observedRatesRes.data as any[]) {
          const mpCode = (row.key as string).replace('observed_commission_rate_', '');
          const rate = parseFloat(row.value);
          if (!isNaN(rate) && rate > 0 && rate < 1) {
            observedRates[mpCode] = rate;
          }
        }
      }

      // Build PAC shipping stats by marketplace
      const pacStatsByMp: Record<string, { avg60: number | null; avg14: number | null; sample: number }> = {};
      if (pacShippingStatsRes.data) {
        for (const row of pacShippingStatsRes.data as any[]) {
          pacStatsByMp[row.marketplace_code] = {
            avg60: row.avg_shipping_cost_60 !== null ? Number(row.avg_shipping_cost_60) : null,
            avg14: row.avg_shipping_cost_14 !== null ? Number(row.avg_shipping_cost_14) : null,
            sample: Number(row.sample_size) || 0,
          };
        }
      }

      // Build dominant estimate quality per marketplace from order_shipping_estimates
      const pacQualityByMp: Record<string, string> = {};
      if (pacQualityRes.data) {
        const qualityCounts: Record<string, Record<string, number>> = {};
        for (const row of pacQualityRes.data as any[]) {
          const mp = row.marketplace_code;
          if (!mp) continue;
          if (!qualityCounts[mp]) qualityCounts[mp] = {};
          qualityCounts[mp][row.estimate_quality] = (qualityCounts[mp][row.estimate_quality] || 0) + 1;
        }
        for (const [mp, counts] of Object.entries(qualityCounts)) {
          let dominant = 'low';
          let maxCount = 0;
          for (const [quality, count] of Object.entries(counts)) {
            if (count > maxCount) { dominant = quality; maxCount = count; }
          }
          pacQualityByMp[mp] = dominant;
        }
      }

      // e.g. 'woolworths_marketplus_bigw' → 'bigw', 'shopify_orders_kogan' → 'kogan'
      const normalizeMarketplace = canonicalNormalizeMarketplace;

      const grouped: Record<string, typeof data> = {};
      for (const row of data) {
        const rawMp = row.marketplace;
        if (!rawMp) continue; // Skip settlements with no marketplace tag
        const mp = normalizeMarketplace(rawMp);
        if (!grouped[mp]) grouped[mp] = [];
        grouped[mp].push(row);
      }

      // ─── Exclude api_sync zero-fee rows when real settlements exist ───
      // api_sync rows (from Shopify order syncs) carry $0 fees by design.
      // They're reconciliation aids, not accounting records. When we have
      // real CSV/direct settlements for the same marketplace, drop them
      // so Insights shows only actual fee data — no estimates needed.
      for (const [mp, rows] of Object.entries(grouped)) {
        const realRows = rows.filter(r => (r as any).source !== 'api_sync');
        const apiSyncRows = rows.filter(r => (r as any).source === 'api_sync');
        if (realRows.length > 0 && apiSyncRows.length > 0) {
          // We have real settlement data — drop the api_sync rows entirely
          grouped[mp] = realRows;
        }
      }

      // ─── Build activeSettlementIds AFTER dedup ────────────────────────
      const dedupedSettlements = Object.values(grouped).flat();
      const activeSettlementIds = new Set(dedupedSettlements.map(s => (s as any).settlement_id));

      // Aggregate order counts from settlement_profit — only for active settlements
      const profitOrderCounts: Record<string, number> = {};
      for (const row of _rawProfitOrders) {
        if (!activeSettlementIds.has(row.settlement_id)) continue;
        const mp = row.marketplace_code;
        profitOrderCounts[mp] = (profitOrderCounts[mp] || 0) + (Number(row.orders_count) || 0);
      }

      // ─── Platform Family Fee Redistribution ───────────────────────────
      // MyDeal, BigW, and Everyday Market all share the Woolworths MarketPlus platform.
      // The Woolworths CSV allocates platform-level fees (subscriptions, etc.) to MyDeal
      // even when sales occur on BigW or Everyday Market. This creates an anomaly where
      // MyDeal shows fees >> sales, while BigW/Everyday Market appear artificially cheap.
      // Fix: detect fee-heavy marketplaces and redistribute excess fees to siblings.
      // Platform family fee redistribution using canonical PLATFORM_FAMILIES
      for (const siblings of Object.values(PLATFORM_FAMILIES)) {
        const presentSiblings = siblings.filter(s => grouped[s]);
        if (presentSiblings.length < 2) continue;

        // Find fee-heavy members (fees > sales * 1.5, indicating platform overhead)
        const feeHeavy: string[] = [];
        const salesSiblings: string[] = [];
        for (const s of presentSiblings) {
          const rows = grouped[s];
          const sales = rows.reduce((sum, r) => sum + (r.sales_principal || 0) + (r.gst_on_income || 0), 0);
          const fees = rows.reduce((sum, r) => sum + Math.abs(r.seller_fees || 0) + Math.abs(r.fba_fees || 0) + Math.abs(r.storage_fees || 0) + Math.abs(r.other_fees || 0), 0);
          if (fees > Math.max(sales * 1.5, 50)) {
            feeHeavy.push(s);
          } else if (sales > 0) {
            salesSiblings.push(s);
          }
        }

        if (feeHeavy.length === 0 || salesSiblings.length === 0) continue;

        // Calculate total excess fees from fee-heavy members
        let totalExcessFees = 0;
        for (const fh of feeHeavy) {
          const rows = grouped[fh];
          const sales = rows.reduce((sum, r) => sum + (r.sales_principal || 0) + (r.gst_on_income || 0), 0);
          const fees = rows.reduce((sum, r) => sum + Math.abs(r.seller_fees || 0) + Math.abs(r.fba_fees || 0) + Math.abs(r.storage_fees || 0) + Math.abs(r.other_fees || 0), 0);
          // Use observed rate if available, fall back to 15% with estimation flag
          const ownFeeRate = observedRates[fh] ?? 0.15;
          const ownFees = sales * ownFeeRate;
          const excess = Math.max(fees - ownFees, 0);
          totalExcessFees += excess;
          // Subtract excess from fee-heavy sibling so its card shows only its own share
          (grouped[fh] as any)._redistributedPlatformFees = -excess;
        }

        // Distribute proportionally to sales-producing siblings by their sales volume
        const siblingSales: Record<string, number> = {};
        let totalSiblingSales = 0;
        for (const s of salesSiblings) {
          const sales = grouped[s].reduce((sum, r) => sum + (r.sales_principal || 0) + (r.gst_on_income || 0), 0);
          siblingSales[s] = sales;
          totalSiblingSales += sales;
        }

        // Store redistributed fees per marketplace for use in stats calculation
        if (totalSiblingSales > 0 && totalExcessFees > 0) {
          for (const s of salesSiblings) {
            const share = siblingSales[s] / totalSiblingSales;
            const feeShare = totalExcessFees * share;
            (grouped[s] as any)._redistributedPlatformFees = feeShare;
          }
        }
      }

      const results: MarketplaceStats[] = [];

      for (const [mp, rows] of Object.entries(grouped)) {
        // Skip fee-only groups with zero or negligible sales (e.g. MyDeal platform fee batches)
        const totalSalesExGst = rows.reduce((sum, r) => sum + (r.sales_principal || 0), 0);
        const totalGstOnSales = rows.reduce((sum, r) => sum + (r.gst_on_income || 0), 0);
        const totalSales = totalSalesExGst + totalGstOnSales;
        if (totalSales <= 0) continue;
        const totalFees = rows.reduce((sum, r) =>
          sum + Math.abs(r.seller_fees || 0) + Math.abs(r.fba_fees || 0) + Math.abs(r.storage_fees || 0) + Math.abs(r.other_fees || 0), 0);
        const totalRefunds = rows.reduce((sum, r) => sum + Math.abs(r.refunds || 0), 0);
        // Check if ANY rows in this group came from shopify_orders (clearing invoices with $0 bank_deposit)
        const hasShopifyOrdersRows = rows.some(r => (r.marketplace || '').startsWith('shopify_orders_'));
        const hasDirectSettlements = rows.some(r => !(r.marketplace || '').startsWith('shopify_orders_'));
        // For mixed groups: use bank_deposit from direct settlements + sales from clearing invoices
        const netPayout = hasDirectSettlements
          ? rows.reduce((sum, r) => {
              if ((r.marketplace || '').startsWith('shopify_orders_')) return sum + ((r.sales_principal || 0) + (r.gst_on_income || 0));
              return sum + (r.bank_deposit || 0);
            }, 0)
          : hasShopifyOrdersRows
            ? totalSales // All clearing invoices — revenue IS the sales total
            : rows.reduce((sum, r) => sum + (r.bank_deposit || 0), 0);
        // Cap ratio at 1.0 — a return > $1 per $1 sold is impossible
        const returnRatioRaw = totalSales > 0 ? Math.min(netPayout / totalSales, 1) : 0;
        const feesOnlyLoad = totalSales > 0 ? Math.min(totalFees / totalSales, 1) : 0;
        const feeLoad = totalSales > 0 ? Math.min(totalFees / totalSales, 1) : 0;
        const commissionTotal = Math.abs(rows.reduce((sum, r) => sum + (r.seller_fees || 0), 0));
        const avgCommission = totalSales > 0 ? Math.min(commissionTotal / totalSales, 1) : 0;
        const latestPeriodEnd = rows.length > 0 ? rows[0].period_end : null;
        const earliestPeriodStart = rows.length > 0 
          ? rows.reduce((earliest, r) => !earliest || (r.period_start && r.period_start < earliest) ? r.period_start : earliest, rows[0].period_start)
          : null;
        const fbaTotal = Math.abs(rows.reduce((sum, r) => sum + (r.fba_fees || 0), 0));
        const storageTotal = Math.abs(rows.reduce((sum, r) => sum + (r.storage_fees || 0), 0));
        const otherFeesTotal = Math.abs(rows.reduce((sum, r) => sum + (r.other_fees || 0), 0));

        const adSpend = adSpendByMp[mp] || 0;
        const returnAfterAds = totalSales > 0 ? Math.max(Math.min((netPayout - adSpend) / totalSales, 1), -1) : null;

        // Fulfilment method
        const fulfilmentMethod = getEffectiveMethod(mp, fulfilmentMethods[mp]);
        const fulfilmentUnknown = fulfilmentMethod === 'not_sure';

        // Shipping cost estimation — only applied for self_ship / third_party_logistics
        const shippingCostPerOrder = shippingCostByMp[mp] || postageCosts[mp] || 0;
        const estimatedOrderCount = (() => {
          const profitOrderCount = profitOrderCounts[mp];
          if (profitOrderCount && profitOrderCount > 0) return profitOrderCount;
          return 0;
        })();
        const shouldDeductShipping = fulfilmentMethod === 'self_ship' || fulfilmentMethod === 'third_party_logistics';
        const estimatedShippingCost = shouldDeductShipping ? shippingCostPerOrder * estimatedOrderCount : 0;
        
        // Primary returnRatio now includes shipping when configured — this makes
        // FBA vs self-ship comparisons fair (FBA fees already include fulfilment)
        const returnRatio = totalSales > 0 
          ? Math.min(Math.max((netPayout - estimatedShippingCost) / totalSales, -1), 1) 
          : 0;
        
        const returnAfterShipping = totalSales > 0 && shouldDeductShipping && shippingCostPerOrder > 0 && estimatedOrderCount > 0
          ? Math.max(Math.min((netPayout - estimatedShippingCost) / totalSales, 1), -1) 
          : null;
        const returnAfterAdsAndShipping = totalSales > 0 && (adSpend > 0 || (shouldDeductShipping && shippingCostPerOrder > 0 && estimatedOrderCount > 0))
          ? Math.max(Math.min((netPayout - adSpend - estimatedShippingCost) / totalSales, 1), -1)
          : null;

        // Fee breakdown is built AFTER effective adjustments below
        // (placeholder — real breakdown built before results.push)

        // ─── Universal Data Quality Guards ──────────────────────────────
        const hasEstimatedFees = rows.some(r => {
          const payload = r.raw_payload as any;
          return payload?.fees_estimated === true;
        });
        const apiSyncZeroFeeRows = rows.filter(r => 
          (r as any).source === 'api_sync' && Math.abs(r.seller_fees || 0) < 0.01
        );
        let hasMissingFeeData = totalFees === 0 && totalSales > 500;

        // Include redistributed platform fees from sibling marketplaces (these are REAL fees, just reallocated)
        const redistributedPlatformFees = (grouped[mp] as any)?._redistributedPlatformFees || 0;

        let effectiveReturnRatio = returnRatio;
        let effectiveFeeLoad = feeLoad;
        let effectiveNetPayout = netPayout;
        let effectiveTotalFees = totalFees + redistributedPlatformFees;
        let effectiveHasEstimatedFees = hasEstimatedFees;

        // For fee/commission calculations, identify rows with real fee data
        const feeRelevantRows = rows.filter(r => {
          const isApiSyncZeroFee = (r as any).source === 'api_sync' && Math.abs(r.seller_fees || 0) < 0.01;
          return !isApiSyncZeroFee;
        });

        if (apiSyncZeroFeeRows.length > 0 && apiSyncZeroFeeRows.length === rows.length) {
          // Case 1: ALL rows are api_sync with zero fees — NO estimation.
          // Show "Fee data unavailable" instead of fabricated numbers.
          effectiveTotalFees = 0;
          effectiveNetPayout = netPayout; // keep raw payout
          effectiveReturnRatio = returnRatio;
          effectiveFeeLoad = 0;
          effectiveHasEstimatedFees = false;
          hasMissingFeeData = true;
        }
        // Case 2 (mixed) REMOVED — upstream filter at lines 196-203 already
        // excludes api_sync rows when real CSV data exists.

        // After api_sync estimation, apply redistributed platform fees from siblings
        // Positive = fees added to sales sibling, Negative = excess removed from fee-heavy sibling
        if (redistributedPlatformFees !== 0) {
          effectiveTotalFees += redistributedPlatformFees;
          effectiveNetPayout -= redistributedPlatformFees;
          effectiveReturnRatio = totalSales > 0 ? Math.min(effectiveNetPayout / totalSales, 1) : 0;
          effectiveFeeLoad = totalSales > 0 ? Math.min(Math.max(effectiveTotalFees, 0) / totalSales, 1) : 0;
          // Flag as estimated if any sibling used the 0.15 fallback (no observed rate)
          const usedFallback = Object.keys(PLATFORM_FAMILIES).some(family =>
            PLATFORM_FAMILIES[family].some(s => grouped[s] && !observedRates[s])
          );
          if (usedFallback) effectiveHasEstimatedFees = true;
        }

        const adjustedCommissionTotal = feeRelevantRows.length > 0 && feeRelevantRows.length < rows.length
          ? Math.abs(feeRelevantRows.reduce((sum, r) => sum + (r.seller_fees || 0), 0))
          : commissionTotal;

        // Derive effectiveAvgCommission aligned with the estimated fee logic above
        let effectiveAvgCommission: number;
        if (apiSyncZeroFeeRows.length > 0 && apiSyncZeroFeeRows.length === rows.length) {
          // All api_sync: no fee data available
          effectiveAvgCommission = 0;
        } else {
          // Real-fee marketplaces: commission must reflect redistribution too
          const redistributedCommission = Math.max(adjustedCommissionTotal + redistributedPlatformFees, 0);
          effectiveAvgCommission = totalSales > 0 ? Math.min(redistributedCommission / totalSales, 1) : 0;
        }

        // ─── Build fee breakdown using EFFECTIVE values (after estimation & redistribution) ───
        // For fee-heavy siblings (negative redistribution), reduce commission by the excess removed.
        // For sales siblings (positive redistribution), add their share to commission.
        let finalCommission: number;
        if (apiSyncZeroFeeRows.length > 0 && apiSyncZeroFeeRows.length === rows.length) {
          // All api_sync: commission IS the entire effective fee total
          finalCommission = Math.max(effectiveTotalFees, 0);
        } else {
          finalCommission = Math.max(adjustedCommissionTotal + redistributedPlatformFees, 0);
        }
        const finalOther = otherFeesTotal;

        // Separate fee-only breakdown (no refunds) and refund breakdown
        const feeBreakdown: FeeBreakdown[] = [];
        if (finalCommission > 0) feeBreakdown.push({ label: 'Commission', amount: finalCommission, pctOfSales: totalSales > 0 ? finalCommission / totalSales : 0, color: 'bg-primary' });
        if (fbaTotal > 0) feeBreakdown.push({ label: 'FBA Fulfilment', amount: fbaTotal, pctOfSales: totalSales > 0 ? fbaTotal / totalSales : 0, color: 'bg-destructive' });
        if (storageTotal > 0) feeBreakdown.push({ label: 'Storage', amount: storageTotal, pctOfSales: totalSales > 0 ? storageTotal / totalSales : 0, color: 'bg-muted-foreground' });
        if (finalOther > 0) feeBreakdown.push({ label: 'Other fees', amount: finalOther, pctOfSales: totalSales > 0 ? finalOther / totalSales : 0, color: 'bg-muted-foreground/40' });
        feeBreakdown.sort((a, b) => b.amount - a.amount);

        // ─── Compute feeLoad from fee-only breakdown (excludes refunds) ───
        const breakdownTotal = feeBreakdown.reduce((sum, f) => sum + f.amount, 0);
        const consistentFeeLoad = totalSales > 0 ? Math.min(breakdownTotal / totalSales, 1) : 0;
        const refundLoad = totalSales > 0 ? totalRefunds / totalSales : 0;

        // PAC shipping estimate data
        const pacStats = pacStatsByMp[mp];

        results.push({
          marketplace: mp,
          label: MARKETPLACE_LABELS[mp] || mp,
          totalSales,
          totalFees: breakdownTotal,
          totalRefunds,
          netPayout: effectiveNetPayout,
          returnRatio: effectiveReturnRatio,
          feeLoad: consistentFeeLoad,
          settlementCount: rows.length,
          latestPeriodEnd,
          earliestPeriodStart,
          avgCommission: effectiveAvgCommission,
          adSpend,
          returnAfterAds,
          shippingCostPerOrder,
          estimatedShippingCost,
          returnAfterShipping,
          returnAfterAdsAndShipping,
          commissionTotal: finalCommission,
          fbaTotal,
          storageTotal,
          otherFeesTotal: finalOther,
          feeBreakdown,
          fulfilmentMethod,
          fulfilmentUnknown,
          hasEstimatedFees: effectiveHasEstimatedFees,
          hasMissingFeeData,
          hasFeeAnomaly: breakdownTotal > totalSales,
          hasNegativePayout: effectiveNetPayout < 0 && totalSales > 0,
          pacShippingAvg60: pacStats?.avg60 ?? null,
          pacShippingAvg14: pacStats?.avg14 ?? null,
          pacShippingSample: pacStats?.sample ?? 0,
          pacEstimateQuality: pacQualityByMp[mp] ?? null,
        });
      }

      results.sort((a, b) => b.returnRatio - a.returnRatio);
      setStats(results);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  function openAdDialog(marketplaceCode: string) {
    setAdDialogMarketplace(marketplaceCode);
    setAdMonth('');
    setAdAmount('');
    setAdCurrency('AUD');
    setAdNotes('');
    setAdParsedEntries([]);
    setAdPastedText('');
    setAdUploadMode('manual');
    setAdDialogOpen(true);
  }

  async function handleAdSpendPastedText(text: string) {
    if (!text.trim()) return;
    setAdUploadParsing(true);
    setAdParsedEntries([]);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await supabase.functions.invoke('parse-ad-spend-invoice', {
        body: {
          file_content: text.substring(0, 50000),
          file_name: 'pasted-text.txt',
          file_type: 'text/plain',
        },
      });

      if (res.error) throw new Error(res.error.message || 'Parse failed');
      const parsed = res.data;

      if (parsed.error) {
        toast({ title: 'Could not parse text', description: parsed.error, variant: 'destructive' });
        return;
      }

      if (!parsed.entries || parsed.entries.length === 0) {
        toast({ title: 'No ad spend data found', description: parsed.raw_summary || 'The text did not contain recognisable ad spend data.', variant: 'destructive' });
        return;
      }

      setAdParsedEntries(parsed.entries);
      toast({ title: `Found ${parsed.entries.length} ad spend ${parsed.entries.length === 1 ? 'entry' : 'entries'}` });
    } catch (err: any) {
      toast({ title: 'Parse failed', description: err.message, variant: 'destructive' });
    } finally {
      setAdUploadParsing(false);
    }
  }

  async function handleAdSpendFileUpload(file: File) {
    setAdUploadParsing(true);
    setAdParsedEntries([]);
    try {
      let textContent = '';
      if (file.type === 'application/pdf') {
        const arrayBuffer = await file.arrayBuffer();
        const bytes = new Uint8Array(arrayBuffer);
        let binary = '';
        for (let i = 0; i < bytes.length; i++) {
          binary += String.fromCharCode(bytes[i]);
        }
        textContent = `[PDF file - base64 encoded]\n${btoa(binary).substring(0, 50000)}`;
      } else {
        textContent = await file.text();
        if (textContent.length > 50000) textContent = textContent.substring(0, 50000);
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('Not authenticated');

      const res = await supabase.functions.invoke('parse-ad-spend-invoice', {
        body: {
          file_content: textContent,
          file_name: file.name,
          file_type: file.type,
        },
      });

      if (res.error) throw new Error(res.error.message || 'Parse failed');
      const parsed = res.data;

      if (parsed.error) {
        toast({ title: 'Could not parse invoice', description: parsed.error, variant: 'destructive' });
        return;
      }

      if (!parsed.entries || parsed.entries.length === 0) {
        toast({ title: 'No ad spend data found', description: parsed.raw_summary || 'The file did not contain recognisable ad spend data.', variant: 'destructive' });
        return;
      }

      setAdParsedEntries(parsed.entries);
      toast({ title: `Found ${parsed.entries.length} ad spend ${parsed.entries.length === 1 ? 'entry' : 'entries'}` });
    } catch (err: any) {
      toast({ title: 'Upload failed', description: err.message, variant: 'destructive' });
    } finally {
      setAdUploadParsing(false);
    }
  }

  async function saveAllParsedAdSpend() {
    setAdSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      let saved = 0;
      for (const entry of adParsedEntries) {
        const amount = entry.includes_gst && entry.gst_amount
          ? entry.spend_amount - entry.gst_amount
          : entry.spend_amount;

        const { error } = await supabase
          .from('marketplace_ad_spend')
          .upsert({
            user_id: user.id,
            marketplace_code: entry.marketplace_code,
            period_start: entry.period_start,
            period_end: entry.period_end,
            spend_amount: Math.round(amount * 100) / 100,
            currency: entry.currency,
            source: 'invoice_upload',
            notes: entry.invoice_number ? `Invoice: ${entry.invoice_number}` : null,
          }, { onConflict: 'user_id,marketplace_code,period_start' });

        if (error) throw error;
        saved++;
      }

      toast({ title: `${saved} ad spend ${saved === 1 ? 'entry' : 'entries'} saved` });
      setAdDialogOpen(false);
      await loadStats();
    } catch (err: any) {
      toast({ title: 'Failed to save', description: err.message, variant: 'destructive' });
    } finally {
      setAdSaving(false);
    }
  }

  async function saveAdSpend() {
    if (!adMonth || !adAmount || Number(adAmount) <= 0) {
      toast({ title: 'Please enter a valid month and amount', variant: 'destructive' });
      return;
    }
    setAdSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const periodStart = `${adMonth}-01`;
      const d = new Date(periodStart);
      const periodEnd = new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().split('T')[0];

      const { error } = await supabase
        .from('marketplace_ad_spend')
        .upsert({
          user_id: user.id,
          marketplace_code: adDialogMarketplace,
          period_start: periodStart,
          period_end: periodEnd,
          spend_amount: Number(adAmount),
          currency: adCurrency,
          source: 'manual',
          notes: adNotes || null,
        }, { onConflict: 'user_id,marketplace_code,period_start' });

      if (error) throw error;

      toast({ title: 'Ad spend saved' });
      setAdDialogOpen(false);
      await loadStats();
    } catch (err: any) {
      toast({ title: 'Failed to save', description: err.message, variant: 'destructive' });
    } finally {
      setAdSaving(false);
    }
  }

  function openShippingDialog(marketplaceCode: string) {
    setShippingDialogMarketplace(marketplaceCode);
    const existing = stats.find(s => s.marketplace === marketplaceCode);
    setShippingCostPerOrder(existing?.shippingCostPerOrder ? String(existing.shippingCostPerOrder) : '');
    setShippingCurrency('AUD');
    setShippingNotes('');
    setShippingDialogOpen(true);
  }

  async function saveShippingCost() {
    if (!shippingCostPerOrder || Number(shippingCostPerOrder) < 0) {
      toast({ title: 'Please enter a valid shipping cost', variant: 'destructive' });
      return;
    }
    setShippingSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase
        .from('marketplace_shipping_costs')
        .upsert({
          user_id: user.id,
          marketplace_code: shippingDialogMarketplace,
          cost_per_order: Number(shippingCostPerOrder),
          currency: shippingCurrency,
          notes: shippingNotes || null,
        }, { onConflict: 'user_id,marketplace_code' });

      if (error) throw error;

      toast({ title: 'Shipping cost saved' });
      setShippingDialogOpen(false);
      await loadStats();
    } catch (err: any) {
      toast({ title: 'Failed to save', description: err.message, variant: 'destructive' });
    } finally {
      setShippingSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <LoadingSpinner size="lg" text="Loading marketplace insights..." />
      </div>
    );
  }

  if (stats.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold text-foreground">Marketplace Insights</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Cross-marketplace analytics will appear here once you upload your first settlement.
          </p>
        </div>
        <Card>
          <CardContent className="py-16 text-center">
            <BarChart3 className="h-12 w-12 text-muted-foreground/20 mx-auto mb-4" />
            <p className="text-sm text-muted-foreground">No settlement data yet</p>
            <p className="text-xs text-muted-foreground mt-1">
              Switch to the <strong>Settlements</strong> tab to upload your first marketplace file.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Best performer = highest returnRatio across ALL marketplaces.
  // Previously this excluded estimated-fee marketplaces, but that created contradictions
  // (e.g. "Best Performer" at $0.44 while overall average was $0.53).
  // Now we pick the true best and annotate if it uses estimated data.
  const bestRatio = Math.max(...stats.map(s => s.returnRatio));
  const totalAllSales = stats.reduce((sum, s) => sum + s.totalSales, 0);
  const totalAllShipping = stats.reduce((sum, s) => sum + s.estimatedShippingCost, 0);
  const totalAllNet = stats.reduce((sum, s) => sum + s.netPayout - s.estimatedShippingCost, 0);
  const totalAllFees = stats.reduce((sum, s) => sum + s.totalFees, 0);
  const totalAllAdSpend = stats.reduce((sum, s) => sum + s.adSpend, 0);
  const overallRatio = totalAllSales > 0 ? totalAllNet / totalAllSales : 0;
  const overallAfterAds = totalAllSales > 0 ? Math.max((totalAllNet - totalAllAdSpend) / totalAllSales, -1) : null;
  const netPctOfSales = totalAllSales > 0 ? (totalAllNet / totalAllSales * 100).toFixed(0) : '0';
  const anyShippingDeducted = stats.some(s => s.estimatedShippingCost > 0);

  function formatPct(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
  }

  function formatCurrency(value: number): string {
    return new Intl.NumberFormat('en-AU', {
      style: 'currency',
      currency: 'AUD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value);
  }

  function formatDate(dateStr: string | null): string {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function getMonthsSpan(startDate: string | null, endDate: string | null): string {
    if (!startDate || !endDate) return '';
    const start = new Date(startDate);
    const end = new Date(endDate);
    const months = Math.round((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 30.44));
    if (months <= 1) return '1 month';
    return `${months} months`;
  }

  function getRatioColor(ratio: number): string {
    if (ratio >= 0.85) return 'text-primary';
    if (ratio >= 0.75) return 'text-foreground';
    return 'text-destructive';
  }

  function getBarWidth(ratio: number): number {
    return Math.max(20, ratio * 100);
  }

  function getAdImpactText(s: MarketplaceStats): string | null {
    if (s.adSpend <= 0 || s.returnAfterAds === null) return null;
    const drop = s.returnRatio - s.returnAfterAds;
    if (drop <= 0) return null;
    return `Advertising reduced return from $${s.returnRatio.toFixed(2)} → $${s.returnAfterAds.toFixed(2)}`;
  }

  // Best performer = highest returnRatio across ALL marketplaces (not filtered by estimated status)
  const topRevenue = [...stats].sort((a, b) => b.totalSales - a.totalSales)[0];
  const bestProfit = [...stats].sort((a, b) => b.returnRatio - a.returnRatio)[0];

  function getHeroInsight(): string {
    const shippingNote = anyShippingDeducted ? ' (incl. est. shipping)' : '';
    if (stats.length === 1) {
      const r = stats[0].returnRatio;
      if (r < 0.60) {
        return `${stats[0].label} keeps $${r.toFixed(2)} per $1 sold${shippingNote} — ${((1 - r) * 100).toFixed(0)}% goes to marketplace fees and deductions.`;
      }
      return `${stats[0].label} returns $${r.toFixed(2)} for every $1 sold after marketplace fees${shippingNote}.`;
    }
    if (topRevenue.marketplace === bestProfit.marketplace) {
      if (topRevenue.returnRatio < 0.60) {
        return `${topRevenue.label} leads in revenue (${formatCurrency(topRevenue.totalSales)}) and retains the most at $${topRevenue.returnRatio.toFixed(2)} per $1${shippingNote} — though ${((1 - topRevenue.returnRatio) * 100).toFixed(0)}% is consumed by fees.`;
      }
      return `${topRevenue.label} leads in both revenue (${formatCurrency(topRevenue.totalSales)}) and efficiency ($${topRevenue.returnRatio.toFixed(2)} per $1${shippingNote}).`;
    }
    return `${topRevenue.label} drives the most revenue (${formatCurrency(topRevenue.totalSales)}), while ${bestProfit.label} retains the most at $${bestProfit.returnRatio.toFixed(2)} per $1 sold${shippingNote}.`;
  }

  // Stacked bar segments for $1 breakdown
  function getStackedSegments(s: MarketplaceStats) {
    if (s.totalSales <= 0) return { net: 0, ads: 0, fees: 0, refunds: 0, shipping: 0 };
    const refundPct = s.totalRefunds / s.totalSales;
    const feePct = s.feeLoad; // fees only (no refunds)
    const adsPct = s.adSpend / s.totalSales;
    const shippingPct = s.estimatedShippingCost / s.totalSales;
    const netPct = Math.max(0, 1 - feePct - adsPct - refundPct - shippingPct);
    return { net: netPct * 100, ads: adsPct * 100, fees: feePct * 100, refunds: refundPct * 100, shipping: shippingPct * 100 };
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Data Quality Warnings */}
        {(() => {
          const warnings: { label: string; detail: string }[] = [];
          const hasEstimatedMarketplaces = stats.filter(s => s.hasEstimatedFees).map(s => s.label);
          const hasMissingFeeMarketplaces = stats.filter(s => s.hasMissingFeeData).map(s => s.label);
          const hasUnknownFulfilment = stats.filter(s => s.fulfilmentUnknown).map(s => s.label);
          
          if (hasEstimatedMarketplaces.length > 0) {
            warnings.push({
              label: 'Estimated fees',
              detail: `${hasEstimatedMarketplaces.join(', ')} — fees are estimated from commission rates. Upload CSV settlements for actual fee data.`,
            });
          }
          if (hasMissingFeeMarketplaces.length > 0) {
            warnings.push({
              label: 'Missing fee data',
              detail: `${hasMissingFeeMarketplaces.join(', ')} — zero fees recorded despite significant sales. Profit may be overstated.`,
            });
          }
          if (hasUnknownFulfilment.length > 0) {
            warnings.push({
              label: 'Fulfilment method not set',
              detail: `${hasUnknownFulfilment.join(', ')} — postage costs cannot be deducted without a fulfilment method. Set in Settings → Fulfilment Methods.`,
            });
          }

          if (warnings.length === 0) return null;
          
          return (
            <div className="rounded-md border border-amber-400/30 bg-amber-50/50 dark:bg-amber-900/10 p-3 space-y-1.5">
              <p className="text-xs font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5" />
                Data Quality — {warnings.length} caveat{warnings.length !== 1 ? 's' : ''} affecting profit accuracy
              </p>
              {warnings.map((w, i) => (
                <p key={i} className="text-[11px] text-amber-600 dark:text-amber-300/80">
                  <strong>{w.label}:</strong> {w.detail}
                </p>
              ))}
            </div>
          );
        })()}

        {/* Alerts */}
        {stats.map(s => (
          <MarketplaceAlertsBanner key={s.marketplace} marketplaceCode={s.marketplace} />
        ))}

        {/* Header */}
        <div>
          <h2 className="text-xl font-bold text-foreground">Marketplace Profitability</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Settlement revenue, fees and margins — based on {stats.reduce((sum, s) => sum + s.settlementCount, 0)} verified settlements.
          </p>
        </div>

        {/* Hero insight sentence */}
        <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
          <p className="text-sm text-foreground font-medium">{getHeroInsight()}</p>
        </div>

        {/* Summary cards row — 5 cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground">Settlement Revenue</p>
              <p className="text-xl font-bold text-foreground mt-1">{formatCurrency(totalAllSales)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{stats.length} marketplace{stats.length !== 1 ? 's' : ''}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground font-medium">Marketplace Fees</p>
              <p className="text-xl font-bold text-destructive mt-1">{formatCurrency(totalAllFees - stats.reduce((sum, s) => sum + s.totalRefunds, 0))}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{formatPct(totalAllSales > 0 ? (totalAllFees - stats.reduce((sum, s) => sum + s.totalRefunds, 0)) / totalAllSales : 0)} of sales</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground">Net Payout{anyShippingDeducted ? ' (after shipping)' : ''}</p>
              <p className="text-xl font-bold text-foreground mt-1">{formatCurrency(totalAllNet)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{netPctOfSales}% of total sales</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="text-xs text-muted-foreground cursor-help underline decoration-dotted">Return per $1 Sold</p>
                </TooltipTrigger>
                <TooltipContent className="text-xs max-w-xs">
                  How much you keep per $1 of sales after marketplace fees{anyShippingDeducted ? ' and est. shipping' : ''}. Excludes COGS & advertising.
                </TooltipContent>
              </Tooltip>
              <p className={`text-xl font-bold mt-1 ${getRatioColor(overallRatio)}`}>${overallRatio.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">(after fees{anyShippingDeducted ? ' + est. shipping' : ''})</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="text-xs text-muted-foreground cursor-help underline decoration-dotted">Top Revenue</p>
                </TooltipTrigger>
                <TooltipContent className="text-xs max-w-xs">The marketplace generating the highest total sales volume — your volume engine.</TooltipContent>
              </Tooltip>
              <p className="text-xl font-bold text-foreground mt-1">{topRevenue.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{formatCurrency(topRevenue.totalSales)} sales</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <Tooltip>
                <TooltipTrigger asChild>
                  <p className="text-xs text-muted-foreground cursor-help underline decoration-dotted">
                    {stats.length > 1 ? 'Highest Return' : 'Return Rate'}
                  </p>
                </TooltipTrigger>
                <TooltipContent className="text-xs max-w-xs">The marketplace that retains the most per $1 sold after fees. Does not mean "profitable" — just the least fee-heavy.</TooltipContent>
              </Tooltip>
              <p className={`text-xl font-bold mt-1 ${getRatioColor(bestProfit.returnRatio)}`}>{bestProfit.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                ${bestProfit.returnRatio.toFixed(2)} per $1
                {bestProfit.hasEstimatedFees && ' (est.)'}
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Reconciliation Health */}
        <ReconciliationHealth />

        {/* Cross-Marketplace Profit Comparison */}
        <div className="space-y-1">
          <MarketplaceProfitComparison />
          <p className="text-[10px] text-muted-foreground italic px-1">
            Profit ranking uses SKU-level cost data — margins may differ from payout-based metrics above.
          </p>
        </div>

        {/* SKU Profit Comparison */}
        <SkuComparisonView />

        {/* $1 Sale Breakdown — main chart */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">$1 Sale Breakdown</CardTitle>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-xs text-xs">
                  <p className="font-medium mb-1">Marketplace Payout</p>
                  <p><strong>Marketplace payout</strong> = (Net Settlement − Est. Shipping) ÷ Gross Sales</p>
                  <p className="mt-1"><strong>After advertising</strong> = (Net Settlement − Ad Spend − Est. Shipping) ÷ Gross Sales</p>
                  <p className="mt-1 text-muted-foreground">Includes est. shipping for self-ship channels. FBA channels already include fulfilment in fees. Excludes COGS & tax.</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <CardDescription className="text-xs">
              For every $1 you sell, here's what you keep after marketplace fees{anyShippingDeducted ? ' and est. shipping' : ''}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            {stats.map((s) => {
              const segments = getStackedSegments(s);
              const impactText = getAdImpactText(s);

              return (
                <div key={s.marketplace} className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-medium text-foreground">{s.label}</span>
                        {s.returnRatio === bestRatio && stats.length > 1 && (
                          <Badge variant="outline" className="text-[10px] h-4 border-primary/30 text-primary">Best</Badge>
                        )}
                        {s.hasEstimatedFees && (
                          <Badge variant="outline" className="text-[10px] h-4 border-amber-400/50 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20">
                            <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                            Estimated
                          </Badge>
                        )}
                        {s.hasMissingFeeData && (
                          <Badge variant="outline" className="text-[10px] h-4 border-amber-400/50 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20">
                            <Upload className="h-2.5 w-2.5 mr-0.5" />
                            Fee data unavailable
                          </Badge>
                        )}
                        {s.hasFeeAnomaly && (
                          <Badge variant="destructive" className="text-[10px] h-4">
                            Fee anomaly
                          </Badge>
                        )}
                        {s.hasNegativePayout && (
                          <Badge variant="outline" className="text-[10px] h-4 border-destructive/50 text-destructive">
                            Negative payout
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                        <span>{s.settlementCount} settlements analysed</span>
                        <span>•</span>
                        <span>Data range: {formatDate(s.earliestPeriodStart)} – {formatDate(s.latestPeriodEnd)} ({getMonthsSpan(s.earliestPeriodStart, s.latestPeriodEnd)})</span>
                      </div>
                    </div>
                    <div className="text-right">
                      <span className={`text-lg font-bold tabular-nums ${getRatioColor(s.returnRatio)}`}>
                        ${s.returnRatio.toFixed(2)}
                      </span>
                      <span className="text-xs text-muted-foreground ml-1">you keep</span>
                    </div>
                  </div>

                  {/* Stacked $1 breakdown bar */}
                  <div className="h-6 rounded-full overflow-hidden flex bg-muted/30">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="h-full bg-primary rounded-l-full transition-all duration-700 ease-out" style={{ width: `${segments.net}%` }} />
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">${(segments.net / 100).toFixed(2)} you keep</TooltipContent>
                    </Tooltip>
                    {segments.shipping > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="h-full bg-chart-2 transition-all duration-500" style={{ width: `${segments.shipping}%` }} />
                        </TooltipTrigger>
                        <TooltipContent className="text-xs">${(segments.shipping / 100).toFixed(2)} est. shipping</TooltipContent>
                      </Tooltip>
                    )}
                    {segments.ads > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="h-full bg-amber-400 transition-all duration-500" style={{ width: `${segments.ads}%` }} />
                        </TooltipTrigger>
                        <TooltipContent className="text-xs">${(segments.ads / 100).toFixed(2)} advertising</TooltipContent>
                      </Tooltip>
                    )}
                    {segments.refunds > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="h-full bg-chart-4 transition-all duration-500" style={{ width: `${segments.refunds}%` }} />
                        </TooltipTrigger>
                        <TooltipContent className="text-xs">${(segments.refunds / 100).toFixed(2)} refunds</TooltipContent>
                      </Tooltip>
                    )}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="h-full bg-muted-foreground/50 rounded-r-full transition-all duration-500" style={{ width: `${segments.fees}%` }} />
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">${(segments.fees / 100).toFixed(2)} marketplace fees</TooltipContent>
                    </Tooltip>
                  </div>

                  {/* Legend */}
                  <div className="flex gap-3 text-[10px] text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-primary inline-block" />
                      ${(segments.net / 100).toFixed(2)} you keep
                    </span>
                    {segments.shipping > 0 && (
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-chart-2 inline-block" />
                        ${(segments.shipping / 100).toFixed(2)} shipping (est.)
                      </span>
                    )}
                    {segments.ads > 0 && (
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-accent inline-block" />
                        ${(segments.ads / 100).toFixed(2)} ads
                      </span>
                    )}
                    {segments.refunds > 0 && (
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-chart-4 inline-block" />
                        ${(segments.refunds / 100).toFixed(2)} refunds
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground/50 inline-block" />
                      ${(segments.fees / 100).toFixed(2)} fees
                    </span>
                  </div>

                  {/* After advertising row */}
                  {s.adSpend > 0 && s.returnAfterAds !== null ? (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Megaphone className="h-3 w-3" /> After advertising
                      </span>
                      <span className={`font-semibold tabular-nums ${getRatioColor(s.returnAfterAds)}`}>
                        ${s.returnAfterAds.toFixed(2)}
                      </span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <p className="text-[11px] text-muted-foreground">Add ad spend to see true return</p>
                      <Button variant="ghost" size="sm" className="h-6 text-[11px] px-2 text-primary" onClick={() => openAdDialog(s.marketplace)}>
                        <Plus className="h-3 w-3 mr-1" /> Add Ad Spend
                      </Button>
                    </div>
                  )}

                  {/* Fulfilment method context */}
                  {s.fulfilmentMethod === 'marketplace_fulfilled' && (
                    <p className="text-[11px] text-muted-foreground italic flex items-center gap-1">
                      <Truck className="h-3 w-3" /> Fulfilment included in settlement fees
                    </p>
                  )}

                  {s.fulfilmentUnknown && (
                    <div className="rounded-md border border-amber-300/50 bg-amber-50 dark:bg-amber-900/10 dark:border-amber-700/30 px-3 py-2">
                      <p className="text-[11px] text-amber-800 dark:text-amber-300">
                        ⚠ Fulfilment method unknown — update in Settings → Fulfilment Methods for accurate margins
                      </p>
                    </div>
                  )}

                  {(s.fulfilmentMethod === 'third_party_logistics' || s.fulfilmentMethod === 'self_ship') && s.shippingCostPerOrder === 0 && (
                    <div className="rounded-md border border-blue-300/50 bg-blue-50 dark:bg-blue-900/10 dark:border-blue-700/30 px-3 py-2">
                      <p className="text-[11px] text-blue-800 dark:text-blue-300">
                        {s.fulfilmentMethod === 'third_party_logistics' 
                          ? '3PL costs not tracked — add estimated cost per order to improve margin accuracy'
                          : 'Shipping costs not set — add estimated cost per order in Settings for accurate margins'}
                      </p>
                    </div>
                  )}

                  {/* After shipping estimate row */}
                  {s.shippingCostPerOrder > 0 && s.returnAfterAdsAndShipping !== null ? (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground flex items-center gap-1">
                        <Truck className="h-3 w-3" /> After ads & shipping (est.)
                      </span>
                      <span className={`font-semibold tabular-nums ${getRatioColor(s.returnAfterAdsAndShipping)}`}>
                        ${s.returnAfterAdsAndShipping.toFixed(2)}
                      </span>
                    </div>
                  ) : s.fulfilmentMethod === 'self_ship' || s.fulfilmentMethod === 'third_party_logistics' ? (
                    <div className="flex items-center gap-2">
                      <p className="text-[11px] text-muted-foreground">Add est. shipping to see full cost</p>
                      <Button variant="ghost" size="sm" className="h-6 text-[11px] px-2 text-primary" onClick={() => openShippingDialog(s.marketplace)}>
                        <Plus className="h-3 w-3 mr-1" /> Add Shipping
                      </Button>
                    </div>
                  ) : null}

                  {/* PAC Shipping Estimate row */}
                  {s.pacShippingAvg60 !== null && s.pacShippingSample > 0 && (
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-center justify-between text-xs cursor-help">
                            <span className="text-muted-foreground flex items-center gap-1.5">
                              <Truck className="h-3 w-3" />
                              Avg Shipping (est.)
                              <Badge variant="outline" className="text-[9px] h-3.5 border-amber-400/50 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-1">
                                PAC estimate
                              </Badge>
                              {s.pacEstimateQuality && (
                                <span className="text-[10px] text-muted-foreground capitalize">
                                  Quality: {s.pacEstimateQuality}
                                </span>
                              )}
                              <span className="text-[10px] text-muted-foreground">
                                n={s.pacShippingSample}
                              </span>
                            </span>
                            <span className="font-semibold tabular-nums text-foreground flex flex-col items-end">
                              <span>${s.pacShippingAvg60.toFixed(2)}</span>
                              {s.pacShippingAvg14 !== null && (
                                <span className="text-[10px] text-muted-foreground font-normal">
                                  14-order: ${s.pacShippingAvg14.toFixed(2)}
                                </span>
                              )}
                            </span>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs text-xs">
                          Estimate based on Shopify weights/dimensions and Australia Post PAC API. Not used in Xero or settlement calculations.
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  )}

                  {/* Impact insight text */}
                  {impactText && (
                    <p className="text-[11px] text-muted-foreground italic">{impactText}</p>
                  )}
                </div>
              );
            })}

            {/* Comparison insight */}
            {stats.length > 1 && (
              <div className="rounded-md border border-border bg-muted/30 p-3 mt-2">
                <p className="text-xs text-muted-foreground">
                  <strong className="text-foreground">{stats[0].label}</strong> returns the most at{' '}
                  <strong className="text-foreground">${stats[0].returnRatio.toFixed(2)}</strong> per $1.{' '}
                  <strong className="text-foreground">{stats[stats.length - 1].label}</strong> returns{' '}
                  <strong className="text-foreground">${stats[stats.length - 1].returnRatio.toFixed(2)}</strong> —{' '}
                  a <strong className="text-foreground">{formatPct(stats[0].returnRatio - stats[stats.length - 1].returnRatio)}</strong> gap.
                </p>
                {/* Cross-marketplace ad comparison */}
                {stats.filter(s => s.adSpend > 0).length > 1 && (() => {
                  const withAds = stats.filter(s => s.returnAfterAds !== null && s.adSpend > 0);
                  const bestAfterAds = withAds.reduce((best, s) => (s.returnAfterAds! > best.returnAfterAds! ? s : best), withAds[0]);
                  const worstAfterAds = withAds.reduce((worst, s) => (s.returnAfterAds! < worst.returnAfterAds! ? s : worst), withAds[0]);
                  if (bestAfterAds.marketplace === worstAfterAds.marketplace) return null;
                  const diff = bestAfterAds.returnAfterAds! - worstAfterAds.returnAfterAds!;
                  return (
                    <p className="text-xs text-muted-foreground mt-1.5">
                      After advertising, <strong className="text-foreground">{bestAfterAds.label}</strong> returns{' '}
                      <strong className="text-foreground">${diff.toFixed(2)}</strong> more per $1 than{' '}
                      <strong className="text-foreground">{worstAfterAds.label}</strong>.
                    </p>
                  );
                })()}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Fee Intelligence table */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Fee Intelligence</CardTitle>
            </div>
            <CardDescription className="text-xs">
              Marketplace fees, commission rates, advertising impact and refund impact
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-md border border-border overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2.5 font-medium text-foreground">Marketplace</th>
                    <th className="text-right px-3 py-2.5 font-medium text-foreground">Sales</th>
                    <th className="text-right px-3 py-2.5 font-medium text-foreground">
                      <Tooltip>
                        <TooltipTrigger className="cursor-help underline decoration-dotted">Marketplace Fees</TooltipTrigger>
                        <TooltipContent className="text-xs">Total marketplace fees as a percentage of sales</TooltipContent>
                      </Tooltip>
                    </th>
                    <th className="text-right px-3 py-2.5 font-medium text-foreground">Avg Commission</th>
                    <th className="text-right px-3 py-2.5 font-medium text-foreground">Refunds</th>
                    <th className="text-right px-3 py-2.5 font-medium text-foreground">
                      <Tooltip>
                        <TooltipTrigger className="cursor-help underline decoration-dotted">Ad Spend</TooltipTrigger>
                        <TooltipContent className="text-xs">Total advertising spend (analytics only — not synced to accounting)</TooltipContent>
                      </Tooltip>
                    </th>
                    <th className="text-right px-3 py-2.5 font-medium text-foreground">
                      <Tooltip>
                        <TooltipTrigger className="cursor-help underline decoration-dotted">Est. Shipping</TooltipTrigger>
                        <TooltipContent className="text-xs">Estimated shipping cost based on configured cost per order × order count. Shows "—" for marketplace-fulfilled channels.</TooltipContent>
                      </Tooltip>
                    </th>
                    <th className="text-right px-3 py-2.5 font-medium text-foreground">Net</th>
                    <th className="text-right px-3 py-2.5 font-medium text-foreground">
                      <Tooltip>
                        <TooltipTrigger className="cursor-help underline decoration-dotted">Payout</TooltipTrigger>
                        <TooltipContent className="text-xs">(Net Settlement − Est. Shipping) ÷ Gross Sales</TooltipContent>
                      </Tooltip>
                    </th>
                    <th className="text-right px-3 py-2.5 font-medium text-foreground">
                      <Tooltip>
                        <TooltipTrigger className="cursor-help underline decoration-dotted">After Ads</TooltipTrigger>
                        <TooltipContent className="text-xs">(Net Settlement − Ad Spend − Est. Shipping) ÷ Gross Sales</TooltipContent>
                      </Tooltip>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {stats.map((s, idx) => (
                    <tr key={s.marketplace} className={idx > 0 ? 'border-t border-border' : ''}>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-1.5">
                          <span className="font-medium text-foreground">{s.label}</span>
                          {s.returnRatio === bestRatio && stats.length > 1 && (
                            <Badge variant="outline" className="text-[9px] h-3.5 border-primary/30 text-primary px-1">Best</Badge>
                          )}
                          {s.estimatedShippingCost > 0 && (
                            <Badge variant="outline" className="text-[9px] h-3.5 border-chart-2/50 text-chart-2 px-1">
                              <Truck className="h-2 w-2 mr-0.5" />
                              Incl. shipping
                            </Badge>
                          )}
                          {s.hasMissingFeeData && (
                            <Badge variant="outline" className="text-[9px] h-3.5 border-amber-400/50 text-amber-600 dark:text-amber-400 px-1">
                              <Upload className="h-2 w-2 mr-0.5" />
                              No fee data
                            </Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{formatCurrency(s.totalSales)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                        {s.hasMissingFeeData ? <span className="text-amber-600 dark:text-amber-400 text-[10px]">N/A</span> : formatCurrency(s.totalFees)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                        {s.hasMissingFeeData ? <span className="text-amber-600 dark:text-amber-400 text-[10px]">N/A</span> : formatPct(s.avgCommission)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatCurrency(s.totalRefunds)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                        {s.adSpend > 0 ? formatCurrency(s.adSpend) : (
                          <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5 text-primary" onClick={() => openAdDialog(s.marketplace)}>
                            <Plus className="h-3 w-3 mr-0.5" /> Add
                          </Button>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                        {s.fulfilmentMethod === 'marketplace_fulfilled' ? (
                          <span className="text-[10px] text-muted-foreground">—</span>
                        ) : s.estimatedShippingCost > 0 ? (
                          formatCurrency(s.estimatedShippingCost)
                        ) : (
                          <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5 text-primary" onClick={() => openShippingDialog(s.marketplace)}>
                            <Plus className="h-3 w-3 mr-0.5" /> Add
                          </Button>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-foreground">{formatCurrency(s.netPayout - s.estimatedShippingCost)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-bold ${getRatioColor(s.returnRatio)}`}>{formatPct(s.returnRatio)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-bold ${s.returnAfterAdsAndShipping !== null && s.adSpend > 0 ? getRatioColor(s.returnAfterAdsAndShipping) : 'text-muted-foreground'}`}>
                        {s.adSpend > 0 && s.returnAfterAdsAndShipping !== null ? formatPct(s.returnAfterAdsAndShipping) : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Profit Leak Breakdown — where the $1 actually goes */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Receipt className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Profit Leak Breakdown</CardTitle>
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Info className="h-4 w-4 text-muted-foreground cursor-help" />
                </TooltipTrigger>
                <TooltipContent side="left" className="max-w-xs text-xs">
                  Shows exactly where your revenue goes — broken down by fee type per marketplace.
                </TooltipContent>
              </Tooltip>
            </div>
            <CardDescription className="text-xs">
              Where your revenue actually goes — fee by fee
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {stats.map((s) => {
              if (s.feeBreakdown.length === 0) return null;
              const adjustedNet = s.netPayout - s.estimatedShippingCost;
              const keepPct = s.totalSales > 0 ? Math.max(0, adjustedNet / s.totalSales) : 0;
              return (
                <div key={s.marketplace} className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-semibold text-foreground">{s.label}</h4>
                    <span className="text-xs text-muted-foreground">{s.settlementCount} settlements</span>
                  </div>
                  
                  {/* Waterfall rows */}
                  <div className="space-y-2">
                    {/* You keep */}
                    <div className="flex items-center gap-3">
                      <span className="text-xs text-muted-foreground w-28 shrink-0 text-right">You keep</span>
                      <div className="flex-1 h-5 bg-muted/20 rounded-full overflow-hidden">
                        <div className="h-full bg-primary rounded-full transition-all duration-700" style={{ width: `${keepPct * 100}%` }} />
                      </div>
                      <span className="text-xs font-bold tabular-nums text-foreground w-14 text-right">{formatPct(keepPct)}</span>
                      <span className="text-xs tabular-nums text-muted-foreground w-20 text-right">{formatCurrency(adjustedNet)}</span>
                    </div>
                    
                    {/* Fee breakdown rows */}
                    {s.feeBreakdown.map((fee) => (
                      <div key={fee.label} className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-28 shrink-0 text-right">{fee.label}</span>
                        <div className="flex-1 h-5 bg-muted/20 rounded-full overflow-hidden">
                          <div className="h-full bg-destructive/70 rounded-full transition-all duration-500" style={{ width: `${fee.pctOfSales * 100}%` }} />
                        </div>
                        <span className="text-xs font-semibold tabular-nums text-foreground w-14 text-right">{formatPct(fee.pctOfSales)}</span>
                        <span className="text-xs tabular-nums text-muted-foreground w-20 text-right">{formatCurrency(fee.amount)}</span>
                      </div>
                    ))}
                    
                    {/* Est. Shipping row */}
                    {s.estimatedShippingCost > 0 && (
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground w-28 shrink-0 text-right">Est. Shipping</span>
                        <div className="flex-1 h-5 bg-muted/20 rounded-full overflow-hidden">
                          <div className="h-full bg-chart-2/70 rounded-full transition-all duration-500" style={{ width: `${(s.estimatedShippingCost / s.totalSales) * 100}%` }} />
                        </div>
                        <span className="text-xs font-semibold tabular-nums text-foreground w-14 text-right">{formatPct(s.estimatedShippingCost / s.totalSales)}</span>
                        <span className="text-xs tabular-nums text-muted-foreground w-20 text-right">{formatCurrency(s.estimatedShippingCost)}</span>
                      </div>
                    )}
                  </div>

                  {/* Total fees summary */}
                  <div className="flex items-center justify-between text-xs border-t border-border pt-2">
                    <span className="text-muted-foreground font-medium">Total fees</span>
                    <span className="font-bold text-foreground tabular-nums">{formatPct(s.feeLoad)} of sales</span>
                  </div>
                  {s.totalRefunds > 0 && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">+ Refunds</span>
                      <span className="font-semibold text-foreground tabular-nums">{formatPct(s.totalSales > 0 ? s.totalRefunds / s.totalSales : 0)} of sales ({formatCurrency(s.totalRefunds)})</span>
                    </div>
                  )}

                  {/* Biggest cost driver callout */}
                  {s.feeBreakdown.length > 0 && (
                    <div className="rounded-md bg-muted/30 border border-border px-3 py-2">
                      <p className="text-xs text-muted-foreground">
                        <strong className="text-foreground">Biggest cost:</strong> {s.feeBreakdown[0].label} at {formatPct(s.feeBreakdown[0].pctOfSales)} of sales ({formatCurrency(s.feeBreakdown[0].amount)})
                      </p>
                    </div>
                  )}
                </div>
              );
            })}

            {/* Cross-marketplace fee comparison table */}
            {stats.length > 1 && (() => {
              const allFeeLabels = Array.from(new Set(stats.flatMap(s => s.feeBreakdown.map(f => f.label))));
              return (
                <div className="border-t border-border pt-4">
                  <h4 className="text-sm font-semibold text-foreground mb-3">Fee Comparison</h4>
                  <div className="rounded-md border border-border overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium text-foreground">Fee Source</th>
                          {stats.map(s => (
                            <th key={s.marketplace} className="text-right px-3 py-2 font-medium text-foreground">{s.label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {allFeeLabels.map((label, idx) => (
                          <tr key={label} className={idx > 0 ? 'border-t border-border' : ''}>
                            <td className="px-3 py-2 text-muted-foreground">{label}</td>
                            {stats.map(s => {
                              const fee = s.feeBreakdown.find(f => f.label === label);
                              return (
                                <td key={s.marketplace} className="px-3 py-2 text-right tabular-nums text-foreground">
                                  {fee ? formatPct(fee.pctOfSales) : '—'}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                        <tr className="border-t-2 border-border font-bold">
                          <td className="px-3 py-2 text-foreground">Total fees</td>
                          {stats.map(s => (
                            <td key={s.marketplace} className="px-3 py-2 text-right tabular-nums text-foreground">{formatPct(s.feeLoad)}</td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>

        {/* Revenue Concentration Risk */}
        {stats.length > 1 && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">Revenue Concentration</CardTitle>
              </div>
              <CardDescription className="text-xs">
                How dependent is your business on a single marketplace?
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {stats.map(s => {
                const pct = totalAllSales > 0 ? s.totalSales / totalAllSales : 0;
                return (
                  <div key={s.marketplace} className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-foreground">{s.label}</span>
                      <span className="text-sm font-bold tabular-nums text-foreground">{formatPct(pct)}</span>
                    </div>
                    <div className="h-4 rounded-full bg-muted overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-700 ${pct >= 0.8 ? 'bg-destructive' : pct >= 0.6 ? 'bg-chart-4' : 'bg-primary'}`}
                        style={{ width: `${Math.max(pct * 100, 2)}%` }}
                      />
                    </div>
                    <p className="text-[11px] text-muted-foreground">{formatCurrency(s.totalSales)} sales</p>
                  </div>
                );
              })}
              {/* Risk insight */}
              {(() => {
                const topPct = totalAllSales > 0 ? topRevenue.totalSales / totalAllSales : 0;
                if (topPct >= 0.8) {
                  return (
                    <div className="rounded-md border border-destructive/20 bg-destructive/5 p-3">
                      <p className="text-xs text-foreground">
                        <strong>⚠️ High concentration risk:</strong> {topRevenue.label} generates {formatPct(topPct)} of your revenue. 
                        Consider growing other channels to reduce dependency.
                      </p>
                    </div>
                  );
                }
                if (topPct >= 0.6) {
                  return (
                    <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                      <p className="text-xs text-foreground">
                        <strong>Moderate concentration:</strong> {topRevenue.label} accounts for {formatPct(topPct)} of revenue. 
                        Your channel mix is reasonable but still weighted toward one platform.
                      </p>
                    </div>
                  );
                }
                return (
                  <div className="rounded-md border border-primary/20 bg-primary/5 p-3">
                    <p className="text-xs text-foreground">
                      <strong>Healthy diversification:</strong> No single marketplace dominates your revenue. Good balance.
                    </p>
                  </div>
                );
              })()}
            </CardContent>
          </Card>
        )}

        {/* Biggest Cost Driver card */}
        {(() => {
          const allBreakdowns = stats.flatMap(s => s.feeBreakdown.map(f => ({ ...f, marketplace: s.label, marketplaceCode: s.marketplace })));
          if (allBreakdowns.length === 0) return null;
          const biggest = allBreakdowns.reduce((max, f) => f.amount > max.amount ? f : max, allBreakdowns[0]);
          return (
            <Card className="border-destructive/20">
              <CardContent className="pt-5 pb-4">
                <div className="flex items-start gap-4">
                  <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                    <TrendingUp className="h-6 w-6 text-destructive" />
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground font-medium">Biggest Cost Driver</p>
                    <p className="text-lg font-bold text-foreground mt-0.5">{biggest.marketplace} — {biggest.label}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">
                      {formatPct(biggest.pctOfSales)} of sales · {formatCurrency(biggest.amount)} total
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })()}

        {/* Marketplace overview cards */}
        <div>
          <h3 className="text-sm font-semibold text-foreground mb-3">Marketplace Overview</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {stats.map((s) => (
              <Card key={s.marketplace} className="hover:border-primary/20 transition-colors">
                <CardContent className="pt-5 pb-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">{s.label}</span>
                    <span className={`text-lg font-bold tabular-nums ${getRatioColor(s.returnRatio)}`}>
                      {formatPct(s.returnRatio)}
                    </span>
                  </div>

                  {/* Stacked bar in card */}
                  <div className="h-3 rounded-full overflow-hidden flex">
                    <div className="h-full bg-primary transition-all duration-500" style={{ width: `${getStackedSegments(s).net}%` }} />
                    {getStackedSegments(s).shipping > 0 && (
                      <div className="h-full bg-chart-2 transition-all duration-500" style={{ width: `${getStackedSegments(s).shipping}%` }} />
                    )}
                    {s.adSpend > 0 && (
                      <div className="h-full bg-accent transition-all duration-500" style={{ width: `${getStackedSegments(s).ads}%` }} />
                    )}
                    <div className="h-full bg-muted-foreground/25 transition-all duration-500" style={{ width: `${getStackedSegments(s).fees}%` }} />
                  </div>

                  <div className="grid grid-cols-2 gap-y-1.5 text-xs">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <DollarSign className="h-3 w-3" /> Sales
                    </div>
                    <span className="text-right tabular-nums text-foreground">{formatCurrency(s.totalSales)}</span>

                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Receipt className="h-3 w-3" /> Marketplace fees
                    </div>
                    <span className="text-right tabular-nums text-foreground">
                      {s.hasMissingFeeData ? <span className="text-amber-600 dark:text-amber-400 text-[10px]">N/A</span> : `${formatPct(s.feeLoad)} of sales`}
                    </span>

                    <div className="flex items-center gap-1 text-muted-foreground">
                      <TrendingUp className="h-3 w-3" /> Avg commission
                    </div>
                    <span className="text-right tabular-nums text-foreground">
                      {s.hasMissingFeeData ? <span className="text-amber-600 dark:text-amber-400 text-[10px]">N/A</span> : formatPct(s.avgCommission)}
                    </span>

                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Megaphone className="h-3 w-3" /> Ad spend
                    </div>
                    <span className="text-right tabular-nums text-foreground">
                      {s.adSpend > 0 ? formatCurrency(s.adSpend) : (
                        <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1 text-primary" onClick={() => openAdDialog(s.marketplace)}>
                          <Plus className="h-3 w-3 mr-0.5" /> Add
                        </Button>
                      )}
                    </span>

                    {s.adSpend > 0 && s.returnAfterAds !== null && (
                      <>
                        <div className="flex items-center gap-1 text-muted-foreground">
                          <Megaphone className="h-3 w-3" /> After ads
                        </div>
                        <span className={`text-right tabular-nums font-semibold ${getRatioColor(s.returnAfterAds)}`}>
                          {formatPct(s.returnAfterAds)}
                        </span>
                      </>
                    )}

                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Store className="h-3 w-3" /> Settlements
                    </div>
                    <span className="text-right tabular-nums text-foreground">{s.settlementCount}</span>

                    <div className="flex items-center gap-1 text-muted-foreground">
                      <Clock className="h-3 w-3" /> Latest
                    </div>
                    <span className="text-right text-foreground">{formatDate(s.latestPeriodEnd)}</span>
                  </div>

                  {/* Insight text */}
                  {(() => {
                    const impact = getAdImpactText(s);
                    if (!impact) return null;
                    return <p className="text-[11px] text-muted-foreground italic border-t border-border pt-2">{impact}</p>;
                  })()}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        {/* Add Ad Spend Dialog */}
        <Dialog open={adDialogOpen} onOpenChange={setAdDialogOpen}>
          <DialogContent className="sm:max-w-lg">
            <DialogHeader>
              <DialogTitle>Add Advertising Spend</DialogTitle>
              <DialogDescription>
                {adDialogMarketplace
                  ? <>Record ad spend for <strong>{MARKETPLACE_LABELS[adDialogMarketplace] || adDialogMarketplace}</strong>. Analytics only — not synced to accounting.</>
                  : <>Upload an ad spend invoice or enter manually. Analytics only — not synced to accounting.</>
                }
              </DialogDescription>
            </DialogHeader>

            <Tabs value={adUploadMode} onValueChange={(v) => setAdUploadMode(v as 'manual' | 'upload')}>
              <TabsList className="w-full">
                <TabsTrigger value="manual" className="flex-1 gap-1.5"><FileText className="h-3.5 w-3.5" /> Manual Entry</TabsTrigger>
                <TabsTrigger value="upload" className="flex-1 gap-1.5"><Upload className="h-3.5 w-3.5" /> Upload Invoice</TabsTrigger>
              </TabsList>

              <TabsContent value="manual" className="space-y-4 pt-2">
                <div className="space-y-2">
                  <Label htmlFor="ad-month">Month</Label>
                  <Input id="ad-month" type="month" value={adMonth} onChange={(e) => setAdMonth(e.target.value)} placeholder="2026-03" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ad-amount">Spend Amount (ex-GST)</Label>
                  <Input id="ad-amount" type="number" min="0" step="0.01" value={adAmount} onChange={(e) => setAdAmount(e.target.value)} placeholder="0.00" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ad-currency">Currency</Label>
                  <Select value={adCurrency} onValueChange={setAdCurrency}>
                    <SelectTrigger id="ad-currency"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="AUD">AUD</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                      <SelectItem value="GBP">GBP</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ad-notes">Notes (optional)</Label>
                  <Textarea id="ad-notes" value={adNotes} onChange={(e) => setAdNotes(e.target.value)} placeholder="e.g. Sponsored Products campaign" rows={2} />
                </div>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setAdDialogOpen(false)}>Cancel</Button>
                  <Button onClick={saveAdSpend} disabled={adSaving}>
                    {adSaving ? 'Saving...' : 'Save Ad Spend'}
                  </Button>
                </DialogFooter>
              </TabsContent>

              <TabsContent value="upload" className="space-y-4 pt-2">
                {adParsedEntries.length === 0 ? (
                  <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                      Upload a file, or paste invoice text (e.g. from a web portal). We'll automatically detect the marketplace, period, and cost.
                    </p>
                    <label className="flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed border-border p-5 cursor-pointer hover:border-primary/50 hover:bg-muted/30 transition-colors">
                      {adUploadParsing ? (
                        <>
                          <LoadingSpinner />
                          <span className="text-sm text-muted-foreground">Parsing…</span>
                        </>
                      ) : (
                        <>
                          <Upload className="h-7 w-7 text-muted-foreground" />
                          <span className="text-sm font-medium text-foreground">Drop file or click to browse</span>
                          <span className="text-xs text-muted-foreground">PDF, CSV, or Excel</span>
                        </>
                      )}
                      <input
                        type="file"
                        className="hidden"
                        accept=".pdf,.csv,.xlsx,.xls,.tsv"
                        disabled={adUploadParsing}
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleAdSpendFileUpload(file);
                          e.target.value = '';
                        }}
                      />
                    </label>

                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <div className="flex-1 h-px bg-border" />
                      <span>or paste text</span>
                      <div className="flex-1 h-px bg-border" />
                    </div>

                    <div className="space-y-2">
                      <Textarea
                        placeholder="Paste invoice text here (e.g. copy from Kogan Publisher Portal, eBay ad invoice page, etc.)"
                        value={adPastedText}
                        onChange={(e) => setAdPastedText(e.target.value)}
                        rows={5}
                        disabled={adUploadParsing}
                        className="text-xs"
                      />
                      <Button
                        onClick={() => handleAdSpendPastedText(adPastedText)}
                        disabled={adUploadParsing || !adPastedText.trim()}
                        size="sm"
                        className="w-full gap-1.5"
                      >
                        <ClipboardPaste className="h-3.5 w-3.5" />
                        {adUploadParsing ? 'Parsing…' : 'Parse Pasted Text'}
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm font-medium text-foreground">
                      {adParsedEntries.length} {adParsedEntries.length === 1 ? 'entry' : 'entries'} detected — review and save:
                    </p>
                    <div className="max-h-60 overflow-y-auto space-y-2">
                      {adParsedEntries.map((entry, idx) => (
                        <div key={idx} className="rounded-md border border-border p-3 space-y-1.5">
                          <div className="flex items-center justify-between">
                            <span className="font-medium text-sm text-foreground">{entry.marketplace_label}</span>
                            <Badge variant={entry.confidence >= 0.8 ? 'default' : 'secondary'} className="text-[10px]">
                              {Math.round(entry.confidence * 100)}% match
                            </Badge>
                          </div>
                          <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                            <span>Period</span>
                            <span className="text-right text-foreground tabular-nums">
                              {new Date(entry.period_start).toLocaleDateString('en-AU', { month: 'short', year: 'numeric' })}
                            </span>
                            <span>Amount {entry.includes_gst ? '(inc GST)' : '(ex GST)'}</span>
                            <span className="text-right text-foreground tabular-nums font-medium">
                              ${entry.spend_amount.toFixed(2)} {entry.currency}
                            </span>
                            {entry.gst_amount != null && entry.gst_amount > 0 && (
                              <>
                                <span>GST</span>
                                <span className="text-right tabular-nums">${entry.gst_amount.toFixed(2)}</span>
                              </>
                            )}
                            {entry.invoice_number && (
                              <>
                                <span>Invoice #</span>
                                <span className="text-right">{entry.invoice_number}</span>
                              </>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                    <DialogFooter className="flex-col sm:flex-row gap-2">
                      <Button variant="outline" onClick={() => setAdParsedEntries([])} className="gap-1.5">
                        <Upload className="h-3.5 w-3.5" /> Upload Different File
                      </Button>
                      <Button onClick={saveAllParsedAdSpend} disabled={adSaving} className="gap-1.5">
                        <Check className="h-3.5 w-3.5" />
                        {adSaving ? 'Saving...' : `Save ${adParsedEntries.length} ${adParsedEntries.length === 1 ? 'Entry' : 'Entries'}`}
                      </Button>
                    </DialogFooter>
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </DialogContent>
        </Dialog>

        {/* Add Shipping Cost Dialog */}
        <Dialog open={shippingDialogOpen} onOpenChange={setShippingDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add Shipping Cost Estimate</DialogTitle>
              <DialogDescription>
                Estimate avg cost per order for <strong>{MARKETPLACE_LABELS[shippingDialogMarketplace] || shippingDialogMarketplace}</strong>. This is your estimated shipping cost (to Amazon FBA or direct to customer) — analytics only.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="shipping-cost">Cost Per Order</Label>
                <Input
                  id="shipping-cost"
                  type="number"
                  min="0"
                  step="0.01"
                  value={shippingCostPerOrder}
                  onChange={(e) => setShippingCostPerOrder(e.target.value)}
                  placeholder="e.g. 10.00 for Bunnings, 2.00 for Amazon FBA"
                />
                <p className="text-xs text-muted-foreground">Your estimated shipping cost per order (not tracked in settlements)</p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="shipping-currency">Currency</Label>
                <Select value={shippingCurrency} onValueChange={setShippingCurrency}>
                  <SelectTrigger id="shipping-currency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="AUD">AUD</SelectItem>
                    <SelectItem value="USD">USD</SelectItem>
                    <SelectItem value="GBP">GBP</SelectItem>
                    <SelectItem value="EUR">EUR</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="shipping-notes">Notes (optional)</Label>
                <Textarea
                  id="shipping-notes"
                  value={shippingNotes}
                  onChange={(e) => setShippingNotes(e.target.value)}
                  placeholder="e.g. Direct to customer, avg weight 2kg"
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setShippingDialogOpen(false)}>Cancel</Button>
              <Button onClick={saveShippingCost} disabled={shippingSaving}>
                {shippingSaving ? 'Saving...' : 'Save Shipping Cost'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}
