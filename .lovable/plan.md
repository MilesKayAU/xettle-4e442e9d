

## Problem

Kogan's "Avg Commission" shows **0.0%** while "Marketplace Fees" correctly shows **$464** (12% of $3,864 sales). The two columns on the same row contradict each other.

**Root cause**: When all rows are `api_sync` with zero `seller_fees` (Case 1, lines 342-351), the code correctly estimates `effectiveTotalFees` using the 12% rate, but `avgCommission` is calculated from the raw `commissionTotal` (line 271-272) which sums the actual `seller_fees` fields — all zero. The `adjustedAvgCommission` fallback (lines 382-390) also returns zero because `feeRelevantRows` is empty when all rows are api_sync zero-fee.

The same issue affects Case 2 (mixed sources) and the `MarketplaceProfitComparison` component.

## Fix

**1. Align `avgCommission` with estimated fees in InsightsDashboard**

In the Case 1 block (all api_sync zero-fee, ~line 342-351), after setting `effectiveTotalFees`, also set an `effectiveAvgCommission` to the estimated rate. In the Case 2 block (mixed, ~line 352-371), derive commission from the real CSV fee rate. Use `effectiveAvgCommission` in the final `results.push()` instead of `adjustedAvgCommission`.

**2. Same fix in MarketplaceProfitComparison**

Apply the identical commission rate alignment so both components show consistent numbers.

**3. No other changes needed**

The "Marketplace Fees" column already shows the correct estimated value. Only "Avg Commission" is broken — it's reading raw zeros instead of the estimated rate.

### Technical detail

```
// In Case 1 (all api_sync zero-fee):
const effectiveAvgCommission = COMMISSION_ESTIMATES[mp] || DEFAULT_COMMISSION_RATE;

// In Case 2 (mixed):
const effectiveAvgCommission = realFeeRate; // already computed from CSV rows

// Default (no estimation needed):
const effectiveAvgCommission = adjustedAvgCommission;

// Then in results.push:
avgCommission: effectiveAvgCommission,
```

Files to modify:
- `src/components/admin/accounting/InsightsDashboard.tsx` — fix avgCommission for Cases 1 & 2
- `src/components/insights/MarketplaceProfitComparison.tsx` — same alignment if it has its own commission display

