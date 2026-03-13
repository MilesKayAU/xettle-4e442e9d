

# Fix Outstanding Tab: Bank Deposit Matching + Diagnostics

## Problem Summary

The `fetch-outstanding` edge function has **two independent failure stages**:

- **Stage 1 (Invoice↔Settlement):** Working — the fuzzy matcher at lines 309-361 correctly matches by amount/date/marketplace with reasonable tolerances. Your 14/21 matched count confirms this.
- **Stage 2 (Bank deposit matching):** Broken — lines 369-385 make a raw `fetch()` to Xero BankTransactions **without** `fetchXeroWithRetry`, so any 429 or network error silently leaves `bankTxns = []`. Result: 0 bank matches, every row shows "Awaiting deposit."

Additionally, there are no diagnostics to distinguish "no deposits exist" from "fetch failed silently."

## Changes (1 file)

### `supabase/functions/fetch-outstanding/index.ts`

**Fix A — Replace live Xero bank fetch with cached `bank_transactions` table (lines 363-385)**

Replace the raw `fetch()` block with a Supabase query to the existing cache table (populated every 30 min by `fetch-xero-bank-transactions`):

```typescript
const { data: cachedBankTxns } = await supabase
  .from('bank_transactions')
  .select('*')
  .eq('user_id', userId)
  .eq('transaction_type', 'RECEIVE')
  .gte('date', ninetyDaysAgo.toISOString().split('T')[0]);

const bankFeedEmpty = !cachedBankTxns || cachedBankTxns.length === 0;

const bankTxns = (cachedBankTxns || []).map(t => ({
  BankTransactionID: t.xero_transaction_id,
  Total: t.amount,
  Date: t.date,
  Reference: t.reference || '',
  Contact: { Name: t.contact_name || '' },
  LineItems: [{ Description: t.description || '' }],
  BankAccount: { Name: t.bank_account_name || '' },
  CurrencyCode: t.currency || 'AUD',
}));
```

This eliminates the second Xero API call entirely, prevents silent failures, and uses already-cached data.

**Fix B — Remove single-group skip (line 463)**

Delete `if (group.invoiceIds.length < 2) continue;` so single Amazon invoices still get scored against bank transactions. They must still meet the existing score ≥ 70 threshold for "high" confidence.

**Fix C — Widen 1:1 match to scored candidates (lines 632-654)**

Replace the ≤$0.05 exact-match loop with a scored approach matching the aggregate scorer:
- Amount tolerance: $10
- Narration keyword scoring: +30 for marketplace keyword match
- Date proximity: +20 for ≤2 days, +10 for ≤5 days
- Only populate `bankMatch` when score ≥ 70
- Set `fuzzy: true` so the UI treats it as a suggestion, not confirmed
- Pick best candidate by score (not first match)

Merge this with the existing fuzzy path (lines 670-693) into one unified scored matcher for all non-confirmed, non-aggregate rows.

**Fix D — Add structured diagnostics to response**

Add a `sync_info` object to the response with:

```typescript
sync_info: {
  invoice_count: invoices.length,
  settlement_count_total: allSettlements.length,
  matched_settlement_count: matchedWithSettlement,
  bank_txn_count_cached: bankTxns.length,
  bank_feed_empty: bankFeedEmpty,
  bank_cache_range: bankTxns.length > 0
    ? { min: /* earliest date */, max: /* latest date */ }
    : null,
  bank_matches_count: bankDepositFound,
  candidates_generated: readyToReconcile,
  source: usingCacheFallback ? 'cache_fallback' : 'live_xero',
}
```

When `bank_feed_empty` is true, the UI can show "No bank feed data — check bank connection" instead of misleading "Awaiting deposit" on every row.

**Fix E — Add structured console log before response**

```typescript
console.log(JSON.stringify({
  event: 'fetch_outstanding_complete',
  user_id: userId.slice(0, 8),
  invoice_count: invoices.length,
  settlement_count: allSettlements.length,
  bank_txn_count: bankTxns.length,
  bank_feed_empty: bankFeedEmpty,
  matched_settlements: matchedWithSettlement,
  bank_deposits_found: bankDepositFound,
  ready_to_reconcile: readyToReconcile,
}));
```

## What stays unchanged

- Settlement matching logic (reference extraction, alias lookup, fuzzy amount+date+marketplace) — already working
- Aggregate grouping algorithm (5-day windows) — just removes the size-2 minimum
- Payment verification layer (Rule #11)
- No schema changes needed
- `bank_transactions` table already exists with RLS, populated by `fetch-xero-bank-transactions` on 30-min cycle

## Guardrails

- Fix A: date-bounded query (last 90 days) prevents unbounded growth; scoped by `user_id`
- Fix B: single groups still require score ≥ 70 for "high" confidence
- Fix C: scored suggestions only — `fuzzy: true` flag means UI never auto-confirms
- Fix D: `bank_feed_empty` diagnostic prevents misleading "Awaiting deposit" when cache is empty

