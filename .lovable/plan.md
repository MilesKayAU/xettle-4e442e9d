

## Plan: Fix Overly Aggressive Recon-Only Gating

### Root Cause

The `ValidationSweep` component hardcodes `'api_sync'` as the source in every `isReconciliationOnly()` call (lines 303, 326, 328, 334, 372, 427, 725, 767, 795). Since `api_sync` is not in `PUSHABLE_SOURCES`, **every single row** is treated as "Recon Only" — including real CSV-uploaded Bunnings, BigW, MyDeal, and Kogan settlements that bookkeepers need to push.

The only settlements that should be "Recon Only" are Shopify auto-generated summaries (`settlement_id` starting with `shopify_auto_`). Everything uploaded via CSV or fetched from a payout API (eBay, Mirakl, Amazon) is a real settlement and must be pushable.

### Fix

**Step 1 — Add `settlement_source` to `marketplace_validation` table**

Migration to add a `settlement_source text` column. This stores the actual source (`csv_upload`, `api_sync`, `manual`, etc.) so the UI can gate correctly without joining to the `settlements` table.

**Step 2 — Backfill `settlement_source` from `settlements`**

In the same migration, backfill existing rows:
```sql
UPDATE marketplace_validation mv
SET settlement_source = s.source
FROM settlements s
WHERE mv.settlement_id = s.settlement_id
  AND mv.settlement_source IS NULL;
```

**Step 3 — Update `run-validation-sweep` edge function**

When the sweep upserts validation rows, include `settlement_source` from the matched settlement's `source` field.

**Step 4 — Update `ValidationSweep.tsx`**

- Add `settlement_source` to the `ValidationRow` interface
- Replace all `isReconciliationOnly('api_sync', ...)` calls with `isReconciliationOnly(row.settlement_source, ...)` — using the actual source
- This means CSV-uploaded Bunnings/BigW/MyDeal/Kogan rows will correctly show as pushable (source = `csv_upload`), while Shopify auto-summaries (source = `api_sync`, settlement_id = `shopify_auto_*`) remain Recon Only

**Step 5 — Update `Dashboard.tsx` badge counts**

The badge count queries already use `marketplace_validation.overall_status` which is correct. No change needed — the trigger `calculate_validation_status` already sets `ready_to_push` based on reconciliation status, not source. The Recon Only badge was purely a UI-layer problem in `ValidationSweep`.

### What Changes

| File | Changes |
|------|---------|
| Migration | Add `settlement_source text` column + backfill from `settlements` |
| `supabase/functions/run-validation-sweep/index.ts` | Include `settlement_source` in upsert |
| `src/components/onboarding/ValidationSweep.tsx` | Use `row.settlement_source` instead of hardcoded `'api_sync'` |

### What Stays Recon Only

- Shopify auto-generated summaries (`source = 'api_sync'` + `settlement_id` starts with `shopify_auto_`)
- Any future order-level-only sources not in the `PUSHABLE_SOURCES` allowlist

### What Becomes Pushable (correctly)

- Bunnings CSV uploads → `source = 'csv_upload'` ✓
- BigW CSV uploads → `source = 'csv_upload'` ✓
- MyDeal CSV uploads → `source = 'csv_upload'` ✓
- Kogan CSV uploads → `source = 'csv_upload'` ✓
- Everyday Market CSV uploads → `source = 'csv_upload'` ✓
- eBay API settlements → `source = 'ebay_api'` ✓
- Mirakl API settlements → `source = 'mirakl_api'` ✓

