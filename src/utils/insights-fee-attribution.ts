/**
 * Canonical Fee Attribution Utility
 * 
 * Single source of truth for:
 * - Commission estimation rates per marketplace
 * - Source priority logic (CSV > API)
 * - Platform-family fee redistribution (Woolworths MarketPlus siblings)
 * - Data quality flags and badge logic
 * 
 * Both InsightsDashboard and MarketplaceProfitComparison consume this.
 */

// ─── Estimated Commission Rates ─────────────────────────────────────────────
// Mirrors the edge function auto-generate-shopify-settlements
export const COMMISSION_ESTIMATES: Record<string, number> = {
  kogan: 0.12,
  bigw: 0.08,
  everyday_market: 0.10,
  mydeal: 0.10,
  bunnings: 0.10,
  catch: 0.12,
  ebay_au: 0.13,
  iconic: 0.15,
  tradesquare: 0.10,
  tiktok: 0.05,
};
export const DEFAULT_COMMISSION_RATE = 0.10;

// ─── Platform Families ──────────────────────────────────────────────────────
// Siblings that share platform-level fees via a single CSV payout
export const PLATFORM_FAMILIES: Record<string, string[]> = {
  woolworths_marketplus: ['mydeal', 'bigw', 'everyday_market', 'woolworths_market'],
};

// ─── Marketplace normalisation ──────────────────────────────────────────────
export function normalizeMarketplace(mp: string): string {
  if (mp.startsWith('woolworths_marketplus_')) return mp.replace('woolworths_marketplus_', '');
  if (mp.startsWith('shopify_orders_')) return mp.replace('shopify_orders_', '');
  return mp;
}

// ─── Types ──────────────────────────────────────────────────────────────────

export interface SettlementRow {
  marketplace: string | null;
  sales_principal: number | null;
  gst_on_income: number | null;
  seller_fees: number | null;
  refunds: number | null;
  bank_deposit: number | null;
  fba_fees: number | null;
  other_fees: number | null;
  storage_fees: number | null;
  period_end: string;
  period_start: string;
  is_hidden: boolean;
  is_pre_boundary: boolean;
  source: string;
  raw_payload: any;
}

export interface FeeAttribution {
  effectiveTotalFees: number;
  effectiveNetPayout: number;
  effectiveReturnRatio: number;
  effectiveFeeLoad: number;
  effectiveAvgCommission: number;
  hasEstimatedFees: boolean;
  hasMissingFeeData: boolean;
}

/**
 * For a set of settlement rows belonging to one (normalised) marketplace,
 * compute the effective fee attribution accounting for api_sync zero-fee rows.
 */
export function attributeFees(
  mp: string,
  rows: SettlementRow[],
  redistributedPlatformFees = 0,
  observedRates: Record<string, number> = {},
): FeeAttribution {
  const totalSalesExGst = rows.reduce((sum, r) => sum + (r.sales_principal || 0), 0);
  const totalGst = rows.reduce((sum, r) => sum + (r.gst_on_income || 0), 0);
  const totalSales = totalSalesExGst + totalGst;

  const rawTotalFees = rows.reduce(
    (sum, r) =>
      sum +
      Math.abs(r.seller_fees || 0) +
      Math.abs(r.fba_fees || 0) +
      Math.abs(r.storage_fees || 0) +
      Math.max(r.other_fees || 0, 0),
    0,
  );

  const commissionTotal = Math.abs(rows.reduce((sum, r) => sum + (r.seller_fees || 0), 0));
  const rawAvgCommission = totalSales > 0 ? Math.min(commissionTotal / totalSales, 1) : 0;

  // Identify api_sync zero-fee rows vs rows with real fee data
  const apiSyncZeroFeeRows = rows.filter(
    (r) => r.source === 'api_sync' && Math.abs(r.seller_fees || 0) < 0.01,
  );
  const feeRelevantRows = rows.filter(
    (r) => !(r.source === 'api_sync' && Math.abs(r.seller_fees || 0) < 0.01),
  );

  let effectiveTotalFees = rawTotalFees;
  let effectiveNetPayout = rows.reduce((sum, r) => sum + (r.bank_deposit || 0), 0);
  let effectiveAvgCommission = rawAvgCommission;
  let hasEstimatedFees = rows.some((r) => (r.raw_payload as any)?.fees_estimated === true);
  let hasMissingFeeData = rawTotalFees === 0 && totalSales > 500;

  if (apiSyncZeroFeeRows.length > 0 && apiSyncZeroFeeRows.length === rows.length) {
    // Case 1: ALL rows are api_sync with zero fees
    const estimatedRate = observedRates[mp] ?? COMMISSION_ESTIMATES[mp] ?? DEFAULT_COMMISSION_RATE;
    const estimatedFees = totalSalesExGst * estimatedRate;
    effectiveTotalFees = estimatedFees;
    effectiveNetPayout = totalSales - estimatedFees;
    effectiveAvgCommission = estimatedRate;
    hasEstimatedFees = true;
    hasMissingFeeData = false;
  } else if (apiSyncZeroFeeRows.length > 0 && feeRelevantRows.length > 0) {
    // Case 2: MIXED — CSV rows with real fees + api_sync with zero fees
    const csvSales = feeRelevantRows.reduce((sum, r) => sum + (r.sales_principal || 0), 0);
    const csvFees = Math.abs(feeRelevantRows.reduce((sum, r) => sum + (r.seller_fees || 0), 0));
    const realFeeRate =
      csvSales > 0 ? csvFees / csvSales : observedRates[mp] ?? COMMISSION_ESTIMATES[mp] ?? DEFAULT_COMMISSION_RATE;

    const apiSyncSales = apiSyncZeroFeeRows.reduce((sum, r) => sum + (r.sales_principal || 0), 0);
    const estimatedApiSyncFees = apiSyncSales * realFeeRate;

    effectiveTotalFees = csvFees + estimatedApiSyncFees;
    const csvPayout = feeRelevantRows.reduce((sum, r) => sum + (r.bank_deposit || 0), 0);
    const apiSyncGst = apiSyncZeroFeeRows.reduce((sum, r) => sum + (r.gst_on_income || 0), 0);
    effectiveNetPayout = csvPayout + (apiSyncSales + apiSyncGst - estimatedApiSyncFees);
    effectiveAvgCommission = realFeeRate;
    hasEstimatedFees = true;
    hasMissingFeeData = false;
  }

  // Apply redistributed platform fees (positive = fees added to this sibling,
  // negative = excess fees removed from fee-heavy sibling)
  if (redistributedPlatformFees !== 0) {
    effectiveTotalFees += redistributedPlatformFees;
    effectiveNetPayout -= redistributedPlatformFees;
    hasEstimatedFees = true;
  }

  const effectiveReturnRatio = totalSales > 0 ? Math.min(effectiveNetPayout / totalSales, 1) : 0;
  const effectiveFeeLoad = totalSales > 0 ? Math.min(effectiveTotalFees / totalSales, 1) : 0;

  return {
    effectiveTotalFees,
    effectiveNetPayout,
    effectiveReturnRatio,
    effectiveFeeLoad,
    effectiveAvgCommission,
    hasEstimatedFees,
    hasMissingFeeData,
  };
}

