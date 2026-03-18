

## Assessment: Source Priority Guard Implementation Status

### What WAS implemented

1. **`applySourcePriority()` in `src/actions/settlements.ts`** -- the canonical suppression logic exists and correctly handles both directions (CSV suppresses API, API self-suppresses if CSV exists).

2. **Post-insert calls** -- both `settlement-engine.ts` (line 1086) and `AccountingDashboard.tsx` (line 203) call `applySourcePriority()` after their direct inserts.

3. **`checkSourceOverlap()`** -- read-only query for UI warnings exists.

4. **`getSourcePreference()` / `setSourcePreference()`** -- preference storage via `app_settings` exists.

5. **Guardrail test** -- blocks `from('settlements').insert()` outside allowed files (line 236-247).

6. **Source badges** -- implemented in `GenericMarketplaceDashboard.tsx` and `ReconciliationHub.tsx`.

7. **Edge function** -- `auto-generate-shopify-settlements` updated with preference check and self-suppress logic.

### What was NOT implemented (the architectural gap you flagged)

The suppression logic is in the right file (`actions/settlements.ts`), but there is **no `createSettlementCanonical()` wrapper**. The insert paths are still direct `from('settlements').insert()` calls in:

- `settlement-engine.ts` (lines 832, 898)
- `AccountingDashboard.tsx` (line 143)
- `promote_and_save_settlement` RPC (DB function)

These call `applySourcePriority()` as **fire-and-forget** after the insert. This means:

1. If `applySourcePriority()` fails silently, the duplicate persists unsuppressed
2. The guardrail test **exempts** these files rather than blocking them -- the filter on lines 241-244 explicitly allows `settlement-engine.ts`, `settlement-components.ts`, and `AccountingDashboard.tsx`
3. Any future insert path would need to remember to call `applySourcePriority()` separately
4. The `promote_and_save_settlement` RPC (server-side) has no source priority check at all

### What needs to happen to make this fully canonical

**Goal**: Replace the "insert + fire-and-forget applySourcePriority" pattern with a single `saveSettlementCanonical()` function that wraps both steps atomically.

#### 1. Create `saveSettlementCanonical()` in `src/actions/settlements.ts`

A function that:
- Accepts the settlement payload
- Performs the insert
- Calls `applySourcePriority()` **synchronously** (not fire-and-forget)
- Returns the result including any suppression info
- Logs system event on failure

#### 2. Migrate insert paths

Replace direct `from('settlements').insert()` in:
- `settlement-engine.ts` (2 paths at lines ~832 and ~898) -- call `saveSettlementCanonical()` instead
- `AccountingDashboard.tsx` (line ~143) -- call `saveSettlementCanonical()` instead
- Remove the separate fire-and-forget `applySourcePriority()` calls from both files

#### 3. Tighten guardrail test

Remove the exemptions for `settlement-engine.ts`, `settlement-components.ts`, and `AccountingDashboard.tsx` from the guardrail test (lines 241-244). Only `src/actions/` files should be allowed.

#### 4. Handle `promote_and_save_settlement` RPC

The DB function `promote_and_save_settlement` does a server-side insert. It cannot call JS code. Two options:
- Add a post-RPC `applySourcePriority()` call in the client code that invokes this RPC (currently in `settlement-engine.ts` around line ~587)
- Or add equivalent SQL logic inside the DB function itself

#### 5. Update audit matrix

Mark settlement ingestion as fully canonicalized in `docs/action-audit-matrix.md`.

### Files to change

| File | Change |
|------|--------|
| `src/actions/settlements.ts` | Add `saveSettlementCanonical()` wrapping insert + source priority |
| `src/utils/settlement-engine.ts` | Replace 2 direct inserts + remove fire-and-forget `applySourcePriority` calls |
| `src/components/admin/accounting/AccountingDashboard.tsx` | Replace direct insert + remove fire-and-forget call |
| `src/actions/__tests__/canonical-actions.test.ts` | Remove exemptions for settlement-engine.ts and AccountingDashboard.tsx |
| `docs/action-audit-matrix.md` | Mark settlement ingestion as ✅ canonicalized |

No database migrations needed.

