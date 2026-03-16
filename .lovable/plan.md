

## Assessment: AI Account Mapper vs Your COA

### Critical Bug Found

Line 317 in `ai-account-mapper/index.ts` references `revenueAccounts` — a variable that **does not exist**. The actual variable is `allActiveAccounts` (line 295). This means the entire deterministic keyword scanner is silently failing, and all marketplace-specific matching falls back solely to the AI LLM — explaining the poor judgment you've seen.

### Gaps vs Your COA

Your COA has rich, well-structured marketplace-specific accounts. Here's what the mapper currently misses:

1. **Multi-region Amazon**: You have Amazon AU (200), Amazon USA (201.1), Amazon Japan (210), Amazon Singapore (215) — but `MARKETPLACE_KEYWORDS` only has `'Amazon AU'`. No entries for USA, Japan, Singapore.

2. **"Advertising Costs" missing from base CATEGORIES**: The `CATEGORIES` array (line 36) lists 9 items but omits `Advertising Costs`. It appears in `SPLITTABLE_CATEGORIES` and in the AI prompt, but the UI won't render a global Advertising Costs row. Your COA has 414 (AU), 413 (USA), 412 (UK).

3. **Keyword gaps for "Seller Fees"**: Your accounts say `"Amazon Seller Fees AU"` (407) — the keyword list requires `"seller fee"` (singular) but the account name has `"Seller Fees"` (plural). The keyword `"fees"` alone is too generic. Same issue with `"Bunnings Fees AU"` (402) which has no "seller" keyword.

4. **FBA Fees keyword**: Account 408 is `"Amazon FBA Fees AU"` — the keyword `"fba"` works, but the exclusion list blocks `"seller"` which isn't in the name anyway, so this should be fine once the variable bug is fixed.

5. **Refunds per marketplace**: You have 205 (Amazon Refunds AU), 205.1 (Amazon Refunds USA), 207 (Shopify PayPal refund), 208 (Shipping Refund Shopify) — good structure but no Bunnings/eBay/Kogan refund accounts, so those would correctly fall back to global.

6. **Clearing accounts**: LMB39-* accounts are gateway clearing accounts — the mapper doesn't handle these at all (nor should it for settlement posting, but worth noting).

### Plan

**Edge function (`ai-account-mapper/index.ts`):**

1. **Fix critical bug**: Change `revenueAccounts` → `allActiveAccounts` on line 317
2. **Add multi-region marketplace keywords**: Add entries for `'Amazon USA'`, `'Amazon JP'`, `'Amazon SG'`, `'Amazon UK'` with appropriate keywords and country hints
3. **Broaden "Seller Fees" keywords**: Add `'seller fees'`, `'fees'` (plural), and `'commission'` patterns; use exclusions to prevent FBA/storage/advertising collisions
4. **Handle account names like "Bunnings Fees AU"**: Treat accounts with marketplace keyword + generic "fees" (without fba/storage/advertising) as Seller Fees candidates

**Frontend (`AccountMapperCard.tsx`):**

5. **Add "Advertising Costs" to base `CATEGORIES`**: Insert it between `Storage Fees` and `Other Fees` so it renders a global row
6. **Add `CATEGORY_DESCRIPTIONS` entry** for Advertising Costs

### Technical Detail

The variable name fix (item 1) is the single highest-impact change — it will immediately activate all the keyword matching logic that was written but never executed due to the undefined reference.

