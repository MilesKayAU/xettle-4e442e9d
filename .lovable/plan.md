

# Scheduled Cron Jobs for Auto-Fetch

## Current State

- **Amazon `fetch-amazon-settlements`**: Already has a `sync` action with service-role-key that iterates all users with `amazon_tokens` -- fully ready for cron.
- **Shopify `fetch-shopify-payouts`**: Only supports single-user auth (Bearer JWT). Needs a multi-user `sync` mode added.
- **Validation sweep `run-validation-sweep`**: Already uses service role key -- ready for cron.
- All three functions have `verify_jwt = false` in config.toml, so they can accept non-JWT calls.

## Plan

### 1. Add multi-user sync mode to `fetch-shopify-payouts`

Add an `x-action: sync` header path (same pattern as Amazon) that:
- Creates a service-role Supabase client
- Queries all rows from `shopify_tokens`
- For each user: fetches payouts using their stored token, skips cooldown check (cron should always run), respects accounting boundary
- Returns a summary of users processed, settlements imported, errors

### 2. Create a scheduler edge function `scheduled-sync`

A lightweight orchestrator function that pg_cron will call. It will:
1. Call `fetch-amazon-settlements` with `x-action: sync`
2. Call `fetch-shopify-payouts` with `x-action: sync`
3. Call `run-validation-sweep` (already supports cron-style calls)
4. Log results to `sync_history` table

This keeps each function independent and testable.

### 3. Register pg_cron jobs

Two cron schedules via SQL insert:
- **Data fetch**: Every 6 hours (`0 */6 * * *`) -- calls `scheduled-sync`
- **Validation sweep**: Daily at 6am AEST / 8pm UTC (`0 20 * * *`) -- calls `run-validation-sweep`

### 4. Add sync status indicator to the UI

Update the dashboard to show "Last auto-sync: X hours ago" by reading the latest `sync_history` entry with `event_type = 'scheduled_sync'`. This gives Pro users visibility that automation is working.

## Files Changed

| File | Change |
|------|--------|
| `supabase/functions/fetch-shopify-payouts/index.ts` | Add `x-action: sync` multi-user mode using service role key |
| `supabase/functions/scheduled-sync/index.ts` | New orchestrator function that calls all three sync functions |
| `supabase/config.toml` | Add `[functions.scheduled-sync]` with `verify_jwt = false` |
| Database (SQL insert) | Register pg_cron + pg_net extensions, create two cron schedules |
| `src/components/dashboard/ActionCentre.tsx` | Add "Last auto-sync" timestamp display |

## Cron Schedule

```text
┌─────────────────────────────────────────────────┐
│  Every 6h: pg_cron → scheduled-sync             │
│    ├─ fetch-amazon-settlements (x-action: sync)  │
│    ├─ fetch-shopify-payouts   (x-action: sync)   │
│    └─ run-validation-sweep                       │
│                                                  │
│  Results → sync_history table                    │
│  UI reads latest sync_history for status display │
└─────────────────────────────────────────────────┘
```

