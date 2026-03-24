

## Plan: Fix Kogan CSV Parsing — Dates Missing and Garbage Settlement Groups

### Root Cause

The database shows **every Kogan CSV save attempt fails** with `format_missing_dates_requires_manual_entry`. The system events reveal the CSV is being split into garbage groups with settlement IDs like:
- `APCreditNote` (header text)
- `------------------------------` (separator line)
- `ungrouped` (fallback)
- `Monthly Marketplace Seller Fee` (non-order row)
- `286964`, `362490` (actual AP Invoice numbers — correct but dateless)

The Kogan CSV fingerprint maps `settlement_id → APInvoice` and `period_start → InvoiceDate`. The generic CSV parser groups rows by `APInvoice`, but:
1. Non-data rows (headers, separators, credit note labels) become their own "settlements"
2. The `InvoiceDate` column is empty or unparseable for many rows, so `period_start` and `period_end` end up null
3. The date gate hard-blocks the save

### Fix (3 parts)

**1. Add Kogan-specific pre-processing to filter junk rows before parsing**

File: `src/components/admin/accounting/SmartUploadFlow.tsx` (in `processFile`, around the Kogan CSV merge block)

Before passing Kogan CSV to the generic parser, pre-filter the CSV text:
- Strip rows where the `APInvoice` column is empty, a separator (`---`), or matches known non-settlement labels (`APCreditNote`, `Monthly Marketplace Seller Fee`)
- This prevents the generic parser from creating garbage settlement groups

**2. Ensure dates are extracted from Kogan CSVs**

File: `src/utils/generic-csv-parser.ts`

The date parser may be failing on Kogan's date format. Check and handle the `InvoiceDate` column format (likely `DD/MM/YYYY` or `YYYY-MM-DD`). If the mapped date column has no parseable dates in a group, fall back to extracting dates from other columns like `DateManifested` or `DateRemitted`.

**3. Add Kogan CSV as a dedicated parser path (like Bunnings/Shopify)**

File: `src/components/admin/accounting/SmartUploadFlow.tsx`

Add a Kogan-specific branch in `processFile` (alongside the existing `bunnings`, `shopify_payments`, `shopify_orders` branches):
- Pre-filter non-data rows from the CSV
- Group remaining rows by `APInvoice` number
- Extract dates from `InvoiceDate` or `DateManifested` columns
- Calculate sales, fees, and net from `Total (AUD)`, `Commission (Inc GST)`, `Remitted` columns
- Produce properly formed `StandardSettlement[]` objects with valid dates

This dedicated path ensures Kogan CSVs never hit the generic parser's edge cases.

### Files Modified

| File | Changes |
|------|---------|
| `src/components/admin/accounting/SmartUploadFlow.tsx` | Add Kogan CSV dedicated parsing branch in `processFile`; pre-filter junk rows |
| `src/utils/kogan-remittance-parser.ts` | Add `parseKoganPayoutCSV()` function for CSV parsing (alongside existing PDF parser) |

### No database changes needed

### Expected Outcome
- Kogan CSVs save successfully with correct dates and settlement IDs
- Junk rows (separators, credit note headers, seller fee rows) are filtered out
- Each AP Invoice number becomes one settlement with valid period dates
- PDF pairing then works via period-based matching as already implemented

