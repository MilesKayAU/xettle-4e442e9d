/**
 * Canonical Xero Posting Line-Item Builder
 *
 * SINGLE SOURCE OF TRUTH for building Xero invoice line items from a settlement.
 * Used by:
 *   - PushSafetyPreview (display)
 *   - syncSettlementToXero (manual push payload + settlementData)
 *   - auto-post-settlement edge function (mirrors this logic; see CANONICAL_VERSION)
 *
 * IMPORTANT: If you change the category list, tax types, or field mapping,
 * you MUST bump CANONICAL_VERSION and update auto-post-settlement to match.
 *
 * ═══════════════════════════════════════════════════════════════
 * SIGN CONVENTION (Option A — "Use Stored Sign")
 * ═══════════════════════════════════════════════════════════════
 * All settlement DB fields are stored with their accounting sign:
 *   - Income fields (sales_principal, sales_shipping): POSITIVE
 *   - Reduction fields (refunds, promotional_discounts): NEGATIVE
 *   - Expense fields (seller_fees, fba_fees, etc.): NEGATIVE
 *   - Recovery fields (reimbursements): POSITIVE
 *
 * The builder passes DB values through WITHOUT sign manipulation.
 * No abs(), no -abs(), no sign flipping. The DB value IS the posted value.
 * This prevents double-negation bugs across parser→DB→builder→Xero.
 *
 * If a parser stores fees as positive magnitudes, that parser is wrong
 * and must be fixed at ingestion — NOT compensated here.
 * ═══════════════════════════════════════════════════════════════
 *
 * ═══════════════════════════════════════════════════════════════
 * TAX TYPE MAPPING (AU GST Model — Amazon AU)
 * ═══════════════════════════════════════════════════════════════
 * Category                Tax Type       Rationale
 * ────────────────────    ────────       ──────────────────────────────
 * Sales (Principal)       OUTPUT         GST-inclusive revenue, seller collects GST
 * Shipping Revenue        OUTPUT         Shipping charged to buyer includes GST
 * Promotional Discounts   OUTPUT         Reduces OUTPUT-taxed revenue (contra-revenue)
 * Refunds                 OUTPUT         Reversal of OUTPUT-taxed sale
 * Reimbursements          BASEXCLUDED    Not a taxable supply; Amazon reimbursement
 * Seller Fees             INPUT          GST-inclusive fee, seller claims input credit
 * FBA Fees                INPUT          GST-inclusive fee, seller claims input credit
 * Storage Fees            INPUT          GST-inclusive fee, seller claims input credit
 * Advertising             INPUT          GST-inclusive fee, seller claims input credit
 * Other Fees              INPUT          GST-inclusive fee, seller claims input credit
 * ═══════════════════════════════════════════════════════════════
 */

export const CANONICAL_VERSION = 'v2-10cat';
import { TOL_LINE_SUM } from '@/constants/reconciliation-tolerance';

// ─── Category Definitions ───────────────────────────────────────────────

export interface PostingCategoryDef {
  /** Display name used in Xero line item description and audit CSV */
  name: string;
  /** Field on the settlement DB row */
  field: string;
  /**
   * Xero tax type for AU GST:
   * - OUTPUT: GST on sales (seller collects)
   * - INPUT: GST on purchases/fees (seller claims credit)
   * - BASEXCLUDED: Not subject to GST
   */
  taxType: 'OUTPUT' | 'INPUT' | 'BASEXCLUDED';
  /**
   * Expected sign direction in DB (for documentation/validation only).
   * The builder does NOT manipulate signs — it uses the stored value as-is.
   * - 'positive': income/recovery (sales, shipping, reimbursements)
   * - 'negative': expenses/reductions (fees, refunds, discounts)
   */
  expectedSign: 'positive' | 'negative';
  /** Default account code (fallback when user has no mapping) */
  defaultAccountCode: string;
}

/**
 * The 10 canonical posting categories. Order matters for display.
 * Category names are constants — changing them requires bumping CANONICAL_VERSION.
 */
