

# Add eBay to Auto-Sync Badge + Sync Status for API Marketplaces

## Problem
1. eBay has API sync now but the marketplace switcher pill still shows it as "File upload" — it's missing from the `apiConnectedCodes` set passed to `MarketplaceSwitcher`.
2. There's no way to check sync status or trigger a manual sync for eBay (or any API marketplace) from the settlements tab.

## Changes

### 1. Add eBay to `apiConnectedCodes` in Dashboard.tsx (~line 851)

Add an `ebay_tokens` check alongside the existing Amazon/Shopify checks, and include `'ebay_au'` in the set when connected.

### 2. Add eBay to `isApiConnected` check in GenericMarketplaceDashboard.tsx (~line 156)

The `checkShopifyAndBoundary` function checks `amazon_tokens` and `shopify_tokens` but not `ebay_tokens`. Add an `else if (code === 'ebay_au')` branch that queries `ebay_tokens`.

### 3. Add eBay to `API_MARKETPLACE_CODES` in MarketplaceSwitcher.tsx (line 137)

Add `'ebay_au'` to the set so it's recognized as an API-capable marketplace.

### 4. Add eBay to MARKETPLACE_CATALOG in MarketplaceSwitcher.tsx

Add an entry for `ebay_au` with `connectionMethods: ['manual_csv']` updated to include API capability indicator.

### 5. Add "Sync Now" button + last sync status for API marketplaces in GenericMarketplaceDashboard.tsx

In the header area (line ~266), when `isApiConnected` is true, show:
- A "Sync Now" button that calls the relevant edge function (`fetch-ebay-settlements`, `fetch-amazon-settlements`, etc.)
- Last sync timestamp from `sync_history` table
- A small status indicator (last sync result)

This will be a shared pattern — map marketplace code to edge function name, fetch last sync from `sync_history`, and display inline.

## Files

| File | Change |
|------|--------|
| `src/pages/Dashboard.tsx` | Query `ebay_tokens`, add `ebay_au` to `apiConnectedCodes` |
| `src/components/admin/accounting/MarketplaceSwitcher.tsx` | Add `ebay_au` to `API_MARKETPLACE_CODES` and `MARKETPLACE_CATALOG` |
| `src/components/admin/accounting/GenericMarketplaceDashboard.tsx` | Add eBay token check for `isApiConnected`; add "Sync Now" button + last sync display for all API marketplaces |

