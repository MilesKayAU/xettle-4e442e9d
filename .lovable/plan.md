

## Plan: Filter Duplicate Shopify-Derived Records from Reconciliation Tab

### Problem
The Reconciliation tab shows `shopify_auto_ebay_au_*` records even though eBay has a direct API connection (`ebay_api`). These are pure duplicates of the real `ebay_payout_*` settlements and add no value. The tab should only show recon rows for marketplaces where Shopify order data is the **only** reference (sub-channels like Kogan, BigW).

### Database Evidence
- 5 `shopify_auto_ebay*` settlements exist, all `duplicate_suppressed` — confirming they're noise
- Real eBay payouts (`ebay_payout_*`) exist from the direct eBay API — the authoritative source
- Kogan/BigW `shopify_auto_*` records are legitimate recon aids (no direct API)

### Changes

**`src/components/onboarding/ValidationSweep.tsx`**

1. When building the recon tab filter, cross-reference the marketplace against `marketplace_connections` to exclude marketplaces that have a direct API connection (`sp_api`, `ebay_api`, `mirakl_api`, `shopify_api`). Only `shopify_sub_channel` and `manual` types should show recon rows.

2. Additionally exclude `shopify_auto_*` rows with `overall_status` of `already_recorded` or `duplicate_suppressed` — these have been resolved and clutter the view.

The filtering logic changes in the `filteredRows` memo and `statusCounts` loop:

```typescript
// Build set of marketplaces with direct API connections (not sub-channels)
const directApiCodes = new Set(
  connections.filter(c => isApiConnectionType(c.connection_type) && c.connection_type !== 'shopify_sub_channel')
    .map(c => c.marketplace_code)
);

// In recon tab filter:
const isUsefulRecon = (r) =>
  r.settlement_id?.startsWith('shopify_auto_') &&
  !directApiCodes.has(r.marketplace_code) &&
  !['already_recorded', 'duplicate_suppressed'].includes(r.overall_status);
```

3. Update the recon count in `statusCounts` to use the same `isUsefulRecon` check.

### Result
- eBay `shopify_auto_*` rows disappear from the Reconciliation tab (they have real API payouts)
- Kogan/BigW recon summaries remain visible as intended
- Resolved/suppressed records are hidden from the tab

### Files Modified
1. **`src/components/onboarding/ValidationSweep.tsx`** — Add direct-API exclusion to recon filtering

