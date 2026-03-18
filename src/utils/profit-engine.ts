/**
 * Profit Engine — Calculates COGS and profit per marketplace from SKU costs.
 *
 * Takes MarketplaceGroup[] from the Shopify Orders parser + a product_costs
 * map, and returns per-marketplace profit breakdowns.
 */

import type { MarketplaceGroup, ShopifyOrderRow } from './shopify-orders-parser';
import { MARKETPLACE_LABELS } from './settlement-engine';
import { getPostageDeductionForOrder } from './fulfilment-settings';

export interface ProductCost {
  sku: string;
  cost: number;
  currency: string;
  label?: string;
}

export interface MarketplaceProfitSummary {
  marketplaceKey: string;
  marketplaceLabel: string;
  revenue: number;        // totalSubtotal (ex shipping, ex tax)
  cogs: number;           // sum of (cost × qty) for costed SKUs
  grossProfit: number;    // revenue - cogs
  marginPct: number;      // (grossProfit / revenue) * 100
  orderCount: number;
  totalSKUs: number;      // unique SKUs in this marketplace
  costedSKUs: number;     // SKUs with cost data
  uncostedSKUs: number;   // SKUs missing cost data
  isEstimated: boolean;   // true if any SKUs are uncosted
}

export interface ProfitEngineResult {
  marketplaces: MarketplaceProfitSummary[];
  totalRevenue: number;
  totalCogs: number;
  totalProfit: number;
  totalMarginPct: number;
  allSKUs: string[];       // unique SKUs across all groups
  costedSKUs: string[];    // SKUs with cost data
  uncostedSKUs: string[];  // SKUs missing cost data
}

/**
 * Extract all unique SKUs from marketplace groups.
 */
export function extractUniqueSKUs(groups: MarketplaceGroup[]): string[] {
  const skus = new Set<string>();
  for (const g of groups) {
    for (const order of g.orders) {
      if (order.lineitemSku) {
        skus.add(order.lineitemSku.toUpperCase().trim());
      }
    }
  }
  return Array.from(skus).sort();
}

/**
 * Calculate profit per marketplace using product costs.
 */
export function calculateProfit(
  groups: MarketplaceGroup[],
  costMap: Map<string, ProductCost>,
): ProfitEngineResult {
  const marketplaces: MarketplaceProfitSummary[] = [];
  let totalRevenue = 0;
  let totalCogs = 0;
  const allSKUSet = new Set<string>();
  const costedSKUSet = new Set<string>();
  const uncostedSKUSet = new Set<string>();

  for (const g of groups) {
    if (g.skipped) continue;

    const skusInGroup = new Set<string>();
    let groupCogs = 0;
    const costedInGroup = new Set<string>();
    const uncostedInGroup = new Set<string>();

    for (const order of g.orders) {
      const sku = order.lineitemSku?.toUpperCase().trim();
      if (!sku) continue;

      skusInGroup.add(sku);
      allSKUSet.add(sku);

      const cost = costMap.get(sku);
      if (cost) {
        groupCogs += cost.cost * order.lineitemQuantity;
        costedInGroup.add(sku);
        costedSKUSet.add(sku);
      } else {
        uncostedInGroup.add(sku);
        uncostedSKUSet.add(sku);
      }
    }

    const revenue = g.totalSubtotal;
    const grossProfit = revenue - groupCogs;
    const marginPct = revenue > 0 ? (grossProfit / revenue) * 100 : 0;

    totalRevenue += revenue;
    totalCogs += groupCogs;

    marketplaces.push({
      marketplaceKey: g.marketplaceKey,
      marketplaceLabel: g.registryEntry.display_name || g.marketplaceKey,
      revenue,
      cogs: groupCogs,
      grossProfit,
      marginPct,
      orderCount: g.orderCount,
      totalSKUs: skusInGroup.size,
      costedSKUs: costedInGroup.size,
      uncostedSKUs: uncostedInGroup.size,
      isEstimated: uncostedInGroup.size > 0,
    });
  }

  const totalProfit = totalRevenue - totalCogs;
  const totalMarginPct = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

  // Sort by profit descending
  marketplaces.sort((a, b) => b.grossProfit - a.grossProfit);

  return {
    marketplaces,
    totalRevenue,
    totalCogs,
    totalProfit,
    totalMarginPct,
    allSKUs: Array.from(allSKUSet).sort(),
    costedSKUs: Array.from(costedSKUSet).sort(),
    uncostedSKUs: Array.from(uncostedSKUSet).sort(),
  };
}

// ─── Settlement-based Profit Calculation ────────────────────────────────────

export interface SettlementForProfit {
  settlement_id: string;
  marketplace: string;
  gross_amount: number;       // sales_principal + gst_on_income (or just sales incl)
  fees_amount: number;        // seller_fees (negative)
  period_start: string;
  period_end: string;
}

