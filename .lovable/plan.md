

## Plan: Make Shipping a First-Class Cost in Insights

### Problem

Amazon settlements include fulfillment fees (FBA) in their fee data, so Amazon's "$X per $1 sold" reflects the true cost. But Shopify and other self-ship marketplaces don't include shipping in their settlement — the user pays shipping separately. The system knows the estimated shipping cost ($9/order for Shopify) and calculates it, but only shows it as a small footnote. The primary metrics, charts, rankings, and hero text all use `returnRatio` (net payout / sales) which ignores shipping entirely.

Result: Shopify shows "$0.93 per $1 sold" while Amazon shows "$0.66" — making Shopify look 40% more profitable when in reality shipping closes that gap significantly.

### Fix

Include estimated shipping as a cost layer in all primary metrics when the user has configured shipping costs. This makes the comparison fair across FBA vs self-ship marketplaces.

**1. Add shipping to the primary `returnRatio` when shipping data exists**

File: `src/components/admin/accounting/InsightsDashboard.tsx`

When `shouldDeductShipping && estimatedShippingCost > 0`:
- Adjust `effectiveNetPayout` to subtract `estimatedShippingCost`
- Recalculate `effectiveReturnRatio` from adjusted net
- This flows through to hero, sort, bars, and all downstream metrics automatically

**2. Add shipping segment to $1 Sale Breakdown stacked bar**

Update `getStackedSegments()` to include a 5th segment for shipping:
```text
Before: net + ads + refunds + fees = 100%
After:  net + ads + refunds + fees + shipping = 100%
```

Add a shipping bar (e.g., `bg-blue-400`) with tooltip showing the deduction. Only shown when `estimatedShippingCost > 0`.

**3. Add shipping row to Profit Leak Breakdown**

Add "Est. Shipping" as a waterfall row between fee rows and the total, using a distinct color and "(est.)" label. Shows the total shipping deduction and its percentage of sales.

**4. Add "Est. Shipping" column to Fee Intelligence table**

New column after "Refunds" showing the estimated shipping cost. Shows "—" for FBA/marketplace-fulfilled channels, and the shipping total for self-ship channels. Add a column for "After Shipping" or fold it into the existing "Payout" to show the adjusted ratio.

**5. Update hero insight text**

`getHeroInsight()` already uses `returnRatio` — since we're adjusting the primary ratio, the hero text will automatically reflect shipping-adjusted figures. Add "(incl. est. shipping)" qualifier when any marketplace has shipping deductions.

**6. Add "Est. Shipping" badge to $1 bar legend**

When shipping is deducted, show badge on the marketplace row indicating the figure includes estimated shipping so users understand it's not from settlement data.

**7. Sort remains fair**

Since `returnRatio` now includes shipping for self-ship channels and already includes FBA fees for Amazon, the sort order becomes a true apples-to-apples comparison.

### What stays the same

- Shipping is still estimated (from user-configured `postage_cost` or `marketplace_shipping_costs`)
- When no shipping cost is configured, nothing changes — the metric remains payout-only with the existing "Add Shipping" prompt
- FBA channels are unaffected — their shipping is already in settlement fees
- The tooltip on "Return per $1 Sold" summary card will update to say "after marketplace fees and est. shipping" instead of "excludes shipping"

### Files Modified

| File | Changes |
|------|---------|
| `src/components/admin/accounting/InsightsDashboard.tsx` | Deduct shipping from `effectiveNetPayout`/`effectiveReturnRatio`; add shipping segment to stacked bar; add shipping row to Profit Leak; add column to Fee Intelligence table; update hero/tooltip copy |

### No database changes needed

