/**
 * Canonical marketplace code normalization.
 * Single source of truth for alias resolution.
 */

export const MARKETPLACE_ALIASES: Record<string, string> = {
  ebay: 'ebay_au',
  'ebay-au': 'ebay_au',
  'ebay australia': 'ebay_au',
  amazon: 'amazon_au',
  'amazon-au': 'amazon_au',
  'amazon australia': 'amazon_au',
  shopify: 'shopify_payments',
  'shopify-payments': 'shopify_payments',
};

/**
 * Normalize a marketplace code to its canonical form.
 * Trims, lowercases, and resolves known aliases.
 */
export function normalizeMarketplaceCode(code: string): string {
  const normalized = (code || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return MARKETPLACE_ALIASES[normalized] || normalized;
}

/**
 * Check if two marketplace codes refer to the same marketplace
 * after normalization and alias resolution.
 */
export function isMarketplaceAlias(codeA: string, codeB: string): boolean {
  return normalizeMarketplaceCode(codeA) === normalizeMarketplaceCode(codeB);
}

/**
 * Check if a candidate code is a near-duplicate of any existing codes.
 * Returns the matched existing code if found, null otherwise.
 */
export function findNearDuplicate(
  candidateCode: string,
  existingCodes: string[],
  existingNames?: string[]
): string | null {
  const normalizedCandidate = normalizeMarketplaceCode(candidateCode);

  for (const existing of existingCodes) {
    if (normalizeMarketplaceCode(existing) === normalizedCandidate) {
      return existing;
    }
  }

  // Check name-based near-matches (e.g., "eBay" in "eBay Australia")
  if (existingNames) {
    const candidateLower = candidateCode.toLowerCase().replace(/[_\-]/g, ' ');
    for (let i = 0; i < existingNames.length; i++) {
      const nameLower = existingNames[i].toLowerCase();
      if (
        nameLower.includes(candidateLower) ||
        candidateLower.includes(nameLower)
      ) {
        return existingCodes[i];
      }
    }
  }

  return null;
}
