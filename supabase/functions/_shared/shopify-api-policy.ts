/**
 * Shopify API Policy & Rules Reference
 * ═════════════════════════════════════
 * Single source of truth for all Shopify API constants, rate limits,
 * scopes, auth patterns, and API versions used by Xettle edge functions.
 *
 * Every Shopify-related edge function MUST import from this file instead of
 * hardcoding endpoints, versions, or auth headers.
 *
 * Sources:
 *   - https://shopify.dev/docs/api/usage/versioning
 *   - https://shopify.dev/docs/api/usage/access-scopes
 *   - https://shopify.dev/docs/api/usage/rate-limits
 *   - https://shopify.dev/docs/api/admin-rest
 *   - https://shopify.dev/docs/api/admin-graphql/latest
 *   - https://shopify.dev/docs/apps/build/authentication-authorization
 */

// ═══════════════════════════════════════════════════════════════
// 1. API Version
// https://shopify.dev/docs/api/usage/versioning
// Shopify releases quarterly: YYYY-MM (01, 04, 07, 10)
// Each version supported for ~12 months after release.
// ═══════════════════════════════════════════════════════════════

/** Current stable API version used across all Xettle Shopify functions */
export const SHOPIFY_API_VERSION = '2026-01';

/** Next expected version (for planning) */
export const SHOPIFY_NEXT_VERSION = '2026-04';

/** Minimum supported version — anything older is auto-forwarded by Shopify */
export const SHOPIFY_MIN_SUPPORTED_VERSION = '2025-04';

// ═══════════════════════════════════════════════════════════════
// 2. Required Scopes
// https://shopify.dev/docs/api/usage/access-scopes
// ═══════════════════════════════════════════════════════════════

/** Scopes Xettle requires for its Shopify integration */
export const SHOPIFY_REQUIRED_SCOPES = [
  'read_fulfillments',
  'read_inventory',
  'read_orders',
  'read_products',
  'read_reports',
  'read_shopify_payments_accounts',
  'read_shopify_payments_payouts',
] as const;

/** Comma-separated scopes string for OAuth initiation */
export const SHOPIFY_SCOPES_STRING = SHOPIFY_REQUIRED_SCOPES.join(',');

// ═══════════════════════════════════════════════════════════════
// 3. Rate Limits
// https://shopify.dev/docs/api/usage/rate-limits
// ═══════════════════════════════════════════════════════════════

export const SHOPIFY_RATE_LIMITS = {
  rest: {
    /** Max requests in the bucket per app per store */
    bucketSize: 40,
    /** Leak rate: requests drained per second */
    leakRate: 2,
    /** Response header containing current usage */
    headerName: 'X-Shopify-Shop-Api-Call-Limit',
  },
  graphql: {
    /** Cost points available per second (Standard plan) */
    pointsPerSecond: 100,
    /** Maximum single query cost */
    maxQueryCost: 1000,
    /** Where throttle status lives in response */
    throttleStatusPath: 'extensions.cost.throttleStatus',
  },
} as const;

// ═══════════════════════════════════════════════════════════════
// 4. Pagination
// ═══════════════════════════════════════════════════════════════

/** Max items per page for REST endpoints */
export const SHOPIFY_MAX_PAGE_SIZE = 250;

/** Shopify hard limit on total objects via cursor pagination */
export const SHOPIFY_MAX_TOTAL_OBJECTS = 25_000;

// ═══════════════════════════════════════════════════════════════
// 5. Deprecation Notes
// ═══════════════════════════════════════════════════════════════

export const SHOPIFY_REST_DEPRECATION = {
  /** REST Admin API is legacy but still fully supported */
  isLegacy: true,
  /** GraphQL is the preferred API for new development */
  preferredAlternative: 'GraphQL Admin API',
  note: 'REST Admin API is legacy. GraphQL is preferred for new development. Both are still fully supported.',
} as const;

// ═══════════════════════════════════════════════════════════════
// 6. Helper Functions
// ═══════════════════════════════════════════════════════════════

/**
 * Returns standard headers for Shopify REST API calls.
 * https://shopify.dev/docs/apps/build/authentication-authorization
 */
export function getShopifyHeaders(accessToken: string): Record<string, string> {
  return {
    'X-Shopify-Access-Token': accessToken,
    'Content-Type': 'application/json',
  };
}

/**
 * Builds a canonical Shopify REST Admin API URL.
 * @param shopDomain - e.g. "my-store.myshopify.com"
 * @param resource  - e.g. "orders", "products", "shopify_payments/payouts"
 * @param params    - optional URLSearchParams or query string
 */
export function buildShopifyUrl(
  shopDomain: string,
  resource: string,
  params?: URLSearchParams | string,
): string {
  const base = `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/${resource}.json`;
  if (!params) return base;
  const qs = typeof params === 'string' ? params : params.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Builds the Shopify GraphQL Admin API endpoint URL.
 */
export function buildShopifyGraphqlUrl(shopDomain: string): string {
  return `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
}

/**
 * Parses the X-Shopify-Shop-Api-Call-Limit header.
 * @returns { used, available } or null if header is missing/malformed
 */
export function parseRateLimitHeader(
  header: string | null,
): { used: number; available: number } | null {
  if (!header) return null;
  const match = header.match(/^(\d+)\/(\d+)$/);
  if (!match) return null;
  return { used: parseInt(match[1], 10), available: parseInt(match[2], 10) };
}

/**
 * Returns true if the REST API bucket is approaching the rate limit.
 * @param header - value of X-Shopify-Shop-Api-Call-Limit header
 * @param threshold - percentage (0-1) at which to warn. Default 0.8 (80%)
 */
export function isApproachingRateLimit(header: string | null, threshold = 0.8): boolean {
  const parsed = parseRateLimitHeader(header);
  if (!parsed) return false;
  return parsed.used / parsed.available >= threshold;
}

/**
 * Extracts the next page URL from a Shopify Link header (cursor-based pagination).
 * @returns The next page URL or null if no next page
 */
export function getNextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
  return match ? match[1] : null;
}

/**
 * Logs a deprecation warning about REST being legacy.
 * Call this in functions that could benefit from GraphQL migration.
 */
export function warnIfRestLegacy(): void {
  console.warn(`[Shopify API] ${SHOPIFY_REST_DEPRECATION.note}`);
}
