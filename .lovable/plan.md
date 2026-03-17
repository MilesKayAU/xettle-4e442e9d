

## Problem Analysis

Looking at the screenshots, I see two distinct issues:

**Issue 1: Rows showing "Uploaded" in Settlement column but "Sync Needed" status**
The eBay AU and Amazon AU rows in image-403 show a green "Uploaded" checkmark in the Settlement column alongside $31.14 net payout — but the status badge reads "Sync Needed". This is contradictory. If `settlement_uploaded = true`, the DB trigger should compute `ready_to_push` (not `settlement_needed`).

**Root cause:** The validation sweep builds a settlement lookup key as `marketplace_code|period_start → period_end` (line 516-517 of `run-validation-sweep`). When the sweep iterates connections and finds settlements matching `s.marketplace === mc`, it collects their exact period dates. But the sweep only stores ONE settlement per key (`Map.set` overwrites). If multiple settlements share the same marketplace+period (the three identical eBay AU $31.14 rows), only the last one gets matched — and the validation row for the others gets created WITHOUT `settlement_uploaded = true`, triggering the `missing` branch in the DB trigger.

Additionally, those three identical $31.14 eBay AU rows are likely **duplicates** that the dedup pass should catch but isn't — possibly because they have different `settlement_id` values or slightly different period dates.

**Issue 2: CSV-only marketplaces showing "Upload Needed" / "Missing" is correct behavior** — Kogan, MyDeal, Big W, Bunnings, Catch don't have API sync, so those statuses are accurate.

## Plan

### 1. Fix duplicate eBay settlements appearing as separate validation rows
**File:** `supabase/functions/run-validation-sweep/index.ts` (lines 403-407)

The `settlementMap` uses `Map.set()` which keeps only the last settlement per key. When multiple settlements exist for the same marketplace+period (duplicates or split payouts), all but the last are orphaned in the validation grid.

**Change:** Instead of storing a single settlement, store an array — then when building the validation record, pick the best one (prefer `pushed_to_xero` > `ready_to_push` > `ingested`, and use the highest `bank_deposit`). Also mark `settlement_uploaded = true` if ANY settlement exists for that period.

### 2. Exclude `duplicate_suppressed` settlements from period key generation
**File:** `supabase/functions/run-validation-sweep/index.ts` (lines 466-468)

Currently the period key loop iterates ALL settlements for a marketplace, including `duplicate_suppressed` ones. This creates validation rows for periods that only have suppressed duplicates, which then show as "Sync Needed" because the settlement lookup skips suppressed records.

**Change:** Add `&& s.status !== 'duplicate_suppressed'` to the period key filter.

### 3. Strengthen the dedup pass for identical eBay payouts
**File:** `supabase/functions/run-validation-sweep/index.ts` (dedup pass, lines 101-165)

The three identical $31.14 eBay AU Feb 26 rows suggest the dedup pass isn't catching them — possibly because their `settlement_id` values differ (API-fetched vs CSV-uploaded). The current dedup groups by `marketplace|period_start|period_end` and checks amount within ±$0.05, which should work. Need to ensure the `status !== 'duplicate_suppressed'` check in the inner loop isn't prematurely skipping.

**Change:** After dedup, filter the `settlements` array used for the rest of the sweep to exclude newly suppressed duplicates, preventing them from creating phantom validation rows.

### 4. Fix validation rows where settlement exists but status shows "settlement_needed"
**File:** `supabase/functions/run-validation-sweep/index.ts` (lines 559-587)

Add a safety net: when the sweep finds a settlement for a period, always set `settlement_uploaded = true` regardless of the settlement's internal status. Currently this is implicit (line 561) but the settlement lookup at line 517 might return `undefined` if the key doesn't match — which means `settlement_uploaded` stays `false` in the upserted record, and the DB trigger computes `missing` or `settlement_needed`.

**Change:** After building all period keys from real settlements, ensure the settlement lookup is robust by also trying normalized key variations (e.g., trimming whitespace in period dates).

### Technical Details

**Edge function deployment:** The `run-validation-sweep` changes will auto-deploy.

**No frontend changes needed** — the `ValidationSweep.tsx` component already reads from `marketplace_validation` correctly. The bug is in how the sweep populates that table.

**Files affected:**
- `supabase/functions/run-validation-sweep/index.ts` — 4 targeted edits to the sweep logic

