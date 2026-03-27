

## Woolworths Dedicated Upload UX

### The Problem
Currently, the "Upload" button on the Woolworths payments view sends users to the generic Smart Upload page — a completely different context. Users lose sight of which Payment IDs need files, and the Smart Upload doesn't understand the Woolworths payment structure.

### The Design

Embed a Woolworths-specific upload zone directly inside `WoolworthsPaymentsView`, replacing the current "Smart Upload →" redirect. Two modes:

**Mode A — Bulk upload (top of page)**
A compact drop zone replaces the current dashed card at the bottom. Sits between the stats row and the table:

```text
┌──────────────────────────────────────────────────────┐
│  📦 Upload Woolworths Files                          │
│                                                      │
│  ┌────────────────────────────────────────────────┐  │
│  │  Drop ZIP, CSV, or PDF files here              │  │
│  │  Xettle extracts and matches automatically     │  │
│  │              [Browse files]                     │  │
│  └────────────────────────────────────────────────┘  │
│                                                      │
│  After drop:                                         │
│  ✅ Extracted 4 files from zip                       │
│  ✅ CSV → matched to Payment 293603                  │
│  ✅ BigW PDF → matched to 293603                     │
│  ✅ EM PDF → matched to 293603                       │
│  ✅ MyDeal PDF → matched to 293603                   │
│  [Confirm & Process]                                 │
└──────────────────────────────────────────────────────┘
```

**Mode B — Per-row upload (inline)**
When a payment row shows ❌ for CSV or PDF, clicking the Upload button on that row opens a small inline drop zone scoped to that Payment ID only. Files dropped there are tagged to that specific payment.

### Key UX Improvements

1. **Upload zone lives on the Woolworths page** — no context switch to Smart Upload
2. **Zip extraction happens inline** with a file-by-file progress list showing what was found
3. **Auto-matching** — extracted files are matched to Payment IDs using the CSV's `Bank Payment Ref` column and PDF filenames
4. **Per-row upload** for targeted "just need this one PDF" scenarios
5. **Processing feedback** stays on the same page — the table updates in real-time as settlements are created

### Technical Approach

**File: `WoolworthsPaymentsView.tsx`**

1. Add a collapsible upload zone between the stats cards and the payments table
2. Import `JSZip` and reuse the zip extraction logic from `SmartUploadFlow.tsx`
3. Reuse existing parsers (`parseWoolworthsMarketPlusCSV`, PDF detection) — just call them directly instead of going through the full SmartUpload pipeline
4. After processing, call `loadData()` to refresh the table — settlements appear immediately in their correct Payment ID rows
5. Replace the bottom "Smart Upload →" card with the inline upload zone
6. Add per-row upload: when `onSwitchToUpload` is clicked on a specific row, expand an inline file input for that payment

**No new components needed** — the upload zone is embedded directly in the existing view. The existing parsers and `saveSettlement` utility handle all the backend logic.

