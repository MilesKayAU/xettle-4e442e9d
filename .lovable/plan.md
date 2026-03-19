

## Pre-Release Hardening Plan

Addresses the specific gaps raised in the audit feedback: absolute claims that need qualifying, commission estimate trust risk, scaling limits, and parity drift.

---

### 1. Commission Rate Calibration — "Calibrate from Observed Data"

**Problem**: Static `COMMISSION_ESTIMATES` are hardcoded in 3 places (frontend util, two edge functions). Users see "Estimated" badges but cannot improve accuracy without code changes.

**Change**: Add a "Calibrate rates" button to the Insights Dashboard that:
- Queries `marketplace_fee_observations` for the user's last 3 CSV-sourced settlements per marketplace
- Computes `observed_rate = avg(observed_amount / base_amount)`
- Saves the result to `app_settings` as `observed_commission_rate:{marketplace_code}`
- `attributeFees()` in `insights-fee-attribution.ts` checks `app_settings` first, falls back to `COMMISSION_ESTIMATES`

Also update both edge function copies (`auto-generate-shopify-settlements`, `repair-settlement-fees`) to read `app_settings.observed_commission_rate:*` before falling back to the constant.

**Files**: `src/utils/insights-fee-attribution.ts`, `src/components/admin/accounting/InsightsDashboard.tsx`, 2 edge functions

---

### 2. Recalculate-Profit Pagination Fix

**Problem**: `recalculate-profit` fetches `settlement_lines` without `.range()` — silently capped at 1000 rows by default. Large accounts get incorrect profit numbers.

**Change**: Add paginated fetch loop (1000 rows per page) to the settlement_lines and settlements queries in the edge function. Same pattern needed in `repair-settlement-fees`.

**Files**: `supabase/functions/recalculate-profit/index.ts`, `supabase/functions/repair-settlement-fees/index.ts`

---

### 3. RLS Policy Inventory Artifact

**Problem**: "Every table has RLS" is an unverified claim. Need a concrete checklist.

**Change**: Add a database query-based RLS inventory to the `DataQualityPanel` in Settings that:
- Calls a new edge function `rls-audit` that runs `SELECT tablename, policyname FROM pg_policies WHERE schemaname = 'public'` via service role
- Returns a table-by-table list with policy count
- Flags any table with 0 policies as a gap

**Files**: New edge function `supabase/functions/rls-audit/index.ts`, update `src/components/settings/DataQualityPanel.tsx`

---

### 4. Commission Parity Test

**Problem**: `COMMISSION_ESTIMATES` is duplicated in `src/utils/insights-fee-attribution.ts`, `auto-generate-shopify-settlements`, and `repair-settlement-fees`. No test verifies they match.

**Change**: Add a unit test in `src/actions/__tests__/` that imports the canonical `COMMISSION_ESTIMATES` from `insights-fee-attribution.ts` and compares it against the rates defined inline in both edge functions (parsed from source files or maintained as a shared test fixture). If rates diverge, the test fails.

Longer-term: extract rates to `supabase/functions/_shared/commission-rates.ts` for true single-source.

**Files**: New test file, new `_shared/commission-rates.ts`

---

### 5. Insights UI — Show Implied Rate

**Problem**: "Estimated" badge exists but doesn't tell the user what rate was used.

**Change**: In `MarketplaceProfitComparison.tsx`, when `has_estimated_fees` is true, show the actual rate in the badge tooltip: "Using 12% estimated commission". Add a small "(calibrate)" link that triggers the calibration flow from step 1.

**Files**: `src/components/insights/MarketplaceProfitComparison.tsx`

---

### 6. Data Quality Warnings for Overstated Profit

**Problem**: Users may not realize their profit is overstated due to missing inputs.

**Change**: In `InsightsDashboard.tsx`, add a consolidated "Data Quality" alert strip at the top that aggregates:
- Missing postage costs (already detected in `useDashboardTaskCounts`)
- Incomplete fulfilment split
- Zero-fee API settlements not yet repaired
- No SKU cost data uploaded

Each item links to the relevant settings/action. This ensures the profit view is never presented without appropriate caveats.

**Files**: `src/components/admin/accounting/InsightsDashboard.tsx`

---

### Summary of Priority

| # | Change | Risk Addressed | Effort |
|---|--------|---------------|--------|
| 1 | Commission calibration | Trust killer — users see wrong margins | Medium |
| 2 | Pagination fix | Silent data loss on large accounts | Small |
| 3 | RLS inventory | Unverified security claim | Small |
| 4 | Parity test | Drift between 3 copies of rates | Small |
| 5 | Show implied rate | User can't judge estimate quality | Small |
| 6 | Data quality strip | Overstated profit without caveat | Medium |

