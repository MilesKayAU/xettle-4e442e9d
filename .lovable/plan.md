

## Problem

1. **No visual distinction between API-automated and CSV-upload marketplaces** in the tab pills. Users can't tell at a glance which tabs auto-sync and which need manual uploads.

2. **The empty state and upload prompts are identical** for Amazon/Shopify (which have API connections) and Bunnings/Kogan/eBay (which require CSV). Amazon/Shopify should show "Auto-synced — settlements are fetched automatically" rather than prompting for file uploads.

3. **No clear guidance** telling users which marketplaces need file uploads and where to find the files.

---

## Plan

### 1. Add API badge to marketplace pills (MarketplaceSwitcher.tsx)

For each pill, check if the marketplace has an active API token (amazon_tokens, shopify_tokens, or ebay_tokens in future). Show a small visual indicator:

- **API-connected**: Show a `⚡` or `Zap` icon + subtle "Auto" badge instead of the generic green checkmark
- **CSV-only**: Keep the current green checkmark (no change)

Logic: Cross-reference `marketplace.connection_type` from the `marketplace_connections` record. If `connection_type === 'sp_api'` or the marketplace code is `amazon_au`/`shopify_payments`/`shopify_orders` and the user has a corresponding token, show the auto badge.

### 2. Differentiate the empty state (ChannelDetectedEmptyState.tsx)

Add a new prop `isApiConnected: boolean`. When true, show:

```
⚡ Amazon AU is connected via API
Settlements are fetched automatically during sync.
No manual upload needed.
[Sync Now]
```

When false (CSV-only), keep the current behavior prompting for file upload with marketplace-specific guidance.

### 3. Differentiate the upload prompt at bottom of dashboard (GenericMarketplaceDashboard.tsx)

For API-connected marketplaces, change the bottom upload card from "Upload more settlement files" to:

```
⚡ Settlements sync automatically
Amazon AU settlements are fetched via API during each sync cycle.
You can also upload files manually if needed.
```

Make it informational rather than a call-to-action. Keep a small "Upload manually" link for edge cases.

### 4. Add connection method indicator to dashboard header

In the `GenericMarketplaceDashboard` header (line ~232), next to the marketplace name, show a small badge:
- `⚡ API` (green) for API-connected
- `📄 File upload` (neutral) for CSV-only

This immediately tells the user the data source.

### 5. Determine API connection status

Add a check in `GenericMarketplaceDashboard` (alongside the existing `checkShopifyAndBoundary` effect) that queries the relevant token table based on marketplace code:
- `amazon_au` → check `amazon_tokens`
- `shopify_payments` / `shopify_orders` → check `shopify_tokens`  
- `ebay_au` → check `ebay_tokens` (future)
- Everything else → CSV-only

Expose this as `isApiConnected` boolean state, used to drive all the UI differences above.

---

## Files to change

| File | Change |
|------|--------|
| `src/components/admin/accounting/MarketplaceSwitcher.tsx` | Add `⚡ Auto` badge on API-connected pills |
| `src/components/admin/accounting/shared/ChannelDetectedEmptyState.tsx` | Add `isApiConnected` prop, show "auto-synced" message when true |
| `src/components/admin/accounting/GenericMarketplaceDashboard.tsx` | Query token tables for API status, pass to empty state, differentiate upload prompt and header badge |

