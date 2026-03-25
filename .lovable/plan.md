
## Reaudit Result

This is not finished yet. The current app is still internally inconsistent in ways that are not acceptable for an accounting product.

### What I confirmed from the code + data

1. **The Data Integrity card is not trustworthy yet**
   - `src/components/dashboard/DataIntegrityScanner.tsx` shows “Never” from `app_settings`.
   - `src/actions/dataIntegrity.ts` writes those timestamps **client-side only after a successful response**.
   - In live data, only `last_bank_match` exists; `last_validation_sweep` is still missing.
   - But backend logs show `run-validation-sweep` did run multiple times.
   - So the UI is using the wrong completion signal. If the request times out/aborts or finishes without the client writing the timestamp, the card stays on “Never”.

2. **Homepage “0 ready to push” is not the same truth as the settlements tables**
   - `marketplace_validation` currently has **0 `ready_to_push`** rows.
   - But `settlements` still has **11 rows with status = `ready_to_push`**.
   - That means the app still has **two competing sources of truth**.

3. **There are conflicting validation rows for the same settlement**
   - Example: settlement `133306548471` appears in `marketplace_validation` twice:
     - one row as `gap_detected`
     - one row as `pushed_to_xero`
   - This is a structural integrity problem, not just a UI bug.

4. **RecentSettlements is still mutating accounting state from the dashboard**
   - In `src/components/dashboard/RecentSettlements.tsx`, it bulk-updates `ingested` settlements to `ready_to_push`.
   - That bypasses the validation pipeline and can create false “ready” states.

5. **Several components still expect `reconciliation_difference` on `settlements`, but that column does not exist**
   - I verified by query that `public.settlements.reconciliation_difference` does not exist.
   - Yet UI code still reads `(s as any).reconciliation_difference` in settlement-based tables.
   - So some “canonical” checks are still running on `undefined`, which is unsafe.

6. **Some ready-to-push settlements have no validation row at all**
   - I found settlement rows marked `ready_to_push` whose join to `marketplace_validation` is `NULL`.
   - That means they can appear actionable in one place and invisible on the homepage.

## What this means

The issue is **not** simply “data is so bad nothing can sync”.
The real issue is:

- some rows are genuinely blocked by gaps
- some rows are already recorded
- but a separate layer is still marking settlements as `ready_to_push`
- and the homepage correctly follows `marketplace_validation`, while other tables still partly follow `settlements`

So the app is still not enforcing one canonical accounting truth sitewide.

## Correct target state

The app must enforce these rules:

1. **`marketplace_validation` is the only source of truth for actionability**
   - ready / blocked / upload needed / already recorded
2. **`settlements` is the financial source record, not the workflow truth**
3. **A settlement can have at most one authoritative validation state**
4. **Scanner last-run times must come from backend completion, not client optimism**
5. **No dashboard component may promote or invent accounting states locally**

## Implementation plan

### 1. Fix the Data Integrity scanner so it reports real backend completion
Files:
- `src/actions/dataIntegrity.ts`
- `src/components/dashboard/DataIntegrityScanner.tsx`
- `supabase/functions/run-validation-sweep/index.ts`
- `supabase/functions/match-bank-deposits/index.ts`
- `supabase/functions/sync-xero-status/index.ts`
- `supabase/functions/scheduled-sync/index.ts`
- `supabase/functions/recalculate-profit/index.ts`

Changes:
- Stop relying on client-only `app_settings` writes as the primary completion record.
- Persist per-scan completion from the backend itself using system events / sync history.
- Make the card read last successful completion from backend records.
- Show 4 states clearly: `running`, `success`, `failed`, `never`.
- Keep the manual scanner limited to the scans bookkeepers should actually run on login.

Result:
- Clicking “Recalculate Gaps” will visibly move from Running to a real completed timestamp.
- “Never” will only mean truly never run.

### 2. Remove all local workflow mutations from dashboard UI
Files:
- `src/components/dashboard/RecentSettlements.tsx`
- any other component that updates settlement status from the UI layer

Changes:
- Remove the dashboard logic that updates `ingested -> ready_to_push`.
- Make dashboard tables display readiness from validation rows only.
- UI may refresh/recompute, but it must not invent accounting state.

Result:
- The dashboard stops manufacturing false ready rows.

