/**
 * Shopify API Policy & Rules Reference
 * ═════════════════════════════════════
 * Single source of truth for all Shopify API constants, rate limits,
 * scopes, auth patterns, and API versions used by Xettle edge functions.
 *
 * Every Shopify-related edge function MUST import from this file instead of
 * hardcoding endpoints, versions, or auth headers.
 *
 * Last verified: 2026-03-20
 *
 * Sources:
 *   - https://shopify.dev/docs/api/usage/versioning
 *   - https://shopify.dev/docs/api/usage/access-scopes
 *   - https://shopify.dev/docs/api/usage/rate-limits
 *   - https://shopify.dev/docs/api/admin-rest
 *   - https://shopify.dev/docs/api/admin-graphql/latest
 *   - https://shopify.dev/docs/apps/build/authentication-authorization
 *   - https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant
 */

// ═══════════════════════════════════════════════════════════════
// 1. API Version
// https://shopify.dev/docs/api/usage/versioning
// Shopify releases quarterly: YYYY-MM (01, 04, 07, 10)
// Each version supported for 12 months after release.
// Stable versions released at 5pm UTC on release date.
// ═══════════════════════════════════════════════════════════════

/** Current stable API version used across all Xettle Shopify functions */
export const SHOPIFY_API_VERSION = '2026-01';

/** Next version — releasing April 1, 2026 */
export const SHOPIFY_NEXT_VERSION = '2026-04';

/** Minimum supported version (supported until Apr 1, 2026) */
export const SHOPIFY_MIN_SUPPORTED_VERSION = '2025-04';

/**
 * Supported stable versions as of March 2026:
 *   2025-04 → supported until Apr 1, 2026
 *   2025-07 → supported until Jul 1, 2026
 *   2025-10 → supported until Oct 1, 2026
 *   2026-01 → supported until Jan 1, 2027  ← WE USE THIS
 *   2026-04-rc → release candidate available now
 */

// ═══════════════════════════════════════════════════════════════
// 2. REST vs GraphQL Status
// ═══════════════════════════════════════════════════════════════

export const SHOPIFY_API_STATUS = {
  /**
   * REST Admin API designated "legacy" on Oct 1, 2024.
   * - Since Apr 1, 2025: all NEW public & custom apps MUST use GraphQL.
   * - Existing apps may continue using REST until full sunset (TBA).
   * - REST is still functional but receives no new features.
   * - Product/variant REST endpoints already deprecated; must use GraphQL.
   */
  restIsLegacy: true,
  restLegacyDate: '2024-10-01',
  graphqlMandatoryForNewApps: '2025-04-01',
  /**
   * Full REST sunset date not yet announced by Shopify.
   * Plan migration to GraphQL for all endpoints.
   */
  fullRestSunsetDate: null as string | null,
  preferredApi: 'GraphQL Admin API' as const,
} as const;

// ═══════════════════════════════════════════════════════════════
// 3. Authentication Patterns (2026)
// ═══════════════════════════════════════════════════════════════

/**
 * CRITICAL — Shopify authentication has changed in 2026:
 *
 * OLD (pre-2026): Custom Apps created in Shopify Admin could
 * "reveal" a permanent access token (shpat_...). This flow
 * NO LONGER EXISTS. You cannot create Custom Apps from the
 * Shopify Admin anymore.
 *
 * NEW (2026): All apps are created via the Dev Dashboard
 * (https://partners.shopify.com or merchant Dev Dashboard).
 *
 * For server-to-server / internal apps (like XettleInternal):
 *   → Use client_credentials grant
 *   → Tokens expire every 24 hours
 *   → No permanent token to "reveal" or store
 *   → Must request fresh token via POST to shop's oauth endpoint
 *
 * For partner/public apps:
 *   → Use authorization code grant or token exchange
 *   → Standard OAuth flow unchanged
 *
 * Reference: https://shopify.dev/docs/apps/build/authentication-authorization/access-tokens/client-credentials-grant
 */
