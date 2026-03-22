

## Current State

The MCF (Shopify → Amazon) flow already has tracking feedback built into `poll-mcf-status`:

1. **Order submitted to Amazon** → MCF order status = `submitted` → **No Shopify status change yet**
2. **Amazon ships the goods** (status = `COMPLETE`) → `poll-mcf-status` extracts tracking number → calls `pushTrackingToShopify()` which creates a **fulfillment on the Shopify order**, marking it as **Fulfilled** with the tracking number and carrier

**The gap**: There is no intermediate status update to Shopify when the order is first pulled/submitted to Amazon. Shopify still shows the order as "Unfulfilled" until Amazon actually ships.

## Proposed Lifecycle

| Stage | Amazon MCF Status | Shopify Order Status | Action |
|-------|------------------|---------------------|--------|
| Order submitted to Amazon | `submitted` | **Add note** "Submitted to Amazon FBA for fulfillment" | New: tag order + add note via Shopify API |
| Amazon processing | `processing` | No change (still unfulfilled) | Optional: update note |
| Amazon ships | `shipped` / `COMPLETE` | **Fulfilled** with tracking number + carrier | Already implemented in `pushTrackingToShopify()` |
| Amazon cancelled | `cancelled` | Remove tag, add note "Amazon MCF cancelled" | New: cleanup |

## Plan

### 1. Add Shopify order tagging on MCF submission
In `create-mcf-order/index.ts`, after successful Amazon submission, call the Shopify API to:
- Add a tag `amazon-mcf-pending` to the Shopify order
- Add an order note: "Submitted to Amazon FBA via Xettle MCF (ref: {sellerFulfillmentOrderId})"
This gives the Shopify admin immediate visibility that the order is being handled.

### 2. Update `pushTrackingToShopify()` to also remove the pending tag
In `poll-mcf-status/index.ts`, after successfully creating the Shopify fulfillment (marking the order as Fulfilled), also:
- Remove the `amazon-mcf-pending` tag
- Add tag `amazon-mcf-fulfilled`

### 3. Handle cancellation cleanup
In `cancel-mcf-order/index.ts`, when an MCF order is cancelled:
- Remove `amazon-mcf-pending` tag from the Shopify order
- Add a note: "Amazon MCF order cancelled — order returned to unfulfilled"

### 4. Display Shopify sync status in the MCF Orders table
In `FulfillmentBridge.tsx`, add a column or indicator showing whether Shopify has been updated (tag added, fulfilled, etc.) based on the `shopify_tracking_pushed` field already returned by `poll-mcf-status`.

### Technical Details

- **Shopify API calls**: Use `PUT /admin/api/2026-01/orders/{id}.json` to update tags/notes; the existing fulfillment endpoint for marking fulfilled
- **Tag-based approach**: Non-destructive, visible in Shopify admin search/filters, compatible with other Shopify apps
- **Reuse existing token selection**: Same `shopify_tokens` lookup pattern already in `pushTrackingToShopify()`
- **Edge functions modified**: `create-mcf-order`, `poll-mcf-status`, `cancel-mcf-order`
- **Frontend**: Minor column addition to MCF Orders tab

