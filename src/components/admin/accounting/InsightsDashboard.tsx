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
import { Info, TrendingUp, DollarSign, BarChart3, Store, Clock, Receipt, Plus, Megaphone, Wallet, Truck, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { MARKETPLACE_LABELS } from '@/utils/settlement-engine';
import LoadingSpinner from '@/components/ui/loading-spinner';
import { loadFulfilmentMethods, loadPostageCosts, getEffectiveMethod, type FulfilmentMethod } from '@/utils/fulfilment-settings';
import { ReconciliationHealth } from '@/components/shared/ReconciliationStatus';
import MarketplaceProfitComparison from '@/components/insights/MarketplaceProfitComparison';
import SkuComparisonView from '@/components/insights/SkuComparisonView';
import MarketplaceAlertsBanner from '@/components/MarketplaceAlertsBanner';
import { toast } from '@/hooks/use-toast';

// ─── Estimated Commission Rates (mirrors edge function) ─────────────────────
// Used to show realistic fee data when actual fee data is missing (api_sync with $0 fees)
const COMMISSION_ESTIMATES: Record<string, number> = {
  kogan: 0.12, bigw: 0.08, everyday_market: 0.10, mydeal: 0.10,
  bunnings: 0.10, catch: 0.12, ebay_au: 0.13, iconic: 0.15,
  tradesquare: 0.10, tiktok: 0.05,
};
const DEFAULT_COMMISSION_RATE = 0.10;

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
      const [settlementsRes, adSpendRes, shippingRes, fulfilmentMethods, postageCosts, profitOrdersRes] = await Promise.all([
        supabase
          .from('settlements')
          .select('marketplace, sales_principal, gst_on_income, seller_fees, refunds, bank_deposit, fba_fees, other_fees, storage_fees, period_end, period_start, is_hidden, is_pre_boundary, source, raw_payload')
          .eq('is_hidden', false)
          .is('duplicate_of_settlement_id', null)
          .not('status', 'in', '("push_failed_permanent","duplicate_suppressed")')
          .order('period_end', { ascending: false }),
        supabase
          .from('marketplace_ad_spend')
          .select('marketplace_code, spend_amount'),
        supabase
          .from('marketplace_shipping_costs')
          .select('marketplace_code, cost_per_order'),
        currentUser ? loadFulfilmentMethods(currentUser.id) : Promise.resolve({} as Record<string, FulfilmentMethod>),
        currentUser ? loadPostageCosts(currentUser.id) : Promise.resolve({} as Record<string, number>),
        supabase
          .from('settlement_profit')
          .select('marketplace_code, orders_count'),
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
      const profitOrderCounts: Record<string, number> = {};
      if (profitOrdersRes.data) {
        for (const row of profitOrdersRes.data as any[]) {
          const mp = row.marketplace_code;
          profitOrderCounts[mp] = (profitOrderCounts[mp] || 0) + (Number(row.orders_count) || 0);
        }
      }

      // e.g. 'woolworths_marketplus_bigw' → 'bigw', 'shopify_orders_kogan' → 'kogan'
      function normalizeMarketplace(mp: string): string {
        if (mp.startsWith('woolworths_marketplus_')) return mp.replace('woolworths_marketplus_', '');
        if (mp.startsWith('shopify_orders_')) return mp.replace('shopify_orders_', '');
        return mp;
      }

      const grouped: Record<string, typeof data> = {};
      for (const row of data) {
        const rawMp = row.marketplace;
        if (!rawMp) continue; // Skip settlements with no marketplace tag
        const mp = normalizeMarketplace(rawMp);
        if (!grouped[mp]) grouped[mp] = [];
        grouped[mp].push(row);
      }

      // ─── Platform Family Fee Redistribution ───────────────────────────
      // MyDeal, BigW, and Everyday Market all share the Woolworths MarketPlus platform.
      // The Woolworths CSV allocates platform-level fees (subscriptions, etc.) to MyDeal
      // even when sales occur on BigW or Everyday Market. This creates an anomaly where
      // MyDeal shows fees >> sales, while BigW/Everyday Market appear artificially cheap.
      // Fix: detect fee-heavy marketplaces and redistribute excess fees to siblings.
      const PLATFORM_FAMILIES: Record<string, string[]> = {
        woolworths_marketplus: ['mydeal', 'bigw', 'everyday_market', 'woolworths_market'],
      };

      // For each family, detect excess fees and redistribute
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
          // Excess = fees beyond what's attributable to own sales (using 15% as normal commission)
          const ownFees = sales * 0.15;
          totalExcessFees += Math.max(fees - ownFees, 0);
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
            // Add synthetic fee rows to represent redistributed platform fees
            // We modify by adjusting the seller_fees on a virtual basis — tracked via _redistributedPlatformFees
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
          sum + Math.abs(r.seller_fees || 0) + Math.abs(r.fba_fees || 0) + Math.abs(r.storage_fees || 0) + Math.max(r.other_fees || 0, 0), 0);
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
        const returnRatio = totalSales > 0 ? Math.min(netPayout / totalSales, 1) : 0;
        const feeLoad = totalSales > 0 ? Math.min(totalFees / totalSales, 1) : 0;
        const commissionTotal = Math.abs(rows.reduce((sum, r) => sum + (r.seller_fees || 0), 0));
        const avgCommission = totalSales > 0 ? Math.min(commissionTotal / totalSales, 1) : 0;
        const latestPeriodEnd = rows.length > 0 ? rows[0].period_end : null;
        const earliestPeriodStart = rows.length > 0 
          ? rows.reduce((earliest, r) => !earliest || (r.period_start && r.period_start < earliest) ? r.period_start : earliest, rows[0].period_start)
          : null;
        const fbaTotal = Math.abs(rows.reduce((sum, r) => sum + (r.fba_fees || 0), 0));
        const storageTotal = Math.abs(rows.reduce((sum, r) => sum + (r.storage_fees || 0), 0));
        const otherFeesTotal = rows.reduce((sum, r) => sum + Math.max(r.other_fees || 0, 0), 0);

        const adSpend = adSpendByMp[mp] || 0;
        const returnAfterAds = totalSales > 0 ? Math.max(Math.min((netPayout - adSpend) / totalSales, 1), -1) : null;

        // Fulfilment method
        const fulfilmentMethod = getEffectiveMethod(mp, fulfilmentMethods[mp]);
        const fulfilmentUnknown = fulfilmentMethod === 'not_sure';

        // Shipping cost estimation — only applied for self_ship / third_party_logistics
        // Use marketplace_shipping_costs table first, fall back to app_settings postage_cost
        const shippingCostPerOrder = shippingCostByMp[mp] || postageCosts[mp] || 0;
        // Use real order counts from settlement_profit when available
        const estimatedOrderCount = (() => {
          const profitOrderCount = profitOrderCounts[mp];
          if (profitOrderCount && profitOrderCount > 0) return profitOrderCount;
          return rows.length > 0 ? rows.length : 1;
        })();
        const shouldDeductShipping = fulfilmentMethod === 'self_ship' || fulfilmentMethod === 'third_party_logistics';
        const estimatedShippingCost = shouldDeductShipping ? shippingCostPerOrder * estimatedOrderCount : 0;
        const returnAfterShipping = totalSales > 0 && shouldDeductShipping && shippingCostPerOrder > 0 
          ? Math.max(Math.min((netPayout - estimatedShippingCost) / totalSales, 1), -1) 
          : null;
        const returnAfterAdsAndShipping = totalSales > 0 && (adSpend > 0 || (shouldDeductShipping && shippingCostPerOrder > 0))
          ? Math.max(Math.min((netPayout - adSpend - estimatedShippingCost) / totalSales, 1), -1)
          : null;

        // Build fee breakdown for waterfall
        const feeBreakdown: FeeBreakdown[] = [];
        if (commissionTotal > 0) feeBreakdown.push({ label: 'Commission', amount: commissionTotal, pctOfSales: totalSales > 0 ? commissionTotal / totalSales : 0, color: 'bg-primary' });
        if (fbaTotal > 0) feeBreakdown.push({ label: 'FBA Fulfilment', amount: fbaTotal, pctOfSales: totalSales > 0 ? fbaTotal / totalSales : 0, color: 'bg-destructive' });
        if (storageTotal > 0) feeBreakdown.push({ label: 'Storage', amount: storageTotal, pctOfSales: totalSales > 0 ? storageTotal / totalSales : 0, color: 'bg-muted-foreground' });
        if (totalRefunds > 0) feeBreakdown.push({ label: 'Refunds', amount: totalRefunds, pctOfSales: totalSales > 0 ? totalRefunds / totalSales : 0, color: 'bg-muted-foreground/60' });
        if (otherFeesTotal > 0) feeBreakdown.push({ label: 'Other fees', amount: otherFeesTotal, pctOfSales: totalSales > 0 ? otherFeesTotal / totalSales : 0, color: 'bg-muted-foreground/40' });
        feeBreakdown.sort((a, b) => b.amount - a.amount);

        // ─── Universal Data Quality Guards ──────────────────────────────
        const hasEstimatedFees = rows.some(r => {
          const payload = r.raw_payload as any;
          return payload?.fees_estimated === true;
        });
        const apiSyncZeroFeeRows = rows.filter(r => 
          (r as any).source === 'api_sync' && Math.abs(r.seller_fees || 0) < 0.01
        );
        let hasMissingFeeData = totalFees === 0 && totalSales > 500;
        const hasFeeAnomaly = totalFees > totalSales;
        const hasNegativePayout = netPayout < 0 && totalSales > 0;

        // Include redistributed platform fees from sibling marketplaces
        const redistributedPlatformFees = (grouped[mp] as any)?._redistributedPlatformFees || 0;

        let effectiveReturnRatio = returnRatio;
        let effectiveFeeLoad = feeLoad;
        let effectiveNetPayout = netPayout;
        let effectiveTotalFees = totalFees + redistributedPlatformFees;
        let effectiveHasEstimatedFees = hasEstimatedFees || redistributedPlatformFees > 0;

        // For fee/commission calculations, identify rows with real fee data
        const feeRelevantRows = rows.filter(r => {
          const isApiSyncZeroFee = (r as any).source === 'api_sync' && Math.abs(r.seller_fees || 0) < 0.01;
          return !isApiSyncZeroFee;
        });

        if (apiSyncZeroFeeRows.length > 0 && apiSyncZeroFeeRows.length === rows.length) {
          // Case 1: ALL rows are api_sync with zero fees — apply estimated commission
          const estimatedRate = COMMISSION_ESTIMATES[mp] || DEFAULT_COMMISSION_RATE;
          const estimatedFees = totalSalesExGst * estimatedRate;
          effectiveTotalFees = estimatedFees;
          effectiveNetPayout = totalSales - estimatedFees;
          effectiveReturnRatio = totalSales > 0 ? Math.min(effectiveNetPayout / totalSales, 1) : 0;
          effectiveFeeLoad = totalSales > 0 ? Math.min(estimatedFees / totalSales, 1) : 0;
          effectiveHasEstimatedFees = true;
          hasMissingFeeData = false;
        } else if (apiSyncZeroFeeRows.length > 0 && feeRelevantRows.length > 0) {
          // Case 2: MIXED — some CSV (with real fees) + some api_sync (zero fees)
          // Extrapolate the REAL fee rate from CSV rows onto the api_sync sales
          const csvSales = feeRelevantRows.reduce((sum, r) => sum + (r.sales_principal || 0), 0);
          const csvFees = Math.abs(feeRelevantRows.reduce((sum, r) => sum + (r.seller_fees || 0), 0));
          const realFeeRate = csvSales > 0 ? csvFees / csvSales : (COMMISSION_ESTIMATES[mp] || DEFAULT_COMMISSION_RATE);
          
          const apiSyncSales = apiSyncZeroFeeRows.reduce((sum, r) => sum + (r.sales_principal || 0), 0);
          const estimatedApiSyncFees = apiSyncSales * realFeeRate;
          
          effectiveTotalFees = csvFees + estimatedApiSyncFees;
          // Recalculate net payout: real CSV payouts + (api_sync sales - estimated fees)
          const csvPayout = feeRelevantRows.reduce((sum, r) => sum + (r.bank_deposit || 0), 0);
          const apiSyncGst = apiSyncZeroFeeRows.reduce((sum, r) => sum + (r.gst_on_income || 0), 0);
          effectiveNetPayout = csvPayout + (apiSyncSales + apiSyncGst - estimatedApiSyncFees);
          effectiveReturnRatio = totalSales > 0 ? Math.min(effectiveNetPayout / totalSales, 1) : 0;
          effectiveFeeLoad = totalSales > 0 ? Math.min(effectiveTotalFees / totalSales, 1) : 0;
          effectiveHasEstimatedFees = true;
          hasMissingFeeData = false;
        }

        // After api_sync estimation, add redistributed platform fees from siblings
        if (redistributedPlatformFees > 0) {
          effectiveTotalFees += redistributedPlatformFees;
          effectiveNetPayout -= redistributedPlatformFees;
          effectiveReturnRatio = totalSales > 0 ? Math.min(effectiveNetPayout / totalSales, 1) : 0;
          effectiveFeeLoad = totalSales > 0 ? Math.min(effectiveTotalFees / totalSales, 1) : 0;
          effectiveHasEstimatedFees = true;
        }

        // Derive effectiveAvgCommission aligned with the estimated fee logic above
        let effectiveAvgCommission: number;
        if (apiSyncZeroFeeRows.length > 0 && apiSyncZeroFeeRows.length === rows.length) {
          // Case 1: ALL api_sync zero-fee — use the estimated rate directly
          effectiveAvgCommission = COMMISSION_ESTIMATES[mp] || DEFAULT_COMMISSION_RATE;
        } else if (apiSyncZeroFeeRows.length > 0 && feeRelevantRows.length > 0) {
          // Case 2: Mixed — derive rate from real CSV rows
          const csvSales = feeRelevantRows.reduce((sum, r) => sum + (r.sales_principal || 0), 0);
          const csvFees = Math.abs(feeRelevantRows.reduce((sum, r) => sum + (r.seller_fees || 0), 0));
          effectiveAvgCommission = csvSales > 0 ? csvFees / csvSales : (COMMISSION_ESTIMATES[mp] || DEFAULT_COMMISSION_RATE);
        } else {
          // Default: use raw commission calculation
          effectiveAvgCommission = avgCommission;
        }

        const adjustedCommissionTotal = feeRelevantRows.length > 0 && feeRelevantRows.length < rows.length
          ? Math.abs(feeRelevantRows.reduce((sum, r) => sum + (r.seller_fees || 0), 0))
          : commissionTotal;

        results.push({
          marketplace: mp,
          label: MARKETPLACE_LABELS[mp] || mp,
          totalSales,
          totalFees: effectiveTotalFees,
          totalRefunds,
          netPayout: effectiveNetPayout,
          returnRatio: effectiveReturnRatio,
          feeLoad: effectiveFeeLoad,
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
          commissionTotal: adjustedCommissionTotal,
          fbaTotal,
          storageTotal,
          otherFeesTotal,
          feeBreakdown,
          fulfilmentMethod,
          fulfilmentUnknown,
          hasEstimatedFees: effectiveHasEstimatedFees,
          hasMissingFeeData,
          hasFeeAnomaly,
          hasNegativePayout,
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
    setAdDialogOpen(true);
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

  // For "Best" badge, only consider marketplaces with real (non-estimated) fee data
  const realFeeStatsForBest = stats.filter(s => !s.hasEstimatedFees);
  const bestRatio = Math.max(...(realFeeStatsForBest.length > 0 ? realFeeStatsForBest : stats).map(s => s.returnRatio));
  const totalAllSales = stats.reduce((sum, s) => sum + s.totalSales, 0);
  const totalAllNet = stats.reduce((sum, s) => sum + s.netPayout, 0);
  const totalAllFees = stats.reduce((sum, s) => sum + s.totalFees, 0);
  const totalAllAdSpend = stats.reduce((sum, s) => sum + s.adSpend, 0);
  const overallRatio = totalAllSales > 0 ? totalAllNet / totalAllSales : 0;
  const overallAfterAds = totalAllSales > 0 ? Math.max((totalAllNet - totalAllAdSpend) / totalAllSales, -1) : null;
  const netPctOfSales = totalAllSales > 0 ? (totalAllNet / totalAllSales * 100).toFixed(0) : '0';

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

  // Generate the main insight sentence
  // For "Best Performer", prefer marketplaces with real fee data over estimated
  const topRevenue = [...stats].sort((a, b) => b.totalSales - a.totalSales)[0];
  const realFeeStats = stats.filter(s => !s.hasEstimatedFees);
  const bestProfit = (realFeeStats.length > 0 ? realFeeStats : stats)
    .sort((a, b) => b.returnRatio - a.returnRatio)[0];

  function getHeroInsight(): string {
    if (stats.length === 1) {
      return `${stats[0].label} returns $${stats[0].returnRatio.toFixed(2)} for every $1 sold after marketplace fees.`;
    }
    // If same marketplace leads both, simple message
    if (topRevenue.marketplace === bestProfit.marketplace) {
      return `${topRevenue.label} leads in both revenue (${formatCurrency(topRevenue.totalSales)}) and profit efficiency ($${topRevenue.returnRatio.toFixed(2)} per $1).`;
    }
    const profitMultiple = bestProfit.returnRatio / topRevenue.returnRatio;
    if (profitMultiple >= 1.5) {
      return `${topRevenue.label} generates the most revenue, but ${bestProfit.label} returns ${profitMultiple.toFixed(1)}× more profit per sale.`;
    }
    return `${topRevenue.label} drives the most revenue (${formatCurrency(topRevenue.totalSales)}), while ${bestProfit.label} keeps $${bestProfit.returnRatio.toFixed(2)} per $1 sold.`;
  }

  // Stacked bar segments for $1 breakdown
  function getStackedSegments(s: MarketplaceStats) {
    if (s.totalSales <= 0) return { net: 0, ads: 0, fees: 0 };
    const feePct = s.feeLoad;
    const adsPct = s.adSpend / s.totalSales;
    const netPct = Math.max(0, 1 - feePct - adsPct);
    return { net: netPct * 100, ads: adsPct * 100, fees: feePct * 100 };
  }

  return (
    <TooltipProvider>
      <div className="space-y-6">
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
              <p className="text-xs text-muted-foreground font-medium">Marketplace Fees Paid</p>
              <p className="text-xl font-bold text-destructive mt-1">{formatCurrency(totalAllFees)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{formatPct(totalAllSales > 0 ? totalAllFees / totalAllSales : 0)} of sales</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground">Net Payout</p>
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
                <TooltipContent className="text-xs max-w-xs">How much you keep per $1 of sales after marketplace fees. Excludes COGS, shipping & advertising.</TooltipContent>
              </Tooltip>
              <p className={`text-xl font-bold mt-1 ${getRatioColor(overallRatio)}`}>${overallRatio.toFixed(2)}</p>
              <p className="text-xs text-muted-foreground mt-0.5">(after marketplace fees)</p>
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
                  <p className="text-xs text-muted-foreground cursor-help underline decoration-dotted">Best Performer</p>
                </TooltipTrigger>
                <TooltipContent className="text-xs max-w-xs">The marketplace returning the most profit per $1 sold — your efficiency engine.</TooltipContent>
              </Tooltip>
              <p className="text-xl font-bold text-primary mt-1">{bestProfit.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">${bestProfit.returnRatio.toFixed(2)} per $1</p>
            </CardContent>
          </Card>
        </div>

        {/* Reconciliation Health */}
        <ReconciliationHealth />

        {/* Cross-Marketplace Profit Comparison */}
        <MarketplaceProfitComparison />

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
                  <p><strong>Marketplace payout</strong> = Net Settlement ÷ Gross Sales</p>
                  <p className="mt-1"><strong>After advertising</strong> = (Net Settlement − Ad Spend) ÷ Gross Sales</p>
                  <p className="mt-1 text-muted-foreground">Excludes COGS, shipping costs & tax.</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <CardDescription className="text-xs">
              For every $1 you sell, here's what you keep after marketplace fees
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
                        {s.returnRatio === bestRatio && stats.length > 1 && !s.hasEstimatedFees && (
                          <Badge variant="outline" className="text-[10px] h-4 border-primary/30 text-primary">Best</Badge>
                        )}
                        {s.hasEstimatedFees && (
                          <Badge variant="outline" className="text-[10px] h-4 border-amber-400/50 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20">
                            <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
                            Estimated
                          </Badge>
                        )}
                        {s.hasMissingFeeData && !s.hasEstimatedFees && (
                          <Badge variant="outline" className="text-[10px] h-4 border-amber-400/50 text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20">
                            Fee data missing
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
                    {segments.ads > 0 && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="h-full bg-amber-400 transition-all duration-500" style={{ width: `${segments.ads}%` }} />
                        </TooltipTrigger>
                        <TooltipContent className="text-xs">${(segments.ads / 100).toFixed(2)} advertising</TooltipContent>
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
                  <div className="flex gap-3 text-[10px] text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-full bg-primary inline-block" />
                      ${(segments.net / 100).toFixed(2)} you keep
                    </span>
                    {segments.ads > 0 && (
                      <span className="flex items-center gap-1">
                        <span className="h-2 w-2 rounded-full bg-accent inline-block" />
                        ${(segments.ads / 100).toFixed(2)} ads
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

                  {s.fulfilmentMethod === 'third_party_logistics' && s.shippingCostPerOrder === 0 && (
                    <div className="rounded-md border border-blue-300/50 bg-blue-50 dark:bg-blue-900/10 dark:border-blue-700/30 px-3 py-2">
                      <p className="text-[11px] text-blue-800 dark:text-blue-300">
                        3PL costs not tracked — add estimated cost per order to improve margin accuracy
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
                    <th className="text-right px-3 py-2.5 font-medium text-foreground">Net</th>
                    <th className="text-right px-3 py-2.5 font-medium text-foreground">
                      <Tooltip>
                        <TooltipTrigger className="cursor-help underline decoration-dotted">Payout</TooltipTrigger>
                        <TooltipContent className="text-xs">Net Settlement ÷ Gross Sales (after marketplace fees)</TooltipContent>
                      </Tooltip>
                    </th>
                    <th className="text-right px-3 py-2.5 font-medium text-foreground">
                      <Tooltip>
                        <TooltipTrigger className="cursor-help underline decoration-dotted">After Ads</TooltipTrigger>
                        <TooltipContent className="text-xs">(Net Settlement − Ad Spend) ÷ Gross Sales</TooltipContent>
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
                          {s.returnRatio === bestRatio && stats.length > 1 && !s.hasEstimatedFees && (
                            <Badge variant="outline" className="text-[9px] h-3.5 border-primary/30 text-primary px-1">Best</Badge>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-foreground">{formatCurrency(s.totalSales)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatCurrency(s.totalFees)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatPct(s.avgCommission)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">{formatCurrency(s.totalRefunds)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                        {s.adSpend > 0 ? formatCurrency(s.adSpend) : (
                          <Button variant="ghost" size="sm" className="h-5 text-[10px] px-1.5 text-primary" onClick={() => openAdDialog(s.marketplace)}>
                            <Plus className="h-3 w-3 mr-0.5" /> Add
                          </Button>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-medium text-foreground">{formatCurrency(s.netPayout)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-bold ${getRatioColor(s.returnRatio)}`}>{formatPct(s.returnRatio)}</td>
                      <td className={`px-3 py-2.5 text-right tabular-nums font-bold ${s.returnAfterAds !== null && s.adSpend > 0 ? getRatioColor(s.returnAfterAds) : 'text-muted-foreground'}`}>
                        {s.adSpend > 0 && s.returnAfterAds !== null ? formatPct(s.returnAfterAds) : '—'}
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
              const keepPct = s.totalSales > 0 ? Math.max(0, s.netPayout / s.totalSales) : 0;
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
                      <span className="text-xs tabular-nums text-muted-foreground w-20 text-right">{formatCurrency(s.netPayout)}</span>
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
                  </div>

                  {/* Total fees summary */}
                  <div className="flex items-center justify-between text-xs border-t border-border pt-2">
                    <span className="text-muted-foreground font-medium">Total fees + refunds</span>
                    <span className="font-bold text-foreground tabular-nums">{formatPct(s.feeLoad + (s.totalSales > 0 ? s.totalRefunds / s.totalSales : 0))} of sales</span>
                  </div>

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
                    <span className="text-right tabular-nums text-foreground">{formatPct(s.feeLoad)} of sales</span>

                    <div className="flex items-center gap-1 text-muted-foreground">
                      <TrendingUp className="h-3 w-3" /> Avg commission
                    </div>
                    <span className="text-right tabular-nums text-foreground">{formatPct(s.avgCommission)}</span>

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
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add Advertising Spend</DialogTitle>
              <DialogDescription>
                Record monthly ad spend for <strong>{MARKETPLACE_LABELS[adDialogMarketplace] || adDialogMarketplace}</strong>. This is analytics only — not synced to your accounting software.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="ad-month">Month</Label>
                <Input
                  id="ad-month"
                  type="month"
                  value={adMonth}
                  onChange={(e) => setAdMonth(e.target.value)}
                  placeholder="2026-03"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ad-amount">Spend Amount</Label>
                <Input
                  id="ad-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={adAmount}
                  onChange={(e) => setAdAmount(e.target.value)}
                  placeholder="0.00"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ad-currency">Currency</Label>
                <Select value={adCurrency} onValueChange={setAdCurrency}>
                  <SelectTrigger id="ad-currency">
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
                <Label htmlFor="ad-notes">Notes (optional)</Label>
                <Textarea
                  id="ad-notes"
                  value={adNotes}
                  onChange={(e) => setAdNotes(e.target.value)}
                  placeholder="e.g. Sponsored Products campaign"
                  rows={2}
                />
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAdDialogOpen(false)}>Cancel</Button>
              <Button onClick={saveAdSpend} disabled={adSaving}>
                {adSaving ? 'Saving...' : 'Save Ad Spend'}
              </Button>
            </DialogFooter>
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
