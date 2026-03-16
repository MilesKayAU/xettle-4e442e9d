

# Critical Gap: `sync-amazon-journal` Bypasses All Safety Fixes

## Finding

The previous fixes only hardened `sync-settlement-to-xero`. A **second edge function** — `sync-amazon-journal` — is a near-duplicate that `AccountingDashboard.tsx` calls directly at 3 push sites (L723, L739, L767) plus 1 rollback site (L1910). This function:

1. **Has `contactName || "Amazon.com.au"` fallback** (L416) — the exact bug removed from `sync-settlement-to-xero`
2. **Posts as `Status: "AUTHORISED"`** (L420) — violates the DRAFT-only rule
3. **Is called without PushSafetyPreview** — `AccountingDashboard` invokes it directly from a "Push to Xero" button handler, bypassing the preview modal entirely
4. **Has no attachment enforcement** — no audit CSV or raw data attached

Your `ARCHITECTURE.md` already flags this: *"sync-amazon-journal is a near-duplicate of sync-settlement-to-xero — should be consolidated."*

## Status of the 3 priorities

| Priority | Claimed status | Actual status |
|----------|---------------|---------------|
| P0: PushSafetyPreview bypass | Fixed for 4 components | **NOT fixed** — AccountingDashboard L723/739/767 calls `sync-amazon-journal` directly |
| P1: Contact fallback | Fixed in `sync-settlement-to-xero` | **NOT fixed** in `sync-amazon-journal` L416 |
| P2: Tests | 4 line-item tests added | No edge function tests for DRAFT-only or attachment enforcement |

## Plan

### Step 1: Retire `sync-amazon-journal` push path in AccountingDashboard

Refactor the 3 push call sites (L723, L739, L767) in `AccountingDashboard.tsx` to route through `PushSafetyPreview` → `syncSettlementToXero()` (from `settlement-engine.ts`), which calls the hardened `sync-settlement-to-xero` edge function.

- The split-month logic (splitPart 1/2) is already supported by `sync-settlement-to-xero` 
- The rollback call site (L1910) stays as-is since rollback is a void/delete action, not a push

### Step 2: Harden `sync-amazon-journal` for rollback-only use

Since rollback still uses this function:
- Remove the invoice creation code path or gate it with `throw new Error('Use sync-settlement-to-xero for invoice creation')`
- Remove the `"Amazon.com.au"` fallback
- Change `Status: "AUTHORISED"` to `"DRAFT"` (in case it's ever reached)
- Add a dead-code comment on the create path

### Step 3: Add `PushSafetyPreview` to AccountingDashboard push flow

Add `PushSafetyPreview` state (`previewOpen`, `previewSettlements`) and wire the existing "Push to Xero" buttons to open the modal instead of calling the edge function directly.

### Step 4: Add edge function test coverage

Add a test file `supabase/functions/sync-settlement-to-xero/index.test.ts` covering:
- Invoice payload status is always DRAFT
- Missing `settlementData` throws before posting  
- Missing contact mapping throws `missing_contact_mapping`

### Technical details

- `sync-settlement-to-xero` already handles split-month via `splitPart` parameter
- `AccountingDashboard` passes `lineItems` client-side to `sync-amazon-journal`, but `sync-settlement-to-xero` rebuilds server-side — this is the correct behavior (server rebuild is authoritative)
- Rollback action in `sync-amazon-journal` uses Xero void API — separate concern, safe to keep

