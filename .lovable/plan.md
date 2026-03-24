

## Plan: Fix Rules Panel Auto-Close + Wire Universal Tab Data

### Two Issues

**Issue 1 — Rules panel stays open after save**
In `InventoryDashboard.tsx`, the `onSave` callback passed to `InventoryRulesPanel` calls `saveRules` but never closes the panel. Fix: wrap the save handler to call `setRulesOpen(false)` after `saveRules` completes.

**Issue 2 — Universal tab shows zero inventory**
Line 185 of `InventoryDashboard.tsx` passes hardcoded empty arrays:
```typescript
platformData={{ shopify: [], amazon: [], kogan: [], ebay: [], mirakl: [] }}
```
No data is ever fetched for the Universal view. Each individual tab fetches its own data independently via `useInventoryFetch`, but none of that data flows back to the dashboard.

### Fix

**File: `src/components/inventory/InventoryDashboard.tsx`**

1. Add five `useInventoryFetch` calls at the dashboard level — one per platform (`fetch-shopify-inventory`, `fetch-amazon-inventory`, `fetch-kogan-inventory`, `fetch-ebay-inventory`, `fetch-mirakl-inventory`)
2. Auto-trigger fetch on mount for each platform that has an active connection/token
3. Pass fetched data arrays into `UniversalInventoryTab` via `platformData`
4. Show a loading state on Universal while any platform is still fetching
5. Show partial warning banner if any platform returned `partial: true` or errored
6. Wrap the `onSave` prop to call `setRulesOpen(false)` after save completes

**File: `src/components/inventory/InventoryRulesPanel.tsx`**

No changes needed — the close-on-save is handled by the parent's `onSave` wrapper.

### Technical Detail

The dashboard will call `useInventoryFetch` for each connected platform. These are the same edge functions the individual tabs use, so no new backend work. The Universal tab already has all the merging/matching logic — it just needs real data.

Individual tabs will continue to fetch independently (they have their own refresh/load-more controls). The dashboard-level fetches are specifically for Universal aggregation.

### Files Modified
1. `src/components/inventory/InventoryDashboard.tsx` — Add platform-level fetches, wire to Universal tab, auto-close rules on save

