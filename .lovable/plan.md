

## Trigger validation sweep after each scan completes

### Problem
The Xero scan detects marketplaces and creates `marketplace_connections`, but never triggers `run-validation-sweep`. That sweep is what generates the "settlement_needed" / "missing" rows in `marketplace_validation` that drive the dashboard's Upload Needed cards, settlement history grid, and action centre. Same gap exists for Amazon and Shopify scans.

The screenshot confirms it eventually works (4 items needing attention appeared), but there's a delay because the sweep only runs on manual "Refresh Status" clicks rather than automatically after scan completion.

### Plan

**File: `src/components/dashboard/PostSetupBanner.tsx`**

Add `run-validation-sweep` call after each scan completes (3 changes):

1. **Xero scan** (~line 112, after `setScanComplete(true)`): Add `await callEdgeFunction('run-validation-sweep').catch(() => {})` before `onScanComplete?.()`

2. **Amazon scan** (~line 156, after `setAppFlag`): Add `await callEdgeFunction('run-validation-sweep').catch(() => {})` before `onScanComplete?.()`

3. **Shopify scan** (~line 200, after `setAppFlag`): Add `await callEdgeFunction('run-validation-sweep').catch(() => {})` before `onScanComplete?.()`

Each wrapped in `.catch()` so scan results still display even if sweep fails.

**File: `supabase/functions/scan-xero-history/index.ts`**

After step 8 (system event log, ~line 396), add server-side validation sweep trigger as backup:
- Use `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` to invoke `run-validation-sweep` internally
- Pass the user's ID so sweep runs in their context
- Wrapped in try/catch so it doesn't block the scan response

This ensures marketplace alerts and folders populate immediately — no manual refresh needed.

### Files to modify
- `src/components/dashboard/PostSetupBanner.tsx` — 3 small additions
- `supabase/functions/scan-xero-history/index.ts` — Server-side sweep trigger

