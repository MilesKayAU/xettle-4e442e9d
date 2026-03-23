

## Plan: Add "Reconciliation Summaries" Section for API-Derived Settlements

### What This Does

Currently, `shopify_auto_*` settlements are completely hidden from the UI. The user wants them shown — but clearly separated and labeled as **reconciliation aids only**, not pushable to Xero. These help users spot missing transactions within their monthly summary accounts.

### Changes

#### 1. New "Reconciliation Summaries" tab in the sub-tab area (`ValidationSweep.tsx`)

When the `settlement_needed` filter is active, add a third sub-tab alongside "Manual Uploads" and "API Syncs":

**🔍 Reconciliation Summaries (N)**

This tab shows rows where `settlement_id` starts with `shopify_auto_` — the records we currently filter out.

#### 2. Remove the blanket `shopify_auto_` filter from `loadData`

Instead of filtering them out at load time (line 175-177), keep them in state but tag them. The `filteredRows` memo will handle which tab shows which rows:

- **Manual tab**: `!apiSyncedCodes.has(code) && !settlement_id?.startsWith('shopify_auto_')`
- **API tab**: `apiSyncedCodes.has(code) && !settlement_id?.startsWith('shopify_auto_')`
- **Reconciliation tab**: `settlement_id?.startsWith('shopify_auto_')`

#### 3. Educational banner for the Reconciliation tab

When the reconciliation sub-tab is selected, show an info banner:

> **ℹ️ These are reconciliation summaries only** — auto-generated from Shopify order data to help you identify any missing transactions in your monthly accounts. They are **not sent to Xero**. Your authoritative accounting records come from the marketplace CSV uploads or direct API settlements.

#### 4. Disable push actions on reconciliation rows

- Hide the "Push to Xero" button and bulk-select checkboxes for these rows
- Show a read-only "View" action instead
- Add a subtle `🔍 Recon Only` badge on each row

#### 5. Exclude from summary card counts

The "Upload Needed" summary card count should continue to exclude `shopify_auto_` rows. The reconciliation count only appears as a sub-tab count, not inflating the main metric.

### Files Modified

1. **`src/components/onboarding/ValidationSweep.tsx`** — Add third sub-tab, adjust filtering, add educational banner, disable push on recon rows

### Technical Detail

- `uploadSubTab` state expands from `'manual' | 'api'` to `'manual' | 'api' | 'recon'`
- `statusCounts` gains a `settlement_needed_recon` counter for `shopify_auto_` rows (counted separately from manual/api)
- Recon rows are excluded from `selectableRows` (no bulk push)
- The existing `isReconciliationOnly()` utility is reused for consistent identification

