

# FBM Bridge: API Audit Log for Amazon SP-API Approval

## Context

The circuit breaker, retry queue, shipping passthrough, dynamic store resolution, cancellation detection, and email alerts are **already implemented and deployed**. What's missing for Amazon approval is a **structured API call audit log** — a record of every SP-API request made on behalf of the seller, demonstrating responsible API usage.

Currently, `system_events` captures business-level events (order created, poll completed, circuit open), but doesn't log individual API calls with request/response metadata that Amazon's review team wants to see.

## What Gets Built

### 1. API Call Audit Table
**Database migration:** New `api_call_log` table optimized for write-heavy, read-occasional audit queries.

```
api_call_log
├── id (uuid, PK)
├── user_id (uuid, NOT NULL)
├── integration (text) — 'amazon_sp_api', 'shopify', etc.
├── endpoint (text) — '/orders/v2026-01-01/orders', '/shipping/v2/shipments'
├── method (text) — 'GET', 'POST'
├── status_code (int)
├── latency_ms (int)
├── request_context (jsonb) — marketplace_id, order_id, page number (NO PII)
├── error_summary (text, nullable) — truncated error for failed calls
├── rate_limit_remaining (int, nullable) — from x-amzn-RateLimit-Remaining header
├── created_at (timestamptz, default now())
```

RLS: Service role only (no user-facing reads needed outside admin). Index on `(user_id, integration, created_at DESC)`.

### 2. Lightweight Audit Logger Helper
Add a shared helper `logApiCall()` in `_shared/api-audit.ts` that the edge functions call after every external API request. It captures timing, status, and rate limit headers without blocking the main flow (fire-and-forget insert).

### 3. Instrument sync-amazon-fbm-orders
Wrap the existing `fetch()` calls to Amazon SP-API (orders list, order detail, order revalidation) with `logApiCall()`. Each call gets a row showing endpoint, status, latency, and remaining rate limit quota.

### 4. Instrument shopify-fbm-fulfillment-webhook
Wrap `confirmShipment` and Shopify fulfillment API calls with the same logger.

### 5. Audit Log Tab in FulfillmentBridge UI
Add a new "API Audit" tab showing the last 100 API calls with filters by integration, status code, and date range. Includes a CSV export button for Amazon's review team.

### 6. Auto-Purge (30-day retention)
Add a SQL statement to clean up `api_call_log` rows older than 90 days (API audit doesn't contain PII, so longer retention is fine for compliance evidence). Can run via the existing daily cron.

---

## Files Changed

| File | What |
|------|------|
| Database migration | Create `api_call_log` table with index |
| `supabase/functions/_shared/api-audit.ts` | New shared `logApiCall()` helper |
| `supabase/functions/sync-amazon-fbm-orders/index.ts` | Instrument 4-5 fetch calls with audit logging |
| `supabase/functions/shopify-fbm-fulfillment-webhook/index.ts` | Instrument confirmShipment + Shopify API calls |
| `src/components/admin/FulfillmentBridge.tsx` | New "API Audit" tab with table + CSV export |

## What This Proves to Amazon
- Every API call is logged with status and latency
- Rate limit headers are captured, proving the integration respects throttling
- Circuit breaker evidence is visible in the audit trail (consecutive failures → circuit open)
- No PII stored in the audit log (only order IDs, endpoints, status codes)

