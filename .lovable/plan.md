

## Plan: Fix Bunnings (and All Mirakl) Shipping Undercount

### Root Cause

Bunnings/Mirakl CSV settlements contain **summary-level lines** (1 revenue line, no order_ids). The `recalculate-profit` function calculates order count as `orderIds.size || revenueLines.length || 1`, which gives **1** for every Bunnings settlement. Shipping deduction = 1 × $9 = $9 per settlement.

Reality: A $1,257 Bunnings settlement contains ~30 orders. Correct shipping = ~$270, not $9.

```text
Current:   $1,131 revenue - $151 fees - $9 shipping  = $971 profit (85% margin)
Corrected: $1,131 revenue - $151 fees - $270 shipping = $710 profit (63% margin)
```

This same issue applies to all Mirakl-sourced CSV settlements (Bunnings, BigW, Everyday Market, MyDeal) which use summary lines.

**Shopify data IS correct** — Shopify payout settlements (source: `api`) contain only pure Shopify store orders. No sub-channel order IDs overlap. The $1,663 revenue and 65.9% margin for Shopify accurately reflects only direct Shopify store sales.

### Fix

**Cross-reference order counts from `shopify_auto_*` settlements**

File: `supabase/functions/recalculate-profit/index.ts`

When the order count from settlement_lines is 0 or 1 for a CSV settlement, look up the matching `shopify_auto_[marketplace]` settlements for the same period and use their order count instead. These auto-settlements have accurate per-order data from Shopify.

Implementation:
1. Build a map of `marketplace → month → order_count` from `shopify_auto_*` settlement_profit rows
2. When processing a CSV settlement where `orderIds.size <= 1`, look up the auto-settlement order count for the same marketplace and overlapping period
3. Use that count for shipping calculation: `shippingOrderCount = autoOrderCount || ordersCount`

```text
// Pseudocode
const autoOrderCounts: Map<string, Map<string, number>> = new Map();
// key: marketplace, value: Map<month_str, order_count>

for (const s of settlements) {
  if (s.settlement_id.startsWith('shopify_auto_')) {
    const lines = linesBySettlement.get(s.settlement_id) || [];
    const count = new Set(lines.filter(l => l.order_id).map(l => l.order_id)).size;
    // Store by marketplace + month
  }
}

// When processing CSV settlement with orderIds.size <= 1:
const monthKey = s.period_end?.substring(0, 7); // e.g. "2026-01"
const autoCount = autoOrderCounts.get(mp)?.get(monthKey);
if (autoCount && autoCount > ordersCount) {
  shippingOrderCount = autoCount;
}
```

This gives Bunnings Jan: 36 orders × $9 = $324 shipping instead of $9.

### Expected Result

| Marketplace | Before | After |
|---|---|---|
| Bunnings margin | 73.3% (shipping undercounted) | ~58-63% (realistic) |
| Shopify margin | 65.9% (correct) | 65.9% (unchanged) |
| Kogan margin | 56.2% (correct — already uses auto data) | 56.2% (unchanged) |

### Files Modified

| File | Changes |
|---|---|
| `supabase/functions/recalculate-profit/index.ts` | Cross-reference auto-settlement order counts for CSV settlements with missing order IDs |

### No database changes needed

After deploying, click "Recalculate" on the Insights page to refresh profit data.

