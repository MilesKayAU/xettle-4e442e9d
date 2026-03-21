

## Verification: Revenue/Expense Partition — Working ✓

The fix correctly:
- Partitions categories into Revenue (200–399) and Expense (400–599) groups
- Uses `globalClaimed` across all categories to prevent code collisions
- Validates codes against `getRangeForType()` boundaries

**For this client's data, expense codes (Seller Fees, FBA Fees, etc.) will never collide with revenue codes (Sales, Shipping, etc.).**

## Remaining Issue: Category Neighbourhood Grouping

Within each range, ALL categories share one sequential counter. This means Sales, Shipping, and Refunds gap-fills are interleaved (e.g., 216, 217, 218) rather than each category extending its own block. In Xero's Chart of Accounts view, this makes the COA harder to read.

**Example with client's data:**
```text
Current:    BigW Sales=216, temu Sales=217, eBay Shipping=218, MyDeal Shipping=219
Better:     BigW Sales=214, temu Sales=215 (extends Sales block)
            eBay Shipping=222, MyDeal Shipping=223 (extends Shipping block)
```

## Plan: Wire detectCodePattern into gap-fill

**File**: `src/components/settings/AccountMapperCard.tsx` — `coaSuggestions` memo (~lines 221–276)

### Step 1: Detect the customer's existing code pattern
Before the gap-fill loop, call `detectCodePattern()` from `accountCodePolicy.ts` using the AI-suggested accounts (which reflect existing COA structure). This gives us `baseCodeByCategory` — the numeric neighbourhood for each category.

### Step 2: Use generateCodeFromPattern for gap-fills
Replace the raw `candidate = range.start` + walk-up logic with `generateCodeFromPattern()`, which starts from the category's base code and finds the next available slot nearby. Pass `globalClaimed` as `batchClaimed` to prevent collisions.

### Step 3: Fallback for unknown categories
If `detectCodePattern` returns null for a category (no existing accounts), fall back to current sequential logic within the correct range.

### Changes
- **`src/components/settings/AccountMapperCard.tsx`**: Import `detectCodePattern`, `generateCodeFromPattern`. ~15 lines changed in the gap-fill section of `coaSuggestions` memo. Replace lines 246–263 with pattern-aware generation.
- No new files needed — all helpers already exist in `accountCodePolicy.ts`.

