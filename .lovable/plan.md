

## Findings

The dry run returned zero orders because the Amazon SP-API query on **line 479** filters for `Unshipped,PartiallyShipped,Shipped` only. Your new order (`503-9977917-3481420`) is still in **Pending** status on Amazon, so it is excluded from results.

## Root Cause

Amazon orders start in `Pending` status (payment verification phase, typically 30 minutes to a few hours). The current filter deliberately excludes `Pending` because Amazon withholds PII (shipping address, buyer info) until the order moves to `Unshipped`. Creating a Shopify order without PII would fail the hard-block safety gate.

## Plan

**File: `supabase/functions/sync-amazon-fbm-orders/index.ts`**

1. **Add `Pending` to the order status filter** (line 479): change to `Unshipped,PartiallyShipped,Shipped,Pending`
2. **Handle Pending orders gracefully** in the order processing loop (~line 530+):
   - When order status is `Pending`, extract PII as normal
   - If PII is missing (expected for Pending), set status to `pending_payment` (not `blocked_missing_pii`) with a friendly error detail: "Order is still in Pending status on Amazon — PII will be available once payment clears"
   - Skip Shopify order creation for `pending_payment` orders
   - When the order is re-fetched later (after moving to `Unshipped`), the existing idempotency logic will update it with full PII and proceed

3. **Add `pending_payment` to the force-refetch cleanup list** (line 368) so re-syncs pick these up

**File: `src/components/admin/FulfillmentBridge.tsx`**

4. **Add status color** for `pending_payment`: amber/yellow badge — `'bg-amber-100 text-amber-800 border-amber-300'`
5. **Add info text** in the order monitor for `pending_payment` status: "Awaiting Amazon payment verification — will auto-sync once the order moves to Unshipped"

## Why This is Safe

- Pending orders won't attempt Shopify creation (PII gate still enforced)
- They'll appear in your dashboard so you can see them
- Next sync (manual or cron) will re-process them once Amazon releases PII

## Technical Detail

- No database migration needed — `status` is a free-text column
- Edge function will be redeployed after changes

