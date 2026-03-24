

## Analysis: Kogan CSV + PDF Upload Support

### What Works Now

**The CSV will be detected and parsed correctly.** The fingerprint engine has a Kogan entry matching on `APInvoice`, `InvoiceRef`, `Commission (Inc GST)`, `Remitted` columns. The column mapping uses partial matching, so `Total` in the CSV matches `Total (AUD)` in the mapping. Each row becomes a settlement line item, grouped by `APInvoice` number (e.g., 360140). The result: a settlement showing gross sales, commission fees, and net remitted per order.

**The PDF will NOT be understood.** The system currently only parses Bunnings Mirakl PDFs. For all other PDFs, the fingerprint engine returns `null`. The Kogan PDF would be silently ignored or trigger an "unknown file" error.

### Why the PDF Matters

The Kogan PDF is a **Remittance Advice** containing data NOT in the CSV:

| Item | Source | In CSV? |
|------|--------|---------|
| Sales + commission per order | CSV rows | Yes |
| **Returns / credit notes** | PDF line "A/P Credit note" | No — $49.44 + $8.36 |
| **Monthly seller fee** | PDF line "Monthly Seller Fee" | No — $55.00 |
| **Advertising fees** | PDF line "Journal Entry - Advertising fees" | No — $100.10 |
| **Actual bank deposit** | PDF "Total paid amount" | No — $753.86 |

From the Feb 2026 PDF:
```text
A/P Invoice 360140 (CSV total):     $966.76
- Credit note (returns):             -$49.44
- Credit note (per-order fee):        -$8.36
- Monthly seller fee:                -$55.00
- Advertising fees:                 -$100.10
= Bank deposit:                     $753.86
```

Without the PDF, the settlement shows $966.76 net payout (from CSV `Remitted` column sum). The actual bank deposit is $753.86 — a $212.90 difference. This means reconciliation against the bank feed will fail, and the Xero invoice will be wrong.

### Fix Plan

**Add a Kogan PDF parser** that extracts the remittance advice table, then merges the data with the CSV settlement.

**1. Parse Kogan PDF (server-side)**

File: `supabase/functions/ai-file-interpreter/index.ts` (or new `parse-kogan-pdf` function)

Use the existing AI file interpreter to extract the structured table from the Kogan remittance PDF. The format is consistent:
- Line items with type (Journal Entry, A/P Invoice, A/P Credit note)
- Doc number matching the CSV's `APInvoice` 
- Amounts with AUD suffix
- Total paid amount = bank deposit

**2. Add Kogan PDF fingerprint detection**

File: `src/utils/file-marketplace-detector.ts`

Add detection for Kogan PDFs by checking for "Remittance Advice" + "Kogan Australia" or "kogan.com" in the first 8KB of the PDF.

**3. Create Kogan-specific upload flow**

File: `src/components/admin/accounting/GenericMarketplaceDashboard.tsx` (or new Kogan component)

Similar to how Bunnings handles PDF + CSV:
- Accept both PDF and CSV uploads
- CSV provides order-level detail (line items)
- PDF provides the settlement summary (returns, fees, ad spend, bank deposit)
- Merge: use CSV for line items, override net payout with PDF's "Total paid amount", add credit notes and fees as additional settlement components

**4. Update settlement save to include PDF-sourced deductions**

When both files are present:
```text
gross_sales = Sum of CSV "Total" column          = $1,131.96
fees        = Sum of CSV "Commission (Inc GST)"  = $149.72
refunds     = Sum of PDF credit notes            = $57.80
ad_spend    = Sum of PDF "Journal Entry" amounts  = $100.10
monthly_fee = Sum of PDF "Monthly Seller Fee"     = $55.00
net_payout  = PDF "Total paid amount"             = $753.86
```

This gives accurate reconciliation against the bank feed.

### Files to Modify

| File | Changes |
|------|---------|
| `src/utils/file-marketplace-detector.ts` | Add Kogan PDF detection |
| `src/utils/file-fingerprint-engine.ts` | Add Kogan PDF fingerprint entry |
| `src/components/admin/accounting/GenericMarketplaceDashboard.tsx` | Add PDF+CSV upload flow for Kogan |
| `supabase/functions/ai-file-interpreter/index.ts` | Add Kogan remittance PDF extraction logic |
| `src/utils/generic-csv-parser.ts` | No changes needed — CSV parsing already works |

### No database schema changes needed

The existing `settlements` and `settlement_lines` tables can store the additional fee components. Ad spend and monthly fees go into existing fee/adjustment fields.

