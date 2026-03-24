

## Plan: Add Kogan API Credentials Panel to Settings

### Current State
- The `fetch-kogan-inventory` edge function already reads credentials from `app_settings` using keys `kogan_api_seller_id` and `kogan_api_seller_token` — correct
- The `InventoryDashboard` checks for `kogan_api_seller_token` to show/hide the Kogan tab — correct
- **Missing**: There is no UI anywhere in Settings to enter these credentials
- Kogan auth is simple: two static headers (`SellerID` + `SellerToken`) provided by the Kogan account manager — not OAuth

### Change

**`src/components/settings/ApiConnectionsPanel.tsx`**

Add a "Kogan Marketplace API" section after the Mirakl panel (before Channel Management). It should:

1. Show a collapsible card with Kogan branding
2. Display two input fields: **Seller ID** and **Seller Token** (password-masked)
3. On load, check `app_settings` for existing values and show connected/not-connected badge
4. Save button upserts both values to `app_settings` with keys `kogan_api_seller_id` and `kogan_api_seller_token`
5. Include a "Test Connection" button that calls `GET /api/marketplace/v2/products/?page=1&page_size=1` via the existing `fetch-kogan-inventory` edge function to verify credentials work
6. Show helper text: "Your Kogan account manager will provide your Seller ID and Seller Token. These are used for inventory visibility only — settlements still require CSV upload."
7. Add Kogan to the `ConnectionSummary` interface and the quick status strip at the top

Also update `SYNC_RAILS` to not include Kogan (no settlement sync — inventory only).

### Files Modified
1. `src/components/settings/ApiConnectionsPanel.tsx` — Add Kogan credential input section, update connection summary