export interface SettlementLineForProfit {
  settlement_id: string;
  sku: string | null;
  amount: number;             // line revenue
  order_id: string | null;
  transaction_type: string | null;
  quantity?: number;
  fulfilment_channel?: string | null;
}

export interface MarketplaceProfit {
  marketplace_code: string;
  marketplace_name: string;
  period_label: string;
  gross_revenue: number;
  total_cogs: number;
  marketplace_fees: number;
  postage_deduction: number;
  gross_profit: number;
  margin_percent: number;
  orders_count: number;
  units_sold: number;
  uncosted_sku_count: number;
  uncosted_revenue: number;
  fulfilment_method: string;
  fulfilment_unknown: boolean;
  fulfilment_data_incomplete: boolean;
}

function normalizeSku(sku: string): string {
  return sku.toUpperCase().trim().replace(/-/g, '');
}

/**
 * Calculate profit for a single marketplace settlement using line-level SKU data.
 */
export function calculateMarketplaceProfit(
  marketplaceCode: string,
  periodLabel: string,
  settlement: SettlementForProfit,
  settlementLines: SettlementLineForProfit[],
  productCosts: ProductCost[],
  options?: {
    fulfilmentMethod?: string;
    postageCostPerOrder?: number;
  }
): MarketplaceProfit {
  // MARKETPLACE_LABELS imported at top level
  const marketplaceName = MARKETPLACE_LABELS[marketplaceCode] || marketplaceCode;

  // Build cost lookup
  const costMap = new Map<string, number>();
  for (const pc of productCosts) {
    costMap.set(normalizeSku(pc.sku), pc.cost);
  }

  const gross_revenue = Math.abs(settlement.gross_amount);
  const marketplace_fees = Math.abs(settlement.fees_amount);

  let total_cogs = 0;
  let units_sold = 0;
  let orders_count = 0;
  const uncostedSkus = new Set<string>();
  let uncosted_revenue = 0;
  const orderIds = new Set<string>();

  // Filter to revenue lines only (sales, not fees/refunds)
  const revenueLines = settlementLines.filter(
    l => l.settlement_id === settlement.settlement_id &&
         (l.transaction_type === 'Order' || l.transaction_type === 'ItemPrice' ||
          l.transaction_type === 'ProductCharges' || l.transaction_type === null ||
          (l.amount && l.amount > 0))
  );

  for (const line of revenueLines) {
    const qty = line.quantity || 1;
    units_sold += qty;

    if (line.order_id) orderIds.add(line.order_id);

    if (line.sku) {
      const normalised = normalizeSku(line.sku);
      const cost = costMap.get(normalised);
      if (cost !== undefined) {
        total_cogs += cost * qty;
      } else {
        uncostedSkus.add(normalised);
        uncosted_revenue += Math.abs(line.amount || 0);
      }
    } else {
      // No SKU on this line — count revenue as uncosted
      uncosted_revenue += Math.abs(line.amount || 0);
    }
  }

  orders_count = orderIds.size || revenueLines.length;

  // Postage deduction — use canonical function per line
  const fulfilmentMethod = options?.fulfilmentMethod || 'not_sure';
  const postageCostPerOrder = options?.postageCostPerOrder || 0;
  let postage_deduction = 0;

  if (fulfilmentMethod === 'mixed_fba_fbm') {
    // Line-level split: count deductions per line channel
    const hasLineData = revenueLines.some(l => l.fulfilment_channel);
    if (hasLineData) {
      // Deduplicate by order_id to avoid double-counting
      const orderChannels = new Map<string, string | null>();
      for (const line of revenueLines) {
        const key = line.order_id || `line_${revenueLines.indexOf(line)}`;
        if (!orderChannels.has(key)) {
          orderChannels.set(key, line.fulfilment_channel || null);
        }
      }
      for (const [, ch] of orderChannels) {
        postage_deduction += getPostageDeductionForOrder(fulfilmentMethod, ch, postageCostPerOrder);
      }
    }
    // else: no line data (legacy) → fall back to zero deduction (treat all as FBA)
  } else {
    // Non-mixed: canonical function owns the multiplication via orderCount
    postage_deduction = getPostageDeductionForOrder(fulfilmentMethod, null, postageCostPerOrder, orders_count);
  }

  const gross_profit = gross_revenue - total_cogs - marketplace_fees - postage_deduction;
  const margin_percent = gross_revenue > 0 ? (gross_profit / gross_revenue) * 100 : 0;

  // Determine if mixed mode is missing line-level data
  const fulfilmentDataIncomplete = fulfilmentMethod === 'mixed_fba_fbm' &&
    !revenueLines.some(l => l.fulfilment_channel);

  return {
    marketplace_code: marketplaceCode,
    marketplace_name: marketplaceName,
    period_label: periodLabel,
    gross_revenue: round(gross_revenue),
    total_cogs: round(total_cogs),
    marketplace_fees: round(marketplace_fees),
    postage_deduction: round(postage_deduction),
    gross_profit: round(gross_profit),
    margin_percent: round(margin_percent),
    orders_count,
    units_sold,
    uncosted_sku_count: uncostedSkus.size,
    uncosted_revenue: round(uncosted_revenue),
    fulfilment_method: fulfilmentMethod,
    fulfilment_unknown: fulfilmentMethod === 'not_sure',
    fulfilment_data_incomplete: fulfilmentDataIncomplete,
  };
}

