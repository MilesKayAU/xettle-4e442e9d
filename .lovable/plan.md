

# Fix eBay Auto-Sync Pipeline

## Problem
eBay OAuth is connected but `fetch-ebay-settlements` has never executed. The `sync_history` shows `ebay: null` in every recent run. Two issues:

1. **`fetch-ebay-settlements` may not be deployed** — no logs exist for it at all
2. **Pipeline may timeout before Step 4.5** — `xero_audit` fails (Unauthorized) and Amazon times out (90s), potentially exhausting the function budget before eBay runs

## Fix 1: Redeploy `fetch-ebay-settlements`
Ensure the edge function is actually deployed. This is the most likely cause — if the function doesn't exist, `callFunction` would return an error that gets swallowed.

## Fix 2: Ensure eBay results are recorded in `sync_history`
Check the final sync_history upsert at the bottom of `scheduled-sync` to confirm `ebay` is included in the details payload. The current code may be missing `totalEbaySynced` or the `ebay` key in the final write.

## Fix 3: Move eBay step order
Currently eBay runs at Step 4.5, after Amazon (which times out at 90s). If the overall function budget is tight, eBay never gets a chance. Consider running eBay before or in parallel with Amazon, or ensuring the pipeline continues past failed steps.

## Implementation
1. Verify and redeploy `fetch-ebay-settlements` edge function
2. Audit `scheduled-sync` final sync_history write to ensure `results.ebay` is persisted
3. No code changes likely needed — the pipeline logic already has eBay wired in; the issue is deployment/execution order

## Files
| File | Action |
|------|--------|
| `supabase/functions/fetch-ebay-settlements/index.ts` | Redeploy |
| `supabase/functions/scheduled-sync/index.ts` | Audit final details write for eBay inclusion; fix if missing |

