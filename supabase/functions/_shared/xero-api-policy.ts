/**
 * Xero API Policy & Rules Reference
 * ═══════════════════════════════════
 * Single source of truth for all Xero API constants, rate limits,
 * OAuth config, and endpoint patterns used by Xettle edge functions.
 *
 * Every Xero-related edge function MUST import from this file instead of
 * hardcoding endpoints, URLs, or auth headers.
 *
 * Sources:
 *   - https://developer.xero.com/documentation/api/accounting/overview
 *   - https://developer.xero.com/documentation/guides/oauth2/overview
 *   - https://developer.xero.com/documentation/best-practices/integration-health/rate-limits
 *   - https://developer.xero.com/documentation/api/accounting/invoices
 *   - https://developer.xero.com/documentation/api/accounting/payments
 *   - https://developer.xero.com/documentation/api/accounting/contacts
 *   - https://developer.xero.com/documentation/api/accounting/banktransactions
 */

// ═══════════════════════════════════════════════════════════════
// 1. Base URLs
// Xero uses URL-versioned API (2.0) — no rotation like Shopify.
// Version is embedded in the URL path, not as a header or query param.
// ═══════════════════════════════════════════════════════════════

/** Accounting API base URL (v2.0) */
export const XERO_API_BASE = 'https://api.xero.com/api.xro/2.0';

/** API version — embedded in URL, does NOT rotate on a schedule */
export const XERO_API_VERSION = '2.0';

// ═══════════════════════════════════════════════════════════════
// 2. OAuth URLs
// https://developer.xero.com/documentation/guides/oauth2/overview
// ═══════════════════════════════════════════════════════════════

/** OAuth2 authorization URL (user redirect) */
export const XERO_AUTH_URL = 'https://login.xero.com/identity/connect/authorize';

/** OAuth2 token endpoint (exchange code / refresh) */
export const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';

/** Connections endpoint (get tenant IDs after auth) */
export const XERO_CONNECTIONS_URL = 'https://api.xero.com/connections';

// ═══════════════════════════════════════════════════════════════
// 3. Token Configuration
// ═══════════════════════════════════════════════════════════════

/** Access token lifetime in seconds */
export const XERO_TOKEN_EXPIRY_SECONDS = 1800; // 30 minutes

/** Buffer before expiry to trigger proactive refresh (seconds) */
export const XERO_TOKEN_REFRESH_BUFFER_SECONDS = 60;

/** Buffer used in edge functions for preemptive refresh (ms) */
export const XERO_TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // 5 minutes — conservative

// ═══════════════════════════════════════════════════════════════
// 4. Rate Limits
// https://developer.xero.com/documentation/best-practices/integration-health/rate-limits
// ═══════════════════════════════════════════════════════════════

export const XERO_RATE_LIMITS = {
  /** Calls per minute per tenant (sliding window) */
  perMinute: 60,
  /** Calls per day per tenant */
  perDay: 5000,
  /** Xero returns 429 with Retry-After header — MUST respect it */
  retryAfterHeader: 'Retry-After',
  /** Default retry-after seconds if header is missing */
  defaultRetryAfterSeconds: 60,
  /** Min/max clamp for Retry-After parsing */
  minRetryAfterSeconds: 5,
  maxRetryAfterSeconds: 300,
} as const;

// ═══════════════════════════════════════════════════════════════
// 5. Required OAuth Scopes
// Final confirmed scopes — journals.read rejected by Xero for
// post-March 2026 apps.
// ═══════════════════════════════════════════════════════════════

export const XERO_REQUIRED_SCOPES = [
  'openid',
  'profile',
  'email',
  'offline_access',
  'accounting.invoices',
  'accounting.contacts',
  'accounting.settings',
  'accounting.settings.read',
  'accounting.banktransactions.read',
  'accounting.payments.read',
] as const;

export const XERO_SCOPES_STRING = XERO_REQUIRED_SCOPES.join(' ');

// ═══════════════════════════════════════════════════════════════
// 6. Xero-Specific Rules (documented for reference)
// ═══════════════════════════════════════════════════════════════

