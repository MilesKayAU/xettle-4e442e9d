

## Plan: Unify Homepage and Overview Data Sources

### Root Cause

The homepage and the Settlements Overview pull counts from **different tables**:

| Component | Data Source | What it counts |
|-----------|-----------|----------------|
| Homepage badge (Settlements tab) | `settlements` table → `status = 'ready_to_push'` | Settlement records |
| Homepage `ActionCentre` | `marketplace_validation` table | Validation periods |
| Homepage `RecentSettlements` | `settlements` table (+ synthetic validation rows) | Settlement records |
| Overview `ValidationSweep` | `marketplace_validation` table | Validation periods |

When `marketplace_validation` is empty or stale (hasn't been re-swept), the Overview shows all zeros — even though `settlements` might have data. The homepage may show counts from `settlements` that don't match.

### Fix: Single Source of Truth

Make `marketplace_validation` the canonical source everywhere, and ensure it's always populated.

**1. Auto-trigger validation sweep when Overview tab is opened with stale/empty data**

**File: `src/components/onboarding/ValidationSweep.tsx`**
- After `loadData()` completes, if `rows.length === 0` and there are active marketplace connections, auto-trigger `triggerValidationSweep()` then reload
- Add a `lastSweptAt` check: if the most recent `last_checked_at` is older than 1 hour, show a "Data may be outdated" banner with a re-scan button (already exists as "Re-scan")

**2. Align homepage badge counts to use `marketplace_validation`**

**File: `src/pages/Dashboard.tsx`** (lines 619-633)
- Replace the `settlements`-table badge count queries with `marketplace_validation` counts:
  - `readyToPushCount` = count where `overall_status = 'ready_to_push'`
  - `outstandingCount` = count where `overall_status IN ('settlement_needed', 'missing')`
- This ensures the Settlements tab badge matches the Overview summary cards exactly

**3. Align `ActionCentre` ready-to-push section with Overview**

**File: `src/components/dashboard/ActionCentre.tsx`**
- Already queries `marketplace_validation` — verify its count logic matches `ValidationSweep.statusCounts` exactly (same active-connection filtering, same recon-only exclusions)
- Add the same `activeCodes` and `pausedCodes` filtering that `ValidationSweep` uses

**4. Auto-sweep on first settlement ingest**

**File: `src/pages/Dashboard.tsx`**
- After `loadMarketplaces()` completes and finds active connections, check if `marketplace_validation` has any rows; if not, trigger `triggerValidationSweep()` once
- This ensures new users who just uploaded their first settlement see data in Overview immediately

### Files Modified

| File | Changes |
|------|---------|
| `src/pages/Dashboard.tsx` | Badge counts from `marketplace_validation`; auto-sweep if empty |
| `src/components/onboarding/ValidationSweep.tsx` | Auto-sweep when opened with 0 rows + active connections |
| `src/components/dashboard/ActionCentre.tsx` | Align filtering logic with ValidationSweep |

### No database changes needed

