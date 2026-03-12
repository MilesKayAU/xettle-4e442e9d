

# Settlement Reference Index — Plan

## Analysis

You're right that the current system is inefficient. Every sync makes **7 separate Xero API queries** (Xettle-, Settlement, AMZN-, LMB-, Shopify, Payout, Shopify contact) plus a full 12-month date scan for fuzzy matching. That's 8+ paginated API calls hitting Xero every single sync, even when 90% of invoices were already matched last time.

You already have `xero_accounting_matches` which stores results, but the system **never reads from it first**. It writes to it, then ignores it on the next run.

## Current Issues

1. **No cache-first lookup** — every sync re-scans Xero from scratch
2. **7+ API calls per sync** — rate limit risk, especially at scale
3. **Fuzzy scan fetches ALL invoices from last 12 months** — wasteful when most are already matched
4. **No duplicate-push guard** — before pushing a new invoice, there's no fast check against known references

## Plan

### 1. Repurpose `xero_accounting_matches` as the reference index

The table already exists with the right structure. Add a `reference_hash` column and proper indexes rather than creating a new table.

**Migration:**
- Add `reference_hash TEXT` column to `xero_accounting_matches`
- Add index on `(user_id, settlement_id)` (already has unique constraint)
- Add index on `(user_id, reference_hash)`

### 2. Rewrite `sync-xero-status` with cache-first pipeline

```text
Step 1: Load xero_accounting_matches for this user
         ↓
Step 2: For each cached match, quick-verify status via Xero API
        (single batch query by InvoiceID — 1 API call)
         ↓
Step 3: Identify settlements with NO cache entry
         ↓
Step 4: ONLY for uncached settlements, run reference queries
        (use incremental cursor: only invoices modified since last sync)
         ↓
Step 5: Fuzzy match ONLY for remaining unmatched
         ↓
Step 6: Update cache + settlements table
```

### 3. Incremental Xero scanning

Instead of scanning all invoices every time, use `ModifiedAfter` header:
- Store `xero_last_invoice_scan_at` in `app_settings`
- On subsequent syncs, only fetch invoices modified since that timestamp
- First sync: full scan (as today). Future syncs: incremental only.

### 4. Pre-push duplicate check

Before `sync-settlement-to-xero` creates a new invoice, check:
```sql
SELECT 1 FROM xero_accounting_matches
WHERE user_id = ? AND settlement_id = ?
```
If found, skip the push and return the existing invoice details.

## Performance Impact

| Scenario | Current | After |
|----------|---------|-------|
| Repeat sync (no changes) | 8+ API calls, scan hundreds | 1 batch status check |
| New settlements only | Full rescan | Incremental only |
| 5k invoices | ~2s | <100ms (cache hit) |
| Duplicate push risk | Possible | Eliminated |

## Files Changed

1. **Migration** — add `reference_hash` + indexes to `xero_accounting_matches`
2. **`supabase/functions/sync-xero-status/index.ts`** — rewrite with cache-first pipeline, incremental scanning via `ModifiedAfter` header, store last scan cursor
3. **`supabase/functions/sync-settlement-to-xero/index.ts`** — add pre-push duplicate check against cache

## Risk Mitigation

- First sync for any user still does a full scan (no data loss)
- Cache entries are always overwritten with fresh Xero status on each sync
- If cache is stale, the system falls through to API queries (graceful degradation)
- Existing `settlement_fingerprint` matching remains as the final fallback tier

