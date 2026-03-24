

## Plan: Kogan Multi-File Pairing with Missing File Warnings

### Problem

When users upload multiple Kogan files (CSVs + PDFs), the system processes them individually. There's no visual indication of:
- Which CSV is paired with which PDF (matched by AP Invoice number)
- Which settlements are missing their PDF (and therefore have inaccurate net payout)
- Which PDFs are missing their CSV (orphaned remittance advice)

Without the PDF, the net payout is wrong (e.g., $966 instead of $753), fees are understated, and Xero reconciliation will fail against the bank feed.

### Fix

**1. Group Kogan files into settlement pairs after detection**

After all files finish detecting, run a pairing pass for Kogan files:
- Extract the AP Invoice doc number from each CSV settlement (already in `settlement_id`)
- Parse each Kogan PDF to get its line items' doc numbers
- Match CSVs to PDFs by doc number overlap
- Track: paired (both files), CSV-only (missing PDF), PDF-only (missing CSV)

**2. Show a Kogan pairing summary card**

When 2+ Kogan files are detected, replace the individual file cards with a grouped "Kogan Settlement Upload" card showing:

```text
┌─────────────────────────────────────────────────┐
│ Kogan Settlements                               │
│                                                  │
│ ✅ Settlement 360140 — Feb 2026                  │
│    CSV: KGN-...360140_2.csv                      │
│    PDF: Kogan_3599603.pdf                        │
│    Net: $753.86 (bank deposit from PDF)          │
│                                                  │
│ ⚠️ Settlement 362490 — Mar 2026                  │
│    CSV: KGN-...362490_1.csv                      │
│    ⚠ Missing PDF — net payout may not match bank │
│    Net: $1,042.18 (CSV only — excludes returns,  │
│         ad spend, seller fees)                   │
│                                                  │
│ [Upload missing PDFs]  [Save All]                │
└─────────────────────────────────────────────────┘
```

**3. Warning banner when saving CSV-only Kogan settlements**

If a Kogan CSV is saved without its PDF:
- Show an amber warning: "This settlement's net payout ($X) may not match your bank deposit. Upload the Kogan Remittance PDF to include returns, ad fees, and seller fees."
- Still allow saving (CSV data is valid for order details) but flag it clearly
- Store `metadata.missingPdf = true` so it can be flagged in the settlements table later

**4. Allow late PDF upload to augment existing settlements**

If a Kogan PDF is uploaded and its matching settlement already exists in the DB:
- Detect the match via AP Invoice doc number
- Offer to update the existing settlement with the PDF deductions
- This handles the "upload CSV now, PDF later" workflow

### Implementation Details

**File: `src/components/admin/accounting/SmartUploadFlow.tsx`**

- Add a `useEffect` after detection completes that groups Kogan files by doc number
- Add a new `KoganPairingCard` component (inline in same file) that replaces individual FileResultCards for Kogan files
- The pairing card shows each settlement group with its file status
- Add "Upload missing PDF" button that opens the file picker filtered to PDFs
- On save: if CSV-only, add `missingPdf: true` to metadata and show warning toast
- On late PDF upload: check DB for existing settlement, offer merge

**File: `src/utils/kogan-remittance-parser.ts`**

- Add a lightweight `extractKoganPdfDocNumbers(file: File): Promise<string[]>` function that quickly extracts just the doc numbers without full parsing — used for pairing

### No database changes needed

### Files Modified

| File | Changes |
|------|---------|
| `src/components/admin/accounting/SmartUploadFlow.tsx` | Add Kogan file pairing logic, KoganPairingCard component, missing-PDF warnings, late PDF merge |
| `src/utils/kogan-remittance-parser.ts` | Add lightweight doc number extraction for pairing |

