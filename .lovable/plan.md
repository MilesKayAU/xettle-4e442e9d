

# Fix Plan: Outstanding Tab + Xero Rate Limiting

## Root Cause

The dashboard fires **multiple Xero API functions simultaneously** on load:
1. `scan-xero-history` (makes 5+ parallel Xero calls: Invoices, BankTransactions, Contacts, Accounts, PaymentAccounts)
2. `fetch-outstanding` (makes 1 Xero call: Invoices)
3. `ai-account-mapper` (makes 1 Xero call: Accounts)

All of these fire within seconds of each other, and Xero's rate limit (60 calls/minute) is exhausted instantly. Every edge function log shows **429 errors**. The Outstanding tab has no cached data to fall back to, so it returns empty rows.

## Two Problems to Fix

### Problem 1: Xero API call storm on dashboard load
The `scan-xero-history` function fires on every Xero-connected dashboard load (when discovery status isn't "complete"). It makes 5+ parallel Xero API calls, burning through the rate limit before `fetch-outstanding` even gets a chance.

**Fix:** Serialize the Xero calls. Dashboard should:
- Run `scan-xero-history` first (only if needed)
- Wait for it to complete before calling `fetch-outstanding`
- Add a delay/queue so Xero calls don't overlap

### Problem 2: fetch-outstanding returns empty when rate-limited with no cache
When Xero returns 429 and there's no cache, the function returns empty rows. The UI shows the summary card counts but the table is empty.

**Fix:** When the function gets a 429 with no cache, return a clear "rate limited, retry in X seconds" status that the UI can act on — show a retry countdown instead of an empty table.

## Implementation Plan

### 1. Dashboard.tsx — Prevent parallel Xero function calls
- Move `fetch-outstanding` call from `OutstandingTab` auto-load into a sequenced flow
- After `scan-xero-history` completes (or is skipped), add a 5-second delay before the Outstanding tab fetches
- Add a `xero_api_last_call_at` check in `app_settings` to prevent functions from firing within 10 seconds of each other

### 2. fetch-outstanding/index.ts — Better rate-limit recovery
- When 429 is received and no cache exists, return a structured response with `retry_after_seconds` and `rows: []` plus a `status: 'rate_limited_no_cache'` flag
- The UI can then show "Xero is cooling down — retrying in X seconds" with an auto-retry timer

### 3. OutstandingTab.tsx — Auto-retry on rate limit
- When `sync_info.xero_rate_limited === true` and `rows` is empty, show a countdown timer
- Auto-retry after `retry_after_seconds` (default 60s)
- Show amber banner: "Waiting for Xero API — will retry automatically. This is normal."

### 4. scan-xero-history/index.ts — Serialize Xero calls
- Change parallel `Promise.all` Xero calls to sequential with 2-second gaps between each
- This prevents burning through the entire rate limit in one burst

## Files to Change
1. `src/pages/Dashboard.tsx` — Delay Outstanding fetch after discovery scan
2. `src/components/dashboard/OutstandingTab.tsx` — Add auto-retry countdown for rate-limited empty state
3. `supabase/functions/fetch-outstanding/index.ts` — Better empty-cache rate-limit response
4. `supabase/functions/scan-xero-history/index.ts` — Serialize Xero API calls with delays

