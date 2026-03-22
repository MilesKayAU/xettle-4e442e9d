

# MCF (Multi-Channel Fulfillment) Feature Plan

## What This Does
Replaces CED Commerce by building Amazon MCF directly into Xettle. When a Shopify order comes in, Xettle sends it to Amazon's Fulfillment Outbound API to pick/pack/ship from your FBA inventory, then tracks the fulfillment and pushes tracking back to Shopify.

## Amazon SP-API Requirements

**API**: Fulfillment Outbound API v2020-07-01
- `createFulfillmentOrder` — submit order to Amazon FBA for fulfillment
- `getFulfillmentOrder` — poll for tracking/status updates  
- `cancelFulfillmentOrder` — cancel if needed
- `listAllFulfillmentOrders` — list history

**Required Role**: "Amazon Fulfillment" (check your SP-API app — this is a different role than "Direct-to-Consumer Delivery" which blocked FBM tracking). This role may already be available or may need separate approval.

**Rate Limits**: `createFulfillmentOrder` = 2 req/sec burst 30; `getFulfillmentOrder` = 2 req/sec burst 30

---

## Implementation Steps

### 1. Database: `mcf_orders` table
New table to track MCF fulfillment lifecycle:

| Column | Type | Purpose |
|--------|------|---------|
| id | uuid PK | |
| user_id | uuid FK | owner |
| shopify_order_id | bigint | source order |
| shopify_order_name | text | e.g. #1042 |
| amazon_fulfillment_order_id | text | returned by Amazon |
| seller_fulfillment_order_id | text | our reference (e.g. `XETTLE-{shopify_order_id}`) |
| status | text | pending → submitted → processing → shipped → delivered → cancelled → failed |
| tracking_number | text | from Amazon |
| carrier | text | from Amazon |
| estimated_arrival | timestamptz | from Amazon |
| items | jsonb | line items sent to Amazon |
| destination_address | jsonb | shipping address |
| raw_amazon_response | jsonb | full API response |
| error_detail | text | |
| retry_count | int default 0 | |
| created_at / updated_at | timestamptz | |

RLS: user can read own rows; service role for writes.

### 2. Edge Function: `create-mcf-order`
- Receives: `{ shopify_order_id, items: [{ sku, quantity }], address, shipping_speed }` 
- Looks up Amazon token (reuses existing `amazon-sp-api-policy.ts` helpers)
- Calls `POST /fba/outbound/2020-07-01/fulfillmentOrders` with:
  - `sellerFulfillmentOrderId`: unique ref
  - `displayableOrderId`: Shopify order name
  - `shippingSpeedCategory`: Standard/Expedited/Priority
  - `destinationAddress`: from Shopify order
  - `items`: SKU + quantity mapped via existing `product_links` table
- Inserts row into `mcf_orders`
- Returns status

### 3. Edge Function: `poll-mcf-status`
- Queries `mcf_orders` where status in (submitted, processing)
- For each, calls `GET /fba/outbound/2020-07-01/fulfillmentOrders/{id}`
- Updates tracking_number, carrier, status
- When status = shipped/delivered and tracking exists → pushes tracking to Shopify via REST API (reuses shopify token selection logic)

### 4. Add API versions & rate limits to `amazon-sp-api-policy.ts`
```
fulfillmentOutbound: {
  current: '2020-07-01',
  latest: '2020-07-01',
}
```
Plus rate limit entries for `createFulfillmentOrder`, `getFulfillmentOrder`.

### 5. UI: New "MCF Orders" tab in Fulfillment Bridge

**Phase 1 (Manual — what we build now):**
- New tab in `FulfillmentBridge.tsx` called "MCF Orders"
- Table showing mcf_orders with status badges (reuse existing STATUS_COLORS pattern)
- "New MCF Order" flow:
  1. Enter Shopify order URL/ID or paste order number
  2. System fetches order details from Shopify (address + line items)
  3. Auto-maps SKUs via existing `product_links` table
  4. Select shipping speed (Standard/Expedited/Priority)
  5. Review & confirm → calls `create-mcf-order`
- "Refresh Status" button → calls `poll-mcf-status` for selected orders
- Status badges: pending → submitted → processing → shipped → delivered
- When shipped: "Push Tracking to Shopify" button (or auto if toggled on)

**Phase 2 (Future — not built now):**
- Shopify webhook auto-triggers MCF submission
- Inventory sync
- Auto-polling on cron

### 6. Shopify Webhook (Future-proofed but manual for now)
The existing `orders/create` webhook infrastructure can be reused later. For now, the user manually enters order IDs in the UI.

---

## Technical Details

- **SKU Mapping**: Reuses the existing `product_links` table (Amazon SKU/ASIN ↔ Shopify variant) already in the Product Links tab
- **Token Management**: Reuses `amazon-sp-api-policy.ts` helpers (getSpApiHeaders, isTokenExpired, LWA refresh)
- **Shopify Token**: Reuses internal token selection (prioritize `is_active` internal tokens with `write_orders` scope)
- **Audit Logging**: All Amazon API calls go through `auditedFetch` wrapper
- **CORS**: Standard `getCorsHeaders` pattern
- **Error Handling**: Retry queue pattern from FBM (exponential backoff)

## Files to Create/Modify

| File | Action |
|------|--------|
| Migration SQL | Create `mcf_orders` table + RLS |
| `supabase/functions/create-mcf-order/index.ts` | New edge function |
| `supabase/functions/poll-mcf-status/index.ts` | New edge function |
| `supabase/functions/_shared/amazon-sp-api-policy.ts` | Add fulfillment outbound API version + rate limits |
| `src/components/admin/FulfillmentBridge.tsx` | Add MCF Orders tab |

