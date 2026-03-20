

# Amazon SP-API Policy — COMPLETE

## What was done

Created `supabase/functions/_shared/amazon-sp-api-policy.ts` as the canonical reference for all Amazon SP-API rules. Updated `sync-amazon-fbm-orders`, `fetch-amazon-settlements`, and `amazon-auth` to import from it.

## Policy file contents

1. **SP_API_ENDPOINTS** — na/eu/fe base URLs + `getEndpointForRegion()` helper
2. **MARKETPLACE_REGISTRY** — 16 marketplace IDs with region, country, domain
3. **LWA constants** — TOKEN_URL, GRANT_TYPES, TOKEN_EXPIRY_BUFFER_MS + `isTokenExpired()` helper
4. **API_VERSIONS** — Orders v0 (deprecated → v2026-01-01), Finances v0 (deprecated → v2024-06-19), Tokens 2021-03-01
5. **RATE_LIMITS** — Per-operation rate/burst for Orders, Finances, Tokens APIs + `getRateLimit()` helper
6. **getSpApiHeaders()** — Returns x-amz-access-token + compliant user-agent + Content-Type
7. **RDT_REQUIRED_OPERATIONS** — getOrderAddress, getOrderBuyerInfo, getOrderItemsBuyerInfo + `requiresRdt()` helper
8. **EXTENDED_HISTORY_MARKETPLACES** — AU/SG/JP support orders from 2016 + `getOrderHistoryStart()` helper
9. **SELLER_CENTRAL_AUTH_URLS** — Per-region OAuth consent URLs
10. **warnIfDeprecated()** — Logs console warnings when using deprecated API versions

## Migration notes for future work

- Orders v0 (`getOrders`) is deprecated → migrate to v2026-01-01 (`searchOrders`)
- Finances v0 (`listFinancialEvents`) is deprecated → migrate to v2024-06-19 (`listTransactions`)
