/**
 * Amazon SP-API Policy & Rules Reference
 * ═══════════════════════════════════════
 * Single source of truth for all Amazon SP-API constants, rate limits,
 * marketplace IDs, auth patterns, and API versions used by Xettle edge functions.
 *
 * Every Amazon-related edge function MUST import from this file instead of
 * hardcoding endpoints, marketplace IDs, or auth URLs.
 *
 * Sources:
 *   - https://developer-docs.amazon.com/sp-api/docs/sp-api-endpoints
 *   - https://developer-docs.amazon.com/sp-api/docs/marketplace-ids
 *   - https://developer-docs.amazon.com/sp-api/docs/connecting-to-the-selling-partner-api
 *   - https://developer-docs.amazon.com/sp-api/docs/orders-api-v0-reference (deprecated)
 *   - https://developer-docs.amazon.com/sp-api/docs/orders-api-v2026-reference
 *   - https://developer-docs.amazon.com/sp-api/docs/finances-api-reference-v2024
 *   - https://developer-docs.amazon.com/sp-api/docs/tokens-api-use-case-guide
 */

// ═══════════════════════════════════════════════════════════════
// 1. Regional SP-API Endpoints
// https://developer-docs.amazon.com/sp-api/docs/sp-api-endpoints
// ═══════════════════════════════════════════════════════════════

export const SP_API_ENDPOINTS: Record<string, string> = {
  na: 'https://sellingpartnerapi-na.amazon.com',
  eu: 'https://sellingpartnerapi-eu.amazon.com',
  fe: 'https://sellingpartnerapi-fe.amazon.com',
};

/** Returns the SP-API base URL for a given region code. Defaults to 'fe'. */
export function getEndpointForRegion(region: string): string {
  return SP_API_ENDPOINTS[region] || SP_API_ENDPOINTS.fe;
}

// ═══════════════════════════════════════════════════════════════
// 2. Marketplace IDs → Region mapping
// https://developer-docs.amazon.com/sp-api/docs/marketplace-ids
// ═══════════════════════════════════════════════════════════════

export interface MarketplaceInfo {
  marketplaceId: string;
  region: string;
  country: string;
  domain: string;
}

export const MARKETPLACE_REGISTRY: Record<string, MarketplaceInfo> = {
  // Far East (fe)
  AU: { marketplaceId: 'A39IBJ37TRP1C6', region: 'fe', country: 'Australia', domain: 'amazon.com.au' },
  JP: { marketplaceId: 'A1VC38T7YXB528', region: 'fe', country: 'Japan', domain: 'amazon.co.jp' },
  SG: { marketplaceId: 'A19VAU5U5O7RUS', region: 'fe', country: 'Singapore', domain: 'amazon.sg' },
  IN: { marketplaceId: 'A21TJRUUN4KGV', region: 'fe', country: 'India', domain: 'amazon.in' },

  // North America (na)
  US: { marketplaceId: 'ATVPDKIKX0DER', region: 'na', country: 'United States', domain: 'amazon.com' },
  CA: { marketplaceId: 'A2EUQ1WTGCTBG2', region: 'na', country: 'Canada', domain: 'amazon.ca' },
  MX: { marketplaceId: 'A1AM78C64UM0Y8', region: 'na', country: 'Mexico', domain: 'amazon.com.mx' },
  BR: { marketplaceId: 'A2Q3Y263D00KWC', region: 'na', country: 'Brazil', domain: 'amazon.com.br' },

  // Europe (eu)
  UK: { marketplaceId: 'A1F83G8C2ARO7P', region: 'eu', country: 'United Kingdom', domain: 'amazon.co.uk' },
  DE: { marketplaceId: 'A1PA6795UKMFR9', region: 'eu', country: 'Germany', domain: 'amazon.de' },
  FR: { marketplaceId: 'A13V1IB3VIYZZH', region: 'eu', country: 'France', domain: 'amazon.fr' },
  IT: { marketplaceId: 'APJ6JRA9NG5V4', region: 'eu', country: 'Italy', domain: 'amazon.it' },
  ES: { marketplaceId: 'A1RKKUPIHCS9HS', region: 'eu', country: 'Spain', domain: 'amazon.es' },
  NL: { marketplaceId: 'A1805IZSGTT6HS', region: 'eu', country: 'Netherlands', domain: 'amazon.nl' },
  SE: { marketplaceId: 'A2NODRKZP88ZB9', region: 'eu', country: 'Sweden', domain: 'amazon.se' },
  PL: { marketplaceId: 'A1C3SOZRARQ6R3', region: 'eu', country: 'Poland', domain: 'amazon.pl' },
  AE: { marketplaceId: 'A2VIGQ35RCS4UG', region: 'eu', country: 'United Arab Emirates', domain: 'amazon.ae' },
  TR: { marketplaceId: 'A33AVAJ2PDY3EV', region: 'eu', country: 'Turkey', domain: 'amazon.com.tr' },
};

