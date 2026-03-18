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
 * Canonical display labels used for override keys (e.g. "Sales:Shopify").
 * Maps marketplace_code → the label used in persisted mapping keys.
 * This is the SINGLE SOURCE OF TRUTH for how marketplaces appear in mapping keys.
 */
export const CANONICAL_KEY_LABELS: Record<string, string> = {
  amazon_au: 'Amazon AU',
  amazon_us: 'Amazon USA',
  amazon_uk: 'Amazon UK',
  amazon_ca: 'Amazon CA',
  amazon_jp: 'Amazon JP',
  amazon_sg: 'Amazon SG',
  shopify_payments: 'Shopify',
  shopify_orders: 'Shopify',
  ebay_au: 'eBay AU',
  bunnings: 'Bunnings',
  catch: 'Catch',
  mydeal: 'MyDeal',
  kogan: 'Kogan',
  bigw: 'BigW',
  woolworths: 'Woolworths',
  woolworths_marketplus: 'Everyday Market',
  everyday_market: 'Everyday Market',
  theiconic: 'The Iconic',
  etsy: 'Etsy',
};

/**
 * Reverse map: display name variants → canonical key label.
 * Used when we have a marketplace_name string from connections/registry
 * and need to normalize it for override key generation.
 */
const DISPLAY_NAME_TO_KEY_LABEL: Record<string, string> = {
  'shopify payments': 'Shopify',
  'shopify': 'Shopify',
  'ebay australia': 'eBay AU',
  'ebay au': 'eBay AU',
  'bunnings marketplace': 'Bunnings',
  'bunnings': 'Bunnings',
  'big w marketplace': 'BigW',
  'big w': 'BigW',
  'bigw': 'BigW',
  'woolworths marketplace': 'Woolworths',
  'woolworths marketplus': 'Everyday Market',
  'everyday market': 'Everyday Market',
  'mydeal marketplace': 'MyDeal',
  'mydeal': 'MyDeal',
  'my deal': 'MyDeal',
  'kogan marketplace': 'Kogan',
  'kogan': 'Kogan',
  'catch marketplace': 'Catch',
  'catch': 'Catch',
  'the iconic': 'The Iconic',
  'theiconic': 'The Iconic',
  'etsy': 'Etsy',
  'amazon au': 'Amazon AU',
  'amazon usa': 'Amazon USA',
  'amazon uk': 'Amazon UK',
  'amazon ca': 'Amazon CA',
  'amazon jp': 'Amazon JP',
  'amazon sg': 'Amazon SG',
  'amazon.com.au': 'Amazon AU',
  'amazon.com': 'Amazon USA',
  'amazon.co.uk': 'Amazon UK',
};

/**
 * Normalize a marketplace display name OR code to the canonical key label
 * used in override keys (e.g. "Sales:Shopify").
 *
 * Tries: marketplace_code lookup → display name lookup → passthrough.
 */
export function normalizeKeyLabel(nameOrCode: string): string {
  if (!nameOrCode) return nameOrCode;
  const trimmed = nameOrCode.trim();

  // Try direct code lookup first
  if (CANONICAL_KEY_LABELS[trimmed]) return CANONICAL_KEY_LABELS[trimmed];

  // Try display name lookup (case-insensitive)
  const lower = trimmed.toLowerCase();
  if (DISPLAY_NAME_TO_KEY_LABEL[lower]) return DISPLAY_NAME_TO_KEY_LABEL[lower];

  // Try normalizing the code
  const normalizedCode = normalizeMarketplaceCode(trimmed);
  if (CANONICAL_KEY_LABELS[normalizedCode]) return CANONICAL_KEY_LABELS[normalizedCode];

  // Passthrough
  return trimmed;
}

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
