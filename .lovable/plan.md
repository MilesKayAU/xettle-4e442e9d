

## Fix: `marketplace_validation` out of sync with `settlements` status

### Problem
The "Ready to Push" count of 40 on the Overview tab comes from the `marketplace_validation` table, which was **not updated** when we previously corrected 36 settlements to `already_recorded` status. The `marketplace_validation.overall_status` still says `ready_to_push` for those 36 rows, plus 14 others whose settlements are only `ingested`.

Breakdown of the 55 `ready_to_push` validation rows:
- **36** → settlement is `already_recorded` (should show as Complete)
- **14** → settlement is `ingested` (should show as Upload Needed or Needs Sync)
- **4** → settlement is genuinely `ready_to_push` (correct — 1 Amazon + 3 Shopify)
- **1** → settlement is `saved` (should not be ready_to_push)

### Changes

**1. Data fix — SQL migration to re-sync `marketplace_validation`**

Update `marketplace_validation.overall_status` based on the linked settlement's actual status:
- Where settlement is `already_recorded` or `pushed_to_xero` → set validation to `complete`
- Where settlement is `ingested` or `saved` → set validation to `settlement_needed`

This brings the count down from 55 to ~4 genuine ready-to-push rows.

**2. Guard in ValidationSweep — cross-check settlement status**

In `ValidationSweep.tsx`, when computing `actionableRows` and `counts`, cross-reference the settlement status. Add a sync-on-load step (similar to `RecentSettlements.tsx` bulk-promote logic) that detects and fixes `marketplace_validation` rows whose `overall_status` doesn't match the linked settlement.

**3. Guard in validation sweep edge function**

In `supabase/functions/run-validation-sweep/index.ts`, when setting `overall_status = 'ready_to_push'`, verify that the linked settlement's status is actually `ready_to_push` (not `already_recorded` or `ingested`).

### Files

| File | Change |
|------|--------|
| Database migration | Bulk-fix 51 mismatched `marketplace_validation` rows |
| `src/components/onboarding/ValidationSweep.tsx` | Add on-load sync guard to detect and fix stale validation statuses |
| `supabase/functions/run-validation-sweep/index.ts` | Check settlement status before setting `ready_to_push` |

