

## Problem

The gap-fill suggestion logic has two bugs visible in the screenshot:

1. **Cross-category code collisions**: The `claimed` set is scoped per-category, so code `216` can be suggested for both "BigW Sales" AND "MyDeal Shipping", and `217` for both "temu Sales" AND "Catch Shipping". These are new accounts that don't exist yet, so `allExistingCodes` doesn't catch duplicates.

2. **No category-aware range separation**: The algorithm starts from `rangeStart` (the lowest code in that category's existing suggestions) and walks upward. Since Sales and Shipping both live in the 200-range, gap-fill suggestions overlap. It should detect the distinct sub-ranges per category (e.g., Sales: 200–213, Shipping: 214–221) rather than blindly reusing the same numbers.

3. **Dropdown defaults to base code (206) instead of suggestion**: The right-hand dropdown shows `206` for most Shipping overrides instead of the suggested gap-fill code, meaning the suggestion isn't being auto-applied.

## Plan

### 1. Fix cross-category code collisions in `coaSuggestions` memo

**File**: `src/components/settings/AccountMapperCard.tsx` (lines ~220–270)

- Move the `claimed` set **outside** the per-category loop so it's shared across all categories. This prevents the same code being suggested for Sales and Shipping.

### 2. Smarter range detection per category

Instead of using `rangeStart` from the first mapped code (which could be a shared parent like 206), detect the **marketplace-specific sub-range** by looking at codes that are clearly per-marketplace (not the base/parent account). Start gap-fill from `max(categoryCodes) + 1` rather than `rangeStart`, so new suggestions extend the sequence rather than filling gaps that might belong to other categories.

### 3. Auto-apply gap-fill suggestions to editable mapping

When gap-fill suggestions are generated, pre-populate `editableMapping[key]` with the suggested code if no override exists yet. This ensures the dropdown on the right reflects the suggestion rather than falling back to the base code.

### Technical detail

```text
Current (broken):
  Sales:    claimed = {211, 203, ...}  → suggests 216 for BigW, 217 for temu
  Shipping: claimed = {206, 206.1, 215.1, ...} → suggests 216 for MyDeal, 217 for Catch
  ← 216 and 217 collide across categories

Fixed:
  globalClaimed = {}
  Sales:    starts from max(211,213)+1=214 → 214 BigW, 215 temu  (added to globalClaimed)
  Shipping: starts from max(206,215.1)+1=218 → 218 eBay, 219 MyDeal, 220 Catch...
  ← no collisions
```

