/**
 * Profit Engine — Calculates COGS and profit per marketplace from SKU costs.
 *
 * Takes MarketplaceGroup[] from the Shopify Orders parser + a product_costs
 * map, and returns per-marketplace profit breakdowns.
 */

import type { MarketplaceGroup, ShopifyOrderRow } from './shopify-orders-parser';

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
