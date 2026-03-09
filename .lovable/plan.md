

## Shopify Onboarding Flow

### What We're Building
A guided onboarding experience that appears when a user selects Shopify for the first time (or has no Shopify settlements). Instead of dumping them into a raw upload zone, it walks them through exporting from Shopify, then shows an animated detection summary of all discovered marketplaces.

### Current State
- `SmartUploadFlow` accepts any file but gives no marketplace-specific guidance
- `ShopifyOrdersDashboard` has a basic file input, no onboarding instructions
- `SellerCentralGuide` exists for Amazon but nothing equivalent for Shopify
- `MarketplaceSwitcher` "Add Marketplace" just creates a DB connection row

### New Component: `ShopifyOnboarding.tsx`

Single card component with 3 phases:

**Phase A -- Instructions + Upload**
- Header: Shopify logo + "Connect your Shopify store"
- Expandable step-by-step guide (mirrors SellerCentralGuide pattern): Shopify Admin → Orders → Export → CSV
- Large drop zone (`.csv` only, 10MB max)
- Below drop zone: "Works with: MyDeal, Bunnings, Kogan, Big W, Everyday Market, PayPal, Afterpay and more"

**Phase B -- Detection Animation**
- Progress steps that tick off sequentially:
  - "Reading your file..." → check
  - "Detecting marketplaces..." → check (triggers existing `parseShopifyOrdersCSV`)
  - "Found X marketplaces" → check
  - "Building your account tabs..." → check (auto-creates `marketplace_connections` for each detected group)
- Each step 500ms delay for visual feedback

**Phase C -- Results + Next Steps**
- Marketplace cards (one per detected group): icon, name, order count, total AUD, green "Ready" dot
- Shopify Payments group shown with grey dot + note: "Use Shopify Payments payout CSV for these"
- Unknown groups shown with marketplace select dropdown (reuses existing `assignUnknownGroup` pattern)
- Action buttons: "Push all to Xero →" and "Review first"
- Post-action: "Monthly sync" card with simple 3-step instruction

### Integration Points

1. **`ShopifyOrdersDashboard.tsx`** -- When no history exists and no file uploaded, render `<ShopifyOnboarding>` instead of the raw upload tab. After successful onboarding upload, transition to the normal dashboard view with parsed data.

2. **`Dashboard.tsx`** -- When user clicks "Add Marketplace" → Shopify Orders, and it's their first time, route to the Shopify Orders tab which will show the onboarding.

3. **Auto-create marketplace connections** -- On detection, for each new marketplace group found (MyDeal, Bunnings, etc.), auto-insert into `marketplace_connections` if not already present. This means tabs appear automatically.

### Files Changed
1. **New**: `src/components/admin/accounting/ShopifyOnboarding.tsx` -- The full onboarding component (~300 lines)
2. **Edit**: `src/components/admin/accounting/ShopifyOrdersDashboard.tsx` -- Show `<ShopifyOnboarding>` when no history + no file, pass parsed result back on completion
3. **Minor edit**: `src/pages/Dashboard.tsx` -- After onboarding completes, reload marketplace tabs

### No database changes needed
All required tables (`marketplace_connections`, `settlements`, `marketplace_fingerprints`) already exist.