/** Reverse lookup: Amazon marketplace ID → region code */
export function getMarketplaceRegion(marketplaceId: string): string {
  for (const info of Object.values(MARKETPLACE_REGISTRY)) {
    if (info.marketplaceId === marketplaceId) return info.region;
  }
  return 'fe'; // default for AU-focused app
}

// ═══════════════════════════════════════════════════════════════
// 3. LWA (Login With Amazon) Auth Constants
// https://developer-docs.amazon.com/sp-api/docs/connecting-to-the-selling-partner-api
// ═══════════════════════════════════════════════════════════════

export const LWA = {
  /** Token endpoint for all grant types */
  TOKEN_URL: 'https://api.amazon.com/auth/o2/token',
  /** LWA access tokens expire after this many seconds */
  TOKEN_LIFETIME_SECONDS: 3600,
  /** Refresh token early by this many ms to avoid edge-case expiry */
  TOKEN_EXPIRY_BUFFER_MS: 60_000,
  GRANT_TYPES: {
    AUTHORIZATION_CODE: 'authorization_code',
    REFRESH_TOKEN: 'refresh_token',
  },
} as const;

/** Check if an ISO token expiry timestamp is expired (with configurable buffer). */
export function isTokenExpired(expiresAt: string | null, bufferMs = LWA.TOKEN_EXPIRY_BUFFER_MS): boolean {
  if (!expiresAt) return true;
  return new Date(expiresAt).getTime() <= Date.now() + bufferMs;
}

// ═══════════════════════════════════════════════════════════════
// 4. API Version Registry
// ═══════════════════════════════════════════════════════════════

export const API_VERSIONS = {
  orders: {
    /** Currently in use across Xettle (stable, but deprecated by Amazon) */
    current: 'v0',
    /** Amazon's replacement — uses searchOrders instead of getOrders */
    latest: 'v2026-01-01',
    deprecated: true,
    migrationNote: 'Orders v0 is deprecated. Migrate to v2026-01-01 (searchOrders). See: https://developer-docs.amazon.com/sp-api/docs/orders-api-v2026-reference',
  },
  finances: {
    current: 'v0',
    latest: 'v2024-06-19',
    deprecated: true,
    migrationNote: 'Finances v0 is legacy. Migrate to v2024-06-19 (listTransactions). See: https://developer-docs.amazon.com/sp-api/docs/finances-api-reference-v2024',
  },
  tokens: {
    current: '2021-03-01',
    latest: '2021-03-01',
    deprecated: false,
    migrationNote: null,
  },
} as const;

// ═══════════════════════════════════════════════════════════════
// 5. Rate Limits (Token Bucket Algorithm)
// https://developer-docs.amazon.com/sp-api/docs/usage-plans-and-rate-limits
// ═══════════════════════════════════════════════════════════════

export interface RateLimit {
  /** Sustained requests per second */
  rate: number;
  /** Maximum burst size */
  burst: number;
}

