

# Make "Sync Shopify" Easy to Find

## Problem

The "Sync Shopify" button is buried inside the "Files needed" checklist banner, which only appears when `missingSettlements` are passed as props AND contain Shopify items. From your screenshot, the checklist isn't showing — so the button is invisible.

## Plan

### 1. Add a prominent Shopify sync banner below the drop zone

When a Shopify connection is active, render a dedicated card between the upload drop zone and the file guide. Always visible (not dependent on the missing checklist).

```text
┌─────────────────────────────────────────────────┐
│  🟢 Shopify Connected                           │
│  Auto-pull payouts directly from Shopify API.   │
│  No CSV needed.          [ Sync Shopify Payouts ]│
│  Last synced: 2 hours ago                       │
└─────────────────────────────────────────────────┘
```

- Green left accent or border to signal "connected"
- Shows last sync time (from `system_events` or `app_settings.last_shopify_sync`)
- Shows cooldown status if within 1 hour ("Next sync available in 43 min")
- Button uses `default` variant (not outline) — it's a primary action for Shopify users

### 2. Keep the existing checklist button as secondary

The small "Sync Shopify" button in the "Files needed" checklist stays as-is for users who arrive via the "Upload now" flow from the Dashboard. No removal needed.

### 3. Files changed

- **`SmartUploadFlow.tsx`**: Add the new `ShopifySyncBanner` section after the drop zone card (around line 1091). Reuse the existing `handleShopifySync`, `shopifySyncing`, and `hasShopifyConnection` state. Query `system_events` for last sync timestamp to display "Last synced: X ago".

