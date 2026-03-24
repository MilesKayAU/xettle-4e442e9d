

## Plan: Insights Page Data Accuracy Audit and Fixes

### Issues Found

**Issue 1 (Critical) — Refunds double-counted in "Total fees + refunds" line**

In `InsightsDashboard.tsx`, the `feeBreakdown` array includes refunds as a segment (line 468). The `breakdownTotal` (line 475) sums ALL breakdown items including refunds. Then `s.feeLoad` = `breakdownTotal / totalSales` — already includes refunds. But line 1410 adds refunds AGAIN:

```typescript
// Line 1410 — DOUBLE COUNTS refunds
formatPct(s.feeLoad + (s.totalSales > 0 ? s.totalRefunds / s.totalSales : 0))
```

Result: If refunds are 5% and fees are 10%, it shows "15% + 5% = 20%" instead of the correct 15%.

Fix: Remove the `+ totalRefunds/totalSales` from line 1410 since `feeLoad` already includes refunds.

---

**Issue 2 (Critical) — "Marketplace Fees Paid" summary card includes refunds**

The top-level card at line 940 shows `totalAllFees` which is derived from `breakdownTotal` — which includes refunds. A card labelled "Marketplace Fees Paid" should not include refund amounts. This inflates the perceived fee burden.

Fix: Separate `totalAllFees` into fees-only (commission + FBA + storage + other) and show refunds separately, OR rename the card to "Fees & Refunds".

---

**Issue 3 (Medium) — MarketplaceProfitComparison uses completely separate data loading**

`InsightsDashboard` loads settlements directly (no user_id filter — relies on RLS). `MarketplaceProfitComparison` loads both `settlement_profit` AND `settlements` with explicit `user_id` filter. These two components on the same page can show conflicting numbers because:
- Different filtering logic (profit engine skips "suspicious" margins)
- Different fee calculation (profit uses `settlement_profit` table, insights uses raw settlements)
- `settlement_profit` table may be stale or have different row counts

This means the "Marketplace Profit Ranking" table and the "$1 Sale Breakdown" chart could show different margins for the same marketplace.

Fix: Add a note in the Profit Ranking card clarifying it uses SKU-level cost data (different from the payout-based metrics above). This is actually correct behavior — two different views of profitability — but the UX doesn't explain this.

---

**Issue 4 (Medium) — `useInsightsData` hook exists but appears unused on the Insights dashboard**

The hook at `src/hooks/useInsightsData.ts` calls 4 RPC functions (`get_marketplace_fee_analysis`, `get_gst_liability_by_quarter`, `get_rolling_12_month_trend`, `get_channel_comparison`). But `InsightsDashboard.tsx` never imports or uses this hook — it builds its own data from raw settlements. This means:
- If those RPC functions exist, they're wasted
- If they don't exist, the hook silently fails
- A third data source that could diverge from the other two

Fix: Remove `useInsightsData` if it's truly unused, or integrate it to replace the manual aggregation.

---

**Issue 5 (Low) — Fee Comparison table shows refunds as a "Fee Source"**

The cross-marketplace fee comparison table (line 1426) pulls labels from `feeBreakdown` which includes "Refunds". Refunds aren't a fee source — they're a separate financial event. Showing them alongside "Commission" and "FBA Fulfilment" is misleading.

Fix: Exclude "Refunds" from the fee comparison table rows, or add it as a separate summary row below the total.

---

**Issue 6 (Low) — Stacked bar segments don't account for refunds separately**

The `getStackedSegments` function (line 857) calculates: `net = 1 - fees - ads`. But `feeLoad` already includes refunds (from Issue 1), so the bar shows refunds as part of fees, not as a distinct segment. This makes it look like fees are higher than they are.

Fix: Break refunds out as a 4th segment in the stacked bar (distinct color from fees and ads).

---

**Issue 7 (UX) — Page is extremely long with repetitive data**

The screenshot shows the same data presented in 6+ different formats on one page:
1. Summary cards (top)
2. Profit Ranking table
3. SKU comparison
4. $1 Sale Breakdown bars
5. Fee Intelligence table
6. Profit Leak Breakdown bars
7. Fee Comparison table
8. Revenue Concentration bars
9. Biggest Cost Driver card
10. Marketplace Overview cards

Many show the same numbers in different layouts. A bookkeeper scanning this page sees the same marketplace data repeated 6+ times. This increases cognitive load and the risk of spotting inconsistencies.

Fix: Group into tabs (Overview / Fee Analysis / Profit Breakdown) to reduce scrolling and repetition.

---

### Implementation Priority

| # | Issue | Impact | Fix Complexity |
|---|-------|--------|---------------|
| 1 | Refunds double-counted in total | Wrong numbers shown | 1 line change |
| 2 | "Fees Paid" includes refunds | Misleading label | Label rename or split |
| 5 | Refunds in Fee Comparison table | Minor confusion | Filter 1 array |
| 6 | Stacked bar lacks refund segment | Visual inaccuracy | Add 4th segment |
| 3 | Dual data sources show different values | Confusing discrepancies | Add explanatory note |
| 4 | Unused `useInsightsData` hook | Dead code | Delete or integrate |
| 7 | Page too long / repetitive | Poor UX | Tab restructure |

### Files Modified

| File | Changes |
|------|---------|
| `src/components/admin/accounting/InsightsDashboard.tsx` | Fix double-count (line 1410), rename "Fees Paid" card, exclude refunds from fee comparison, add 4th bar segment, add tabs |
| `src/hooks/useInsightsData.ts` | Evaluate removal if unused |

### No database changes needed

