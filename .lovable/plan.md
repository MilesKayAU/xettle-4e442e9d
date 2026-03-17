

## Plan: Wire AccountMapperCard to the existing COA Intelligence scanner

### Problem
`AccountMapperCard.tsx` contains a duplicated inline COA scanner (`coaSuggestions` memo with hardcoded `CATEGORY_KEYWORDS`) instead of using the existing `src/utils/coa-intelligence.ts` which is more powerful — it uses database-driven detection keywords from `marketplace_registry`, supports confidence levels, and already produces `mapping_suggestions` with marketplace+category pairs.

### Changes

#### 1. Replace inline scanner with `coa-intelligence.ts` in AccountMapperCard

**File:** `src/components/settings/AccountMapperCard.tsx`

- Remove the inline `coaSuggestions` memo and its hardcoded `CATEGORY_KEYWORDS` block (~lines 133–200).
- Import `analyseCoA` and types from `@/utils/coa-intelligence`.
- Fetch `marketplace_registry` and `payment_processor_registry` rows (one-time query, alongside existing COA fetch).
- Call `analyseCoA(coaAccounts, registryEntries, processorEntries)` to get `DetectedSignals.mapping_suggestions`.
- Build the `coaSuggestions` Map from `mapping_suggestions`, keyed by `${category}:${marketplace_code}` — same shape the rest of the component already consumes.
- This gives us registry-driven keywords, confidence scoring, and payment provider detection for free.

#### 2. Map coa-intelligence categories to AccountMapper categories

The existing scanner uses lowercase category keys (`sales`, `seller_fees`, `fba_fees`, etc.) while AccountMapperCard uses display names (`Sales`, `FBA Fees`, etc.). Add a small mapping lookup so the suggestions resolve correctly against the `SPLITTABLE_CATEGORIES` keys used in the UI.

### What stays the same
- The AI edge function suggestions (`mapping[key]`) remain the primary suggestion — COA intelligence is the fallback, exactly as today.
- The overwrite protection, confirmation dialogs, and bulk-apply logic are unchanged.
- The `coaSuggestions` Map interface stays identical so no downstream changes are needed.

### Files affected
- `src/components/settings/AccountMapperCard.tsx` — replace inline scanner with `analyseCoA()` import

