

## Plan: Delete Marketplace Tab + Move Pricing to Dedicated Page

### 1. Add "Delete Tab" to MarketplaceSwitcher

**File: `src/components/admin/accounting/MarketplaceSwitcher.tsx`**

- Add a right-click or X button on each marketplace pill (except amazon_au which uses SP-API)
- On click, open a confirmation AlertDialog
- If the marketplace has settlements in DB, show warning: "This will delete X settlements and all associated data. This cannot be undone."
- Query `settlements` table count for that marketplace to determine if files exist
- On confirm:
  - Delete from `settlements` where `marketplace = code`
  - Delete from `settlement_lines`, `settlement_unmapped`, `marketplace_fee_alerts`, `marketplace_fee_observations`, `marketplace_file_fingerprints`, `marketplace_ad_spend`, `marketplace_shipping_costs` where `marketplace_code = code`
  - Delete from `marketplace_connections` where `marketplace_code = code`
  - Call `onMarketplacesChanged()` to refresh
  - Switch to first remaining marketplace tab
- Use AlertDialog for the destructive confirmation

### 2. Remove Pricing Section from Landing Page

**File: `src/pages/Landing.tsx`**

- Remove the entire `<section id="pricing">` block (lines ~155-258)
- Update the "See Plans" button to link to `/pricing` instead of `#pricing`

### 3. Update Pricing Page Nav Link

**File: `src/pages/Landing.tsx`**

- Add a "Pricing" link in the nav bar pointing to `/pricing`

The `/pricing` route and page already exist and are fully built.

