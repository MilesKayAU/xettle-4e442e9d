

# Fix: Dry Run Should Bypass Polling-Enabled Guard

## Problem

When you clicked "Dry Run", the edge function returned `{ status: 'skipped', reason: 'disabled' }` because the `fbm:primary:polling_enabled` setting is `false`. The toast likely flashed "Dry run completed" with that JSON but it was easy to miss.

Manual dry runs and manual syncs should not require auto-polling to be enabled -- that setting should only gate the hourly cron job.

## Changes

### 1. Edge function: skip polling guard for manual invocations

**File**: `supabase/functions/sync-amazon-fbm-orders/index.ts`

Change lines 182-187 to only check `polling_enabled` when the request is from cron (`isCron === true`). When a user manually triggers a dry run or sync via JWT auth, skip this guard entirely.

### 2. Improve toast feedback in UI

**File**: `src/components/admin/FulfillmentBridge.tsx`

Update the `runSync` success handler (line 367) to show a more readable toast:
- If `data.status === 'skipped'`, show an amber warning toast explaining why (e.g., "Polling is disabled -- enable it in Settings or this is now fixed")
- If dry run succeeds, show counts: orders found, matched, unmatched
- If no orders found, say "No unshipped FBM orders found in the polling window"

### Technical Detail

The fix is a one-line condition change in the edge function:

```
// Before:
if (pollingEnabled !== 'true') { ... return skipped }

// After:
if (isCron && pollingEnabled !== 'true') { ... return skipped }
```

This means:
- Cron jobs still respect the toggle
- Manual dry run / sync always executes regardless of toggle state

