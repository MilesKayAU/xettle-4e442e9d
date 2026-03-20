

# Audit: Shipping Cost Estimator — Findings & Fixes

## What's Working Correctly
- Edge function structure: guard on `shipping:enabled`, PAC API two-step (service lookup then calculate), 500ms delay, batch_size capped at 50
- Marketplace detection via `marketplace_registry` server-side — no frontend imports
- `calculation_basis` JSONB stored with full audit trail
- `estimate_quality` derived from real vs default weight/dimensions
- Rolling averages computed from `order_shipping_estimates` only (not `shopify_orders`)
- Unique constraint on `(user_id, shopify_fulfillment_id)` with duplicate skip on 23505
- Settings UI has non-dismissible warning banner, all inputs, batch runner
- InsightsDashboard loads `marketplace_shipping_stats` and renders PAC row with amber badge + sample size

## Issues Found

### Issue 1: `shopify_orders` table has no `cancelled_at` or `test` columns
The edge function queries `shopify_orders` and filters on `financial_status != 'voided'`, but the table schema shows no `cancelled_at`, `test`, `fulfilled_at`, or `refund_status` columns. The edge function works around this by fetching fulfillments from the Shopify API directly — but it does NOT filter out cancelled/test orders at the DB query level because those columns don't exist. This means cancelled orders whose fulfillment still exists in Shopify will get estimated.

**Fix**: Add a check in the Shopify fulfillment loop — skip fulfillments with `status === 'cancelled'`. Shopify fulfillment objects have a `status` field (`success`, `cancelled`, `error`, `failure`). Only process `status === 'success'`.

### Issue 2: No tooltip on PAC estimate in Insights
The card shows the badge and sample count but no tooltip explaining the data is not used for accounting. The plan specified a tooltip.

**Fix**: Wrap the PAC row in a `TooltipProvider`/`Tooltip` with the agreed text.

### Issue 3: `pacEstimateQuality` always null
Line 491 hardcodes `pacEstimateQuality: null` with comment "computed elsewhere if needed". The plan specified showing quality distribution. The data exists in `order_shipping_estimates.estimate_quality` but is never queried.

**Fix**: Query `order_shipping_estimates` grouped by `marketplace_code, estimate_quality` to get the dominant quality level per marketplace, and display it in the Insights card (e.g. "Quality: medium").

### Issue 4: Averages not auto-updated on non-affected marketplaces
The edge function only recalculates stats for marketplaces that had new estimates in THIS run. If old estimates are deleted or corrected, stats go stale. This is acceptable for now but worth noting.

### Issue 5: `grams → kg` conversion present but min weight floor is 0.1kg
Line 398: `Math.max(totalWeightGrams / 1000, 0.1)` — PAC API minimum weight is 0.1kg so this is correct. No issue.

### Issue 6: Insights card doesn't show 14-day average
The data is loaded (`pacShippingAvg14`) but only the 60-order average is displayed. The 14-order average could show shipping cost drift.

**Fix**: Show both averages when 14-day data exists.

## Plan — 3 Fixes

### Fix 1: Filter cancelled fulfillments in edge function
In the fulfillment processing loop, skip any fulfillment where `fulfillment.status !== 'success'`.

### Fix 2: Add tooltip + quality indicator to Insights PAC row
- Query `order_shipping_estimates` for dominant `estimate_quality` per marketplace
- Show "Quality: {level}" next to sample count
- Add tooltip with the agreed analytics-only disclaimer
- Show 14-order average when available

### Fix 3: Populate `pacEstimateQuality` from actual data
Add a query in `loadStats()` that groups `order_shipping_estimates` by `marketplace_code, estimate_quality` to find the dominant quality per marketplace.

## Files Modified
- `supabase/functions/estimate-shipping-cost/index.ts` — add fulfillment status filter
- `src/components/admin/accounting/InsightsDashboard.tsx` — add quality query, tooltip, 14-day avg display

## What is NOT changed
- Settlements, Xero, journals, reconciliation, accounting exports
- Database schema (no migration needed)
- Settings UI (working correctly)

