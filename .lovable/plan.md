

# Phase 1 (Beta-scoped): Hardening the FBM Bridge

Given your framing — this is a personal-use feature that earns Amazon app approval as a byproduct, parked as admin-only beta — the scope narrows significantly. Here is a minimal, focused plan.

## What gets built

### 1. Error Retry Queue + Email Alerts
**Database migration:** Add `retry_count` (int, default 0) and `last_retry_at` (timestamptz) to `amazon_fbm_orders`.

**`sync-amazon-fbm-orders`:** During each poll, pick up `failed` rows where `retry_count < 3` and backoff has elapsed (5m / 15m / 60m). Re-attempt Shopify creation. After 3 failures, set status to `manual_review` and enqueue an alert email via existing `enqueue_email` RPC.

**`FulfillmentBridge.tsx`:** Add a "Retry All Failed" button in the Order Monitor tab.

### 2. Shipping Service Level Passthrough
**Database migration:** Add `shipping_service_level` (text, nullable) to `amazon_fbm_orders`.

**`sync-amazon-fbm-orders`:** Extract `shipmentServiceLevelCategory` from the Amazon order payload and store it. Tag the Shopify draft order with `shipping:Expedited` (or whatever the value is).

**`shopify-fbm-fulfillment-webhook`:** Use stored shipping level instead of hardcoded `'Standard'` when calling `confirmShipment`.

### 3. Remove Hardcoded Store Domain
Replace `SHOPIFY_FBM_STORE = 'mileskayaustralia.myshopify.com'` in 3 locations:
- **`sync-amazon-fbm-orders`** — query `shopify_tokens` for first active row, no domain filter
- **`shopify-auth`** — remove fallback default
- **`FulfillmentBridge.tsx`** — read shop domain from `shopify_tokens` instead of hardcoding

### 4. Cancellation Detection (lightweight)
**`sync-amazon-fbm-orders`:** When re-checking existing `synced`/`created` orders during a poll, detect Amazon `Canceled` status. Update row to `cancelled`, cancel the Shopify draft order via REST API, log a `system_event`, and send an alert email.

No reverse flow (Shopify → Amazon cancel) in this phase.

### 5. Circuit Breaker (Amazon approval requirement)
Add a simple counter in memory within `sync-amazon-fbm-orders`: after 5 consecutive API failures (429s or 5xx), stop polling for that cycle and log `fbm_circuit_open` to `system_events` with an alert email. Resets on next successful call or next poll cycle.

---

## Files changed

| File | What |
|------|------|
| Database migration | `retry_count`, `last_retry_at`, `shipping_service_level` on `amazon_fbm_orders` |
| `supabase/functions/sync-amazon-fbm-orders/index.ts` | Retry loop, shipping extraction, dynamic store, cancellation detection, circuit breaker, alert emails |
| `supabase/functions/shopify-fbm-fulfillment-webhook/index.ts` | Use stored shipping level, dynamic store resolution |
| `supabase/functions/shopify-auth/index.ts` | Remove hardcoded store fallback |
| `src/components/admin/FulfillmentBridge.tsx` | "Retry All Failed" button, dynamic store, shipping level display |

## What is explicitly NOT built
Returns/refunds, inventory sync, multi-store UI, bulk CSV import, dashboard metrics, multi-currency — all parked unless needed for your store or Amazon approval.

