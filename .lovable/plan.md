

# Cache-First Outstanding Invoices — Survive Xero Rate Limits

## Problem
`fetch-outstanding` calls Xero's invoice API on **every invocation** (line 212). When rate-limited (429) and no prior matches exist in `xero_accounting_matches`, the page returns empty. The existing fallback only works if matches were previously cached — first-time users or fresh accounts get nothing.

## Solution

### A. New table: `outstanding_invoices_cache`
Explicit invoice snapshot cache with TTL awareness.

```text
outstanding_invoices_cache
├── id (uuid, PK)
├── user_id (uuid, NOT NULL)
├── xero_invoice_id (text, NOT NULL)
├── xero_tenant_id (text)
├── invoice_number (text)
├── reference (text)
├── contact_name (text)
├── date (date)
├── due_date (date)
├── amount_due (numeric)
├── total (numeric)
├── currency_code (text, default 'AUD')
├── status (text)  -- DRAFT/SUBMITTED/AUTHORISED
├── fetched_at (timestamptz, default now())
├── UNIQUE(user_id, xero_invoice_id)
```
RLS: all operations scoped to `auth.uid() = user_id`.

### B. Refactor `fetch-outstanding` to cache-first logic

```text
Request arrives
  ├─ force_refresh: true → call Xero, update cache, serve
  ├─ Cache fresh (< 30 min) → serve from cache, zero API calls
  └─ Cache stale → try Xero
       ├─ 200 → update cache, serve
       └─ 429 → serve stale cache + sync_info.xero_rate_limited + cache_age_minutes
```

Key changes in `fetch-outstanding/index.ts`:
- Before calling Xero (current line 218), check `outstanding_invoices_cache` freshness via `MAX(fetched_at)` for user
- If fresh and not `force_refresh`, build `allInvoices` from cache rows (same shape as Xero response)
- If Xero call succeeds, upsert all invoices into cache, then proceed
- If 429, load from cache (replaces current `xero_accounting_matches` fallback which is incomplete)
- Return `sync_info.invoice_cache_age_minutes` and `sync_info.from_cache` in response

### C. Frontend: pass `force_refresh` and show cache age

In `OutstandingTab.tsx`:
- Default load: `fetchOutstanding({ runSync: false })` — no change, edge function uses cache
- "Sync with Xero" button: pass `force_refresh: true` in request body
- Display "Last refreshed X min ago" from `sync_info.invoice_cache_age_minutes`
- When `sync_info.xero_rate_limited` is true, show amber banner: "Xero rate limited — showing cached data from X minutes ago"

### D. Bank feed lookback split

In `fetch-xero-bank-transactions/index.ts`:
- `self` mode (UI-triggered): `LOOKBACK_DAYS = 30`
- `batch` mode (cron): keep `LOOKBACK_DAYS = 60`

Change line 20 constant to mode-specific value inside the handler.

## Files to change

1. **Database migration** — Create `outstanding_invoices_cache` table with RLS + unique constraint
2. **`supabase/functions/fetch-outstanding/index.ts`** — Cache-first read/write logic around lines 210-278
3. **`supabase/functions/fetch-xero-bank-transactions/index.ts`** — Split lookback by mode (line 20)
4. **`src/components/dashboard/OutstandingTab.tsx`** — Pass `force_refresh`, display cache age indicator, rate-limit banner

