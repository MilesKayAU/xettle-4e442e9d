/**
 * CoA Intelligence — Chart of Accounts analysis for marketplace detection
 *
 * Analyses cached Xero Chart of Accounts to detect likely marketplaces,
 * payment providers, and suggest account mappings.
 *
 * Uses marketplace_registry and payment_processor_registry detection_keywords
 * from the database — no hardcoded marketplace lists.
 */

// ══════════════════════════════════════════════════════════════
// XETTLE_COA_RULES (hardcoded, never configurable)
//
// Xettle may read the user's Chart of Accounts.
// Xettle may use account names as signals for marketplace detection.
// Xettle may suggest mappings based on those signals.
//
// Xettle must NEVER:
// - create accounts in Xero
// - rename accounts in Xero
// - modify account codes
// - automatically save mappings
// - assume account numbers (e.g. 200 = Sales)
//
// The user's Chart of Accounts is read-only.
// Xettle adapts to the user's accounting structure.
// ══════════════════════════════════════════════════════════════

export const XETTLE_COA_RULES = {
  COA_IS_READ_ONLY: true,
  NEVER_CREATE_XERO_ACCOUNTS: true,
  NEVER_RENAME_XERO_ACCOUNTS: true,
  NEVER_MODIFY_ACCOUNT_CODES: true,
  NEVER_AUTO_SAVE_MAPPINGS: true,
  NEVER_ASSUME_ACCOUNT_NUMBERS: true,
} as const;

// ─── Types ──────────────────────────────────────────────────────

export type Confidence = 'HIGH' | 'MEDIUM' | 'LOW';

export interface ChannelSuggestion {
  marketplace_code: string;
  marketplace_name: string;
  confidence: Confidence;
  detected_account: string;
  account_code: string;
}

export interface ProviderSuggestion {
  provider_code: string;
  provider_name: string;
  confidence: Confidence;
  detected_account: string;
  account_code: string;
}

export interface MappingSuggestion {
  category: string;
  account_code: string;
  account_name: string;
  marketplace_code: string;
  confidence: Confidence;
}

export interface DetectedSignals {
  channels: ChannelSuggestion[];
  payment_providers: ProviderSuggestion[];
  mapping_suggestions: MappingSuggestion[];
}

export interface CoaAccount {
  account_code: string | null;
  account_name: string;
  account_type: string | null;
  tax_type: string | null;
}

export interface RegistryEntry {
  marketplace_code: string;
  marketplace_name: string;
  detection_keywords: any;
}

export interface ProcessorEntry {
  processor_code: string;
  processor_name: string;
  detection_keywords: any;
}

// ─── Normalization ──────────────────────────────────────────────

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}

// ─── Category detection keywords ────────────────────────────────
// IMPORTANT: Order matters! Most specific categories first.
// Matching is exclusive: first category match wins per account+marketplace.
const CATEGORY_KEYWORDS_ORDERED: [string, string[]][] = [
  ['reimbursements', ['reimbursement', 'reimbursment']], // includes common typo
  ['fba_fees', ['fba', 'fulfilment', 'fulfillment', 'pick pack']],
  ['storage_fees', ['storage', 'warehouse', 'inventory storage']],
  ['advertising', ['advertising', 'sponsored', 'ppc', 'ad spend', 'campaign']],
  ['refunds', ['refund', 'return']],
  ['shipping', ['shipping', 'freight', 'postage', 'delivery']],
  ['promotional_discounts', ['discount', 'promotion', 'voucher', 'coupon']],
  ['sales', ['sales', 'revenue', 'income']],
  ['seller_fees', ['seller fee', 'referral fee', 'selling fee', 'commission', 'fees']],
  ['other_fees', ['adjustment', 'charge', 'miscellaneous', 'other fee', 'reserved']],
];

// ─── Account type compatibility ─────────────────────────────────
const REVENUE_CATEGORIES = new Set(['sales', 'shipping', 'promotional_discounts', 'refunds', 'reimbursements']);
const REVENUE_TYPES = new Set(['REVENUE', 'SALES', 'OTHERINCOME', 'DIRECTCOSTS']);
const EXPENSE_TYPES = new Set(['EXPENSE', 'OVERHEADS', 'DIRECTCOSTS', 'CURRLIAB', 'LIABILITY']);

function isTypeCompatible(category: string, accountType: string | null): boolean {
  if (!accountType) return true; // no type info, allow it
  const upper = accountType.toUpperCase();
  const validTypes = REVENUE_CATEGORIES.has(category) ? REVENUE_TYPES : EXPENSE_TYPES;
  return validTypes.has(upper);
}


