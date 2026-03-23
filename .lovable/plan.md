

## Shipping Cost Deduction in Profit Ranking — Data Availability & Plan

### What Data We Have

1. **`settlement_profit` table** — already has `orders_count` and `units_sold` per settlement per marketplace. This is populated by the profit engine when SKU cost data exists.

2. **`settlement_lines` table** — has individual transaction rows with `order_id`. We can count distinct `order_id` values per marketplace to get order counts even when no SKU costs are entered.

3. **`app_settings`** — stores `postage_cost:{marketplace_code}` (the user's estimated shipping cost per order) and `fulfilment_method:{marketplace_code}`.

### The Gap Today

The Marketplace Profit Ranking chart (screenshot) has two paths:

- **Path A (has `settlement_profit` rows)**: Uses profit data that already includes `orders_count` and `postage_deduction`. Shipping IS already factored in here.
- **Path B (settlement-only, no SKU costs)**: Lines 204-235 of `MarketplaceProfitComparison.tsx`. This path explicitly says `// skip postage deduction here since we don't have order counts`. So for marketplaces without SKU cost data, shipping is NOT deducted even when the user has entered an estimated cost.

### The Fix

For Path B marketplaces, we CAN get order counts from `settlement_lines` by counting distinct `order_id` values grouped by marketplace. Then multiply by the user's `postage_cost` setting to produce an estimated shipping deduction.

### Implementation

**File: `src/components/insights/MarketplaceProfitComparison.tsx`**

1. After loading settlements, also query `settlement_lines` to get distinct order counts per marketplace:
   ```sql
   SELECT marketplace_name, COUNT(DISTINCT order_id) as order_count
   FROM settlement_lines
   WHERE user_id = ? AND order_id IS NOT NULL
   GROUP BY marketplace_name
   ```
2. In Path B (lines 204-235), use the order count from `settlement_lines` + the user's `postage_cost` + `fulfilment_method` to calculate a shipping deduction via the existing `getPostageDeductionForOrder()` function.
3. Subtract shipping deduction from `adjustedPayout` before calculating margin.
4. Add a new field `shipping_deduction` to `AggregatedMarketplace` interface and display it as a tooltip or sub-line on the chart (e.g., "incl. est. shipping: -$X,XXX").
5. Show an "Est. Shipping" badge next to marketplaces where shipping was deducted using estimates (similar to the existing "Estimated" badge for fees).

### What This Gives Users

- Bunnings at 73% margin might drop to ~60% once their $8/order shipping estimate is applied across their order count
- Makes the ranking more realistic and actionable
- No schema changes needed — all data already exists

### Technical Details

- Query `settlement_lines` with a single RPC or direct query, grouped by `marketplace_name`
- Only count lines where `order_id IS NOT NULL` and `accounting_category = 'revenue'` (to avoid counting fee lines as orders)
- For Path A marketplaces (with `settlement_profit`), shipping is already included — no change needed
- The `getPostageDeductionForOrder()` function handles all fulfilment method logic (self-ship, 3PL, marketplace-fulfilled, mixed)

