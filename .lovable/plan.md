

## Plan: Add Shopify Duplicate Detection Before FBM Order Creation

### Problem
If CedCommerce or any other fulfilment bridging app is active on the Shopify store, it may already be creating Shopify orders from the same Amazon FBM orders. Without a dedup check, the bridge will create duplicate Shopify orders — causing double fulfilment and double accounting.

### Approach
Use Shopify GraphQL Admin API to search for existing orders matching the Amazon order ID before creating a new one. This is efficient (single request, low rate-limit cost) and the app already has `read_orders` scope.

### Changes

**1. Edge function: `supabase/functions/sync-amazon-fbm-orders/index.ts`**

Add a new helper function `checkShopifyDuplicate()`:
- Uses Shopify GraphQL Admin API (`/admin/api/2026-01/graphql.json`)
- Query: `orders(first: 5, query: "tag:amazon OR <amazonOrderId>")` searching for the Amazon order ID across tags, notes, order name
- Returns the matching Shopify order ID if found, or `null`

Insert the check at ~line 727 (after the idempotency guard, before the Shopify order creation block):
- Read the `fbm:primary:dedup_check_enabled` setting (default `true`)
- If enabled, call `checkShopifyDuplicate(shopifyToken, amazonOrderId)`
- If a match is found:
  - Update `amazon_fbm_orders` status to `'duplicate_detected'`
  - Store the found Shopify order ID in `shopify_order_id`
  - Log `fbm_duplicate_shopify_detected` system event with details (matched field, likely source app)
  - Skip order creation, increment `skippedCount`
- Also add `'duplicate_detected'` to the `forceRefetch` cleanup status list (line 384)

**2. UI: `src/components/admin/FulfillmentBridge.tsx`**

Status badge (line 19-28 `STATUS_COLORS`):
- Add `duplicate_detected: 'bg-purple-100 text-purple-800 border-purple-300'`

Order Monitor expanded row:
- When status is `duplicate_detected`, show an info panel: "A Shopify order for this Amazon order already exists — likely created by another app (CedCommerce, etc.). Review before proceeding."

Settings tab (~line 657):
- Add a new toggle: "Check for existing Shopify orders before creating" with description "Searches Shopify for duplicate orders created by other apps (CedCommerce, etc.)"
- Key: `fbm:primary:dedup_check_enabled`, default ON
- Load it alongside other settings, save via the existing `saveSetting` pattern

**3. No database migration needed**
The `status` column on `amazon_fbm_orders` is a text field with no CHECK constraint — `'duplicate_detected'` works immediately.

### GraphQL Query Design
```graphql
{
  orders(first: 5, query: "<amazonOrderId>") {
    edges {
      node {
        id
        name
        tags
        note
        customAttributes { key value }
      }
    }
  }
}
```
Searching the raw Amazon order ID (e.g. `250-3366733-4698245`) will match across order name, tags, notes, and metafields. CedCommerce typically stores it in tags or note attributes.

### Files Changed
- `supabase/functions/sync-amazon-fbm-orders/index.ts` — add `checkShopifyDuplicate()` helper + integrate into order processing loop + read dedup setting
- `src/components/admin/FulfillmentBridge.tsx` — add status color, info panel for duplicate_detected, settings toggle

