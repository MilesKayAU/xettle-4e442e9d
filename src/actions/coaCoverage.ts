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

/**
 * Generate a new account name by replacing the template marketplace name
 * with the target marketplace name. Generic — works for any naming convention.
 */
export function generateNewAccountName(
  templateName: string,
  templateMarketplace: string,
  targetMarketplace: string,
): string {
  const escapedMp = templateMarketplace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(escapedMp, 'gi');
  const replaced = templateName.replace(regex, targetMarketplace);
  if (replaced !== templateName) return replaced;

  // Fallback: replace first word cluster that matches
  const mpWords = templateMarketplace.split(/\s+/);
  let result = templateName;
  for (const word of mpWords) {
    if (word.length < 3) continue; // skip short words like "AU"
    const wordRegex = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    result = result.replace(wordRegex, targetMarketplace);
    if (result !== templateName) break;
  }
  return result !== templateName ? result : `${targetMarketplace} ${templateName}`;
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

    let status: CoverageStatus;
    if (templates.length === 0) {
      status = 'uncovered';
      uncovered.push(mp);
    } else if (categories.length >= 3) {
      // At least Sales + Fees + one other = covered
      status = 'covered';
      covered.push(mp);
    } else {
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