// ─── Platform Family Redistribution ─────────────────────────────────────────

export interface RedistributionResult {
  redistributedFees: Record<string, number>;
}

/**
 * Detect fee-heavy siblings in platform families and redistribute excess fees
 * proportionally to sales-producing siblings.
 */
export function redistributePlatformFees(
  grouped: Record<string, SettlementRow[]>,
): Record<string, number> {
  const result: Record<string, number> = {};

  for (const siblings of Object.values(PLATFORM_FAMILIES)) {
    const presentSiblings = siblings.filter((s) => grouped[s] && grouped[s].length > 0);
    if (presentSiblings.length < 2) continue;

    const feeHeavy: string[] = [];
    const salesSiblings: string[] = [];

    for (const s of presentSiblings) {
      const rows = grouped[s];
      const sales = rows.reduce(
        (sum, r) => sum + (r.sales_principal || 0) + (r.gst_on_income || 0),
        0,
      );
      const fees = rows.reduce(
        (sum, r) =>
          sum +
          Math.abs(r.seller_fees || 0) +
          Math.abs(r.fba_fees || 0) +
          Math.abs(r.storage_fees || 0) +
          Math.abs(r.other_fees || 0),
        0,
      );
      if (fees > Math.max(sales * 1.5, 50)) {
        feeHeavy.push(s);
      } else if (sales > 0) {
        salesSiblings.push(s);
      }
    }

    if (feeHeavy.length === 0 || salesSiblings.length === 0) continue;

    let totalExcessFees = 0;
    for (const fh of feeHeavy) {
      const rows = grouped[fh];
      const sales = rows.reduce(
        (sum, r) => sum + (r.sales_principal || 0) + (r.gst_on_income || 0),
        0,
      );
      const fees = rows.reduce(
        (sum, r) =>
          sum +
          Math.abs(r.seller_fees || 0) +
          Math.abs(r.fba_fees || 0) +
          Math.abs(r.storage_fees || 0) +
          Math.abs(r.other_fees || 0),
        0,
      );
      const ownFees = sales * 0.15;
      const excess = Math.max(fees - ownFees, 0);
      totalExcessFees += excess;
      // Subtract excess from fee-heavy sibling (negative = fee reduction)
      result[fh] = (result[fh] || 0) - excess;
    }

    const siblingSales: Record<string, number> = {};
    let totalSiblingSales = 0;
    for (const s of salesSiblings) {
      const sales = grouped[s].reduce(
        (sum, r) => sum + (r.sales_principal || 0) + (r.gst_on_income || 0),
        0,
      );
      siblingSales[s] = sales;
      totalSiblingSales += sales;
    }

    if (totalSiblingSales > 0 && totalExcessFees > 0) {
      for (const s of salesSiblings) {
        result[s] = (result[s] || 0) + (totalExcessFees * siblingSales[s]) / totalSiblingSales;
      }
    }
  }

  return result;
}

/**
 * Validate that a margin value is within logical bounds for a given marketplace.
 * Returns clamped margin. Margins > 95% for marketplaces with known fees are suspicious.
 */
export function isMarginSuspicious(mp: string, marginPct: number): boolean {
  const knownRate = COMMISSION_ESTIMATES[mp] || DEFAULT_COMMISSION_RATE;
  // Max logical margin = 100% - commission rate (i.e. if you had zero COGS)
  const maxLogicalMargin = (1 - knownRate) * 100;
  return marginPct > maxLogicalMargin + 5; // 5% tolerance
}
