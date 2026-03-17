

## Problem

The Settlements Overview tab shows "Upload Needed" with an "Upload" button for Amazon AU and eBay AU settlements — even though these are API-connected marketplaces. The ActionCentre (Dashboard) already filters these out using `apiSyncedMarketplaces`, but the ValidationSweep component does not.

Two changes are needed:

1. **For API-connected marketplaces, show "Sync" instead of "Upload"** — the label should say "Sync Needed" (not "Upload Needed") and the action button should trigger an API sync rather than navigate to the upload page.

2. **Add a "Sync Now" action** so the user can request a marketplace sync directly from the Overview row.

## Changes

### 1. ValidationSweep — detect API-synced marketplaces

In `src/components/onboarding/ValidationSweep.tsx`:

- On mount, query `marketplace_connections` for connected marketplaces (same pattern ActionCentre uses) to build an `apiSyncedCodes` set.
- Also query `settlements` with `source = 'api_sync'` to catch marketplaces that have API-fetched data.

### 2. ValidationSweep — update status labels and counts

- For rows where `overall_status === 'settlement_needed'` or `'missing'` AND the marketplace is API-synced:
  - Change the status badge label from "Upload Needed" / "Missing" to "Sync Needed"
  - Change the summary card label to split counts: show "Upload Needed" for CSV-only, and include a note or separate count for sync-needed items

### 3. RowAction — show "Sync" button for API marketplaces

In the `RowAction` component at the bottom of `ValidationSweep.tsx`:

- When `settlement_needed` or `missing` AND marketplace is API-synced → show a "Sync" button (with RefreshCw icon) instead of "Upload"
- The Sync button calls `runMarketplaceSync(row.marketplace_code)` from `src/actions/sync.ts`
- Show a loading spinner while syncing, then refresh the validation data

### 4. Summary card — combined count with context

- The "Upload Needed" summary card count should still include both upload and sync items (to show total attention needed)
- But the label on the card could say "Action Needed" or keep "Upload Needed" with a tooltip explaining some can be synced via API

### Files modified

- `src/components/onboarding/ValidationSweep.tsx` — add API marketplace detection, update RowAction, update status badge labels
- No edge function or database changes needed — the existing `scheduled-sync` and `fetch-amazon-settlements` / `fetch-ebay-settlements` functions handle the actual sync

