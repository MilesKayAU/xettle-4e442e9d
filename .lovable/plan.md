

# Two Fixes: CSV-Only Reconciliation Panel + Pre-Boundary Gap Suppression

## Fix 1 — CSV-Only Marketplace Detection

**Root cause**: The reconciliation panel choice uses `hasShopify` which checks if the user has *any* Shopify token. For MyDeal, BigW, and EverydayMarket, this is wrong — these are CSV-only marketplaces that will never have Shopify order data to cross-reference, regardless of whether the user has a Shopify connection for other marketplaces.

**Fix**: Add an explicit CSV-only marketplace list. If the current marketplace code is in this list, always show `FileReconciliationStatus` instead of `ReconciliationStatus`.

**File: `src/components/admin/accounting/GenericMarketplaceDashboard.tsx`**
- Add constant: `const CSV_ONLY_MARKETPLACES = ['bigw', 'everyday_market', 'mydeal', 'bunnings', 'catch', 'kogan']`
- Change the reconciliation panel condition from `hasShopify` to `hasShopify && !CSV_ONLY_MARKETPLACES.includes(code)`
- Update the heading label similarly

## Fix 2 — Suppress Gap Warnings for Pre-Boundary Settlements

**Root cause**: The gap detection logic (lines 378-401) runs on all settlements with no awareness of the accounting boundary date. Gaps between pre-boundary settlements (e.g. Dec 2025) are irrelevant noise.

**Fix**: 
- Add an `accountingBoundary` prop to `GapDetector` and load the boundary date in `GenericMarketplaceDashboard`
- In the gap detection logic, skip gap warnings when *both* the current and previous settlements are before the accounting boundary
- Fetch the boundary from `app_settings` table (key: `accounting_boundary_date`) in the existing `useEffect` that gets user data

**File: `src/components/admin/accounting/shared/GapDetector.tsx`**
- Add optional `accountingBoundary?: string` to props and `hasSettlementGap` params
- If boundary is set and both `currentStart` and `previousEnd` are before the boundary, return false

**File: `src/components/admin/accounting/GenericMarketplaceDashboard.tsx`**
- Fetch `accounting_boundary_date` from `app_settings` in the existing `checkShopify` useEffect
- Store in state, pass to the inline gap detection logic (lines 378-386)
- Add boundary check: skip gap warning if both settlements' `period_end` < boundary

## Files Changed
1. `src/components/admin/accounting/GenericMarketplaceDashboard.tsx` — CSV-only list, boundary fetch, both fixes applied
2. `src/components/admin/accounting/shared/GapDetector.tsx` — Add boundary-aware suppression

