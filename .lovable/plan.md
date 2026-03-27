

# Add "Re-sync via API" Button for Gap Resolution

## Problem
The `verify-settlement` edge function already exists and can auto-correct settlement figures by fetching live data from marketplace APIs (Mirakl/Bunnings, eBay, Amazon). However, this button is only available in the admin `SettlementsOverview` page — it's never surfaced in the per-marketplace `GenericMarketplaceDashboard` where users actually see and manage their gaps.

## What Changes

### 1. Add a "Re-sync" button on settlement rows with gaps (API-connected marketplaces only)

In `GenericMarketplaceDashboard.tsx`, next to the existing "Edit Figures" and "Acknowledge Gap" actions on settlements that have a reconciliation gap, add a **"Re-sync via API"** button — but **only** when the marketplace is API-capable (using the existing `API_CAPABLE_CODES` set + `isCsvOnly` check).

The button will:
- Call `supabase.functions.invoke('verify-settlement', { body: { settlement_id } })`
- Show a loading spinner while running
- On success: toast the result (corrected values or "already matched"), reload settlements
- On failure: toast error with guidance

### 2. Update the gap diagnosis panel

When a gap is detected and the marketplace is API-connected, the "Likely cause" section will include a note like:
> "This marketplace has an API connection — try **Re-sync** to fetch corrected figures automatically."

For CSV-only marketplaces (Kogan, MyDeal), the existing guidance stays unchanged (upload PDF, edit figures manually).

### 3. Add Bunnings to API_CAPABLE_CODES

The current `API_CAPABLE_CODES` set is missing `bunnings` (which uses Mirakl API). Add it so Bunnings settlements show the re-sync option.

## Files to modify

- **`src/components/admin/accounting/GenericMarketplaceDashboard.tsx`**:
  - Add `bunnings` to `API_CAPABLE_CODES`
  - Add re-sync button with loading state in the gap actions area
  - Update gap diagnosis tooltip to mention API re-sync when available

## No new files needed
The `verify-settlement` edge function and all API routing logic already exist.

