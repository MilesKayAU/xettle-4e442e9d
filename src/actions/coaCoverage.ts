/**
 * COA Coverage — Canonical action for detecting marketplace COA gaps.
 *
 * Determines which active marketplaces have matching Xero accounts
 * and which are "uncovered" (no accounts found in the COA).
 *
 * This is reusable across UI surfaces: Account Mapper, Push Preview,
 * Onboarding Wizard, etc.
 */

import type { CachedXeroAccount } from './xeroAccounts';

// ─── Types ───────────────────────────────────────────────────────────────────

export type CoverageStatus = 'covered' | 'uncovered' | 'partial';

export interface MarketplaceCoverage {
  marketplace: string;
  status: CoverageStatus;
  /** Number of COA accounts matching this marketplace */
  matchCount: number;
  /** Categories that have matching accounts */
  coveredCategories: string[];
}

export interface CoverageResult {
  covered: string[];
  uncovered: string[];
  partial: string[];
  details: MarketplaceCoverage[];
}

// ─── Category Detection (shared with CloneCoaDialog) ────────────────────────

export function detectCategoryFromName(nameLower: string): string | null {
  if (/advertis/i.test(nameLower)) return 'Advertising Costs';
  if (/storage/i.test(nameLower)) return 'Storage Fees';
  if (/fba|fulfilment|fulfillment/i.test(nameLower)) return 'FBA Fees';
  if (/refund/i.test(nameLower)) return 'Refunds';
  if (/reimburse/i.test(nameLower)) return 'Reimbursements';
  if (/shipping|freight|delivery/i.test(nameLower) && /revenue|income|sales/i.test(nameLower)) return 'Shipping';
  if (/promotional|promo|discount|voucher/i.test(nameLower)) return 'Promotional Discounts';
  if (/seller fee|commission|referral/i.test(nameLower)) return 'Seller Fees';
  if (/\bfee/i.test(nameLower) && !/fba|storage|advertis|shipping/i.test(nameLower)) return 'Seller Fees';
  if (/other.*fee|miscellaneous/i.test(nameLower)) return 'Other Fees';
  if (/sales|revenue|income/i.test(nameLower)) return 'Sales';
  if (/shipping/i.test(nameLower)) return 'Shipping';
  return null;
}

// ─── Template Account Discovery ─────────────────────────────────────────────

export interface TemplateAccount {
  category: string;
  code: string;
  name: string;
  type: string;
  taxType: string | null;
}

/**
 * Find COA accounts belonging to a given marketplace, grouped by category.
 * Uses generic keyword matching — works for any user's COA.
 */
export function findTemplateAccounts(
  marketplace: string,
  coaAccounts: CachedXeroAccount[],
): TemplateAccount[] {
  const mpLower = marketplace.toLowerCase();
  const results: TemplateAccount[] = [];

  // Build keyword variants for the marketplace
  // Always include the full label AND individual significant words (≥3 chars)
  // This ensures "Amazon AU" matches "Amazon Sales AU" via the word "amazon"
  const words = mpLower.split(/\s+/).filter(w => w.length >= 3);
  // Use individual words as primary keywords (more flexible), plus the full label
  const keywords = [...new Set([...words, mpLower])];

  for (const acc of coaAccounts) {
    if (!acc.account_code || !acc.is_active) continue;
    const nameLower = acc.account_name.toLowerCase();

    // Check if this account matches the marketplace
    // For multi-word marketplaces, ALL significant words must appear (prevents false positives)
    const matchesMarketplace = words.length > 0
      ? words.every(w => nameLower.includes(w))
      : nameLower.includes(mpLower);
    if (!matchesMarketplace) continue;

    // Determine category from account name
    const category = detectCategoryFromName(nameLower);
    if (category) {
      results.push({
        category,
        code: acc.account_code,
        name: acc.account_name,
        type: acc.account_type || 'REVENUE',
        taxType: acc.tax_type || null,
      });
    }
  }

  return results;
}

