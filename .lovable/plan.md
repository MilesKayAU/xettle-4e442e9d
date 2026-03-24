


## Plan: Fix Bunnings (and All Mirakl) Shipping Undercount

### Status: ✅ Implemented

Cross-reference order counts from `shopify_auto_*` settlements applied to `recalculate-profit/index.ts`.

---

## Plan: Kogan CSV + PDF Upload Support

### Status: ✅ Implemented

Added Kogan Remittance Advice PDF parser and merge flow.

### What Was Done

1. **Created `src/utils/kogan-remittance-parser.ts`** — Extracts line items (Journal Entry, A/P Invoice, A/P Credit note), total paid amount, advertising fees, monthly seller fees, and returns from Kogan PDFs.

2. **Updated `src/utils/file-marketplace-detector.ts`** — Added Kogan PDF and filename detection (`kogan`, `kgn-` prefix).

3. **Updated `src/utils/file-fingerprint-engine.ts`** — Added Kogan PDF fingerprint detection with content-based fallback.

4. **Updated `src/components/admin/accounting/SmartUploadFlow.tsx`**:
   - Kogan PDF parsed during pre-parse (returns empty settlements — it's a companion file)
   - On save of Kogan CSV, checks for a Kogan PDF in the upload list
   - Merges PDF data: overrides net_payout with bank deposit, adds returns/refunds, ad spend, monthly seller fee to fees
   - Marks PDF as "saved" after merge
   - Updated source hint to instruct users to upload both files

### How It Works

Upload both files together:
- **CSV** provides order-level detail (gross sales, commission per order)
- **PDF** provides settlement-level adjustments (returns, ad spend, seller fees, bank deposit)

Result:
```text
gross_sales = Sum of CSV "Total" column          = $1,131.96
fees        = CSV commission + PDF ad spend + fee = $149.72 + $100.10 + $55.00
refunds     = PDF credit notes (returns)          = $57.80
net_payout  = PDF "Total paid amount"             = $753.86
```

### No database changes needed
