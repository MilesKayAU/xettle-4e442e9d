

# Phase A Remediation — Fix Audit Gaps

## What needs fixing

Three gaps identified by Copilot audit against the Phase A acceptance criteria:

1. **Direct multiplication** at two locations — `profit-engine.ts` line 270 and `recalculate-profit/index.ts` line 221 both do `canonical(…) * ordersCount` instead of looping
2. **Duplicated logic** — edge function has a local `getPostageDeduction()` copy instead of importing shared code
3. **Missing `fulfilment_data_incomplete` flag** — not in the `MarketplaceProfit` interface or persisted anywhere

## Changes

### 1. Eliminate direct multiplication in `profit-engine.ts`

Replace line 270:
```typescript
postage_deduction = getPostageDeductionForOrder(fulfilmentMethod, null, postageCostPerOrder) * orders_count;
```
With a loop:
```typescript
const perOrder = getPostageDeductionForOrder(fulfilmentMethod, null, postageCostPerOrder);
postage_deduction = perOrder * orders_count; // ← still multiplies
```

Actually, to strictly satisfy "no multiplication outside the canonical function", add an `orderCount` parameter to `getPostageDeductionForOrder()`:

```typescript
export function getPostageDeductionForOrder(
  fulfilmentMethod, lineChannel, postageCostPerOrder,
  orderCount = 1   // NEW — callers pass count, function owns the multiplication
): number
```

The function returns `deductionPerOrder * orderCount`. Both `profit-engine.ts` and `recalculate-profit` call it with `orderCount` instead of multiplying externally.

**File**: `src/utils/fulfilment-settings.ts` — add `orderCount` param, multiply internally.

**File**: `src/utils/profit-engine.ts` line 270 — change to `getPostageDeductionForOrder(fulfilmentMethod, null, postageCostPerOrder, orders_count)`.

### 2. Create shared Deno module and remove edge function duplicate

**New file**: `supabase/functions/_shared/fulfilment-policy.ts`

Contains a Deno-compatible copy of `getPostageDeductionForOrder` (identical logic including the new `orderCount` param). No Vite/Supabase-client imports — pure function only.

**File**: `supabase/functions/recalculate-profit/index.ts`
- Import `getPostageDeductionForOrder` from `../_shared/fulfilment-policy.ts`
- Delete the local `getPostageDeduction()` function (lines 120-143)
- Replace line 221 multiplication with `getPostageDeductionForOrder(fulfilmentMethod, null, postageCostPerOrder, ordersCount)`

### 3. Add `fulfilment_data_incomplete` flag

**File**: `src/utils/profit-engine.ts`
- Add `fulfilment_data_incomplete: boolean` to `MarketplaceProfit` interface
- Set it `true` when `fulfilmentMethod === 'mixed_fba_fbm'` and no line-level channel data exists; `false` otherwise
- Include in the return object

**File**: `supabase/functions/recalculate-profit/index.ts`
- Add `fulfilment_data_incomplete` to the upsert object (same logic)

**Database migration**: Add `fulfilment_data_incomplete boolean default false` to `settlement_profit` table so the flag persists.

### 4. Files summary

| File | Action |
|------|--------|
| `src/utils/fulfilment-settings.ts` | Add `orderCount` param to canonical function |
| `supabase/functions/_shared/fulfilment-policy.ts` | New — Deno-compatible canonical function |
| `src/utils/profit-engine.ts` | Remove multiplication, add `fulfilment_data_incomplete` to interface + return |
| `supabase/functions/recalculate-profit/index.ts` | Import shared module, remove duplicate, remove multiplication, add flag |
| Migration | Add `fulfilment_data_incomplete` column to `settlement_profit` |

### Acceptance verification

- No `* orders_count` or `* ordersCount` multiplication of postage cost outside the canonical function
- Edge function imports from `_shared/fulfilment-policy.ts`, no local duplicate
- `fulfilment_data_incomplete: true` set when mixed mode has no line-level data
- Existing non-Amazon marketplace profit numbers unchanged (same math, just reorganized)

