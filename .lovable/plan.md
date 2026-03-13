

# Fix: Outstanding Tab Blocks on Xero API — Should Load Cache Instantly

## Root Cause
Two bugs combine to create the 1-minute blocking load:

1. **Line 311**: `body: { force_refresh: true }` is **hardcoded** on every call to `fetch-outstanding`, even the mount call. This defeats the 30-minute cache TTL — every page load hits Xero live.

2. **Lines 1084-1097**: The loading state renders a full-page spinner with no content until the edge function returns. When Xero is slow or rate-limited, the user stares at a spinner for 60+ seconds, then gets a rate-limit warning with no data.

## Fix

### A. Pass `force_refresh` only when user explicitly clicks "Sync with Xero"

In `fetchOutstanding()` (line 311), change `force_refresh: true` to `force_refresh: !!options?.runSync`. On mount (`runSync: false`), this means the edge function serves from cache if fresh — zero Xero API calls, instant load.

### B. Show skeleton table immediately, not a blocking spinner

Replace the full-page spinner (lines 1084-1097) with skeleton rows that render the Outstanding header, action buttons, and placeholder rows immediately. The actual data populates when the edge function returns. If the edge function returns cached data, the skeleton disappears in <1 second.

### C. Show "Loading from cache..." not "Syncing with Xero..."

The loading message should say "Loading outstanding invoices..." since the default path no longer hits Xero live.

## Files to change

1. **`src/components/dashboard/OutstandingTab.tsx`**
   - Line 311: `force_refresh: !!options?.runSync` instead of `true`
   - Lines 1084-1097: Replace blocking spinner with skeleton table + header
   - Update loading text

