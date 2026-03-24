

## Plan: Fix Shopify Shipping Cost Misattribution

### Root Cause

When a Shopify payout CSV is uploaded, it contains ALL orders — including Bunnings, Kogan, BigW, etc. that use Shopify as the payment processor. The `recalculate-profit` edge function processes this settlement with `marketplace_code = 'shopify'` and applies the **Shopify** postage cost setting ($9) to every order in it.

Result: 87 Shopify orders × $9 = $783 shipping deducted from "Shopify" — but many of those 87 orders are actually Bunnings/Kogan/BigW orders whose shipping should be attributed to their respective marketplaces (or not at all if they're marketplace-fulfilled).

This is why Shopify shows 30% shipping — it's absorbing the shipping costs of all sub-channel orders.

Meanwhile, `shopify_auto_bunnings` settlements (created by auto-generate) also count those same Bunnings orders with their own shipping deduction — so shipping is **double-counted** across the system.

### Fix

**1. Exclude sub-channel orders from Shopify payout shipping calculation**

File: `supabase/functions/recalculate-profit/index.ts`

When processing a Shopify payout settlement (marketplace starts with `shopify` but NOT `shopify_auto_` or `shopify_orders_`), cross-reference the order IDs against `settlement_lines` from `shopify_auto_*` settlements. Any order that appears in a sub-channel auto-settlement should be excluded from the Shopify payout's order count for shipping purposes.

```text
Before:  87 orders × $9 = $783 shipping on "Shopify"
After:   87 - 55 sub-channel orders = 32 pure Shopify orders × $9 = $288
```

Implementation:
- After loading all settlement lines, build a set of order IDs that belong to `shopify_auto_*` settlements
- When calculating `ordersCount` for a Shopify payout settlement, subtract orders that exist in any `shopify_auto_*` settlement
- This prevents double-counting: Bunnings orders get shipping under `bunnings`, pure Shopify orders get shipping under `shopify`

**2. Apply correct per-marketplace shipping rates to sub-channel auto-settlements**

The auto-generate function already creates separate settlements per marketplace (e.g., `shopify_auto_bunnings_2026-01`). The `recalculate-profit` function already looks up `postageCosts[mp]` per marketplace. So if the user has set `postage_cost:bunnings = $9` and `postage_cost:shopify = $5`, Bunnings gets $9 and Shopify gets $5.

Verify: Ensure `postage_cost` settings exist per sub-channel marketplace, not just for "shopify". If only "shopify" has a cost set, the sub-channels get $0. Add a note in the UI when sub-channel shipping costs aren't configured.

**3. Update InsightsDashboard order counts to exclude sub-channel orders from Shopify**

File: `src/components/admin/accounting/InsightsDashboard.tsx`

The `profitOrderCounts` aggregation at line 184-189 sums `orders_count` from `settlement_profit`. After the recalculate-profit fix, the Shopify entry will already have the correct (reduced) order count. No additional frontend changes needed — the fix is in the profit calculation.

**4. Add sub-channel shipping configuration reminder**

File: `src/components/admin/accounting/InsightsDashboard.tsx`

When a marketplace's fulfilment method is `self_ship` or `third_party_logistics` but `shippingCostPerOrder === 0` and there are orders, show a subtle prompt: "Set shipping cost estimate for accurate margins."

### Files Modified

| File | Changes |
|------|---------|
| `supabase/functions/recalculate-profit/index.ts` | Exclude sub-channel order IDs from Shopify payout shipping count; build cross-reference set from `shopify_auto_*` lines |
| `src/components/admin/accounting/InsightsDashboard.tsx` | Add missing shipping cost prompt for sub-channel marketplaces |

### No database changes needed

After deploying, run "Recalculate Profit" to refresh all `settlement_profit` rows with corrected shipping attribution.

