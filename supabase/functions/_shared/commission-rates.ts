/**
 * Canonical Commission Rates — Single source of truth.
 * 
 * Imported by:
 *   - auto-generate-shopify-settlements
 *   - repair-settlement-fees
 * 
 * Frontend mirror: src/utils/insights-fee-attribution.ts (COMMISSION_ESTIMATES)
 * Parity test: src/actions/__tests__/commission-parity.test.ts
 */

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

/**
 * Look up observed commission rate from app_settings rows, falling back
 * to the hardcoded estimate.
 */
export function getCommissionRate(
  marketplaceCode: string,
  observedRates: Record<string, number> = {},
): number {
  return observedRates[marketplaceCode]
    ?? COMMISSION_ESTIMATES[marketplaceCode]
    ?? DEFAULT_COMMISSION_RATE;
}
