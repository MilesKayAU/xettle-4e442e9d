

## Plan: Wire Kogan Uploads Into Dashboard Cards and Validation Pipeline

### Problem

After uploading Kogan PDFs (and CSVs), the dashboard cards ("Upload Needed", "Ready for Xero", etc.) don't reflect the new data. The homepage and Settlements Overview rely on `marketplace_validation` rows, which are only updated by the validation sweep. Two gaps exist:

1. **`mergeKoganPdfToExisting()` in SmartUploadFlow never triggers a validation sweep** — after merging a PDF into a DB settlement, the dashboard stays stale
2. **The validation sweep edge function doesn't create `settlement_needed` rows for Kogan periods** that need CSV uploads — it doesn't know Kogan requires CSV+PDF pairs, so Kogan never appears in "Upload Needed"

### Fix

**1. Trigger validation sweep after Kogan PDF merge**

File: `src/components/admin/accounting/SmartUploadFlow.tsx`

After the successful `mergeKoganPdfToExisting` update (around line 1576), call `triggerValidationSweep()` — same as the canonical save path does. This ensures dashboard cards refresh after any Kogan PDF merge.

**2. Trigger validation sweep after `processAllConfirmed` completes**

File: `src/components/admin/accounting/SmartUploadFlow.tsx`

After the `processAllConfirmed` loop finishes (line 1404), add a `triggerValidationSweep()` call. While individual saves already trigger it, a final sweep ensures the dashboard is fully consistent after bulk operations.

**3. Add Kogan period awareness to the validation sweep**

File: `supabase/functions/run-validation-sweep/index.ts`

Currently the sweep discovers expected periods from `marketplace_connections` + order data. Kogan periods where auto-generated settlements exist (`shopify_auto_kogan_*`) but no CSV-sourced settlement has been uploaded should generate `settlement_needed` rows. This makes Kogan appear in the "Upload Needed" card on the dashboard.

- When processing Kogan marketplace periods, check if the settlement source is `shopify_auto_*` (recon-only)
- If so, mark as `settlement_needed` with a note like "CSV upload required"
- If a CSV-sourced Kogan settlement exists but `metadata.missingPdf = true`, show it as needing attention but still pushable

### Files Modified

| File | Changes |
|------|---------|
| `src/components/admin/accounting/SmartUploadFlow.tsx` | Add `triggerValidationSweep()` after PDF merge and after bulk save completion |
| `supabase/functions/run-validation-sweep/index.ts` | Ensure Kogan auto-generated settlements create `settlement_needed` validation rows |

### No database changes needed

