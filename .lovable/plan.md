

## Smarter "Upload Needed" — Split Manual vs API Counts

### Problem
The Settlements Overview "Upload Needed" summary card shows **32** — but many of those are API-connected channels (Bunnings via Mirakl, Shopify) that sync automatically. This creates unnecessary panic. The homepage ActionCentre already filters to manual-only uploads, but the Settlements page doesn't, and neither surface clearly communicates "X are API, don't worry about those."

### Current State
- **Settlements Overview (`ValidationSweep.tsx`)**: `statusCounts.settlement_needed` counts ALL `settlement_needed`/`missing` rows — no API/manual split. The guidance banner (lines 438-460) already splits when the filter is clicked, but the **summary card itself** just shows the raw total.
- **Homepage (`ActionCentre.tsx`)**: Already filters to `uploadNeededManual` (excludes `connectedApiMarketplaces`), but doesn't mention how many API syncs are pending.
- **`apiSyncedCodes`** is already computed in both components from `marketplace_connections` with `isApiConnectionType()`.

### Changes

#### 1. Split the "Upload Needed" summary card (`ValidationSweep.tsx`)

Update `statusCounts` to track `settlement_needed_manual` and `settlement_needed_api` separately using `apiSyncedCodes`:

```
statusCounts = {
  settlement_needed: total,          // keeps filter working
  settlement_needed_manual: X,       // manual-upload channels
  settlement_needed_api: Y,          // API-synced channels
}
```

Update the SummaryCard display:
- Label: **"Upload Needed"** → show `manual` count prominently
- Subtitle: "X manual · Y auto-sync" in smaller text below the number
- The card still filters to all `settlement_needed` rows when clicked (so user can see both)

#### 2. Update homepage "Manual Uploads Needed" card (`ActionCentre.tsx`)

Add a small note showing how many API-synced periods are also pending:
- Below the manual upload list, add: "Plus X API-connected periods — these sync automatically."
- This reassures users that the system is aware of the API channels

#### 3. Update the "Upload Needed" guidance banner (`ValidationSweep.tsx`)

Already correctly splits — no change needed. Just ensure the summary card count aligns.

### Files Modified
1. **`src/components/onboarding/ValidationSweep.tsx`** — split statusCounts, update SummaryCard to show manual/api breakdown
2. **`src/components/dashboard/ActionCentre.tsx`** — add "Plus X API-connected periods" note to the manual uploads card

### Result
- Summary card shows "25 manual · 7 auto-sync" instead of a scary "32"
- Homepage card mentions pending API syncs so users know the system is tracking them
- No functional changes to filtering or row actions

