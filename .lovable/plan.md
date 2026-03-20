

# Fix: Widen polling window on force_refetch

## Problem
When `force_refetch = true`, the edge function:
1. Deletes stale local rows (works correctly)
2. Queries Amazon using the narrow `last_poll_at` window (e.g., last 10 minutes)
3. Amazon returns 0 orders because the order hasn't been updated recently

The order was last updated on March 19 but the query window started at March 20 05:06.

## Fix

**File:** `supabase/functions/sync-amazon-fbm-orders/index.ts` (lines 187-196)

When `forceRefetch === true`, override `lastUpdatedAfter` to use a 7-day lookback window instead of the `last_poll_at` value. This ensures all recent orders are re-fetched after the bulk delete.

```text
Current logic (line 187-196):
  lastUpdatedAfter = last_poll_at - 2min buffer
  OR 7 days ago (if no last_poll_at)

New logic:
  if forceRefetch → always use 7 days ago
  else → use last_poll_at - 2min buffer (unchanged)
```

This is a 2-line change: add an `if (forceRefetch)` block before the existing polling window computation that forces the 7-day lookback.

## Changes

| File | Change |
|------|--------|
| `supabase/functions/sync-amazon-fbm-orders/index.ts` | Add `forceRefetch` override for `lastUpdatedAfter` to use 7-day lookback |

No other changes needed. After deploying, clicking "Live Sync Now" will re-fetch the order from Amazon and push it to Shopify.

