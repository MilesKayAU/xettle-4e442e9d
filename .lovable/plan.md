

# Unified Fee Attribution and Data Repair Plan

## Problem

Multiple prior fixes have patched UI-side estimation logic, but the root causes remain:

1. **Two different data sources** power the same page: the "$1 Sale Breakdown" uses active settlements with UI estimation, while "Marketplace Profit Ranking" prefers stale `settlement_profit` rows containing malformed Kogan entries (e.g., `Monthly Marketplace Seller Fee`, `APCreditNote`).
2. **Old Kogan `api_sync` settlements** are stuck on `source_version: v2` with `seller_fees = 0` in the database. UI patches estimate fees at display time, but the underlying data is never corrected.
3. **Duplicated fee logic** across `InsightsDashboard.tsx`, `MarketplaceProfitComparison.tsx`, the Shopify auto-generation edge function, and the Woolworths redistribution code — each drifting independently.

## Plan

### 1. Create a canonical fee-attribution utility

- New file: `src/utils/insights-fee-attribution.ts`
- Single source of truth for: source priority (CSV > API), commission estimation rates, platform-family redistribution, and badge/flag logic
- Both `InsightsDashboard` and `MarketplaceProfitComparison` will consume this instead of each doing their own math

### 2. Fix future ingestion at the source

- Update `supabase/functions/auto-generate-shopify-settlements/index.ts` so all newly generated sub-channel settlements persist: `seller_fees` (estimated), `fees_estimated: true`, `commission_rate_applied`, and an updated `source_version`
- Add an upgrade path: if an existing `api_sync` row is still on old `v2`/zero-fee format, reruns overwrite it with corrected values instead of leaving stale data
- Audit the manual CSV parser path to block malformed pseudo-settlements (header/footer rows like `Monthly Marketplace Seller Fee`) from being saved as real settlements

### 3. Repair existing data (one-off backend flow)

- Create an edge function `repair-settlement-fees/index.ts` that:
  - Reprocesses old zero-fee `api_sync` settlements (applies estimated commission, writes `seller_fees`, flags `fees_estimated`)
  - Removes or rebuilds stale `settlement_profit` rows for malformed or no-longer-active settlements
  - Recalculates profit rows from current active settlements only
- This is the step that immediately fixes Kogan's conflicting numbers

### 4. Refactor both UI surfaces to use the shared utility

- `InsightsDashboard.tsx` and `MarketplaceProfitComparison.tsx` both call the canonical attribution helper
- `settlement_profit` rows are only used when they match an active settlement
- Estimated data gets the same badge and rate in both widgets
- No marketplace can exceed logical bounds (margin > 100%, fees > sales)

### 5. Keep Woolworths/MyDeal family logic deterministic

- Move the platform-family redistribution into the canonical utility
- BigW / Everyday Market / MyDeal use the same redistributed fee basis everywhere
- Fee-conservation checks ensure redistributed family fees always sum correctly

### 6. Verify

- Kogan: old stale profit rows gone, active API settlements upgraded, both widgets show the same fee rate and margin
- BigW / Everyday / MyDeal: family redistribution consistent across both widgets
- No marketplace exceeds logical bounds due to mixed datasets

## Files involved

- New: `src/utils/insights-fee-attribution.ts`
- New: `supabase/functions/repair-settlement-fees/index.ts`
- Modified: `supabase/functions/auto-generate-shopify-settlements/index.ts`
- Modified: `src/components/admin/accounting/InsightsDashboard.tsx`
- Modified: `src/components/insights/MarketplaceProfitComparison.tsx`
- Modified: `src/utils/profit-engine.ts` (if profit row rebuild logic lives here)

## Expected outcome

- One consistent answer for every marketplace across all charts and tables
- Future API or upload settlements land with the right fee basis immediately
- Historical contradictions from stale `settlement_profit` rows and old zero-fee `api_sync` rows are eliminated

