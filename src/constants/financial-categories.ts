/**
 * INTERNAL FINANCIAL CATEGORIES — Canonical constant file
 *
 * These are Xettle's internal categories for normalizing financial data
 * across all marketplaces. All ingestion pipelines MUST use these exact
 * values when writing to settlement_lines.accounting_category.
 *
 * IMPORTANT: These are NOT accounting codes. They are internal classification
 * keys used by the Insights Engine. The COA mapping layer (optional) translates
 * these to Xero account codes during push.
 *
 * All values: lowercase, snake_case, stable across all marketplaces.
 *
 * Edge functions cannot import this file — copy the comment block below
 * into every edge function that writes settlement_lines:
 *
 * // ══════════════════════════════════════════════════════════════
 * // INTERNAL FINANCIAL CATEGORIES (canonical)
 * // Source: src/constants/financial-categories.ts
 * //
 * //   revenue          — item sale (ex GST)
 * //   marketplace_fee  — commission / referral fee
 * //   payment_fee      — gateway fee (Stripe, PayPal)
 * //   shipping_income  — shipping charged to customer
 * //   shipping_cost    — shipping expense
 * //   refund           — refunded sale
 * //   gst_income       — GST collected on sales
 * //   gst_expense      — GST on fees
 * //   promotion        — discount / promotional rebate
 * //   adjustment       — reserve, correction, reimbursement
 * //   fba_fee          — fulfilment fee (Amazon FBA)
 * //   storage_fee      — storage / warehousing
 * //   advertising      — sponsored product costs
 * // ══════════════════════════════════════════════════════════════
 */

export const FINANCIAL_CATEGORIES = {
  REVENUE: 'revenue',
  MARKETPLACE_FEE: 'marketplace_fee',
  PAYMENT_FEE: 'payment_fee',
  SHIPPING_INCOME: 'shipping_income',
  SHIPPING_COST: 'shipping_cost',
  REFUND: 'refund',
  GST_INCOME: 'gst_income',
  GST_EXPENSE: 'gst_expense',
  PROMOTION: 'promotion',
  ADJUSTMENT: 'adjustment',
  FBA_FEE: 'fba_fee',
  STORAGE_FEE: 'storage_fee',
  ADVERTISING: 'advertising',
} as const;

export type FinancialCategory = typeof FINANCIAL_CATEGORIES[keyof typeof FINANCIAL_CATEGORIES];

/**
 * Map legacy accounting_category values to canonical categories.
 * Used when reading existing settlement_lines that may have old values.
 */
export const LEGACY_CATEGORY_MAP: Record<string, FinancialCategory> = {
  // PascalCase (auto-generate-shopify-settlements v1)
  'Sales': 'revenue',
  'GST': 'gst_income',
  'PromotionalDiscounts': 'promotion',
  // lowercase (SmartUploadFlow v1)
  'sales': 'revenue',
  'fees': 'marketplace_fee',
  'refunds': 'refund',
  'gst': 'gst_income',
  // Already canonical (no-op)
  'revenue': 'revenue',
  'marketplace_fee': 'marketplace_fee',
  'payment_fee': 'payment_fee',
  'refund': 'refund',
  'gst_income': 'gst_income',
  'gst_expense': 'gst_expense',
  'promotion': 'promotion',
  'adjustment': 'adjustment',
  'fba_fee': 'fba_fee',
  'storage_fee': 'storage_fee',
  'advertising': 'advertising',
  'shipping_income': 'shipping_income',
  'shipping_cost': 'shipping_cost',
};

/**
 * Normalize a legacy category value to the canonical category.
 * Returns the input unchanged if not found in the map.
 */
export function normalizeCategory(raw: string | null | undefined): string {
  if (!raw) return 'revenue';
  return LEGACY_CATEGORY_MAP[raw] || raw;
}
