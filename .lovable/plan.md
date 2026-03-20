

## Plan: Fix COA Clone Name Generation for Brand-Contaminated Templates

### Problem
When a template account contains a brand/business name alongside the marketplace name (e.g. "MKA Website Sales Refund (Shopify PayPal)"), the name replacement only swaps "Shopify" → "temu", producing "MKA Website Sales Refund (temu PayPal)" — a nonsensical name for the new marketplace.

### Root Cause
`generateNewAccountName()` in `src/actions/coaCoverage.ts` does a simple string replacement of the marketplace name. It has no awareness of brand contamination.

### Fix: `src/actions/coaCoverage.ts` — `generateNewAccountName()`

Add a "clean name" fallback when the replaced name still contains words not attributable to the target marketplace or standard category terms:

1. After performing the marketplace name swap, check if the result still contains the original marketplace's surrounding context words (words that aren't standard category keywords like "Sales", "Fees", "Refund", "Shipping", etc.)
2. If >50% of non-category words in the result are inherited junk from the template name, **generate a clean canonical name instead**: `{targetMarketplace} {category}` (e.g. "temu Refunds")
3. This uses the `category` parameter — but `generateNewAccountName` currently doesn't receive the category. Add it as an optional parameter.

**Concrete changes:**
- Update `generateNewAccountName` signature to accept optional `category?: string`
- After replacement, if the name contains words not matching the target marketplace or known category keywords, fall back to `{targetMarketplace} {category}`
- Update the call site in `buildClonePreview` (coaClone.ts line 186) to pass the category

### Files Changed
- `src/actions/coaCoverage.ts` — update `generateNewAccountName`
- `src/actions/coaClone.ts` — pass `category` to the name generator

