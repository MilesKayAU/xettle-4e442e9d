

# eBay Sync Hardening — Implementation Plan

## Issues Identified (7 fixes)

### 1. GST: Use eBay-provided tax fields, fallback to 1/11th estimate

**File:** `supabase/functions/fetch-ebay-settlements/index.ts`

In `buildSettlementFromPayout()`, eBay transaction objects can include tax fields. Change to:
- For each SALE transaction, check `tx.orderLineItems[].tax` or `tx.totalFeeBasisAmount` for tax breakdown
- If eBay provides tax/VAT amounts, sum them directly
- Only fallback to 1/11th when no tax data present
- Tag settlement metadata with `gst_mode: 'ebay_provided'` vs `'estimate_1_11th'` so downstream (insights, posting) knows the confidence level

### 2. Deduplication: Upsert instead of skip

**File:** `supabase/functions/fetch-ebay-settlements/index.ts`

Current code (line 371-374) skips existing settlements entirely. Change to:
- Use `.upsert()` on `(user_id, settlement_id)` instead of insert-after-check
- This handles payout adjustments, chargebacks, and delayed fee corrections
- Log `ebay_settlement_updated` event (distinct from `ebay_settlement_imported`) when an existing row is modified
- Dedupe key remains: `ebay_payout_${payoutId}` per user — this is stable and correct

### 3. Rate limit cooldown: per-provider, reset on success, log event

**File:** `supabase/functions/fetch-ebay-settlements/index.ts`

- After successful sync for a user, **delete** the `ebay_rate_limit_until` key (reset cooldown)
- On rate limit, log a `system_event`: `ebay_sync_rate_limited` with `{ retry_after, user_id }`

**File:** `supabase/functions/scheduled-sync/index.ts`

- Already per-provider (`ebay_rate_limit_until` key). Confirmed correct.
- Add jitter: randomize eBay user processing order to avoid stampeding the same user first every cycle

### 4. Mutex: verify manual + cron coverage

**File:** `supabase/functions/fetch-ebay-settlements/index.ts`

- In user-authenticated (manual) mode, acquire `sync_lock(user_id, 'ebay', 'settlement_sync')` before processing
- Release on completion (success or error)
- Lock TTL is 300s — already set, acts as deadlock protection
- The lock key `settlement_sync` is already provider-specific

### 5. Sync window hard cap: 180 days max

**File:** `supabase/functions/scheduled-sync/index.ts` (sync window calc, ~line 131)

- After computing `syncFrom`, clamp: `syncFrom = max(syncFrom, today - 180 days)`
- Log if clamped so admin can see when backfill is needed

**File:** `supabase/functions/fetch-ebay-settlements/index.ts`

- Add same 180-day cap on `sync_from` input

### 6. Settlement object: verify canonical fields

**File:** `supabase/functions/fetch-ebay-settlements/index.ts`

Audit `buildSettlementFromPayout()` against posting engine expectations:
- Sign conventions: sales positive, fees negative, refunds negative — **already correct** (line 192: `feesTotal -= Math.abs(feeAmount)`, line 195: refunds already negative from eBay)
- Add missing fields: `currency`, `fba_fees: 0`, `storage_fees: 0`, `advertising_costs: 0`, `promotional_discounts: 0`, `reimbursements: 0` (some of these are expected by the posting engine and missing will cause NULLs)
- Ensure `source: 'api'` and add `source_reference: 'ebay_finances_api_v1'` for traceability
- `is_hidden: false`, `is_pre_boundary: false` defaults

### 7. Verification artefact: sample payloads in system_events

**File:** `supabase/functions/fetch-ebay-settlements/index.ts`

- On first successful import per sync run, log a detailed `ebay_sync_debug` event containing the full settlement object (before insert) so it's inspectable in FormatInspector/system events. Only for the first payout per run to avoid noise.

## Execution Order

1. Fix GST handling (tax field extraction + estimate fallback tagging)
2. Switch dedup from skip to upsert
3. Add missing canonical settlement fields
4. Add mutex for manual sync path
5. Add cooldown reset on success + rate limit system_event
6. Add 180-day hard cap to sync window
7. Add jitter to scheduled-sync eBay processing
8. Add debug artefact logging
9. Redeploy both edge functions

## Files Changed

| File | Changes |
|------|---------|
| `supabase/functions/fetch-ebay-settlements/index.ts` | GST tax fields, upsert dedupe, manual mutex, cooldown reset, 180d cap, canonical fields, debug event |
| `supabase/functions/scheduled-sync/index.ts` | 180d sync window cap, jitter on eBay user order |