export function analyseCoA(
  accounts: CoaAccount[],
  registryEntries: RegistryEntry[],
  processorEntries: ProcessorEntry[],
): DetectedSignals {
  const channels: ChannelSuggestion[] = [];
  const payment_providers: ProviderSuggestion[] = [];
  const mapping_suggestions: MappingSuggestion[] = [];

  // Track already-detected to avoid duplicates
  const detectedMarketplaces = new Set<string>();
  const detectedProviders = new Set<string>();

  // Build a lookup of marketplace_code → keywords for use in mapping suggestions
  const marketplaceKeywordsMap = new Map<string, string[]>();
  for (const entry of registryEntries) {
    const keywords = (entry.detection_keywords || []) as string[];
    const normalizedKeywords = keywords
      .map(k => normalize(k))
      .filter(k => k.length >= 3);
    // Always include the marketplace name parts as keywords
    const nameParts = normalize(entry.marketplace_name).split(' ').filter(p => p.length >= 3);
    const allKeywords = [...new Set([...normalizedKeywords, ...nameParts])];
    marketplaceKeywordsMap.set(entry.marketplace_code, allKeywords);
  }

  for (const account of accounts) {
    const normalizedName = normalize(account.account_name);

    // ─── Marketplace detection ────────────────────────────────
    for (const entry of registryEntries) {
      if (detectedMarketplaces.has(entry.marketplace_code)) continue;

      const keywords = (entry.detection_keywords || []) as string[];
      if (keywords.length === 0) continue;

      const normalizedMarketplace = normalize(entry.marketplace_name);

      // HIGH: marketplace name appears directly
      if (normalizedName.includes(normalizedMarketplace)) {
        channels.push({
          marketplace_code: entry.marketplace_code,
          marketplace_name: entry.marketplace_name,
          confidence: 'HIGH',
          detected_account: account.account_name,
          account_code: account.account_code || '',
        });
        detectedMarketplaces.add(entry.marketplace_code);
        break;
      }

      // Check detection keywords
      for (const keyword of keywords) {
        const normalizedKeyword = normalize(keyword);
        if (normalizedKeyword.length < 3) continue;

        if (normalizedName.includes(normalizedKeyword)) {
          // HIGH if keyword is the marketplace name itself, MEDIUM otherwise
          const isDirectName = normalizedKeyword === normalizedMarketplace;
          const confidence: Confidence = isDirectName ? 'HIGH' : 'MEDIUM';

          channels.push({
            marketplace_code: entry.marketplace_code,
            marketplace_name: entry.marketplace_name,
            confidence,
            detected_account: account.account_name,
            account_code: account.account_code || '',
          });
          detectedMarketplaces.add(entry.marketplace_code);
          break;
        }
      }
    }

    // ─── Payment provider detection ───────────────────────────
    for (const processor of processorEntries) {
      if (detectedProviders.has(processor.processor_code)) continue;

      const keywords = (processor.detection_keywords || []) as string[];
      const normalizedProcessor = normalize(processor.processor_name);

      if (normalizedName.includes(normalizedProcessor)) {
        payment_providers.push({
          provider_code: processor.processor_code,
          provider_name: processor.processor_name,
          confidence: 'HIGH',
          detected_account: account.account_name,
          account_code: account.account_code || '',
        });
        detectedProviders.add(processor.processor_code);
        continue;
      }

      for (const keyword of keywords) {
        const normalizedKeyword = normalize(keyword);
        if (normalizedKeyword.length < 3) continue;

        if (normalizedName.includes(normalizedKeyword)) {
          payment_providers.push({
            provider_code: processor.processor_code,
            provider_name: processor.processor_name,
            confidence: normalizedKeyword === normalizedProcessor ? 'HIGH' : 'MEDIUM',
            detected_account: account.account_name,
            account_code: account.account_code || '',
          });
          detectedProviders.add(processor.processor_code);
          break;
        }
      }
    }

    // ─── Mapping suggestions ──────────────────────────────────
    // For each detected marketplace, check if this account matches via
    // full name OR any detection keyword (not just the full marketplace name)
    for (const detected of channels) {
      const marketplaceNorm = normalize(detected.marketplace_name);
      const keywords = marketplaceKeywordsMap.get(detected.marketplace_code) || [];

      // Check if account name contains the full marketplace name OR any keyword
      const matchesFull = normalizedName.includes(marketplaceNorm);
      const matchesKeyword = !matchesFull && keywords.some(kw => normalizedName.includes(kw));

      if (!matchesFull && !matchesKeyword) continue;

      // Determine confidence: full name match = HIGH, keyword match = MEDIUM
      const baseConfidence: Confidence = matchesFull ? 'HIGH' : 'MEDIUM';

      // Find the BEST (most specific) category match — first match wins
      let matchedCategory: string | null = null;
      for (const [category, catKeywords] of CATEGORY_KEYWORDS_ORDERED) {
        for (const kw of catKeywords) {
          if (normalizedName.includes(kw)) {
            matchedCategory = category;
            break;
          }
        }
        if (matchedCategory) break;
      }

      if (matchedCategory) {
        // Avoid duplicate suggestions for same marketplace+category
        const exists = mapping_suggestions.some(
          ms => ms.marketplace_code === detected.marketplace_code
            && ms.category === matchedCategory
        );
        if (!exists) {
          mapping_suggestions.push({
            category: matchedCategory,
            account_code: account.account_code || '',
            account_name: account.account_name,
            marketplace_code: detected.marketplace_code,
            confidence: baseConfidence,
          });
        }
      }
    }
  }

  return { channels, payment_providers, mapping_suggestions };
}

/**
 * Filter signals to only HIGH confidence results for auto-suggestion.
 */
export function getHighConfidenceChannels(signals: DetectedSignals): ChannelSuggestion[] {
  return signals.channels.filter(c => c.confidence === 'HIGH');
}

export function getMediumConfidenceChannels(signals: DetectedSignals): ChannelSuggestion[] {
  return signals.channels.filter(c => c.confidence === 'MEDIUM');
}
