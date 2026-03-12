

# Settlement → Bank Deposit Reconciliation Engine

## Overview
Implement a full bank transaction ingestion pipeline with local caching, deposit matching against settlements, and verification badges — with the minor adjustments you specified (currency, index, confidence_score, guard logic, 7-day window).

## Database Migration

### 1. New table: `bank_transactions`
```sql
CREATE TABLE public.bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  xero_transaction_id text NOT NULL,
  bank_account_id text,
  bank_account_name text,
  date date,
  amount numeric DEFAULT 0,
  currency text DEFAULT 'AUD',
  description text,
  reference text,
  contact_name text,
  transaction_type text DEFAULT 'RECEIVE',
  created_at timestamptz DEFAULT now(),
  fetched_at timestamptz DEFAULT now(),
  UNIQUE (user_id, xero_transaction_id)
);

ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own bank transactions"
  ON public.bank_transactions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_bank_transactions_user_date
  ON public.bank_transactions(user_id, date);
```

### 2. Add `confidence_score` to `payment_verifications`
```sql
ALTER TABLE public.payment_verifications
  ADD COLUMN IF NOT EXISTS confidence_score numeric DEFAULT 0;
```

## New Edge Function: `fetch-xero-bank-transactions`

- Iterates all users with `xero_tokens`
- **Guard**: checks `app_settings` key `bank_txn_last_fetched_at` — skips if < 30 minutes ago
- Calls Xero `GET /BankTransactions?where=Type=="RECEIVE" AND Date>=DateTime(60 days ago)&pageSize=100`
- Upserts into `bank_transactions` using `ON CONFLICT (user_id, xero_transaction_id) DO UPDATE`
- Updates `bank_txn_last_fetched_at` timestamp
- Config: `verify_jwt = false`

## Rewrite: `match-bank-deposits`

Replace the per-settlement live Xero API call (lines 199-256) with a local query:

```text
Before: For each settlement → call Xero API → score
After:  For each settlement → query bank_transactions → score
```

Key changes:
- Query `bank_transactions` where `user_id = X`, `date BETWEEN period_end AND period_end + 7 days` (expanded from 5 to 7)
- Amount tolerance: ±$0.50 (exact match = 50pts, ±$0.50 = 40pts, ±$1.00 = 30pts)
- Narration matching: use existing `MARKETPLACE_NAMES` map (+30pts)
- Date proximity: ≤2 days = +20pts, ≤7 days = +10pts
- Confidence scoring: ≥90 = high, ≥70 = medium, else low
- Write high-confidence matches (≥90) to `payment_verifications` with `confidence_score`
- Update settlement status to `deposit_matched` for score ≥90
- Golden Rule preserved: no auto-confirmation, suggestions only

## Update: `scheduled-sync`

Add two new steps after step 5 (Xero status audit):

```text
Step 6: fetch-xero-bank-transactions (with 30-min guard)
Step 7: match-bank-deposits (per user, using local cache)
```

Both with 45-second timeout protection. Update `totalSteps` from 5 to 7.

## Update: `sync-settlement-to-xero`

After successful push, set settlement status to `awaiting_deposit` instead of just `pushed_to_xero`.

## UI Updates

### GenericMarketplaceDashboard.tsx — Deposit status badge column
Add a new column showing deposit verification state:
- `awaiting_deposit` → amber badge "Awaiting Deposit"
- `deposit_matched` → blue badge "Deposit Matched"  
- `verified_payout` → green badge "Verified ✓"

Reuse `SettlementStatusBadge` by extending its switch cases.

### OutstandingTab.tsx — Recognize new statuses
The summary strip should count settlements by deposit state and show:
```text
Settlement found: 18 | Deposit matched: 15 | Verified: 12
```

### SettlementStatusBadge.tsx — Add new cases
```text
awaiting_deposit  → 🟡 Amber  "Awaiting Deposit"
deposit_matched   → 🔵 Blue   "Deposit Matched"
verified_payout   → 🟢 Green  "Verified ✓"
```

## Files Affected

| File | Change |
|------|--------|
| Database migration | `bank_transactions` table + index + RLS; `confidence_score` column |
| `supabase/functions/fetch-xero-bank-transactions/index.ts` | **New** |
| `supabase/config.toml` | Add `[functions.fetch-xero-bank-transactions]` |
| `supabase/functions/match-bank-deposits/index.ts` | Rewrite to use local cache |
| `supabase/functions/scheduled-sync/index.ts` | Add steps 6 + 7 |
| `supabase/functions/sync-settlement-to-xero/index.ts` | Set `awaiting_deposit` after push |
| `src/components/admin/accounting/shared/SettlementStatusBadge.tsx` | 3 new cases |
| `src/components/admin/accounting/GenericMarketplaceDashboard.tsx` | Deposit badge column |
| `src/components/dashboard/OutstandingTab.tsx` | Updated summary counts |

## Files NOT Changed
- Settlement parsing, GST calculations, Xero journal creation, account mapping

