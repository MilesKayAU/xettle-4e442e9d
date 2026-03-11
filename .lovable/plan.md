

## Problem

You're right — the user already chose to connect Shopify during onboarding, and the wizard's scanning step (`SetupStepScanning`) already calls `fetch-shopify-orders` + `scan-shopify-channels`. But the "Sync now" prompt still appears on the Dashboard because:

1. **Race condition**: The onboarding wizard fires `fetch-shopify-orders` but has a 45-second timeout per step. If the Shopify API is slow, it may abort before orders are saved.
2. **Double-fire**: `SetupStepConnectStores` fires `fetch-shopify-payouts` + `scan-shopify-channels` as fire-and-forget (line 117), then `SetupStepScanning` fires them again sequentially. The orders fetch may not complete in either case.
3. **Dashboard check**: `ChannelAlertsBanner` sees `shopify_orders` count = 0 and shows the prompt, even though the scan was already attempted.

## Fix

Two changes:

### 1. Track that the scan was already triggered during onboarding
After the scanning step completes (or is attempted), write a flag to `app_settings`:
- Key: `shopify_channel_scan_triggered`, value: `true`

### 2. Respect that flag in ChannelAlertsBanner
When deciding whether to show the "Sync now" prompt, also check `app_settings` for `shopify_channel_scan_triggered`. If true AND `shopify_orders` count is 0, show a different message like "Channel scan in progress — orders are still syncing" with a refresh button, instead of asking the user to manually trigger something they already did.

If orders count > 0 after a refresh, clear the prompt entirely (the scan worked, just took time).

### 3. Increase reliability of the initial scan
In `SetupStepScanning`, bump the `fetch-shopify-orders` timeout from 45s to 60s since it's the most critical step. Also, if it fails/times out, fire it one more time as a background retry so it completes after the wizard closes.

### Files to change
- `src/components/onboarding/SetupStepScanning.tsx` — write `shopify_channel_scan_triggered` flag after the scan steps run
- `src/components/dashboard/ChannelAlertsBanner.tsx` — check the flag; if set and orders=0, show "still syncing" instead of "sync now"; auto-refresh after 30s
- `src/components/onboarding/SetupStepScanning.tsx` — increase timeout for fetch-shopify-orders

