

# Fix: Split-Aware Grouping + Conservative GST Explainable Matching

## Problem
21 invoices linked to settlements, 0 matched. Two root causes:

1. **Split invoices grouped together**: P1 and P2 invoices share the same `settlement_id`, so they get summed together and compared against `bank_deposit`. P1 represents expense allocation, P2 represents bank deposit — their sum will never match either anchor.

2. **GST-inclusive invoice amounts**: Non-split invoices where Xero `AmountDue` includes GST, but the settlement anchor (`bank_deposit`) is net of GST. The diff equals `gst_on_income`, which the explainable matcher should catch but may miss due to tolerance gates.

## Changes (single file: `supabase/functions/fetch-outstanding/index.ts`)

### Change 1 — Split-Aware Sub-Grouping (lines 839-853)

Currently groups by `settlement_id` only. Will sub-group by `settlement_id + part` when split invoices are detected.

**Grouping key logic:**
- `extractSettlementId` already returns `{ id, part }` — `part` is extracted from references like `Xettle-291854-P1` or `Amazon AU Settlement 291854 - Part 2`
- Store `part` alongside each invoice in the group
- After first pass, if a group contains invoices with different `part` values AND the settlement has `is_split_month = true`, split into sub-groups keyed by `settlementId_P1` / `settlementId_P2`

**Anchor per sub-group:**
- P1 → `abs(split_month_1_data.netExGst)` (the `SplitMonthData` type has `netExGst` but no `bankDeposit`)
- P2 → `abs(split_month_2_data.netExGst)`
- No part (non-split settlement) → `abs(bank_deposit ?? net_ex_gst)` (unchanged)

**No heuristic anchor switching.** If the settlement is not `is_split_month` or the part cannot be determined from the reference, the group stays as-is with the existing anchor. We do not guess invoice type.

### Change 2 — Conservative GST Explainable Logic (lines 909-936)

Add `gst_on_income` alone as an explainable candidate (currently only `tax = gst_on_income + gst_on_expenses` is checked). This is the most common single-component mismatch.

**New candidate list (6 entries, still max 2 components):**
```
[fees, 'fees']
[refunds, 'refunds']
[tax, 'tax']                        // gst_on_income + gst_on_expenses
[gstOnIncome, 'gst_on_income']      // NEW — standalone
[fees + tax, 'fees+tax']
[fees + refunds, 'fees+refunds']
```

**No other changes to the explainable logic.** The tolerance gate (`diff <= min(net * 0.10, 100)`) and match threshold (`abs(diff - component) <= 1.00`) stay the same. We widen the $1.00 to $2.00 only for the `gst_on_income` candidate to accommodate rounding across line items.

### Change 3 — Use split-aware anchor in explainable pass

When scoring a sub-group (P1 or P2), the `settlement` object passed to the explainable matcher should use the split data's fee/refund/GST values (already available in `SplitMonthData`: `sellerFees`, `fbaFees`, `refunds`, `gstOnIncome`, `gstOnExpenses`, etc.) instead of the parent settlement totals.

### What does NOT change
- `extractSettlementId` — already returns `part`
- `resolveCanonicalId` — unchanged
- `getSettlementNet` — unchanged (only used for non-split groups)
- Bank matching logic — unchanged
- Row shape / UI — unchanged (OutstandingTab already reads `settlement_group_confidence` and `settlement_group_explanation`)
- No automatic anchor switching based on heuristics — if we can't prove the invoice is a split part via its reference, we don't change the anchor

### Expected outcome
- Split settlements: P1 matches against `split_month_1_data.netExGst`, P2 against `split_month_2_data.netExGst` → "Matched exact" or "Matched high"
- Non-split GST-inclusive invoices: diff matching `gst_on_income` within $2 → "Matched explainable (gst_on_income)"
- Settlement matching count should go from 0/21 to ~14-19/21
- Remaining mismatches are genuine and need investigation

