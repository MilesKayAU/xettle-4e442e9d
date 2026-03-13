

# Destination Account Mapper + Matching Diagnostics — Gap Analysis & Plan

Most of what you've described is already implemented from the previous rail routing work. Here's what's **already done** vs what **still needs building**.

## Already Implemented

- **PayoutBankAccountMapper** uses `payout_destination:*` keys with legacy `payout_account:*` fallback
- All 9 Phase 1 rails displayed with "Use default" toggle and currency badge
- `fetch-outstanding` already does rail normalization, destination-scoped bank matching (line 985), and returns `routing` diagnostics per row (`rail_code`, `destination_account_id`, `destination_account_name`, `mapping_source`)
- `fetch-xero-bank-transactions` already has self mode (JWT auth, LOOKBACK_DAYS_SELF=30, destination-scoped account filtering, dedup via `Set`)
- Bank sync returns `cooldown_until`, `retry_after_seconds`, `bank_rows_upserted`, `mapped_account_ids_count`, `has_any_mapping`, `lookback_days`

## Gaps to Close

### 1. Rename component file + export
- Rename `PayoutBankAccountMapper.tsx` → `DestinationAccountMapper.tsx`
- Update all imports (search for `PayoutBankAccountMapper`)
- Section title already says "Settlement Rail → Destination Account"; simplify to "Destination accounts"

### 2. Add account type badge per row
- The Xero bank accounts response doesn't currently include account type. The `fetch-xero-bank-accounts` edge function needs to return `Type` (BANK) and `BankAccountType` from Xero API
- UI: show badge like "Bank", "PayPal", "Wise", "Clearing" based on account name heuristics or Xero's `BankAccountType` field
- Add `account_type` to `XeroBankAccount` interface

### 3. Per-row routing diagnostics in fetch-outstanding
- Already returns `routing.rail_code`, `routing.destination_account_id`, `routing.destination_account_name`, `routing.mapping_source`
- Add `routing.bank_feed_empty` (boolean — no cached txns for that destination account)
- Add `routing.bank_cache_stale` (boolean — oldest fetched_at for that account > 24h)
- Add `routing.last_bank_refresh_at` (timestamp)

### 4. Bank sync return shape enhancement
- Add `synced_account_count` (already have `mapped_account_ids_count` — alias it)
- Add `refreshed_at` timestamp to success response

## Files to Change

1. **Rename**: `src/components/settings/PayoutBankAccountMapper.tsx` → `src/components/settings/DestinationAccountMapper.tsx`
2. **Edit**: New `DestinationAccountMapper.tsx` — add account type badge, simplify title
3. **Edit**: All files importing `PayoutBankAccountMapper` (search needed)
4. **Edit**: `supabase/functions/fetch-xero-bank-accounts/index.ts` — return `type` field from Xero accounts
5. **Edit**: `supabase/functions/fetch-outstanding/index.ts` — add per-destination `bank_feed_empty`, `bank_cache_stale`, `last_bank_refresh_at` to routing object
6. **Edit**: `supabase/functions/fetch-xero-bank-transactions/index.ts` — add `synced_account_count` and `refreshed_at` to success response

## What Does NOT Change
- Matching scorer logic, tolerances, confidence thresholds
- Settlement state machine, accounting rules
- Backward compatibility with legacy `payout_account:*` keys