/**
 * IMPORTANT RULES:
 * 
 * 1. Token refresh uses Basic Auth header: btoa(clientId:clientSecret)
 * 2. tenant_id is MANDATORY on every API call — obtained from /connections after OAuth
 * 3. Xero returns 429 with Retry-After header — MUST respect it (0 retries on 429)
 * 4. Invoice references must be unique per tenant
 * 5. Xero uses page-based pagination via ?page=N (not cursor-based)
 * 6. Maximum 100 records per page for most endpoints
 * 7. Dates can be in .NET JSON format: /Date(1234567890000+0000)/
 * 8. Xero API version is URL-embedded (2.0) — does NOT rotate like Shopify
 */

// ═══════════════════════════════════════════════════════════════
// 7. Pagination
// ═══════════════════════════════════════════════════════════════

export const XERO_PAGINATION = {
  /** Max records per page for most endpoints */
  maxPerPage: 100,
  /** Pagination is page-based (?page=N), NOT cursor-based */
  type: 'page-based' as const,
} as const;

// ═══════════════════════════════════════════════════════════════
// 8. Deprecation Tracking
// ═══════════════════════════════════════════════════════════════

export const XERO_DEPRECATIONS = [
  {
    feature: 'journals.read scope',
    status: 'rejected',
    note: 'Xero rejects journals.read for post-March 2026 app registrations',
    since: '2026-03',
  },
] as const;

// ═══════════════════════════════════════════════════════════════
// 9. Helper Functions
// ═══════════════════════════════════════════════════════════════

/**
 * Build standard Xero API headers for authenticated requests.
 * Every Xero API call requires Authorization, Xero-Tenant-Id, and Accept.
 */
export function getXeroHeaders(accessToken: string, tenantId: string): Record<string, string> {
  return {
    'Authorization': `Bearer ${accessToken}`,
    'Xero-Tenant-Id': tenantId,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };
}

/**
 * Build a Xero API URL for a given resource.
 * Example: buildXeroUrl('Invoices') → 'https://api.xero.com/api.xro/2.0/Invoices'
 * Example: buildXeroUrl('Invoices', 'where=Status=="DRAFT"') → '...?where=Status=="DRAFT"'
 */
export function buildXeroUrl(resource: string, params?: string | URLSearchParams): string {
  const base = `${XERO_API_BASE}/${resource}`;
  if (!params) return base;
  const paramStr = typeof params === 'string' ? params : params.toString();
  return paramStr ? `${base}?${paramStr}` : base;
}

/**
 * Check if a Xero token is expired or expiring soon.
 * Uses the conservative 5-minute buffer used across Xettle functions.
 */
export function isXeroTokenExpired(expiresAt: string | Date, bufferMs: number = XERO_TOKEN_REFRESH_BUFFER_MS): boolean {
  const expiresAtMs = typeof expiresAt === 'string' ? new Date(expiresAt).getTime() : expiresAt.getTime();
  return expiresAtMs - Date.now() < bufferMs;
}

/**
 * Build Basic Auth header for token refresh requests.
 * Xero requires: Authorization: Basic btoa(clientId:clientSecret)
 */
export function buildXeroBasicAuth(clientId: string, clientSecret: string): string {
  return `Basic ${btoa(`${clientId}:${clientSecret}`)}`;
}

/**
 * Parse Xero's Retry-After header (integer seconds or HTTP-date).
 * Clamped to configured min/max range.
 */
export function parseXeroRetryAfter(header: string | null): number {
  const { defaultRetryAfterSeconds, minRetryAfterSeconds, maxRetryAfterSeconds } = XERO_RATE_LIMITS;
  if (!header) return defaultRetryAfterSeconds;

  const asInt = parseInt(header, 10);
  if (!isNaN(asInt) && String(asInt) === header.trim()) {
    return Math.max(minRetryAfterSeconds, Math.min(maxRetryAfterSeconds, asInt));
  }

  const dateMs = Date.parse(header);
  if (!isNaN(dateMs)) {
    const secondsUntil = Math.ceil((dateMs - Date.now()) / 1000);
    return Math.max(minRetryAfterSeconds, Math.min(maxRetryAfterSeconds, secondsUntil));
  }

  return defaultRetryAfterSeconds;
}

/**
 * Returns rate limit info for documentation / audit purposes.
 */
export function getXeroRateLimit() {
  return {
    perMinute: XERO_RATE_LIMITS.perMinute,
    perDay: XERO_RATE_LIMITS.perDay,
    note: 'Per tenant. Sliding window for minute limit. Xero returns 429 with Retry-After header.',
  };
}
