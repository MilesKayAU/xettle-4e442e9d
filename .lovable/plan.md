

# Create Amazon SP-API Policy & Rules Reference

## Goal

Create a canonical `amazon-sp-api-policy.ts` shared file that all Amazon-related edge functions can import and reference. This ensures every function uses correct endpoints, rate limits, marketplace IDs, auth patterns, and API versions — and serves as a living reference that gets checked when building or modifying Amazon API code.

## What the docs revealed

Key findings from the official SP-API documentation:

- **Orders API v0 is deprecated** — new version is `v2026-01-01` with `searchOrders` replacing `getOrders`
- **Finances API v0 is legacy** — new version is `v2024-06-19` with `listTransactions`
- **Rate limits** use token bucket algorithm; e.g. `getOrders` = 0.0167 req/s (burst 20), `getOrderItems` = 0.5 req/s (burst 30)
- **RDT (Restricted Data Token)** required for PII operations like `getOrderAddress`, `getOrderBuyerInfo`
- **LWA token** expires in 3600s, refresh via `POST https://api.amazon.com/auth/o2/token`
- **Three regional endpoints**: NA, EU, FE — Australia is in FE region
- **user-agent header** is mandatory on every SP-API call (max 500 chars)
- **AU/SG/JP marketplaces** support orders from 2016 onward (not just 2 years)

## Changes

### File: `supabase/functions/_shared/amazon-sp-api-policy.ts` (NEW)

A single shared policy file containing:

1. **Regional endpoints** — `SP_API_ENDPOINTS` map (na, eu, fe) with the correct URLs
2. **Marketplace IDs** — Complete map of marketplace codes to Amazon marketplace IDs and their regions (AU = `A39IBJ37TRP1C6` / fe, US = `ATVPDKIKX0DER` / na, etc.)
3. **LWA auth constants** — Token URL, grant types, token expiry buffer (60s)
4. **Rate limits** — Per-operation rate limits and burst values for Orders API v0, Orders API v2026-01-01, and Finances API
5. **API version registry** — Current vs deprecated versions for each API Xettle uses (Orders, Finances, Tokens)
6. **Required headers** — `x-amz-access-token`, `x-amz-date`, `user-agent` template
7. **Migration warnings** — Constants flagging that Orders v0 is deprecated, with target migration version
8. **Helper functions**:
   - `getEndpointForRegion(region)` — returns correct base URL
   - `getMarketplaceRegion(marketplaceId)` — returns region from marketplace ID
   - `buildUserAgent()` — generates compliant user-agent string
   - `isTokenExpired(expiresAt, bufferMs)` — standardized token expiry check
   - `getRateLimit(operation)` — returns `{ rate, burst }` for an operation
9. **PII/RDT rules** — List of operations requiring Restricted Data Tokens
10. **Order history limits** — AU/SG/JP from 2016, others 2 years

### File: `supabase/functions/sync-amazon-fbm-orders/index.ts`

- Replace inline `SP_API_ENDPOINTS` with import from shared policy
- Use `buildUserAgent()` for the `user-agent` header
- Use `isTokenExpired()` for token refresh check
- Add rate limit awareness comment referencing `getOrderItems` burst limit

### File: `supabase/functions/fetch-amazon-settlements/index.ts`

- Replace inline `SP_API_ENDPOINTS` with import from shared policy
- Use shared `buildUserAgent()` helper

### File: `supabase/functions/amazon-auth/index.ts`

- Import LWA constants from shared policy instead of hardcoding

### No database changes required

## Technical Details

The policy file acts as a single source of truth. Each constant includes a doc comment with the source URL from `developer-docs.amazon.com/sp-api/docs/...` so future developers (and AI) can verify against the latest docs. The deprecated API version flags will log warnings when used, encouraging migration to new versions.