export const RATE_LIMITS: Record<string, RateLimit> = {
  // Orders API v0
  'getOrders': { rate: 0.0167, burst: 20 },
  'getOrder': { rate: 0.5, burst: 30 },
  'getOrderItems': { rate: 0.5, burst: 30 },
  'getOrderAddress': { rate: 0.5, burst: 30 },
  'getOrderBuyerInfo': { rate: 0.5, burst: 30 },

  // Orders API v2026-01-01
  'searchOrders': { rate: 0.0167, burst: 20 },

  // Finances API v0
  'listFinancialEventGroups': { rate: 0.5, burst: 30 },
  'listFinancialEvents': { rate: 0.5, burst: 30 },

  // Finances API v2024-06-19
  'listTransactions': { rate: 0.5, burst: 30 },

  // Tokens API
  'createRestrictedDataToken': { rate: 1, burst: 10 },
};

/** Get rate limit for an SP-API operation. Returns null if unknown. */
export function getRateLimit(operation: string): RateLimit | null {
  return RATE_LIMITS[operation] ?? null;
}

// ═══════════════════════════════════════════════════════════════
// 6. Required Headers
// https://developer-docs.amazon.com/sp-api/docs/include-a-user-agent-header
// ═══════════════════════════════════════════════════════════════

const APP_NAME = 'Xettle';
const APP_VERSION = '1.0';
const PLATFORM = 'Deno';

/**
 * Build a compliant SP-API user-agent string (max 500 chars).
 * Format: AppName/Version (Language=Deno; Platform=Lovable)
 */
export function buildUserAgent(): string {
  return `${APP_NAME}/${APP_VERSION} (Language=${PLATFORM}; Platform=Lovable)`;
}

/**
 * Returns the standard headers required for every SP-API call.
 * Caller must supply the access token.
 */
export function getSpApiHeaders(accessToken: string): Record<string, string> {
  return {
    'x-amz-access-token': accessToken,
    'user-agent': buildUserAgent(),
    'Content-Type': 'application/json',
  };
}

// ═══════════════════════════════════════════════════════════════
// 7. PII / Restricted Data Token (RDT) Rules
// https://developer-docs.amazon.com/sp-api/docs/tokens-api-use-case-guide
// ═══════════════════════════════════════════════════════════════

/** Operations that require a Restricted Data Token for PII access */
export const RDT_REQUIRED_OPERATIONS = [
  'getOrderAddress',
  'getOrderBuyerInfo',
  'getOrderItemsBuyerInfo',
] as const;

/** Check if an operation requires an RDT */
export function requiresRdt(operation: string): boolean {
  return (RDT_REQUIRED_OPERATIONS as readonly string[]).includes(operation);
}

// ═══════════════════════════════════════════════════════════════
// 8. Order History Limits
// ═══════════════════════════════════════════════════════════════

/** Marketplaces that support order retrieval back to 2016 (vs standard 2 years) */
export const EXTENDED_HISTORY_MARKETPLACES = ['AU', 'SG', 'JP'] as const;

/** Returns the earliest date from which orders can be retrieved for a marketplace */
export function getOrderHistoryStart(marketplaceCode: string): Date {
  if ((EXTENDED_HISTORY_MARKETPLACES as readonly string[]).includes(marketplaceCode.toUpperCase())) {
    return new Date('2016-01-01T00:00:00Z');
  }
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  return twoYearsAgo;
}

// ═══════════════════════════════════════════════════════════════
// 9. Seller Central Auth URLs (per-region)
// ═══════════════════════════════════════════════════════════════

export const SELLER_CENTRAL_AUTH_URLS: Record<string, string> = {
  fe: 'https://sellercentral.amazon.com.au/apps/authorize/consent',
  na: 'https://sellercentral.amazon.com/apps/authorize/consent',
  eu: 'https://sellercentral-europe.amazon.com/apps/authorize/consent',
};

// ═══════════════════════════════════════════════════════════════
// 10. Deprecation Warning Helper
// ═══════════════════════════════════════════════════════════════

/**
 * Log a deprecation warning when using a deprecated API version.
 * Call this at the top of any function that still uses v0 APIs.
 */
export function warnIfDeprecated(apiName: keyof typeof API_VERSIONS): void {
  const info = API_VERSIONS[apiName];
  if (info.deprecated && info.migrationNote) {
    console.warn(`[SP-API DEPRECATION] ${info.migrationNote}`);
  }
}
