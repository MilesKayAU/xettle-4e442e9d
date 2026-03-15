

## Audit: Wasteful API Calls & the "270 days" Toast

### Problems Found

**1. Auto-backfill fires on every Outstanding Tab load (the "270 days" toast)**

In `OutstandingTab.tsx` (line 692-698), a `useEffect` automatically calls `triggerBackfill()` whenever `missing_settlement_ids` are present in the response data. Since the same 2 settlement IDs (`12259977803`, `12258962383`) are perpetually missing (they're genuinely older than 270 days), this fires on every tab load, hitting the Amazon SP-API backfill endpoint and showing the "not found — may be older than 270 days" toast every time.

**Fix**: Track which settlement IDs have already been attempted (persist in `app_settings` or `localStorage`) and skip them on subsequent loads. Add a "backfill_failed_ids" list so the system stops retrying known-unfindable IDs.

**2. PostSetupBanner re-runs scans when flags are already set**

The `PostSetupBanner` correctly checks `completedFlags` before firing API calls — this part is fine. However, it still calls `detectCapabilities()` on every dashboard mount, which queries 3 token tables. This is minor but unnecessary when `scanTriggered.current` prevents the actual API calls. No fix needed here — the ref guard is working.

**3. Scheduled sync pipeline is well-guarded**

The `scheduled-sync` edge function already has proper mutex locks (`acquire_sync_lock`) and rate-limit cooldown checks (`check_sync_cooldown`) per user per integration. This is correctly preventing duplicate cron-triggered syncs. No fix needed.

**4. OutstandingTab calls `sync-xero-status` on initial load with `runSync: true`**

Need to verify if the initial load fires `runSync: true`. If so, it's calling sync-xero-status + fetch-outstanding on every dashboard visit, which is wasteful when the cache is fresh.

### Changes

| File | Change |
|------|--------|
| `src/components/dashboard/OutstandingTab.tsx` | Add a "backfill already attempted" guard using `localStorage` or `sessionStorage`. Track failed backfill IDs so the same missing settlements don't trigger repeated API calls and the "270 days" toast on every load. |
| `src/components/dashboard/OutstandingTab.tsx` | Add a `toast.id` to the 270-day toast to prevent duplicate toasts stacking. |

### What's Already Correct (No Changes Needed)
- `scheduled-sync`: Proper per-user mutex locks and cooldown checks
- `PostSetupBanner`: Guards via `scanTriggered.current` ref and `completedFlags` set
- `DashboardConnectionStrip` / `SystemStatusStrip`: Only read token tables (no API calls), with 5-min staleTime
- Amazon smart-sync: Has cooldown checks before attempting fetch

