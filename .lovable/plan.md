

# Updated Plan: Add Rule 5 — Skip Empty Settlements

## Change

In `supabase/functions/fetch-mirakl-settlements/index.ts`, after the accumulation loop and before saving each grouped settlement, add an `hasActivity` guard:

```typescript
const hasActivity =
  Math.abs(totals.sales_principal) > 0.001 ||
  Math.abs(totals.sales_shipping) > 0.001 ||
  Math.abs(totals.seller_fees) > 0.001 ||
  Math.abs(totals.refunds) > 0.001 ||
  Math.abs(totals.reimbursements) > 0.001 ||
  Math.abs(totals.other_fees) > 0.001 ||
  Math.abs(totals.bank_deposit) > 0.001;

if (!hasActivity) {
  // Log skip as system_event info, then continue to next payout group
  continue;
}
```

This sits alongside the existing 4 safety rules in the approved plan. No other files or logic change.

## Files affected

- `supabase/functions/fetch-mirakl-settlements/index.ts` — add empty settlement guard after accumulation, before save

