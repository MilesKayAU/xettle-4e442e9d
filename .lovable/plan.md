

## Plan: Enforce SKU-based filtering with proper logging

Three changes needed in `supabase/functions/sync-amazon-fbm-orders/index.ts`:

### 1. Zero matched SKUs — log `fbm_order_skipped_fba` (lines 841-846)

Current code deletes the record and skips silently with no event log. Add a `logEvent` call with `fbm_order_skipped_fba` including the skipped SKUs before deleting the record.

### 2. Partial match — log `fbm_partial_order_created` (after Shopify order creation, ~line 1000+)

After a successful Shopify order creation, if `unmappedSkus.length > 0` (meaning some SKUs were mapped and some weren't), log `fbm_partial_order_created` with `included_skus` (the matched ones) and `skipped_skus` (the unmapped FBA ones). This is informational — the Shopify order already only contains `mappedOrderItems`, so the behavior is correct; we just need the log entry.

### 3. All SKUs matched — no change needed

The existing flow already handles this correctly. Optionally add `fbm_order_created` detail showing all SKUs were matched (this already happens via the existing `shopify_order_created` event).

### Summary of changes

| Scenario | Action | Log event |
|----------|--------|-----------|
| 0 mapped SKUs | Delete record, skip | `fbm_order_skipped_fba` |
| Some mapped | Create Shopify with mapped only | `fbm_partial_order_created` |
| All mapped | Create Shopify as normal | existing `shopify_order_created` |

### File touched
- `supabase/functions/sync-amazon-fbm-orders/index.ts` — two small additions (~5 lines each)
- Redeploy edge function

