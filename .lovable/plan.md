

## Fix: Phantom "Sync Needed" Rows in Settlements Overview

### Root Cause (from DB query)

The Bunnings/Shopify rows showing "Sync Needed" all have `settlement_id` values like `shopify_auto_bunnings_2026-01_9d34d250`. These are **reconciliation-only** settlements auto-generated from Shopify order data — not real Mirakl API settlements. The DB trigger correctly forces `overall_status = 'settlement_needed'` for any settlement matching `shopify_auto_%`, but the validation sweep still creates period rows from these settlements, resulting in phantom entries.

Meanwhile, the **real** Mirakl API settlements (e.g. `BUN-2301-2026-02-27`) are correctly marked as `already_recorded`. The problem is just the recon-only ghost rows cluttering the overview.

### Changes

#### 1. Fix validation sweep period generation (`supabase/functions/run-validation-sweep/index.ts`)

Line ~498: The `periodKeys` loop currently includes ALL non-suppressed settlements. Add the same `isReconciliationOnly` filter that's already used for `settlementMap`:

```typescript
// Before (creates phantom periods from shopify_auto_ settlements):
if (s.marketplace === mc && s.status !== 'duplicate_suppressed')

// After:
if (s.marketplace === mc && s.status !== 'duplicate_suppressed' 
    && !isReconciliationOnly(s.source, s.marketplace, s.settlement_id))
```

This prevents recon-only settlements from generating period rows in the first place.

#### 2. Clean up existing stale rows (DB migration)

Delete `marketplace_validation` rows that reference `shopify_auto_` settlement IDs — these are phantom entries that shouldn't exist:

```sql
DELETE FROM marketplace_validation 
WHERE settlement_id LIKE 'shopify_auto_%'
  AND overall_status IN ('settlement_needed', 'missing');
```

#### 3. UI safety net (`ValidationSweep.tsx`)

Add a filter in `loadData` to exclude any rows with `shopify_auto_` settlement IDs from display. This is belt-and-suspenders — prevents any future phantom rows from showing even if the sweep hasn't been re-run yet.

### Files Modified
1. **`supabase/functions/run-validation-sweep/index.ts`** — exclude recon-only settlements from period key generation
2. **DB migration** — clean up existing phantom rows
3. **`src/components/onboarding/ValidationSweep.tsx`** — filter out recon-only rows from display

### Result
- No more phantom "Sync Needed" rows for Bunnings/Shopify in the API tab
- Real Mirakl settlements continue to show correctly as `already_recorded`
- The daily sync will stop regenerating these phantom rows

