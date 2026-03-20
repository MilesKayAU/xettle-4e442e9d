
# API Policy Files — COMPLETE

## Amazon SP-API Policy (`_shared/amazon-sp-api-policy.ts`)

- Regional endpoints (NA, EU, FE)
- Marketplace registry (16 marketplaces with IDs, regions, domains)
- LWA auth constants (token URL, expiry buffer, grant types)
- API version registry — Orders v0 and Finances v0 marked as **legacy but still supported** (not hard-blocked)
- Rate limits per operation (token bucket)
- Required headers + user-agent builder
- RDT-required operations list
- Order history limits (AU/SG/JP from 2016)
- **SigV4 signing constants** (SIGNING_SERVICE, SIGNING_REGIONS per region)
- **`assertMarketplaceSupported()`** helper to prevent invalid marketplace bugs

### Functions using this policy
- `sync-amazon-fbm-orders`
- `fetch-amazon-settlements`
- `amazon-auth`
- `historical-audit`

## Shopify API Policy (`_shared/shopify-api-policy.ts`)

- `SHOPIFY_API_VERSION = '2026-01'` — single source of truth
- `SHOPIFY_REQUIRED_SCOPES` array + comma-joined string
- REST rate limits (leaky bucket: 40 burst, 2/s leak)
- GraphQL rate limits (100 points/s)
- Pagination constants (250 max per page, 25K total)
- REST deprecation note (legacy but supported)
- Helper functions:
  - `getShopifyHeaders(accessToken)`
  - `buildShopifyUrl(shopDomain, resource, params?)`
  - `buildShopifyGraphqlUrl(shopDomain)`
  - `parseRateLimitHeader(header)`
  - `isApproachingRateLimit(header, threshold?)`
  - `getNextPageUrl(linkHeader)`
  - `warnIfRestLegacy()`

### Functions using this policy
- `sync-amazon-fbm-orders` (Shopify order creation)
- `fetch-shopify-payouts`
- `fetch-shopify-orders`
- `resolve-shopify-handle`
- `estimate-shipping-cost`
- `historical-audit`
- `shopify-auth` (scopes)

## Xero API Policy (`_shared/xero-api-policy.ts`)

- `XERO_API_BASE = 'https://api.xero.com/api.xro/2.0'` — single source of truth
- `XERO_AUTH_URL`, `XERO_TOKEN_URL`, `XERO_CONNECTIONS_URL`
- Token config (1800s expiry, 5-min refresh buffer)
- Rate limits (60/min per tenant, 5000/day per tenant)
- `XERO_REQUIRED_SCOPES` — confirmed scopes (journals.read rejected post-March 2026)
- Pagination rules (page-based, 100 per page)
- Deprecation tracking
- Helper functions:
  - `getXeroHeaders(accessToken, tenantId)`
  - `buildXeroUrl(resource, params?)`
  - `isXeroTokenExpired(expiresAt, bufferMs?)`
  - `buildXeroBasicAuth(clientId, clientSecret)`
  - `parseXeroRetryAfter(header)`
  - `getXeroRateLimit()`

### Functions using this policy
- `xero-auth`
- `sync-settlement-to-xero`
- `refresh-xero-coa`
- `fetch-xero-invoice`
- `fetch-xero-bank-accounts`
- `fetch-xero-bank-transactions`
- `fetch-outstanding`
- `sync-xero-status`
- `scan-xero-history`
- `run-validation-sweep`
- `apply-xero-payment`
- `sync-amazon-journal`
- `ai-account-mapper`
- `create-xero-accounts`

## Master API Policy Registry (`_shared/api-policy-registry.ts`)

- Imports and wraps all three API policies
- `API_REGISTRY` object with amazon, shopify, xero sections
- `getApiHealth()` — returns health summary for each API
- `getAllDeprecationWarnings()` — aggregates deprecation warnings across all APIs
- Enables future scheduled weekly audit scans
