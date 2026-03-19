

# Ad Spend Integration Audit — Kogan $90 January

## Summary

The $90 Kogan ad spend is **correctly integrated** across all calculation paths. No formula bugs found. Here's the full flow:

1. **Stored** in `marketplace_ad_spend` with `marketplace_code: 'kogan'`
2. **Aggregated** into `adSpendByMp['kogan'] = 90`
3. **$1 Breakdown chart**: `returnAfterAds = (netPayout − $90) / totalSales` — shows amber segment in stacked bar
4. **Fee Intelligence table**: Shows $90 in the "Ad Spend" column
5. **After ads + shipping**: Correctly deducts $90 from combined calculation
6. **Marketplace Overview cards**: Shows $90 ad spend and "After ads" return

## One Consistency Fix Needed

The **Marketplace Overview cards** (bottom of Insights page) still display `0.0%` for "Marketplace fees" and "Avg commission" when `hasMissingFeeData` is true (e.g. Kogan with only api_sync data). The **Fee Intelligence table** correctly shows "N/A" for these — the cards should match.

### Changes

**File:** `src/components/admin/accounting/InsightsDashboard.tsx` (lines ~1502-1510)

Replace the fee load and avg commission display in Marketplace Overview cards with conditional rendering:
- When `hasMissingFeeData` is true → show "N/A" in amber text (matching Fee Intelligence table)
- When `hasMissingFeeData` is false → show the percentage as before

This is a ~6-line UI change. No formula or data changes needed — the ad spend integration is working correctly.

