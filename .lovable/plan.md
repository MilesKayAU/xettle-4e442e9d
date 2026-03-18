
Problem confirmed: this is not just a weak filter. The end-to-end flow has a label/identity mismatch plus suggestion precedence problems, so live Xero accounts can be present in cache but still not win in the mapper UI.

What I found

1. Xero COA is being pulled correctly
- `refresh-xero-coa` fetches live active Xero accounts and caches them into `xero_chart_of_accounts`.
- Your database currently contains the expected Shopify accounts:
  - `201 Shopify Sales`
  - `206 Shopify Shipping Revenue`
  - `400 Seller Fees Shopify`
- So the issue is not primarily “Xero didn’t return the COA”.

2. The mapper is mixing marketplace identities
- Active connection row is:
  - `marketplace_code = shopify_payments`
  - `marketplace_name = Shopify Payments`
- But the AI mapper fallback/deterministic logic often uses display label `Shopify`.
- `AccountMapperCard` builds keys as `Category:${marketplace_name from marketplace_connections}`.
- Result: one place generates `Sales:Shopify`, another expects `Sales:Shopify Payments`.
- Because of that, exact Shopify suggestions can exist but fail to attach to the rendered row, so the UI falls back to base/global mappings like Amazon `200`.

3. Confirmed mapping state is also masking the issue
- Current confirmed mapping in `app_settings.accounting_xero_account_codes` is mostly Amazon/global:
  - `Sales = 200`
  - `Refunds = 205`
  - `Seller Fees = 407`
  - etc.
- Split mode is enabled, but the confirmed record does not contain the per-marketplace Shopify overrides now shown in draft.
- In the UI, when no exact override key matches, it shows `Fallback: 200`, which is exactly what your screenshot shows.

4. There are two suggestion systems that are not aligned
- `src/utils/coa-intelligence.ts` uses registry-driven lowercase categories and marketplace codes.
- `supabase/functions/ai-account-mapper/index.ts` separately does deterministic keyword scanning using hardcoded marketplace labels.
- These systems use slightly different marketplace names/aliases and category heuristics, which creates drift.

Root cause summary

The main bug is not the Xero fetch itself. It is:
- inconsistent marketplace naming (`Shopify` vs `Shopify Payments`)
- suggestion keys using display names instead of canonical marketplace codes
- UI fallback to global mappings when exact override keys fail to resolve
- duplicated matching logic between client utility and backend mapper

Implementation plan

1. Canonicalize marketplace identity everywhere
- Use `marketplace_code` as the internal key for all per-marketplace suggestion/mapping generation.
- Only use display names for rendering.
- Update `AccountMapperCard` so rows, suggestions, and saved override keys resolve from a canonical marketplace descriptor map:
  - code
  - display name
  - aliases
- Normalize `shopify_payments` / `Shopify Payments` / `Shopify` to one canonical mapping path.

2. Fix mapper row key generation and lookup
- Refactor the split-row rendering so suggestion lookup does not depend on raw `marketplace_name` strings from `marketplace_connections`.
- Build exact override keys from canonical marketplace identity, then render the human label separately.
- Ensure Shopify rows consume `Sales:Shopify Payments` only if that is the persisted convention, or migrate consistently to one convention.

3. Unify matching logic around a single source
- Reuse `analyseCoA()` logic inside the backend AI mapper’s deterministic pre-scan instead of maintaining a second hardcoded marketplace keyword map.
- Add alias support for common naming variants:
  - Shopify / Shopify Payments / Website
  - eBay / eBay AU / Ebay
  - MyDeal / Mydeal
  - BigW / Big W
- This prevents backend suggestions and frontend fallback suggestions from disagreeing.

4. Tighten suggestion ranking
- Prefer exact marketplace-specific Xero accounts over global/base matches.
- Rank by:
  1. exact marketplace code/alias match + category match
  2. strong alias match + category match
  3. global category fallback
- Prevent a weaker Amazon/global suggestion from occupying a marketplace-specific row when a Shopify-specific account exists.

5. Rework displayed fallback behavior
- In split mode, show three distinct states:
  - exact marketplace suggestion found
  - no exact suggestion, using explicit global fallback
  - no valid fallback
- This makes it obvious when the row is not actually matched.
- For marketplaces with `use_global_mappings === false`, suppress global fallback in the UI as well.

6. Validate current saved data compatibility
- Add compatibility handling so existing saved keys like `Sales:Shopify` still resolve if the UI now renders `Shopify Payments`, or migrate them in-memory on load.
- Do the same for labels like `Mydeal` vs `MyDeal`, `BigW` vs `Big W`, `eBay` vs `eBay AU`.

Files to update

- `src/components/settings/AccountMapperCard.tsx`
  - canonical marketplace map
  - row key generation
  - suggestion lookup
  - fallback display logic
- `src/utils/coa-intelligence.ts`
  - marketplace alias normalization
  - stronger match scoring / exact-over-fallback preference
- `supabase/functions/ai-account-mapper/index.ts`
  - replace hardcoded deterministic marketplace matching with canonical shared logic or mirrored normalization rules
  - ensure override keys use the same convention as the UI
- Possibly `src/actions/accountMappings.ts`
  - compatibility resolver for old override key names if needed

Expected outcome

After this fix:
- live Xero Shopify accounts already in cache will be recognized
- Shopify rows will prefer `201 Shopify Sales`, `206 Shopify Shipping Revenue`, `400 Seller Fees Shopify`
- Amazon/global codes will only appear as intentional fallback, not because of key mismatch
- the mapper UI and backend auto-mapper will agree on the same marketplace/category identity model

Technical note
The strongest evidence is in current data:
- active connection: `Shopify Payments`
- draft overrides: `Sales:Shopify`, `Shipping:Shopify`, `Seller Fees:Shopify`
- confirmed global mapping: `Sales = 200`
That mismatch fully explains why the rendered Shopify row can still show Amazon/global fallback despite the correct Shopify COA accounts existing in Xero.

<lov-actions>
<lov-suggestion message="Test this end-to-end in Settings by refreshing from Xero, re-running the mapper, and verifying Shopify rows prefer Shopify accounts over Amazon fallbacks.">Verify that it works</lov-suggestion>
<lov-suggestion message="Implement the canonical marketplace code fix so all COA mapping keys use marketplace_code internally and only use display labels in the UI.">Canonicalize marketplace keys</lov-suggestion>
<lov-suggestion message="Unify the backend AI mapper and frontend COA intelligence so they share the same marketplace alias and category matching rules.">Unify matching engine</lov-suggestion>
<lov-suggestion message="Add a diagnostics panel to the mapper that shows why each row matched, fell back, or remained unmapped.">Add mapper diagnostics</lov-suggestion>
</lov-actions>
