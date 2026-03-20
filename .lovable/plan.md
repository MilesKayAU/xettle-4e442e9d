

# Create Shopify API Policy File + Update Amazon Policy

## Summary

Two changes: (1) create `supabase/functions/_shared/shopify-api-policy.ts` mirroring the Amazon policy pattern, and (2) update the Amazon policy with the corrections you provided (v0 still supported, add SigV4 signing constants, add marketplace validation helper).

## Part 1: Update Amazon SP-API Policy

**File: `supabase/functions/_shared/amazon-sp-api-policy.ts`**

Corrections based on your feedback:

- **Orders v0 status**: Change `deprecated: true` to `deprecated: false` with note "legacy but still supported; use newer versions when available" — not hard-blocked
- **Add SigV4 signing constants**:
  - `SIGNING_SERVICE = 'execute-api'`
  - `SIGNING_REGION` map per regional endpoint (us-east-1, eu-west-1, us-west-2)
- **Add `assertMarketplaceSupported(marketplaceId)`** helper that throws if marketplace ID is not in the registry — prevents silent bugs from invalid marketplace codes

## Part 2: Create Shopify API Policy

**File: `supabase/functions/_shared/shopify-api-policy.ts`** (NEW)

Structured identically to the Amazon policy:

### Constants

| Section | Details |
|---------|---------|
| **API Version** | `SHOPIFY_API_VERSION = '2026-01'` (current stable, released Jan 2026, supported until Jan 2027). Next: `2026-04` (April 2026). Quarterly release cycle. |
| **Base URL template** | `https://{shop_domain}/admin/api/{version}/` |
| **GraphQL endpoint** | `/admin/api/{version}/graphql.json` |
| **Auth header** | `X-Shopify-Access-Token: {access_token}` |
| **Scopes** | `read_fulfillments, read_inventory, read_orders, read_products, read_reports, read_shopify_payments_accounts, read_shopify_payments_payouts` (matches existing `shopify-auth`) |
| **Rate limits (REST)** | Leaky bucket: 40 requests/app/store, leak rate 2/second. Response header: `X-Shopify-Shop-Api-Call-Limit` |
| **Rate limits (GraphQL)** | 100 points/second (Standard plan), 1000 max single query cost. Response: `extensions.cost.throttleStatus` |
| **Pagination** | REST: cursor-based via `Link` header (`rel="next"`), max 250 per page. Max 25,000 total objects. |
| **REST deprecation note** | REST Admin API is legacy; GraphQL is preferred for new development. Both still supported. |

### Helper Functions

- `getShopifyHeaders(accessToken)` — returns `{ 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' }`
- `buildShopifyUrl(shopDomain, resource, params?)` — builds `https://{domain}/admin/api/{version}/{resource}.json?{params}`
- `buildShopifyGraphqlUrl(shopDomain)` — returns GraphQL endpoint URL
- `parseRateLimitHeader(header)` — parses `X-Shopify-Shop-Api-Call-Limit` into `{ used, available }`
- `isApproachingRateLimit(header, threshold?)` — returns true if bucket is > 80% full
- `getNextPageUrl(linkHeader)` — extracts cursor-based next page URL from `Link` header
- `SHOPIFY_REQUIRED_SCOPES` — array of scopes Xettle needs (matches shopify-auth)
- `warnIfRestLegacy()` — logs a deprecation warning encouraging GraphQL migration

### Deprecation Tracking

- REST Admin API: legacy but fully supported
- Version `2025-07` and older: unsupported (fallen forward by Shopify)
- Track `SHOPIFY_API_VERSION` as single constant all functions import

## Part 3: Refactor Existing Functions

Update these files to import from the new policy instead of hardcoding:

| Function | Change |
|----------|--------|
| `sync-amazon-fbm-orders/index.ts` | Remove `const SHOPIFY_API_VERSION = '2026-01'`, import from shopify policy. Use `getShopifyHeaders()` and `buildShopifyUrl()`. |
| `fetch-shopify-payouts/index.ts` | Remove `const SHOPIFY_API_VERSION = "2026-01"`, import from shopify policy. Use `buildShopifyUrl()`. |
| `fetch-shopify-orders/index.ts` | Import `SHOPIFY_API_VERSION` and `getShopifyHeaders()` from policy. |
| `resolve-shopify-handle/index.ts` | Replace hardcoded `2026-01` with imported constant. Use `getShopifyHeaders()`. |
| `estimate-shipping-cost/index.ts` | Replace hardcoded `2026-01` with imported constant. |
| `historical-audit/index.ts` | Replace hardcoded `2026-01` with imported constant. |
| `shopify-auth/index.ts` | Import `SHOPIFY_REQUIRED_SCOPES` from policy instead of inline string. |
| `scan-shopify-channels/index.ts` | Import version constant. |

## No database changes required

## Expected Result

- Single source of truth for Shopify API version, headers, scopes, rate limits
- Changing API version = one-line edit in the policy file
- All Shopify functions use consistent headers and URL construction
- Amazon policy corrected: v0 not hard-blocked, SigV4 constants added, marketplace validation added

