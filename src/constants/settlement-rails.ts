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

/**
 * Rail Payout Mode — determines how a settlement is confirmed as "paid".
 *
 * payout_source:
 *   'settlement' — the settlement report itself is the payout confirmation
 *                  (e.g., Amazon: payout is implicit in the settlement report)
 *   'bank'       — a bank deposit must be matched to confirm payout
 *                  (e.g., Shopify Payments, Stripe, PayPal)
 *
 * bank_match_required:
 *   false — settlement is considered "matched/complete" once posted to Xero
 *   true  — settlement must match a bank deposit to be considered complete
 */
export interface RailPayoutConfig {
  payout_source: 'settlement' | 'bank';
  bank_match_required: boolean;
}

export const RAIL_PAYOUT_MODE: Record<string, RailPayoutConfig> = {
  amazon_au:         { payout_source: 'settlement', bank_match_required: false },
  amazon_us:         { payout_source: 'settlement', bank_match_required: false },
  shopify_payments:  { payout_source: 'settlement', bank_match_required: false },
  stripe:            { payout_source: 'bank',       bank_match_required: true },
  paypal:            { payout_source: 'bank',       bank_match_required: true },
  kogan:             { payout_source: 'settlement', bank_match_required: false },
  bunnings:          { payout_source: 'settlement', bank_match_required: false },
  bigw:              { payout_source: 'settlement', bank_match_required: false },
  everyday_market:   { payout_source: 'settlement', bank_match_required: false },
  ebay:              { payout_source: 'settlement', bank_match_required: false },
  catch:             { payout_source: 'settlement', bank_match_required: false },
  mydeal:            { payout_source: 'settlement', bank_match_required: false },
};

/** Default config for unknown rails — assume bank match required (safe default) */
const DEFAULT_PAYOUT_CONFIG: RailPayoutConfig = { payout_source: 'bank', bank_match_required: true };

/** Get the payout mode for a rail code */
export function getRailPayoutConfig(railCode: string): RailPayoutConfig {
  const normalised = toRailCode(railCode);
  return RAIL_PAYOUT_MODE[normalised] || DEFAULT_PAYOUT_CONFIG;
}

/** Check if a rail requires bank matching for payout confirmation */
export function isBankMatchRequired(marketplace: string): boolean {
  return getRailPayoutConfig(marketplace).bank_match_required;
}

export const DESTINATION_KEY_PREFIX = 'payout_destination:';
export const DESTINATION_DEFAULT_KEY = 'payout_destination:_default';
export const LEGACY_KEY_PREFIX = 'payout_account:';
export const LEGACY_DEFAULT_KEY = 'payout_account:_default';