// ─── Name Generation ────────────────────────────────────────────────────────

/** Words considered standard category/accounting keywords — not brand contamination */
const CATEGORY_KEYWORDS = new Set([
  'sales', 'revenue', 'income', 'fees', 'fee', 'seller', 'commission',
  'refund', 'refunds', 'reimbursement', 'reimbursements', 'shipping',
  'freight', 'delivery', 'advertising', 'ad', 'ads', 'storage', 'fba',
  'fulfilment', 'fulfillment', 'promotional', 'promo', 'discount',
  'discounts', 'voucher', 'other', 'miscellaneous', 'costs', 'cost',
  'charges', 'expense', 'expenses', 'au', 'us', 'uk', 'ca', 'nz',
  'gst', 'tax', 'vat', 'paypal', 'stripe', 'website', 'online',
]);

/**
 * Generate a new account name by replacing the template marketplace name
 * with the target marketplace name. If the result still contains brand junk
 * from the template, falls back to a clean canonical name.
 */
export function generateNewAccountName(
  templateName: string,
  templateMarketplace: string,
  targetMarketplace: string,
  category?: string,
): string {
  const escapedMp = templateMarketplace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapedMp, 'gi');
  let replaced = templateName.replace(regex, targetMarketplace);

  // Fallback: replace first word cluster that matches
  if (replaced === templateName) {
    const mpWords = templateMarketplace.split(/\s+/);
    for (const word of mpWords) {
      if (word.length < 3) continue;
      const wordRegex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
      replaced = replaced.replace(wordRegex, targetMarketplace);
      if (replaced !== templateName) break;
    }
    if (replaced === templateName) {
      replaced = `${targetMarketplace} ${templateName}`;
    }
  }

  // ── Brand contamination check ──
  if (category) {
    const targetWords = new Set(targetMarketplace.toLowerCase().split(/\s+/));
    const resultWords = replaced
      .replace(/[()[\]]/g, ' ')
      .split(/\s+/)
      .filter(w => w.length >= 2);

    const junkWords = resultWords.filter(w => {
      const wl = w.toLowerCase();
      return !targetWords.has(wl) && !CATEGORY_KEYWORDS.has(wl);
    });

    if (resultWords.length > 0 && junkWords.length / resultWords.length > 0.3) {
      return `${targetMarketplace} ${category}`;
    }
  }

  return replaced;
}

// ─── Main Coverage Action ───────────────────────────────────────────────────

/**
 * Compute marketplace COA coverage for a set of active marketplaces.
 * Returns covered, uncovered, and partial lists.
 */
export function getMarketplaceCoverage(
  activeMarketplaces: string[],
  coaAccounts: CachedXeroAccount[],
): CoverageResult {
  const covered: string[] = [];
  const uncovered: string[] = [];
  const partial: string[] = [];
  const details: MarketplaceCoverage[] = [];

  for (const mp of activeMarketplaces) {
    const templates = findTemplateAccounts(mp, coaAccounts);
    const categories = [...new Set(templates.map(t => t.category))];

    // Required categories for full coverage
    const CORE_CATEGORIES = new Set(['Sales', 'Seller Fees']);
    const hasCoreCategories = [...CORE_CATEGORIES].every(c => categories.includes(c));

    let status: CoverageStatus;
    if (templates.length === 0) {
      status = 'uncovered';
      uncovered.push(mp);
    } else if (hasCoreCategories && categories.length >= 2) {
      // Has at least Sales + Fees = covered (may still have gaps but has a structure)
      status = 'covered';
      covered.push(mp);
    } else {
      // Has some accounts but missing core categories
      status = 'partial';
      partial.push(mp);
    }

    details.push({
      marketplace: mp,
      status,
      matchCount: templates.length,
      coveredCategories: categories,
    });
  }

  return { covered, uncovered, partial, details };
}