export const POSTING_CATEGORIES: readonly PostingCategoryDef[] = [
  { name: 'Sales (Principal)',     field: 'sales_principal',       taxType: 'OUTPUT',       expectedSign: 'positive',  defaultAccountCode: '200' },
  { name: 'Shipping Revenue',     field: 'sales_shipping',        taxType: 'OUTPUT',       expectedSign: 'positive',  defaultAccountCode: '206' },
  { name: 'Promotional Discounts',field: 'promotional_discounts', taxType: 'OUTPUT',       expectedSign: 'negative',  defaultAccountCode: '200' },
  { name: 'Refunds',              field: 'refunds',               taxType: 'OUTPUT',       expectedSign: 'negative',  defaultAccountCode: '205' },
  { name: 'Reimbursements',       field: 'reimbursements',        taxType: 'BASEXCLUDED',  expectedSign: 'positive',  defaultAccountCode: '271' },
  { name: 'Seller Fees',          field: 'seller_fees',           taxType: 'INPUT',        expectedSign: 'negative',  defaultAccountCode: '407' },
  { name: 'FBA Fees',             field: 'fba_fees',              taxType: 'INPUT',        expectedSign: 'negative',  defaultAccountCode: '408' },
  { name: 'Storage Fees',         field: 'storage_fees',          taxType: 'INPUT',        expectedSign: 'negative',  defaultAccountCode: '409' },
  { name: 'Advertising',          field: 'advertising_costs',     taxType: 'INPUT',        expectedSign: 'negative',  defaultAccountCode: '410' },
  { name: 'Other Fees',           field: 'other_fees',            taxType: 'INPUT',        expectedSign: 'negative',  defaultAccountCode: '405' },
] as const;

// ─── Legacy category name mapping (for account code resolution) ─────

/**
 * Maps canonical category names to the legacy keys used in
 * app_settings.accounting_xero_account_codes and marketplace_account_mapping.
 * This ensures existing user mappings continue to resolve correctly.
 */
const LEGACY_ACCOUNT_KEY_MAP: Record<string, string> = {
  'Sales (Principal)': 'Sales',
  'Shipping Revenue': 'Shipping',
  'Promotional Discounts': 'Promotional Discounts',
  'Refunds': 'Refunds',
  'Reimbursements': 'Reimbursements',
  'Seller Fees': 'Seller Fees',
  'FBA Fees': 'FBA Fees',
  'Storage Fees': 'Storage Fees',
  'Advertising': 'Advertising Costs',
  'Other Fees': 'Other Fees',
};

// ─── Types ──────────────────────────────────────────────────────────────

export interface XeroPostingLineItem {
  Description: string;
  AccountCode: string;
  TaxType: string;
  UnitAmount: number;
  Quantity: number;
}

/** Simplified type used for PushSafetyPreview display */
export interface LineItemPreview {
  description: string;
  amount: number;
  accountCode: string;
  taxType: string;
}

/** Settlement fields used by the builder. Accepts any object with these keys. */
export interface SettlementForPosting {
  settlement_id: string;
  marketplace?: string | null;
  period_start: string;
  period_end: string;
  sales_principal?: number | null;
  sales_shipping?: number | null;
  promotional_discounts?: number | null;
  refunds?: number | null;
  reimbursements?: number | null;
  seller_fees?: number | null;
  fba_fees?: number | null;
  storage_fees?: number | null;
  advertising_costs?: number | null;
  other_fees?: number | null;
  bank_deposit?: number | null;
  gst_on_income?: number | null;
  gst_on_expenses?: number | null;
  [key: string]: any; // Allow extra fields from DB row
}

/** Resolver function: (categoryName, marketplace?) → accountCode */
export type AccountCodeResolver = (categoryName: string, marketplace?: string) => string;

// ─── Builder ────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Build the default account code resolver from a user codes map.
 * Accepts the parsed JSON from app_settings.accounting_xero_account_codes
 * and/or marketplace_account_mapping rows merged in.
 */
export function createAccountCodeResolver(
  userCodes?: Record<string, string> | null
): AccountCodeResolver {
  return (categoryName: string, marketplace?: string): string => {
    const legacyKey = LEGACY_ACCOUNT_KEY_MAP[categoryName] || categoryName;
    const codes = userCodes || {};

    // 1. Marketplace-specific key  e.g. "Sales:Amazon AU"
    if (marketplace) {
      const mpKey = `${legacyKey}:${marketplace}`;
      if (codes[mpKey]) return codes[mpKey];
    }
    // 2. Base key  e.g. "Sales"
    if (codes[legacyKey]) return codes[legacyKey];
    if (codes[categoryName]) return codes[categoryName];

    // 3. Default from category definition
    const def = POSTING_CATEGORIES.find(c => c.name === categoryName);
    return def?.defaultAccountCode || '400';
  };
}

