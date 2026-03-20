

# Fix: FBM Sync Not Creating Shopify Orders + Add OrderItems Logging

## Root Cause Found

Two issues preventing Shopify order creation:

### Issue 1: Dry run creates a "pending" row, then real sync skips it as duplicate

The flow today:
1. **Dry Run** → inserts order into `amazon_fbm_orders` with status `pending` and error_detail `dry_run` → skips Shopify create (line 403)
2. **Real Sync** → finds the existing row (line 315-326) → skips it as "duplicate" → **never creates Shopify order**

The duplicate check on line 322 does `if (existing) { skip }` — it doesn't check whether the order was actually synced to Shopify. A dry-run row or a failed/pending row should be re-processable.

### Issue 2: `logger` references on lines 342 and 574 are broken

The `logger` import was removed in the last fix but two references remain, causing runtime crashes when those code paths are hit.

## Changes

### File: `supabase/functions/sync-amazon-fbm-orders/index.ts`

**1. Fix duplicate check to allow re-processing of unsynced orders (lines 314-326)**

Replace the simple "skip if exists" with smarter logic:
- If existing row has `shopify_order_id` → skip (truly synced)
- If existing row has status `created` → skip
- Otherwise (pending, failed, manual_review, dry_run) → delete the old row and re-process

**2. Add OrderItems logging after fetch (after line 367)**

Log to console AND store on the order record + system events:
- `order_items_count`
- Each `SellerSKU` and `ASIN`
- The SKU used for product_links lookup
- Whether mapping was found

**3. Add debug details to the order record (line 329-338)**

Store `raw_order_items` and `matched_skus` in the `raw_amazon_payload` or a dedicated field so they're visible in the Order Monitor UI.

**4. Fix broken `logger` references (lines 342, 574)**

Replace `logger.warn(...)` and `logger.error(...)` with `console.warn(...)` and `console.error(...)`.

**5. Log Shopify create attempt (before line 477)**

Add `console.log('fbm_shopify_create', { amazonOrderId, shopifyUrl, lineItemCount })` so we can confirm the Shopify API is actually called.

**6. Log Shopify response on success (after line 487)**

Add `console.log('fbm_shopify_created', { shopifyOrderId })`.

### No other files changed

## Expected Result After Fix

- **Dry Run** → inserts order, logs OrderItems details, skips Shopify create (same as now)
- **Real Sync after Dry Run** → re-processes the order instead of skipping, calls OrderItems API, matches SKU, creates Shopify order
- All debug info visible in: edge function logs, Event Log tab, and Order Monitor payload

