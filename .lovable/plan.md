

# Create Xero API Policy + Master API Policy Registry

## Overview

Create a shared Xero API policy file mirroring the Amazon and Shopify patterns, then wrap all three into a master registry. This centralizes all API constants, prevents hardcoded URLs/headers across 14+ Xero edge functions, and enables a future weekly audit scan.

## Part 1: Create `supabase/functions/_shared/xero-api-policy.ts`

### Constants

| Section | Details |
|---------|---------|
| **Base URL** | `XERO_API_BASE = 'https://api.xero.com/api.xro/2.0'` |
| **Auth URLs** | `XERO_AUTH_URL`, `XERO_TOKEN_URL = 'https://identity.xero.com/connect/token'`, `XERO_CONNECTIONS_URL = 'https://api.xero.com/connections'` |
| **Token expiry** | 1800s (30 min), buffer 60s |
| **Rate limits** | 60 calls/min per tenant, 5000 calls/day per tenant. Minute limit uses sliding window. |
| **Required headers** | `Authorization`, `Xero-Tenant-Id`, `Accept: application/json` |
| **API version** | Xero uses URL-versioned API (2.0) — no rotation like Shopify. Note this in policy. |
| **OAuth scopes** | `openid profile email offline_access accounting.transactions accounting.contacts accounting.settings accounting.attachments` |

### Helper Functions

- `getXeroHeaders(accessToken, tenantId)` — returns `{ Authorization, Xero-Tenant-Id, Accept, Content-Type }`
- `buildXeroUrl(resource, params?)` — builds `https://api.xero.com/api.xro/2.0/{resource}?{params}`
- `isXeroTokenExpired(expiresAt, bufferMs?)` — standardized expiry check
- `getXeroRateLimit()` — returns `{ perMinute: 60, perDay: 5000 }`

### Xero-specific rules to document

- Token refresh uses Basic Auth header (`btoa(clientId:clientSecret)`)
- `tenant_id` is mandatory on every API call — obtained from `/connections` after OAuth
- Xero returns 429 with `Retry-After` header — respect it
- Invoice references must be unique per tenant
- Xero uses pagination via `page=N` (not cursor-based)

## Part 2: Refactor Xero Edge Functions

14 functions currently hardcode Xero URLs and headers. Update each to import from the policy:

| Function | What changes |
|----------|-------------|
| `xero-auth` | Import `XERO_AUTH_URL`, `XERO_TOKEN_URL`, `XERO_CONNECTIONS_URL` |
| `sync-settlement-to-xero` | Import `buildXeroUrl`, `getXeroHeaders`, token URL |
| `refresh-xero-coa` | Import `XERO_TOKEN_URL`, `buildXeroUrl`, `getXeroHeaders` |
| `fetch-xero-invoice` | Import token URL, `buildXeroUrl`, `getXeroHeaders` |
| `fetch-xero-bank-accounts` | Import token URL, `buildXeroUrl`, `getXeroHeaders` |
| `fetch-xero-bank-transactions` | Import token URL, `buildXeroUrl`, `getXeroHeaders` |
| `fetch-outstanding` | Import token URL, `buildXeroUrl`, `getXeroHeaders` |
| `sync-xero-status` | Import token URL, `buildXeroUrl`, `getXeroHeaders` |
| `scan-xero-history` | Import token URL, `buildXeroUrl`, `getXeroHeaders` |
| `run-validation-sweep` | Import token URL, `buildXeroUrl`, `getXeroHeaders` |
| `apply-xero-payment` | Import token URL, `buildXeroUrl`, `getXeroHeaders` |
| `sync-amazon-journal` | Import token URL, `buildXeroUrl`, `getXeroHeaders` |
| `ai-account-mapper` | Import token URL, `buildXeroUrl`, `getXeroHeaders` |
| `create-xero-accounts` | Import token URL, `buildXeroUrl`, `getXeroHeaders` |

## Part 3: Create `supabase/functions/_shared/api-policy-registry.ts`

Master registry that imports and re-exports all three policies:

```text
api-policy-registry.ts
├── imports amazon-sp-api-policy
├── imports shopify-api-policy
├── imports xero-api-policy
└── exports API_REGISTRY with:
    ├── amazon: { versions, rateLimits, helpers, deprecations }
    ├── shopify: { version, rateLimits, helpers, deprecations }
    └── xero:   { baseUrl, rateLimits, helpers, oauthConfig }
```

Also includes:

- `getApiHealth()` — returns a summary of each API's version status and deprecation warnings
- `getAllDeprecationWarnings()` — aggregates warnings across all three APIs for audit logging

## Part 4: Update `.lovable/plan.md`

Document all three policy files and the registry in the plan for future AI reference.

## No database changes required

## Expected Result

- Single source of truth for every API Xettle integrates with
- Changing any URL, version, or rate limit = one file edit
- Master registry enables future scheduled audit scans
- All 14 Xero functions use consistent headers and URL construction
- Deprecation warnings logged centrally

