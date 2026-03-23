

# Fix: Derive API-connected badges from actual connection data

## Problem

The green "Auto" badge on marketplace pills in the Settlements tab is hardcoded from three boolean flags (`hasAmazon`, `hasShopify`, `hasEbay`) derived from token tables. Bunnings (mirakl_api) and any future API connection are completely ignored. When you add or remove an API connection in Settings, the badge never updates.

## Root Cause

In `src/pages/Dashboard.tsx` (line ~1108), `apiConnectedCodes` is built as:

```typescript
apiConnectedCodes={new Set([
  ...(hasAmazon ? [amazonXettleCode] : []),
  ...(hasShopify ? ['shopify_payments', 'shopify_orders'] : []),
  ...(hasEbay ? ['ebay_au'] : []),
])}
```

This is a static list. It misses Bunnings (`mirakl_api`), and won't react to Settings changes.

## Fix

### 1. Derive `apiConnectedCodes` from `marketplace_connections` table

In `Dashboard.tsx`, after `loadMarketplaces` fetches `userMarketplaces`, compute the set dynamically:

```typescript
const apiConnectedCodes = useMemo(() => {
  const codes = new Set<string>();
  for (const um of userMarketplaces) {
    if (isApiConnectionType(um.connection_type)) {
      codes.add(um.marketplace_code);
    }
  }
  // Also include token-derived APIs that may not have explicit connection_type set
  if (hasAmazon) codes.add(amazonXettleCode);
  if (hasShopify) { codes.add('shopify_payments'); codes.add('shopify_orders'); }
  if (hasEbay) codes.add('ebay_au');
  return codes;
}, [userMarketplaces, hasAmazon, amazonXettleCode, hasShopify, hasEbay]);
```

This merges both sources: the `marketplace_connections.connection_type` field (catches Bunnings/mirakl_api and future APIs) and the legacy token-table booleans (backward compat).

### 2. Pass derived set to MarketplaceSwitcher

Replace the inline `new Set([...])` with the computed `apiConnectedCodes` variable.

### 3. Audit other pages for same issue

Search for any other place that shows API/Auto indicators using hardcoded logic instead of `isApiConnectionType()`:
- `ActionCentre.tsx` — already fixed in prior session
- `ValidationSweep.tsx` — already fixed
- `SettlementsOverview.tsx` — check and fix if needed
- `GenericMarketplaceDashboard.tsx` — check header badge

### 4. Ensure Settings changes propagate

`loadMarketplaces` is already called after connection changes via `onMarketplacesChanged`. Since `apiConnectedCodes` is derived from `userMarketplaces` via `useMemo`, any Settings page change that updates `marketplace_connections.connection_type` will automatically reflect in the badge on next load.

## Files to modify

| File | Change |
|------|--------|
| `src/pages/Dashboard.tsx` | Replace hardcoded `apiConnectedCodes` with `useMemo` derived from `userMarketplaces` + `isApiConnectionType()` |
| Any other files found in audit step 3 | Ensure consistent use of `isApiConnectionType()` |

## Expected outcome

- Bunnings shows green "Auto" badge immediately
- Any future API marketplace gets the badge automatically
- Adding/removing API connections in Settings reflects on the Settlements tab after reload

