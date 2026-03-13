

# Settlement Rail Routing with `payout_destination:*` Keys

## Summary

Introduce rail-based reconciliation routing using `payout_destination:<rail_code>` keys. Legacy `payout_account:*` keys remain untouched. All read paths use new-first/legacy-fallback. UI saves only new keys.

## Files to Change

### 1. New: `src/constants/settlement-rails.ts`
- `PHASE_1_RAILS` array with code + label for: `amazon_au`, `shopify_payments`, `ebay`, `bunnings`, `catch`, `kogan`, `mydeal`, `everyday_market`, `paypal`
- `RAIL_ALIASES` map: `{ ebay_au: 'ebay' }`
- `toRailCode(marketplace: string): string` helper

### 2. Migration: Copy-forward (non-destructive)
SQL that copies existing `payout_account:*` values into `payout_destination:*` only where new keys don't already exist. Normalizes rail codes during copy (e.g. `payout_account:ebay_au` becomes `payout_destination:ebay`). Does **not** delete or rename old keys.

### 3. Edit: `src/components/settings/PayoutBankAccountMapper.tsx`
- Change `PAYOUT_KEY_PREFIX` to `'payout_destination:'` and `DEFAULT_KEY` to `'payout_destination:_default'`
- Read both `payout_destination:%` and `payout_account:%` on load; prefer new keys, fallback to legacy
- Save only `payout_destination:*` keys
- Source rail list from `PHASE_1_RAILS` (unioned with active marketplace connections for display)
- Update UI labels: "Settlement Rail → Destination Account", "Default destination account", "Save destination mappings"

### 4. Edit: `supabase/functions/fetch-outstanding/index.ts` (~lines 510-540)
- Query both `payout_destination:%` and `payout_account:%`
- Build mappings preferring new keys, falling back to legacy
- Add `toRailCode()` inline helper (same logic as constants file)
- `getMappedPayoutAccount` becomes `getDestinationAccount(rail)` — returns `{ account_id, source }` where source can be `explicit | default | legacy_fallback | missing`
- Matching filter uses `getDestinationAccount(toRailCode(marketplace))` to scope bank transaction candidates

### 5. Edit: `supabase/functions/fetch-xero-bank-transactions/index.ts` (~lines 108-120)
- Query both `payout_destination:%` and `payout_account:%`
- Build `mappedAccountIds` from new keys first, legacy fallback
- No other logic changes

### 6. Edit: `src/pages/Dashboard.tsx` (~lines 260-271)
- Nudge query: check for `payout_destination:%` first, then `payout_account:%`
- Show nudge only if neither namespace has any keys

## What Does NOT Change
- Matching scorer logic, tolerances, confidence thresholds
- Settlement state machine
- Xero push logic
- Bank transaction caching strategy
- Old `payout_account:*` rows in `app_settings` (preserved indefinitely)

