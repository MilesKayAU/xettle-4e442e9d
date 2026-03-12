

# Xero-First Smart Sync with Split Discovery Windows

## What We're Building

Reorder the sync pipeline to query Xero first, auto-verify PAID settlements, compute a smart sync window for marketplace data, and maintain a separate 90-day discovery window for Shopify order-based marketplace detection.

## New Pipeline (9 steps)

```text
1. Xero status audit          (per Xero user)
2. Bank transaction fetch
3. Auto-verify PAID invoices   ← NEW
4. Compute smart sync window   ← NEW
5. Amazon fetch (sync_from)
6. Shopify payouts (sync_from)
6.5 Channel scan + auto-gen settlements
7. Shopify orders (always 90-day window for discovery)
8. Validation sweep
9. Auto-push to Xero + bank matching
```

## Key Design Decisions

| Decision | Approach |
|----------|----------|
| Settlement sync window | Oldest unreconciled gap, default 2 months |
| Discovery window | Always 90 days for Shopify orders |
| Auto-verify | PAID Xero invoice → `bank_verified = true`, `status = reconciled_in_xero` |
| Analytics data | Shopify orders fetch unchanged (still fetches full history for insights) |

## Files to Change

### 1. `supabase/functions/scheduled-sync/index.ts`
- Move steps 5-7 (Xero audit, bank fetch, bank match) to steps 1-2
- After Xero audit, per user: query oldest unreconciled settlement → compute `sync_from`
- Pass `sync_from` in body to Amazon and Shopify fetch calls
- Shopify orders fetch remains unchanged (90-day discovery is already built in)

### 2. `supabase/functions/sync-xero-status/index.ts`
- After updating a settlement's status to `reconciled_in_xero` (PAID invoice), also set:
  - `bank_verified = true`
  - `bank_verified_at = now()`
  - `status = reconciled_in_xero`
- This clears PAID items from the Outstanding tab automatically

### 3. `supabase/functions/fetch-amazon-settlements/index.ts`
- Accept optional `sync_from` in request body
- When present, skip settlement reports whose `dataEndTime` is before `sync_from`
- Fall back to existing accounting boundary behavior when not provided

### 4. `supabase/functions/fetch-shopify-payouts/index.ts`
- Accept optional `sync_from` in request body
- When present, use as `date_min` filter on the payouts API
- Fall back to existing accounting boundary behavior when not provided

## Smart Sync Window Logic (in scheduled-sync)

```text
Per user after Xero audit:
  1. Query settlements WHERE status NOT IN
     (reconciled_in_xero, synced_external, already_recorded)
     ORDER BY period_start ASC LIMIT 1
  2. sync_from = oldest gap OR (today - 2 months)
  3. Pass sync_from to Amazon/Shopify fetchers
```

## Auto-Verify Logic (in sync-xero-status)

When a settlement is matched to a PAID Xero invoice via reference or fuzzy match:
- Set `bank_verified = true`, `bank_verified_at = now()`
- Status already gets set to `reconciled_in_xero` for PAID invoices

This is a ~15 line addition in the existing settlement update loop.

## Discovery vs Settlement: Two Windows

```text
Settlement window: sync_from → today
  Used by: fetch-amazon-settlements, fetch-shopify-payouts
  Purpose: Only fetch missing/unreconciled data

Discovery window: today - 90 days → today
  Used by: fetch-shopify-orders (unchanged)
  Purpose: Detect TikTok, Temu, eBay, etc. from order metadata
```

The Shopify orders fetch already uses a ~90 day lookback — no change needed there.

## Expected Impact

- 80-90% fewer Amazon/Shopify API calls for accounts with Xero history
- Outstanding tab auto-clears PAID items immediately
- Onboarding becomes seconds instead of minutes
- Marketplace discovery remains reliable (90-day order scan)
- No data loss — analytics order fetch is unaffected

