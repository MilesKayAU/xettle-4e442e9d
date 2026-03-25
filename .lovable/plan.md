

## Plan: Inline Upload Dialog Per Row Instead of Page Navigation

### Problem
When users click "Upload" on a row in the Settlements Overview table, it navigates them away to the full upload page. They lose context, can't see their list of outstanding items, and have to go back and forth. There's no contextual guidance about what specific files are needed for that marketplace/period.

### Solution
Replace the navigate-away behavior with an inline upload dialog (modal) that:
1. Opens right on the page when clicking "Upload" on any row
2. Shows marketplace-specific guidance (e.g. Kogan needs CSV + PDF, Big W needs one CSV, etc.)
3. Shows the expected date range for that period
4. Accepts file drops/picks and processes them inline
5. Closes back to the same table view after upload completes

### Implementation

**1. Create `InlineUploadDialog` component**

File: `src/components/admin/accounting/InlineUploadDialog.tsx`

A Dialog/Sheet component that receives:
- `marketplaceCode` — which marketplace
- `periodLabel` — expected period (e.g. "2026-03-01 → 2026-03-28")
- `periodStart` / `periodEnd` — date bounds
- `onComplete` — callback to refresh the table

Content:
- Header: marketplace name + period range
- Guidance section based on marketplace:
  - **Kogan**: "Upload 2 files: a CSV (order data) and PDF (Remittance Advice) for this period"
  - **Other marketplaces**: "Upload 1 settlement CSV file for this period"
- File drop zone with file picker button
- After files are selected, show detected file names and a "Save" button
- Uses the existing `processFile` logic from SmartUploadFlow (extracted into a shared util or called directly)

**2. Update `ValidationSweep.tsx` — Wire dialog into RowAction**

Replace `onUpload={() => onSwitchToUpload?.(row.marketplace_code, row.period_label)}` with opening the new `InlineUploadDialog` with the row's marketplace and period data.

Add state for tracking which row's dialog is open:
- `uploadDialogRow: { marketplace_code, period_label, period_start, period_end } | null`

When upload completes, close dialog and re-run the sweep to refresh the table.

**3. Update `ActionCentre.tsx` — Wire dialog into "Upload now" and individual rows**

Same pattern: instead of `onSwitchToUpload(buildMissingList())`, open the inline dialog for the specific marketplace. The "Upload now" button at the bottom can still navigate to the full upload page for bulk uploads, but individual row items get inline dialogs.

### Marketplace Guidance Map

Built into the dialog component:
```
kogan → "2 files required: CSV (order data) + PDF (Remittance Advice)"
bigw → "1 file: CSV settlement report from Big W Marketplace Hub"
mydeal → "1 file: CSV settlement report from MyDeal Seller Portal"
everyday_market → "1 file: CSV settlement report"
default → "1 file: Settlement CSV for this period"
```

Each entry also shows the expected date range from the validation row.

### Files Modified

| File | Changes |
|------|---------|
| `src/components/admin/accounting/InlineUploadDialog.tsx` | **New** — Modal with marketplace-specific guidance, file drop zone, inline processing |
| `src/components/onboarding/ValidationSweep.tsx` | Add dialog state; change RowAction upload to open dialog instead of navigating |
| `src/components/dashboard/ActionCentre.tsx` | Add dialog state for individual upload items; keep bulk "Upload now" as page navigation |

### No database changes needed

