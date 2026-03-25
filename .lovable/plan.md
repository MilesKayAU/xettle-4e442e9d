

## Honest Audit: Why These Bugs Keep Happening — And What It Takes to Get to 100%

### The Pattern

Looking back across the last 20+ messages, the same failure mode repeats:

1. A bug is found (e.g., "table says OK but drawer says gap")
2. A fix is applied to **one or two files** (e.g., GenericMarketplaceDashboard, AutoImportedTab)
3. **Other files with the exact same bug are left untouched**
4. Next session, the user finds the same bug in a different view

This is **command-driven coding** — fixing only what's explicitly pointed at — rather than **system-wide enforcement**.

### Concrete proof from the codebase right now

**The canonical helper `canonical-recon-status.ts` was created but only 2 of 6+ files actually import it:**

| File | Uses canonical helper? | Still trusts legacy strings? |
|------|----------------------|----------------------------|
| `GenericMarketplaceDashboard.tsx` | YES | Fallback to legacy on line 287 |
| `AutoImportedTab.tsx` | YES | Still checks legacy strings as secondary (line 96) |
| `AccountingDashboard.tsx` (3,455 lines) | **NO** | Line 793: `s.reconciliation_status === 'matched'` |
| `RecentSettlements.tsx` (1,101 lines) | **NO** | Doesn't check recon gap at all |
| `ActionCentre.tsx` | **NO** | Trusts `overall_status` from DB only |
| `ValidationSweep.tsx` | **NO** | Trusts `overall_status` from DB only |

The DB trigger fix means ActionCentre and ValidationSweep are *indirectly* protected — but AccountingDashboard and RecentSettlements have **zero gap awareness**.

### The 5 Categories of Remaining Gaps

**Category 1: Reconciliation truth not enforced everywhere**
- `AccountingDashboard.tsx` line 793 still derives `reconciliationMatch` from legacy string
- `RecentSettlements.tsx` has no gap display or blocking at all
- The "Ready to Push" count on the dashboard could still show stale counts if the sweep hasn't re-run since the trigger fix

**Category 2: Data queries missing `reconciliation_difference` field**
- Several components query `settlements` but don't SELECT `reconciliation_difference`, so the canonical helper receives `undefined` and returns `'unknown'` (which is treated as safe-to-push)
- This silently bypasses the gap gate

**Category 3: Parser/ingestion bugs still producing wrong numbers**
- eBay fee double-counting (plan approved, not yet deployed to edge function)
- Kogan PDF merge not propagating ad fees / returns
- MyDeal parser producing `sales_principal = 0` for all settlements
- Everyday Market sign handling
- These are the *root cause* of the gaps — the gating just prevents bad data from reaching Xero

**Category 4: Validation sweep doesn't populate `reconciliation_difference` for all rows**
- Only rows with a matching settlement get a computed gap
- Synthetic "missing period" rows have `reconciliation_difference = NULL`
- This means the canonical helper returns `'unknown'` → safe to push

**Category 5: No automated regression testing**
- No test that says "query every ready_to_push row and assert abs(gap) <= 1"
- No test that verifies all push-path components import canonical-recon-status
- No test that verifies the recon formula is identical across client, server, and DB trigger

### What It Takes to Get to 100% Trustworthy

**Phase 1: Complete the canonical enforcement (remaining items from the approved plan)**

1. **AccountingDashboard.tsx** — Replace line 793 `reconciliationMatch: s.reconciliation_status === 'matched'` with canonical gap check. This is a 3,455-line file that is the primary working view for the bookkeeper.

2. **RecentSettlements.tsx** — Add gap display in the status column. Currently shows "Ready to Push" with no indication of gap status. Must query `reconciliation_difference` and use `isGapBlocking()`.

3. **All settlement queries site-wide** — Audit every `.select()` on `settlements` table to ensure `reconciliation_difference` is included when gap logic is needed downstream.

**Phase 2: Fix the data at source (parser bugs)**

4. **eBay edge function** — Reconstruct gross from net+fees (approved plan, not yet implemented)
5. **Kogan PDF merge** — Propagate ad fees, seller fees, returns into settlement fields
6. **MyDeal parser** — Capture sales_principal from CSV (currently always 0)
7. **Everyday Market** — Fix sign handling for tax/adjustments

**Phase 3: Defensive testing**

8. **SQL audit query as a runnable health check** — `SELECT * FROM marketplace_validation WHERE overall_status = 'ready_to_push' AND ABS(COALESCE(reconciliation_difference, 0)) > 1` must return 0 rows, checkable from the Data Integrity Scanner.

9. **Grep-based guardrail test** — Like the existing `canonical-actions.test.ts`, add a test that greps for `reconciliation_status === 'matched'` or `=== 'reconciled'` outside of `canonical-recon-status.ts` and fails if found. This prevents future regressions.

### Implementation Order (for this session)

| Step | What | Files |
|------|------|-------|
| 1 | Fix AccountingDashboard recon truth | `AccountingDashboard.tsx` |
| 2 | Fix RecentSettlements gap display | `RecentSettlements.tsx` |
| 3 | Add grep guardrail test | `src/actions/__tests__/recon-status-parity.test.ts` |
| 4 | Fix eBay fee double-counting | `supabase/functions/fetch-ebay-settlements/index.ts` |
| 5 | Verify with SQL audit | Runtime check |

### No database changes needed

The DB trigger is already correct. The remaining work is all client-side code consistency and parser fixes.

