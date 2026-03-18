

## Accounting Boundary: What It Is and The Fix

### What is the boundary?

The `accounting_boundary_date` is a safety gate set during onboarding. Its purpose: **prevent Xettle from creating duplicate Xero entries for settlements that were already recorded in Xero before you started using Xettle.**

During setup on **March 14**, the onboarding wizard ran `scan-xero-history` which scanned your Xero for existing marketplace invoices. Based on what it found, it recommended **2026-03-11** as the cutoff. No `accounting_boundary_source` was saved (the key is missing from `app_settings`), so it was likely set via the default "today" path or the scan's recommendation.

### How it works

- Settlements with `period_end < boundary` get flagged `is_pre_boundary: true`
- Pre-boundary settlements are filtered out of the action queue and never pushed to Xero
- Most pre-boundary items are also marked `status: already_recorded` (assumed to exist in Xero already)

### Current state of pre-boundary settlements

There are ~20 pre-boundary settlements across Amazon AU and Shopify. All are marked `already_recorded` **except one**:

| Settlement | Marketplace | Deposit | Period End | Status |
|---|---|---|---|---|
| 132787241207 | shopify_payments | $41.84 | Mar 10 | `ready_to_push` but `is_pre_boundary: true` |

This is the missing 5th payout that Link My Books shows. It fell 1 day before the boundary.

### The fix

**Move the boundary from 2026-03-11 to 2026-03-10** and flip `is_pre_boundary` to `false` on settlement `132787241207`.

Implementation:
1. Update `app_settings` row: set `accounting_boundary_date` to `2026-03-10`
2. Update `settlements` row for ID `132787241207`: set `is_pre_boundary = false`
3. No code changes needed -- the existing boundary logic will handle everything correctly with the new date

This is a data-only change (two UPDATE statements). The $41.84 payout will immediately appear in the action queue, matching Link My Books' count of 5.