// ─── SKU Cross-Marketplace Comparison ──────────────────────────────────────

export interface SkuMarketplaceEntry {
  marketplace_code: string;
  marketplace_name: string;
  revenue_per_unit: number;
  cogs: number;
  fee_per_unit: number;
  profit_per_unit: number;
  margin_percent: number;
  units_sold: number;
}

export interface SkuMarketplaceComparison {
  sku: string;
  product_name: string;
  marketplaces: SkuMarketplaceEntry[];
  best_marketplace: string;
  worst_marketplace: string;
}

/**
 * Compare a single SKU's profitability across all marketplaces.
 */
export function compareSkuAcrossMarketplaces(
  sku: string,
  allSettlements: SettlementForProfit[],
  allLines: SettlementLineForProfit[],
  productCosts: ProductCost[]
): SkuMarketplaceComparison {
  // MARKETPLACE_LABELS imported at top level
  const normalised = normalizeSku(sku);

  // Find cost
  const costEntry = productCosts.find(pc => normalizeSku(pc.sku) === normalised);
  const unitCost = costEntry?.cost || 0;
  const productName = costEntry?.label || sku;

  // Group lines by marketplace
  const mpMap = new Map<string, { revenue: number; fees: number; units: number; grossSales: number }>();

  // Find all lines matching this SKU
  const skuLines = allLines.filter(l => l.sku && normalizeSku(l.sku) === normalised);

  for (const line of skuLines) {
    // Find which settlement this line belongs to
    const settlement = allSettlements.find(s => s.settlement_id === line.settlement_id);
    if (!settlement) continue;

    const mp = settlement.marketplace;
    if (!mpMap.has(mp)) mpMap.set(mp, { revenue: 0, fees: 0, units: 0, grossSales: 0 });

    const entry = mpMap.get(mp)!;
    const qty = line.quantity || 1;
    entry.revenue += Math.abs(line.amount || 0);
    entry.units += qty;
  }

  // Calculate fee rate per marketplace from settlements
  const feeRates = new Map<string, number>();
  const mpSettlements = new Map<string, SettlementForProfit[]>();
  for (const s of allSettlements) {
    if (!mpSettlements.has(s.marketplace)) mpSettlements.set(s.marketplace, []);
    mpSettlements.get(s.marketplace)!.push(s);
  }
  for (const [mp, settlements] of mpSettlements) {
    const totalGross = settlements.reduce((sum, s) => sum + Math.abs(s.gross_amount), 0);
    const totalFees = settlements.reduce((sum, s) => sum + Math.abs(s.fees_amount), 0);
    feeRates.set(mp, totalGross > 0 ? totalFees / totalGross : 0);
  }

  const marketplaces: SkuMarketplaceEntry[] = [];

  for (const [mp, data] of mpMap) {
    if (data.units === 0) continue;

    const revenue_per_unit = round(data.revenue / data.units);
    const feeRate = feeRates.get(mp) || 0;
    const fee_per_unit = round(revenue_per_unit * feeRate);
    const profit_per_unit = round(revenue_per_unit - unitCost - fee_per_unit);
    const margin_percent = revenue_per_unit > 0
      ? round((profit_per_unit / revenue_per_unit) * 100)
      : 0;

    marketplaces.push({
      marketplace_code: mp,
      marketplace_name: MARKETPLACE_LABELS[mp] || mp,
      revenue_per_unit,
      cogs: unitCost,
      fee_per_unit,
      profit_per_unit,
      margin_percent,
      units_sold: data.units,
    });
  }

  // Sort by margin descending
  marketplaces.sort((a, b) => b.margin_percent - a.margin_percent);

  return {
    sku,
    product_name: productName,
    marketplaces,
    best_marketplace: marketplaces.length > 0 ? marketplaces[0].marketplace_code : '',
    worst_marketplace: marketplaces.length > 0 ? marketplaces[marketplaces.length - 1].marketplace_code : '',
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}
