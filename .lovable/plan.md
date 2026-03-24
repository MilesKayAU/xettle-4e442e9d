

## Plan: Fix Double-Counting in MarketplaceProfitComparison

### Root Cause

The profit ranking table double-counts revenue because `activeSettlementIds` (line 134) is built from ALL settlements including `api_sync` rows, but the `grouped` map (line 146-153) filters `api_sync` out when CSV data exists. Since the profit aggregation loop (line 176-193) uses `activeSettlementIds` to validate rows, `shopify_auto_*` profit entries still pass and get counted alongside CSV profit entries.

Additionally, `isMarginSuspicious()` (line 184) silently drops legitimate profit rows where margins exceed `(1 - commission_rate) * 100 + 5%`. Since there's no COGS, many rows have high margins (e.g., 85% for Bunnings) which may or may not trigger this filter depending on the commission estimate. This creates inconsistent filtering that makes totals appear wrong.

### Fix

**1. Rebuild `activeSettlementIds` AFTER api_sync deduplication**

Move the `activeSettlementIds` construction to after line 153 (after the api_sync filtering loop). This way, `shopify_auto_*` settlement IDs are removed from the active set when CSV data exists, and their corresponding profit rows are excluded.

```text
Before (line 134): activeSettlementIds includes shopify_auto_bunnings
After (line 154):  activeSettlementIds excludes shopify_auto_bunnings when CSV bunnings data exists
```

**2. Remove `isMarginSuspicious` filter from profit aggregation**

This filter was intended to catch data anomalies but it silently drops real data. With no COGS, all margins are high — this is expected, not suspicious. The filter should only apply when COGS data IS present (a margin of 95% WITH product costs would be suspicious; without costs it's just a payout ratio).

Replace line 184 with a check that only filters when `total_cogs > 0`:
- Fetch `total_cogs` in the profit query (add to select on line 93)
- Only apply `isMarginSuspicious` when `total_cogs > 0`

**3. Verify the recalculate-profit function actually ran**

The edge function logs show only "booted" with no processing output. The function may have hit a silent error or wasn't invoked properly. Add a "Recalculate Profit" button to the Insights page (the Profit Ranking card header) so users can trigger it directly without navigating to Settings.

### Files Modified

| File | Changes |
|------|---------|
| `src/components/insights/MarketplaceProfitComparison.tsx` | Move `activeSettlementIds` after dedup loop; add `total_cogs` to query; only apply `isMarginSuspicious` when COGS > 0; add recalculate button |

### Expected Result After Fix

- Bunnings revenue should reflect ONLY CSV settlements (not CSV + shopify_auto combined)
- Shopify should show only pure Shopify orders (not all sub-channel orders)
- No legitimate rows silently dropped by margin filter
- Users can trigger profit recalculation directly from the Insights page

### No database changes needed

