

## Plan: Add a Dedicated "Marketplace Manager" Settings Panel

### Problem
The ability to activate/deactivate marketplaces is currently buried deep inside the Account Mapper card. There's no obvious, standalone place for a user to see all their marketplaces and toggle them on/off. This means orphaned or unwanted marketplaces (like Temu) slip through because users can't easily find the controls.

### Solution
Create a new **Marketplace Manager** settings section that appears as its own accordion in the Dashboard Settings tab — positioned **above** the Account Mapper. It provides a simple list of all connected marketplaces with toggle switches to activate/deactivate each one site-wide.

### What the User Sees
- A new "Active Marketplaces" accordion in Settings
- A clean table/list showing every marketplace connection with:
  - Marketplace name and code
  - Connection type badge (API / Manual / Sub-channel)
  - An on/off toggle switch
- Toggling off triggers the existing `DeactivateMarketplaceDialog` (with safety checks for unposted settlements)
- Toggling on triggers the reactivation flow
- Deactivated marketplaces shown greyed out at the bottom

### Files to Create/Modify

1. **`src/components/settings/MarketplaceManagerPanel.tsx`** (NEW)
   - Fetches all `marketplace_connections` for the user (active, connected, and deactivated)
   - Renders each as a row with a `Switch` toggle
   - On toggle-off: opens `DeactivateMarketplaceDialog`
   - On toggle-on: opens `DeactivateMarketplaceDialog` in reactivate mode
   - Groups: active connections at top, deactivated at bottom (greyed)

2. **`src/pages/Dashboard.tsx`**
   - Import `MarketplaceManagerPanel`
   - Add a new settings accordion section "Active Marketplaces" positioned before the Account Mapper section
   - Include help text explaining this is the site-wide on/off switch

### Reuses
- Existing `DeactivateMarketplaceDialog` for confirmation + safety checks
- Existing `ACTIVE_CONNECTION_STATUSES` constant for filtering
- Existing `Switch` UI component for the toggle
- No database changes needed — uses existing `connection_status` field

