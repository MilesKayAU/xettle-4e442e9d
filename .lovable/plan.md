

# Deposit Coverage Mapping — Implementation Plan

## Current State
- Batch matching exists in `match-bank-deposits` Pass 2 — settlements share the same `xero_tx_id` but have no explicit group identifier
- `payment_verifications` table has no `deposit_group_id` column
- UI shows "Batched deposit across N settlements" text but cannot show the reverse view (which settlements a deposit covers)

## Changes Required

### 1. Database Migration
Add `deposit_group_id` column and index to `payment_verifications`:
```sql
ALTER TABLE public.payment_verifications ADD COLUMN IF NOT EXISTS deposit_group_id uuid;
CREATE INDEX IF NOT EXISTS idx_pv_deposit_group ON public.payment_verifications(deposit_group_id) WHERE deposit_group_id IS NOT NULL;
```

### 2. Edge Function: `match-bank-deposits/index.ts`
Two small additions:

**Pass 1 (line ~247):** Add `deposit_group_id: crypto.randomUUID()` to the upsert payload for single matches.

**Pass 2 (line ~413):** Before the batch loop, generate `const groupId = crypto.randomUUID()`. Add `deposit_group_id: groupId` to each settlement's upsert payload in the batch.

No scoring or matching logic changes — only adding the group ID to existing writes.

### 3. UI: `OutstandingTab.tsx` — Deposit Coverage Panel
Add lazy-loaded deposit coverage when a row is expanded:

- New state: `depositGroupData: Record<string, { settlements: any[], depositAmount: number }>`
- When `expandedRow` changes and the row has a settlement, query `payment_verifications` for that settlement's `deposit_group_id`, then fetch all siblings sharing that group ID
- Join sibling settlement IDs against `settlements` table to get period labels and amounts
- Render a "Deposit Coverage" card in the evidence panel (between Payout Verification and the 3-column grid):

```
Deposit $2,658.41 covers 3 settlements:
  ✓ Settlement 2026-03-01  $732.58
  ✓ Settlement 2026-03-08  $1,081.93
  ✓ Settlement 2026-03-15  $843.90
Total: $2,658.41  Difference: $0.00
```

- If `abs(depositAmount - settlementSum) > 0.05`, show warning badge
- Only fetched when row is expanded (lazy-load, never preload all groups)

### Files Affected
| File | Change |
|------|--------|
| DB migration | Add `deposit_group_id uuid` + index |
| `supabase/functions/match-bank-deposits/index.ts` | Add `deposit_group_id` to Pass 1 and Pass 2 upserts (~4 lines) |
| `src/components/dashboard/OutstandingTab.tsx` | Deposit Coverage panel in evidence section |

### Safety
- No changes to settlement parsing, GST, Xero invoice creation, or account mapping
- Verification-only — no accounting entries created
- Golden Rule preserved

