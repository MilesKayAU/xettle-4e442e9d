

## Two Issues

### Issue 1: The `verify-settlement` edge function is not deployed
The new universal verification function was created in the codebase but never deployed. The edge function logs confirm the OLD `verify-mirakl-settlement` function (with the broken document-number filter) is still being called. This is why you still see "No Data" — the fix exists in code but isn't live.

**Fix**: Deploy the `verify-settlement` edge function. Once deployed, the "Verify via API" button will use the corrected date-range-only filtering and should return matched transactions.

### Issue 2: No auto-resync after credential fix
When we corrected the API key, the system should have automatically re-fetched and corrected the Bunnings settlement data. Currently there's no mechanism that says "credential was fixed, go re-verify all settlements that previously failed." The next scheduled sync will fetch NEW settlements, but it won't go back and re-verify the existing `BUN-2301-2026-03-14` settlement that was ingested from CSV.

**What you can do right now** (after deployment):
1. Open the settlement detail drawer for BUN-2301-2026-03-14
2. Press "Verify via API" — this will now work with the deployed fix
3. If the API data shows different values, use "Correct & Repost" to update the settlement with API-verified figures

**What we should build** (to prevent this happening again):

### Step 1 — Deploy `verify-settlement`
Deploy the already-written edge function so the UI fix takes effect immediately.

### Step 2 — Add "Re-fetch from API" action to the settlement drawer
For any settlement where a Mirakl/eBay/Amazon API connection exists, add a button that re-runs the fetch function for that specific settlement's period, compares the result to stored values, and offers to auto-correct if discrepancies are found. This is different from "Verify" (read-only comparison) — this actually updates the settlement data.

### Step 3 — Post-credential-fix auto-resync
When an API credential is updated in `mirakl_tokens` (or `ebay_tokens`, `amazon_tokens`), trigger a background task that:
1. Finds all settlements for that marketplace with `verdict = "api_error"` or `verdict = "no_data"` in their last verification
2. Re-runs verification against each
3. Logs results to `system_events`

This ensures credential fixes automatically propagate to affected settlements.

### Files to modify
- **Deploy**: `supabase/functions/verify-settlement/index.ts` (already written, just needs deployment)
- **Edit**: `src/components/shared/SettlementDetailDrawer.tsx` — add "Re-fetch from API" button
- **Edit**: `supabase/functions/mirakl-auth/index.ts` — after successful credential save, trigger re-verification of affected settlements