/**
 * Build Xero posting line items from a settlement row.
 * Returns only non-zero lines. Uses settlement DB columns directly.
 *
 * SIGN CONVENTION: Uses stored DB values as-is. No sign manipulation.
 * DB fields are expected to be stored with correct accounting signs
 * (positive for income, negative for expenses/reductions).
 *
 * @param settlement - Settlement DB row (or object with same fields)
 * @param getCode    - Account code resolver (use createAccountCodeResolver)
 * @param marketplace - Optional marketplace label for per-channel account resolution
 */
export function buildPostingLineItems(
  settlement: SettlementForPosting,
  getCode?: AccountCodeResolver,
  marketplace?: string,
): XeroPostingLineItem[] {
  const resolver = getCode || createAccountCodeResolver();

  const lines: XeroPostingLineItem[] = [];

  for (const cat of POSTING_CATEGORIES) {
    const raw = (settlement as any)[cat.field];
    const value = typeof raw === 'number' ? raw : parseFloat(raw) || 0;
    // Use stored sign as-is — NO sign manipulation (Option A)
    const amount = round2(value);

    if (Math.abs(amount) < TOL_LINE_SUM) continue;

    lines.push({
      Description: cat.name,
      AccountCode: resolver(cat.name, marketplace),
      TaxType: cat.taxType,
      UnitAmount: amount,
      Quantity: 1,
    });
  }

  return lines;
}

/**
 * Convert XeroPostingLineItem[] to LineItemPreview[] for display.
 */
export function toLineItemPreviews(lineItems: XeroPostingLineItem[]): LineItemPreview[] {
  return lineItems.map(li => ({
    description: li.Description,
    amount: li.UnitAmount,
    accountCode: li.AccountCode,
    taxType: li.TaxType,
  }));
}

// ─── Audit CSV Builder ──────────────────────────────────────────────────

/**
 * Build a multi-row audit CSV from a settlement and its line items.
 * One row per category + a totals row.
 * Columns: settlement_id, period_start, period_end, marketplace, category,
 *          amount_ex_gst, gst_estimate, amount_inc_gst_estimate, account_code, tax_type
 *
 * NOTE: GST columns are ESTIMATES (10% flat rate). Refer to settlement source
 * data for authoritative GST figures.
 */
export function buildAuditCsvContent(
  settlement: SettlementForPosting,
  lineItems: XeroPostingLineItem[],
): string {
  const headers = [
    'settlement_id', 'period_start', 'period_end', 'marketplace',
    'category', 'amount_ex_gst', 'gst_estimate', 'amount_inc_gst_estimate',
    'account_code', 'tax_type',
  ];

  const sid = settlement.settlement_id || '';
  const ps = settlement.period_start || '';
  const pe = settlement.period_end || '';
  const mp = settlement.marketplace || '';

  const rows: string[] = [
    '# GST values are estimates (10% flat rate). Refer to settlement source for authoritative GST.',
    headers.join(','),
  ];

  let totalExGst = 0;
  let totalGst = 0;

  for (const li of lineItems) {
    const exGst = round2(li.UnitAmount);
    // Estimate GST per line: OUTPUT lines have GST at 10%, INPUT lines have GST at 10%, BASEXCLUDED has 0
    const gstRate = li.TaxType === 'BASEXCLUDED' ? 0 : 0.1;
    const gstAmount = round2(exGst * gstRate);
    const incGst = round2(exGst + gstAmount);

    totalExGst += exGst;
    totalGst += gstAmount;

    rows.push(
      [sid, ps, pe, mp, li.Description, exGst, gstAmount, incGst, li.AccountCode, li.TaxType]
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(',')
    );
  }

  // Totals row
  const totalInc = round2(totalExGst + totalGst);
  rows.push(
    [sid, ps, pe, mp, 'TOTAL', round2(totalExGst), round2(totalGst), totalInc, '', '']
      .map(v => `"${String(v).replace(/"/g, '""')}"`)
      .join(',')
  );

  return rows.join('\n') + '\n';
}

/**
 * Compute a simple hash of CSV content for immutability verification.
 * Uses a basic djb2 hash — not cryptographic but sufficient for drift detection.
 */
export function hashCsvContent(csv: string): string {
  let hash = 5381;
  for (let i = 0; i < csv.length; i++) {
    hash = ((hash << 5) + hash + csv.charCodeAt(i)) & 0xFFFFFFFF;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