### 3. Make validation the sitewide canonical readiness source
Files:
- `src/components/dashboard/RecentSettlements.tsx`
- `src/components/dashboard/ActionCentre.tsx`
- `src/pages/Dashboard.tsx`
- `src/components/admin/accounting/GenericMarketplaceDashboard.tsx`
- `src/components/admin/accounting/AutoImportedTab.tsx`
- `src/components/admin/accounting/AccountingDashboard.tsx`

Changes:
- Audit every table/card/count that shows:
  - ready to push
  - needs attention
  - gap detected
  - already in Xero
- Join or map each settlement to its authoritative validation row.
- Use validation `overall_status` for actionability and `reconciliation_difference` for gap display.
- Use settlement fields only for financial drilldown, not for workflow truth.

Result:
- Homepage counts, action cards, table badges, and drawer states all match.

### 4. Repair duplicate and missing validation rows
Files:
- `supabase/functions/run-validation-sweep/index.ts`
- `supabase/migrations/*` (new migration required)

Changes:
- Add a cleanup/backfill pass so one settlement cannot leave behind multiple conflicting validation rows.
- Remove stale validation rows produced by period-label drift or old Shopify auto-generation logic.
- Ensure every actionable settlement has exactly one current validation row.
- Add a DB guardrail to prevent duplicate authoritative validation rows for the same settlement.

Result:
- No more cases like the same settlement being both `gap_detected` and `pushed_to_xero`.

### 5. Stop reading nonexistent gap fields from settlements
Files:
- `src/components/admin/accounting/GenericMarketplaceDashboard.tsx`
- `src/components/admin/accounting/AutoImportedTab.tsx`
- `src/components/admin/accounting/AccountingDashboard.tsx`
- `src/components/dashboard/RecentSettlements.tsx`

Changes:
- Replace any use of `(s as any).reconciliation_difference` on raw settlement rows unless that value is explicitly joined from validation.
- Standardize one helper for:
  - display gap from validation when available
  - compute fallback display-only gap from settlement components when needed
- Never use fallback-computed gap as workflow authority if validation exists.

Result:
- Canonical gap logic actually runs on real data, not `undefined`.

### 6. Re-audit rail-specific root causes after status truth is fixed
Files:
- `supabase/functions/fetch-ebay-settlements/index.ts`
- relevant MyDeal / Kogan / Everyday Market / Shopify ingestion paths

Changes:
- Re-run rail audits only after the validation pipeline is fixed.
- Confirm whether remaining gaps are:
  - true accounting issues
  - old bad rows needing repair
  - parser/sign errors still unresolved

Result:
- The system not only blocks bad rows, but explains whether the cause is parser/data quality or a genuine unmatched payout.

### 7. Add accounting-grade guardrails
Files:
- `src/actions/__tests__/recon-status-parity.test.ts`
- new parity tests for validation/settlement alignment
- SQL runtime health checks surfaced in the scanner/admin audit flow

Add checks for:
- no `settlements.status = 'ready_to_push'` unless validation also says ready
- no duplicate validation rows per settlement
- no validation-ready row where `abs(reconciliation_difference) > 1`
- no actionable settlement missing a validation row
- scanner completion timestamps must advance after successful backend runs

## Important correction to the previous strategy

The earlier statement “no database changes needed” is no longer correct.

Because I found:
- duplicate validation rows
- missing validation rows for actionable settlements
- conflicting workflow truth between tables

This now requires:
- **one cleanup/backfill**
- **one protective migration**
- **sitewide UI alignment**

## Acceptance criteria for “100% trustworthy”

I will treat this as complete only when all are true:

1. Pressing **Recalculate Gaps** updates the card from `Never` to a real completion time.
2. Homepage ready count matches the action list and settlement table.
3. No settlement appears ready anywhere unless validation says it is ready.
4. No settlement has two conflicting validation rows.
5. No ready row has a gap above $1.
6. Every actionable settlement has exactly one authoritative validation row.
7. Drawer, tables, badges, homepage cards, and push actions all agree on the same status.
8. Remaining blocked rows are explained as real data issues, not UI/state bugs.

## Delivery order

1. Fix scanner completion telemetry
2. Remove dashboard-side status mutation
3. Align all readiness/counts to validation
4. Clean and constrain duplicate/missing validation rows
5. Re-audit rail parsers against the cleaned truth
6. Add guardrail tests and SQL health checks

This is the shortest path from the current inconsistent state to an accounting-grade canonical system.
