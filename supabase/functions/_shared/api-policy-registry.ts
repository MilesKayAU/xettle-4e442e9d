/**
 * Master API Policy Registry
 * ═══════════════════════════
 * Wraps all four API policies (Amazon SP-API, Shopify, Xero, Mirakl) into a
 * single registry for health checks, deprecation audits, and version tracking.
 *
 * Usage:
 *   import { API_REGISTRY, getApiHealth, getAllDeprecationWarnings } from '../_shared/api-policy-registry.ts'
 */

import {
  SP_API_ENDPOINTS,
  RATE_LIMITS as AMAZON_RATE_LIMITS,
  API_VERSIONS as AMAZON_API_VERSIONS,
  SIGNING_SERVICE,
  SIGNING_REGIONS,
} from './amazon-sp-api-policy.ts';

import {
  SHOPIFY_API_VERSION,
  SHOPIFY_NEXT_VERSION,
  SHOPIFY_REST_RATE_LIMITS,
  SHOPIFY_GRAPHQL_RATE_LIMITS,
  SHOPIFY_REQUIRED_SCOPES,
} from './shopify-api-policy.ts';

import {
  XERO_API_BASE,
  XERO_API_VERSION,
  XERO_TOKEN_URL,
  XERO_RATE_LIMITS,
  XERO_REQUIRED_SCOPES,
  XERO_DEPRECATIONS,
} from './xero-api-policy.ts';

import {
  MIRAKL_AUTH_URL,
  MIRAKL_MARKETPLACE_ENDPOINTS,
  MIRAKL_RATE_LIMITS,
  MIRAKL_DEPRECATIONS,
  MIRAKL_API_VERSION,
  MIRAKL_POWERED_MARKETPLACES,
} from './mirakl-api-policy.ts';

// ═══════════════════════════════════════════════════════════════
// Master Registry
// ═══════════════════════════════════════════════════════════════

export const API_REGISTRY = {
  amazon: {
    name: 'Amazon SP-API',
    endpoints: SP_API_ENDPOINTS,
    rateLimits: AMAZON_RATE_LIMITS,
    apiVersions: AMAZON_API_VERSIONS,
    signing: { service: SIGNING_SERVICE, regions: SIGNING_REGIONS },
    deprecations: Object.values(AMAZON_API_VERSIONS)
      .filter((v: any) => v.deprecated)
      .map((v: any) => ({
        feature: v.path,
        status: 'legacy',
        note: v.note || 'Legacy but still supported',
      })),
  },

  shopify: {
    name: 'Shopify Admin API',
    version: SHOPIFY_API_VERSION,
    nextVersion: SHOPIFY_NEXT_VERSION,
    rateLimits: {
      rest: SHOPIFY_REST_RATE_LIMITS,
      graphql: SHOPIFY_GRAPHQL_RATE_LIMITS,
    },
    scopes: [...SHOPIFY_REQUIRED_SCOPES],
    deprecations: [
      {
        feature: 'REST Admin API',
        status: 'legacy',
        note: 'REST is legacy; GraphQL is preferred for new development. Both still supported.',
      },
    ],
  },

  xero: {
    name: 'Xero Accounting API',
    baseUrl: XERO_API_BASE,
    version: XERO_API_VERSION,
    tokenUrl: XERO_TOKEN_URL,
    rateLimits: XERO_RATE_LIMITS,
    scopes: [...XERO_REQUIRED_SCOPES],
    deprecations: [...XERO_DEPRECATIONS],
  },

  mirakl: {
    name: 'Mirakl Marketplace API',
    authUrl: MIRAKL_AUTH_URL,
    version: MIRAKL_API_VERSION,
    endpoints: MIRAKL_MARKETPLACE_ENDPOINTS,
    rateLimits: MIRAKL_RATE_LIMITS,
    poweredMarketplaces: [...MIRAKL_POWERED_MARKETPLACES],
    deprecations: [...MIRAKL_DEPRECATIONS],
  },
} as const;

// ═══════════════════════════════════════════════════════════════
// Health & Audit Functions
// ═══════════════════════════════════════════════════════════════

export interface ApiHealthEntry {
  api: string;
  version: string;
  status: 'ok' | 'warning' | 'deprecated';
  deprecationCount: number;
  notes: string[];
}

/**
 * Returns a health summary for each integrated API.
 * Useful for scheduled audit scans and admin dashboards.
 */
export function getApiHealth(): ApiHealthEntry[] {
  const entries: ApiHealthEntry[] = [];

  // Amazon
  const amazonDeprecations = API_REGISTRY.amazon.deprecations;
  entries.push({
    api: 'Amazon SP-API',
    version: 'Multi-version (Orders v0, Finances v2024-06-19)',
    status: amazonDeprecations.length > 0 ? 'warning' : 'ok',
    deprecationCount: amazonDeprecations.length,
    notes: amazonDeprecations.map(d => `${d.feature}: ${d.note}`),
  });

  // Shopify
  const shopifyDeprecations = API_REGISTRY.shopify.deprecations;
  entries.push({
    api: 'Shopify Admin API',
    version: SHOPIFY_API_VERSION,
    status: shopifyDeprecations.length > 0 ? 'warning' : 'ok',
    deprecationCount: shopifyDeprecations.length,
    notes: [
      ...shopifyDeprecations.map(d => `${d.feature}: ${d.note}`),
      `Next version: ${SHOPIFY_NEXT_VERSION}`,
    ],
  });

  // Xero
  const xeroDeprecations = API_REGISTRY.xero.deprecations;
  entries.push({
    api: 'Xero Accounting API',
    version: `v${XERO_API_VERSION}`,
    status: xeroDeprecations.length > 0 ? 'warning' : 'ok',
    deprecationCount: xeroDeprecations.length,
    notes: xeroDeprecations.map(d => `${d.feature}: ${d.note}`),
  });

  return entries;
}

/**
 * Aggregates all deprecation warnings across all three APIs.
 * Used for weekly audit scans and warning logs.
 */
export function getAllDeprecationWarnings(): Array<{ api: string; feature: string; status: string; note: string }> {
  const warnings: Array<{ api: string; feature: string; status: string; note: string }> = [];

  for (const dep of API_REGISTRY.amazon.deprecations) {
    warnings.push({ api: 'Amazon SP-API', feature: dep.feature, status: dep.status, note: dep.note });
  }

  for (const dep of API_REGISTRY.shopify.deprecations) {
    warnings.push({ api: 'Shopify Admin API', feature: dep.feature, status: dep.status, note: dep.note });
  }

  for (const dep of API_REGISTRY.xero.deprecations) {
    warnings.push({ api: 'Xero Accounting API', feature: dep.feature, status: dep.status, note: dep.note || '' });
  }

  return warnings;
}
