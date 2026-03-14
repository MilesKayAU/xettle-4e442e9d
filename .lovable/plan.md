

# Phase 1: Settlement-Native "Send to Xero" Card

## Problem
The "Send to Xero" card reads from `marketplace_validation` (line 133, 230), which contains stale monthly rollup rows producing mega-buckets like "Amazon AU — Feb 1–28 — $12,471". The `settlements` table already has canonical per-payout records.

## Change: Single file — `src/components/dashboard/ActionCentre.tsx`

### 1. Add a `settlements` query to `loadData`
Add to the `Promise.all` block (line 132):
```typescript
supabase.from('settlements')
  .select('id, marketplace, settlement_id, period_start, period_end, bank_deposit, status, is_hidden, is_pre_boundary, duplicate_of_settlement_id')
  .in('status', ['ingested', 'ready_to_push'])
  .eq('is_hidden', false)
  .eq('is_pre_boundary', false)
  .is('duplicate_of_settlement_id', null)
  .order('marketplace')
  .order('period_start', { ascending: false })
```

Store in new state: `readySettlements`.

### 2. Replace `readyToPush` derivation
Currently (line 230):
```typescript
const readyToPush = normalisedRows.filter(r => r.overall_status === 'ready_to_push');
```

Replace with a computed list derived from `readySettlements`, mapping each settlement row to the shape the card expects (marketplace label, period, amount). Each row = one real payout.

### 3. Update Card 2 rendering
Wire the card to use the new settlement-sourced list instead of the validation-sourced `readyToPush`. The `settlement_net` field maps to `bank_deposit`, marketplace label uses the existing `MARKETPLACE_LABELS` lookup.

### 4. No deletion, no sweep changes
Per copilot guidance: no cleanup of `marketplace_validation` in this phase. The ghost rows remain but are no longer displayed in the card. Phase 2 (hide/supersede) deferred.

## What changes
- **One file**: `src/components/dashboard/ActionCentre.tsx`
- **No migration**: `settlements` table already has all needed columns
- **No edge function changes**

## Result
The "Send to Xero" card will show one row per real settlement payout (matching Link My Books), not monthly rollups.

