
# API Policy System — Complete Architecture

## Policy Files (Single Source of Truth)

| File | Purpose |
|------|---------|
| `_shared/amazon-sp-api-policy.ts` | Amazon SP-API endpoints, LWA auth, marketplace registry, SigV4, rate limits |
| `_shared/shopify-api-policy.ts` | Shopify version, scopes, rate limits, URL builders, pagination |
| `_shared/xero-api-policy.ts` | Xero base URL, OAuth URLs, token config, rate limits, scopes |
| `_shared/api-policy-registry.ts` | Master registry wrapping all 3 APIs, health checks, deprecation aggregation |
| `_shared/api-policy-guard.ts` | **Enforcement layer**: assertApiPolicy(), safe mode, violation logging |

## Enforcement & Monitoring

| File | Purpose |
|------|---------|
| `api-policy-audit/index.ts` | Weekly cron (Monday 4am) — scans for violations, logs to system_events, activates safe mode on critical |
| `api-health/index.ts` | REST endpoint — returns live status for all 3 APIs, safe mode state, recent warnings |

## How It Works

1. **Policy files** define constants, helpers, and deprecation tracking for each API
2. **Registry** wraps all three into a single `API_REGISTRY` with `getApiHealth()` and `getAllDeprecationWarnings()`
3. **Guard** provides `assertApiPolicy(api)` — called at function entry to validate API health
4. **Safe Mode** — if audit finds critical issues, all syncs are blocked via `api_safe_mode` in app_settings
5. **Weekly Audit** — cron runs `api-policy-audit`, logs `api_policy_warning` events to system_events
6. **Health Endpoint** — `api-health` returns real-time status for admin dashboard

## Safe Mode Flow

```
Weekly Audit → finds critical violation
  → activateSafeMode(userId, reason)
  → sets app_settings.api_safe_mode = 'true'
  → logs api_safe_mode_activated to system_events

Sync functions → call checkSafeMode()
  → throws Error if safe mode active
  → sync blocked until resolved

Admin → reviews warnings → fixes issue
  → deactivateSafeMode(userId, resolvedBy)
  → syncs resume
```

## Functions Using Each Policy

### Amazon SP-API Policy
- `sync-amazon-fbm-orders`, `fetch-amazon-settlements`, `amazon-auth`, `historical-audit`

### Shopify API Policy
- `sync-amazon-fbm-orders`, `fetch-shopify-payouts`, `fetch-shopify-orders`, `resolve-shopify-handle`
- `estimate-shipping-cost`, `historical-audit`, `shopify-auth`, `scan-shopify-channels`

### Xero API Policy
- `xero-auth`, `sync-settlement-to-xero`, `refresh-xero-coa`, `fetch-xero-invoice`
- `fetch-xero-bank-accounts`, `fetch-xero-bank-transactions`, `fetch-outstanding`
- `sync-xero-status`, `scan-xero-history`, `run-validation-sweep`, `apply-xero-payment`
- `sync-amazon-journal`, `ai-account-mapper`, `create-xero-accounts`

## system_events Types

| event_type | severity | When |
|-----------|----------|------|
| `api_policy_warning` | warning/critical | Violation detected by audit |
| `api_audit_completed` | info/critical | Weekly audit finished |
| `api_safe_mode_activated` | critical | Safe mode turned on |
| `api_safe_mode_deactivated` | info | Safe mode turned off |
