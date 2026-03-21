

## Research Findings — Account Mapper Suggestion Accuracy

### Current Issues Identified

**1. Gap-fill ignores Revenue vs Expense separation**
The gap-fill logic in `coaSuggestions` (lines 221-274) uses `max(categoryCodes) + 1` blindly across ALL categories. This means:
- If Sales accounts are at 200-213, it suggests 214 for the next Sales marketplace — correct.
- But Seller Fees (an **expense** category) also gets suggested in the 200-range if the existing fee codes happen to be there — **wrong** per Xero best practice.
- Xero convention: Revenue 200-399, Expenses 400-599. The gap-fill doesn't enforce this boundary.

**2. Category grouping is flat — no Revenue/Expense partitioning**
The `CATEGORY_DISPLAY_MAP` loop iterates all 10 categories in one pass. It should partition into two groups:
- **Revenue categories**: Sales, Shipping, Promotional Discounts, Refunds, Reimbursements → codes in 200-range
- **Expense categories**: Seller Fees, FBA Fees, Storage Fees, Advertising Costs, Other Fees → codes in 400-range

Currently a Seller Fees gap-fill can collide with a Sales gap-fill because both draw from the same numeric neighborhood.

**3. Gap-fill doesn't detect the customer's actual code pattern**
The `accountCodePolicy.ts` has a `detectCodePattern()` function that can identify base codes per category and decimal strategies — but the gap-fill logic in `coaSuggestions` memo doesn't use it at all. It should:
- Detect the customer's existing pattern (e.g., eBay Sales=200, Amazon Sales=203, Shopify Sales=211)
- Infer the category's numeric neighborhood from existing accounts
- Only suggest codes within that same neighborhood

**4. Works for this customer but won't generalize**
The hardcoded ranges (200-399 revenue, 400-599 expenses) work for this customer's 3-digit Xero setup, but many accountants use 4-digit codes (e.g., 4000-4999 revenue). The `neighbourhoodOf()` helper in `accountCodePolicy.ts` already handles this — it just isn't wired into the gap-fill.

### Proposed Fix

**File**: `src/components/settings/AccountMapperCard.tsx` — `coaSuggestions` memo (lines 221-274)

1. **Partition categories into Revenue and Expense groups** using the existing `REVENUE_CATEGORIES_SET` (line 76). Run gap-fill separately per group so expense suggestions never land in revenue ranges and vice versa.

2. **Use `detectCodePattern()` from accountCodePolicy** to detect the customer's actual numbering convention. If their Sales accounts are at 200, 203, 211, the gap-fill should suggest 214, 215 (next in that neighborhood) — not jump to 400. If their fees are at 460, 461, suggest 462, 463.

3. **Range-aware floor**: For each group (revenue/expense), compute `startFrom` as `max(all codes in that group across all categories) + 1` rather than per-category. This prevents the current behavior where Sales and Shipping get separate `startFrom` values that can overlap with Fees.

4. **Respect `getRangeForType()`**: Before accepting a gap-fill code, validate it falls within the correct range for its account type. If it doesn't, fall back to `generateNextCode()` from the policy module.

5. **Generalize for any COA structure**: Use `neighbourhoodOf()` to detect whether the customer uses 3-digit or 4-digit codes, and scope the gap-fill to the same neighborhood. This ensures new users with 4000-series revenue codes get suggestions in the 4000s, not the 200s.

### Technical Detail

```text
Current (broken for expenses):
  globalClaimed = {}
  Sales:        max(211,213) → startFrom=214 → BigW=214, temu=215
  Shipping:     max(206,215) → startFrom=216 → eBay=216, MyDeal=217
  Seller Fees:  max(460,461) → startFrom=462 → BigW=462 ← correct
  BUT if fees were at 206.1, 215.1 → startFrom=216 ← COLLISION with Shipping!

Fixed (partitioned):
  REVENUE group (Sales, Shipping, Refunds, Promos, Reimbursements):
    All revenue codes: [200,203,206,211,213,215]
    startFrom = max(215)+1 = 216
    Gap-fill: BigW Sales=216, temu Sales=217, eBay Shipping=218...
    Validate: all in 200-399 ✓

  EXPENSE group (Seller Fees, FBA, Storage, Advertising, Other):
    All expense codes: [460,461,462]
    startFrom = max(462)+1 = 463
    Gap-fill: BigW Seller Fees=463, temu Seller Fees=464...
    Validate: all in 400-599 ✓
```

This is a focused change to ~50 lines in the `coaSuggestions` memo, leveraging existing policy functions. No new files needed.

