/**
 * Settlement Rails — canonical routing keys for reconciliation.
 *
 * A "rail" identifies the payment path a settlement follows.
 * A "destination account" is the Xero bank/clearing account where funds land.
 *
 * Mapping stored in app_settings as:
 *   payout_destination:<rail_code> = <xero_account_id>
 *   payout_destination:_default    = <xero_account_id>
 */

export const PHASE_1_RAILS = [
  { code: 'amazon_au', label: 'Amazon AU' },
  { code: 'shopify_payments', label: 'Shopify Payments' },
  { code: 'ebay', label: 'eBay' },
  { code: 'bunnings', label: 'Bunnings' },
  { code: 'catch', label: 'Catch' },
  { code: 'kogan', label: 'Kogan' },
  { code: 'mydeal', label: 'MyDeal' },
  { code: 'everyday_market', label: 'Everyday Market' },
  { code: 'paypal', label: 'PayPal' },
] as const;

export type RailCode = typeof PHASE_1_RAILS[number]['code'];

/** Maps legacy/variant marketplace codes to canonical rail codes */
export const RAIL_ALIASES: Record<string, string> = {
  ebay_au: 'ebay',
};

/** Normalise a marketplace code to its canonical rail code */
export function toRailCode(marketplace: string): string {
  const lower = marketplace.toLowerCase();
  return RAIL_ALIASES[lower] || lower;
}

export const DESTINATION_KEY_PREFIX = 'payout_destination:';
export const DESTINATION_DEFAULT_KEY = 'payout_destination:_default';
export const LEGACY_KEY_PREFIX = 'payout_account:';
export const LEGACY_DEFAULT_KEY = 'payout_account:_default';
