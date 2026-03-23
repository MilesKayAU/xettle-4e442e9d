

## Audit: Settlement Folder Routing — Root Cause & Fixes

### Problem Observed
The Bunnings tab is displaying `shopify_auto_kogan_*` settlements. The screenshot confirms settlement IDs like `shopify_auto_kogan_2026-03_9d34d250` appear under "Bunnings Settlements" with Kogan order data.

### Database Audit Result — All Clean
Every API save path and manual upload path writes the correct `marketplace` code:

| Path | Marketplace Value | Status |
|------|------------------|--------|
| `fetch-amazon-settlements` | `'amazon_au'` hardcoded | Correct |
| `fetch-ebay-settlements` | `'ebay_au'` hardcoded | Correct |
| `fetch-shopify-payouts` | `'shopify_payments'` hardcoded | Correct |
| `fetch-mirakl-settlements` | Dynamic from `connection.marketplace_label` → lowercase | Correct |
| `auto-generate-shopify-settlements` | Dynamic `mpCode` from detection registry | Correct |
| `SmartUploadFlow` (manual CSV) | From file detection / user override | Correct |
| `BunningsDashboard` (PDF upload) | `'bunnings'` via `parseBunningsSummaryPdf` | Correct |

Database query confirms no cross-contamination:
- `kogan` settlements have `marketplace: 'kogan'` (3 rows)
- `bunnings` settlements have `marketplace: 'bunnings'` (12 rows)
- No rows have mismatched marketplace values

### Root Cause — Missing React `key` Prop
The bug is a **UI rendering issue**, not a data issue. In `Dashboard.tsx` line 1150:

```tsx
<GenericMarketplaceDashboard marketplace={selectedUserMarketplace} ... />
```

There is **no `key` prop**. When switching from Kogan → Bunnings (both use `GenericMarketplaceDashboard`), React reuses the same component instance. While `useSettlementManager` does re-fetch data when `marketplaceCode` changes, several pieces of internal state persist incorrectly:

1. **`hasAutoAudited` / `hasAutoExpanded`** — boolean flags that don't reset on marketplace change, causing stale auto-expansion behavior
2. **`expandedLines` / `lineItems`** from `useTransactionDrilldown` — line items from the previous marketplace stay visible
3. **`reconResults`** from `useReconciliation` — reconciliation checks from previous marketplace linger
4. **`selected` set** from `useBulkSelect` — selection state carries over
5. **`settlementFilter` / `marketplaceFilter`** — filter state from previous tab persists

The combination of stale expanded line items + the brief moment before the new query returns creates the visual effect of Kogan data appearing in the Bunnings tab.

### Fix — 2 Changes

#### 1. Add `key` prop to force remount (`src/pages/Dashboard.tsx`)
Line 1150 — add `key={selectedMarketplace}`:
```tsx
<GenericMarketplaceDashboard 
  key={selectedMarketplace}
  marketplace={selectedUserMarketplace} 
  onMarketplacesChanged={loadMarketplaces} 
  onSwitchToUpload={() => setShowUploadSheet(true)} 
/>
```

This forces React to destroy and recreate the component when switching marketplaces, resetting all internal state cleanly.

#### 2. Add `key` to `ShopifyOrdersDashboard` for consistency
Line 1147 — same pattern:
```tsx
<ShopifyOrdersDashboard key={selectedMarketplace} onMarketplacesChanged={loadMarketplaces} />
```

### What This Fixes
- Bunnings tab will only show Bunnings settlements
- All expanded line items, reconciliation checks, and filter states reset on tab switch
- No more stale data bleeding between marketplace tabs
- No database changes needed — the data is already correct

### Scope
Two lines changed in `src/pages/Dashboard.tsx`. No parser, API, or database changes required.

