

## Problem

The 3 Shopify Payments settlements ($29.66, $58.62, $41.84) match Link My Books exactly. However, only 2 of the 3 are `ready_to_push` in our system — the $41.84 one (and many older ones) are stuck in `ingested` status because the promotion step (Step 5b in `sync-xero-status`) hasn't run since they were fetched.

**Root cause:** Shopify payouts are ingested with `status = 'ingested'` and only get promoted to `ready_to_push` when a Xero sync runs. If the user hasn't triggered a sync recently, new payouts sit in `ingested` limbo, showing "Waiting for Payout" / "Pending" instead of "Send to Xero".

The older settlements (Feb/Mar) showing "Waiting for Payout" are also `ingested` — same issue.

## Solution

### 1. Auto-promote Shopify payouts at ingestion time

In `fetch-shopify-payouts`, Shopify Payments payout data from the API is already fully reconciled (it comes with transaction breakdowns). There's no reason to wait for a Xero sync to promote them. Change the initial status from `ingested` to `ready_to_push` for non-pre-boundary payouts.

**File:** `supabase/functions/fetch-shopify-payouts/index.ts` (~line 287)
- Change: `const settlementStatus = "ingested"` → `const settlementStatus = isBeforeBoundary ? "ingested" : "ready_to_push"`
- This ensures new payouts immediately appear in the "Send to Xero" queue

### 2. Bulk-promote existing stuck `ingested` settlements

Add a one-time promotion step in the dashboard fetch logic so existing stuck settlements get promoted without waiting for a Xero sync.

**File:** `src/components/dashboard/RecentSettlements.tsx` (in `fetchAll`)
- After loading rows, find any `ingested` Shopify/Amazon settlements within 60 days that aren't pre-boundary
- Batch-update them to `ready_to_push` in the background and re-fetch

### 3. Rename "Waiting for Payout" summary card

Since most rails no longer require bank matching, rename the summary card from "Waiting for Payout" to "In Xero" to avoid confusion. Only show "Awaiting bank match" as a sublabel when there are actually bank-match-required items.

**File:** `src/components/dashboard/RecentSettlements.tsx` (~line 507-515)
- Change label from "Waiting for Payout" to "In Xero — Processing"
- Update sublabel to "Posted, awaiting reconciliation"

### 4. Fix `ingested` status badge

The `StatusBadge` for `ingested` currently shows "Processing" — rename to "Needs Sync" to make it clear these need a sync or promotion.

**File:** `src/components/dashboard/RecentSettlements.tsx` (~line 176-183)

### Files to modify

| File | Change |
|------|--------|
| `supabase/functions/fetch-shopify-payouts/index.ts` | Auto-set `ready_to_push` for non-pre-boundary payouts |
| `src/components/dashboard/RecentSettlements.tsx` | Bulk-promote stuck `ingested`, rename summary card, fix badge |