export const SHOPIFY_AUTH = {
  /**
   * Client credentials grant (Dev Dashboard apps / internal apps).
   * - Only for apps installed on stores owned by the same org.
   * - Tokens expire after 24 hours.
   * - No refresh token — just request a new one.
   * - Scopes configured in Dev Dashboard app version config.
   */
  clientCredentials: {
    grantType: 'client_credentials' as const,
    /** POST https://{shop}/admin/oauth/access_token */
    tokenEndpointPattern: 'https://{shop_domain}/admin/oauth/access_token',
    contentType: 'application/x-www-form-urlencoded',
    /** Tokens are valid for ~24 hours */
    tokenLifetimeHours: 24,
    /** We cache for 23h to avoid edge-case expiry */
    recommendedCacheHours: 23,
    /**
     * Required env vars for client_credentials:
     *   SHOPIFY_INTERNAL_CLIENT_ID
     *   SHOPIFY_INTERNAL_CLIENT_SECRET
     */
    requiredSecrets: ['SHOPIFY_INTERNAL_CLIENT_ID', 'SHOPIFY_INTERNAL_CLIENT_SECRET'] as const,
  },

  /**
   * Legacy stored tokens (shpat_... or shpca_...) in shopify_tokens table.
   * These may still exist from old Custom App installs but should NOT be
   * used for operations requiring scopes added after the token was generated.
   * The Fulfillment Bridge (FBM sync) MUST use client_credentials only.
   */
  legacyStoredTokenWarning:
    'Stored shopify_tokens access_tokens are from legacy Custom App installs. ' +
    'Do NOT use them for write operations — use client_credentials grant instead.',
} as const;

// ═══════════════════════════════════════════════════════════════
// 4. Required Scopes
// https://shopify.dev/docs/api/usage/access-scopes
// ═══════════════════════════════════════════════════════════════

/** Read-only scopes for settlement/order/payout sync */
export const SHOPIFY_READ_SCOPES = [
  'read_fulfillments',
  'read_inventory',
  'read_orders',
  'read_products',
  'read_reports',
  'read_shopify_payments_accounts',
  'read_shopify_payments_payouts',
] as const;

/** Write scopes needed for FBM bridge (creating orders in Shopify) */
export const SHOPIFY_WRITE_SCOPES = [
  'write_orders',
  'write_draft_orders',
] as const;

/** All scopes Xettle requires across its integrations */
export const SHOPIFY_REQUIRED_SCOPES = [
  ...SHOPIFY_READ_SCOPES,
  ...SHOPIFY_WRITE_SCOPES,
] as const;

/** Comma-separated scopes string for OAuth initiation */
export const SHOPIFY_SCOPES_STRING = SHOPIFY_REQUIRED_SCOPES.join(',');

// ═══════════════════════════════════════════════════════════════
// 5. Rate Limits
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
// 6. Pagination
// ═══════════════════════════════════════════════════════════════

/** Max items per page for REST endpoints */
export const SHOPIFY_MAX_PAGE_SIZE = 250;

/** Shopify hard limit on total objects via cursor pagination */
export const SHOPIFY_MAX_TOTAL_OBJECTS = 25_000;

// ═══════════════════════════════════════════════════════════════
// 7. Helper Functions
// ═══════════════════════════════════════════════════════════════

/**
 * Returns standard headers for Shopify REST API calls.
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
 * Builds the token endpoint URL for client_credentials grant.
 */
export function buildTokenUrl(shopDomain: string): string {
  return `https://${shopDomain}/admin/oauth/access_token`;
}

/**
 * Requests a fresh access token via the client_credentials grant.
 * For Dev Dashboard / internal apps only (e.g. XettleInternal).
 * Tokens expire after ~24 hours.
 *
 * @returns access_token string
 * @throws on grant failure
 */
export async function requestClientCredentialsToken(
  shopDomain: string,
  clientId: string,
  clientSecret: string,
): Promise<string> {
  const tokenUrl = buildTokenUrl(shopDomain);
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(
      `Shopify client_credentials grant failed (${response.status}): ${errText.slice(0, 300)}`
    );
  }

  const data = await response.json();
  if (!data.access_token) {
    throw new Error('Shopify client_credentials grant returned no access_token');
  }

  return data.access_token;
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
