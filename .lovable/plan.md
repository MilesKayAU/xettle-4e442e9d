

# Fix Fabricated Data in Financial Reporting — Phase 1

## What This Fixes

Hardcoded commission rates and estimation logic currently produce fabricated fee percentages that appear alongside real settlement data in charts and tables. Bookkeepers see numbers like "12% commission" for Kogan when no CSV has been uploaded — these are made-up figures. This plan eliminates all fabricated numbers from user-facing financial reporting.

---

## Fix 1 — Complete exclusion of api_sync rows when CSV data exists

**Current behaviour:** When a marketplace has both CSV and api_sync rows, the code extrapolates the CSV fee rate onto api_sync sales, blending real and estimated data.

**New behaviour:** When any `csv_upload` or `manual` source settlement exists for a marketplace, all `api_sync` rows are already filtered out at line ~195-202 of InsightsDashboard.tsx. However, the `attributeFees()` function in `insights-fee-attribution.ts` still has "Case 2" (lines 122-138) that blends CSV and api_sync data. This case must be removed — if real rows exist, api_sync rows should have been filtered upstream and never reach `attributeFees()`.

**Files:** `src/utils/insights-fee-attribution.ts` (remove Case 2 blending logic), `src/components/insights/MarketplaceProfitComparison.tsx` (add the same upstream api_sync exclusion filter that InsightsDashboard already has)

---

## Fix 2 — api_sync-only marketplaces show "No fee data" instead of estimates

**Current behaviour:** Case 1 in both `InsightsDashboard.tsx` (lines 354-363) and `attributeFees()` (lines 113-121) applies `COMMISSION_ESTIMATES[mp]` to fabricate fee figures.

**New behaviour:**
- `attributeFees()` Case 1: instead of computing estimated fees, set `effectiveTotalFees = 0`, `hasMissingFeeData = true`, `hasEstimatedFees = false`, and leave `effectiveAvgCommission = 0`
- `InsightsDashboard.tsx` Case 1: same — set fees to 0, flag `hasMissingFeeData = true`
- In the UI card rendering, when `hasMissingFeeData` is true: show "Fee data unavailable — upload marketplace CSV for accurate figures" instead of fee percentage, commission rate, and margin
- `COMMISSION_ESTIMATES` and `DEFAULT_COMMISSION_RATE` exports remain in `insights-fee-attribution.ts` (still used by `auto-generate-shopify-settlements` edge function and `isMarginSuspicious` sanity check) but are no longer consumed for display calculations
- Remove the import/usage of `COMMISSION_ESTIMATES` and `DEFAULT_COMMISSION_RATE` from `InsightsDashboard.tsx` display logic

**Files:** `src/utils/insights-fee-attribution.ts`, `src/components/admin/accounting/InsightsDashboard.tsx`, `src/components/insights/MarketplaceProfitComparison.tsx`

---

## Fix 3 — Replace hardcoded 15% redistribution with observed rates

**Current behaviour:** Line 225 in `insights-fee-attribution.ts` and line 239 in `InsightsDashboard.tsx` use `sales * 0.15` to estimate a marketplace's "own fees" before redistributing the excess.

**New behaviour:**
- Load observed commission rates from `app_settings` (key pattern: `observed_commission_rate_{marketplace_code}`)
- Use observed rate if available; fall back to 0.15 only if no observed rate exists
- When using the 0.15 fallback, set `hasEstimatedFees = true` on that marketplace's data so the UI shows an "Estimated" badge
- Both the canonical `redistributePlatformFees()` function and the inline redistribution in `InsightsDashboard` will accept an `observedRates` parameter

**Files:** `src/utils/insights-fee-attribution.ts` (update `redistributePlatformFees` signature), `src/components/admin/accounting/InsightsDashboard.tsx` (pass observed rates, badge logic)

---

## Fix 4 — Fix order count fallback

**Current behaviour:** Line 315 falls back to `rows.length` (number of settlements) as order count when `profitOrderCounts` has no data. A single settlement covers many orders, so this produces wildly inaccurate shipping cost calculations.

**New behaviour:** When `profitOrderCounts[mp]` is unavailable or zero, set `estimatedOrderCount = 0` and `estimatedShippingCost = 0`. The `returnAfterShipping` calculation will show `null` (displayed as N/A) rather than a misleading number.

**Files:** `src/components/admin/accounting/InsightsDashboard.tsx` (lines 312-316), `src/components/insights/MarketplaceProfitComparison.tsx` (line 190 uses `rows.length` similarly — same fix)

---

## Technical Summary

| File | Changes |
|------|---------|
| `src/utils/insights-fee-attribution.ts` | Remove Case 2 blending; change Case 1 to flag missing data instead of estimating; update `redistributePlatformFees` to accept observed rates and replace hardcoded 0.15 |
| `src/components/admin/accounting/InsightsDashboard.tsx` | Remove Case 1 estimation and Case 2 blending; load observed rates from `app_settings`; pass to redistribution; fix order count fallback; show "Fee data unavailable" message for `hasMissingFeeData` marketplaces |
| `src/components/insights/MarketplaceProfitComparison.tsx` | Add upstream api_sync exclusion filter; stop showing estimated commission rates; fix order count fallback |

**No changes to:** `auto-generate-shopify-settlements`, database functions, Xero push logic, `commission-rates.ts` (edge function only)

