

## Auto-trigger Amazon & Shopify scans from PostSetupBanner

### Problem
When a user connects Amazon or Shopify and lands on the dashboard, the banner shows passive text ("Importing your Amazon settlements...") but never actually calls any edge functions. Only Xero's `scan-xero-history` is auto-triggered. Amazon and Shopify connections sit idle until the user manually navigates to another tab or triggers a sync.

### Plan

**File: `src/components/dashboard/PostSetupBanner.tsx`**

Add two new auto-trigger effects mirroring the existing Xero scan pattern:

**Amazon auto-scan** (when `hasAmazon` is true and not already scanned):
1. Check `app_settings` for `amazon_scan_completed` flag
2. If not set, call `fetch-amazon-settlements` edge function
3. Track scanning/complete states with `amazonScanning` / `amazonScanComplete`
4. On success, poll `settlements` table for `marketplace = 'amazon_au'` to show count
5. Set `amazon_scan_completed` flag in `app_settings` on completion

**Shopify auto-scan** (when `hasShopify` is true and not already scanned):
1. Check `app_settings` for `shopify_scan_completed` flag
2. If not set, call three functions in sequence:
   - `fetch-shopify-payouts` (sync payout settlements)
   - `fetch-shopify-orders` (sync order history)
   - `scan-shopify-channels` (detect sub-channels like eBay, TikTok, etc.)
3. Track scanning/complete states with `shopifyScanning` / `shopifyScanComplete`
4. On success, show discovered channel count from `shopify_sub_channels` table
5. Set `shopify_scan_completed` flag in `app_settings` on completion

**Update scanning status display:**
- `isActivelyScanning` logic updated to include `amazonScanning` and `shopifyScanning`
- Amazon status line shows real progress: "Importing X settlements found so far..."
- Shopify status line shows: "Detected X sales channels so far..."
- After completion, show concrete results instead of generic text

**Update polling:**
- Existing 10s poll also checks `settlements` count for Amazon and `shopify_sub_channels` count for Shopify to update live counts during scanning

**File: `src/pages/Dashboard.tsx`**
- After `PostSetupBanner` completes any scan, call `loadMarketplaces()` to refresh the marketplace switcher with newly auto-detected connections. Pass `onScanComplete={loadMarketplaces}` as a new prop.

