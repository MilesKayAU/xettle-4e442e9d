

## Audit: Data Integrity Issues in Settlements Overview

### Issues Found

**Issue 1 — `saved` → `ingested` backfill never ran**

The earlier plan to backfill `status = 'saved'` to `'ingested'` was approved but the migration only cleaned up orphaned validation rows — it didn't include the status backfill. Result: 11 settlements (5 CSV, 6 eBay API) are stuck at `saved` status. The reconciliation engine's auto-promotion only works on `ingested` status rows, so these can never auto-promote to `ready_to_push`.

Fix: Migration to update `saved` → `ingested`.

**Issue 2 — eBay API uses source `api`, not `ebay_api`**

The `fetch-ebay-settlements` function saves with `source: 'api'` (not `'ebay_api'`). Both `api` and `ebay_api` are in `PUSHABLE_SOURCES` so this doesn't break push gating — but it creates inconsistent data. The validation sweep backfill also set `settlement_source = 'api'` from the settlements table. This is cosmetic but worth normalising.

Not blocking — no code change needed now, but worth noting.

**Issue 3 — Kogan validation row `344840` references a non-existent settlement**

The validation table has a Kogan row with `settlement_id = '344840'`, `settlement_source = NULL`, `overall_status = 'ready_to_push'`, `settlement_net = 730.65`. But **no settlement with ID `344840` exists in the `settlements` table**. This is a ghost row — likely a Shopify order ID that was written to the validation table by an older sweep version, before the source-tracking fix.

Because `settlement_source` is NULL, `isReconciliationOnly(null, ...)` returns `false`, so this ghost row appears as a pushable "Ready to Push" item. Attempting to push it would fail because no settlement data exists.

Fix: Delete orphaned validation rows where `settlement_id` doesn't exist in `settlements` AND is not a placeholder (not null).

**Issue 4 — "All Periods" count excludes recon rows but "Ready to Push" count of 10 includes the ghost Kogan row**

The summary card "Ready to Push: 10" includes the ghost Kogan `344840` row. The actual pushable count should be 9. After cleanup it will be correct.

**Issue 5 — Latest eBay payout `ebay_payout_7391507591` (Mar 18-20) has no validation row**

There's an eBay settlement with `status: 'saved'` that was never picked up by the validation sweep because it's stuck at `saved` and the sweep may not have matched it. After fixing Issue 1 (saved → ingested), the next sweep will pick it up.

**Issue 6 — Bunnings `mirakl-bunnings-ungrouped` shows as "Sync Needed" with $0 net**

This is a Mirakl API placeholder for ungrouped pending payouts. It correctly shows `settlement_needed` but with `$0` net — which means the Mirakl API returned pending orders but no completed payout yet. This is correct behavior, not a bug.

### Fix Plan

**Single migration to clean all data issues:**

```sql
-- 1. Backfill saved → ingested (was missed from earlier plan)
UPDATE public.settlements
SET status = 'ingested', updated_at = now()
WHERE status = 'saved';

-- 2. Delete orphaned validation rows referencing non-existent settlements
DELETE FROM public.marketplace_validation mv
WHERE mv.settlement_id IS NOT NULL
  AND mv.settlement_id NOT LIKE 'shopify_auto_%'
  AND NOT EXISTS (
    SELECT 1 FROM public.settlements s
    WHERE s.settlement_id = mv.settlement_id
  );

-- 3. Re-backfill settlement_source for any validation rows still NULL
UPDATE public.marketplace_validation mv
SET settlement_source = s.source
FROM public.settlements s
WHERE mv.settlement_id = s.settlement_id
  AND mv.settlement_source IS NULL;
```

**No frontend code changes needed** — once the data is cleaned, the existing UI will show correct counts.

### After Fix

| What | Before | After |
|------|--------|-------|
| Ghost Kogan "Ready to Push" | Shows as pushable | Deleted |
| eBay settlements stuck at `saved` | 6 rows stuck | Promoted to `ingested`, eligible for sweep |
| CSV settlements stuck at `saved` | 5 rows stuck | Promoted to `ingested` |
| Ready to Push count | 10 (includes ghost) | 9 (accurate) |
| Next sweep picks up eBay Mar 18-20 | No | Yes |

### Files

| File | Action |
|------|--------|
| Migration | Backfill statuses + delete orphans + fill NULL sources |

