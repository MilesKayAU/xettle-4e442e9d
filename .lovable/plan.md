

## Root Cause Found

The frontend `ValidationSweep.tsx` component has a "sync guard" (lines 162-205) that runs on every page load and **overwrites** `overall_status` in the database. Specifically, lines 189-197:

```typescript
} else if (sStatus === 'ingested' || sStatus === 'saved') {
  row.overall_status = 'settlement_needed';
  // ...writes 'settlement_needed' back to the DB
}
```

Your eBay AU settlements have `status: 'saved'` in the `settlements` table. So even though the DB trigger correctly computes `overall_status = 'ready_to_push'` (since `settlement_uploaded = true`), every time you open the dashboard, this frontend code queries the settlement's raw status, sees `'saved'`, and **downgrades** the validation row back to `settlement_needed` — which the UI then renders as "Sync Needed" (for API marketplaces) or "Upload Needed" (for CSV ones).

This is why repeated fixes to the trigger and sweep never stuck — the frontend undoes them on every page load.

## Plan

### 1. Remove the destructive sync guard from ValidationSweep.tsx

**File:** `src/components/onboarding/ValidationSweep.tsx` (lines 161-205)

Delete the entire "sync guard" block. The DB trigger `calculate_validation_status` already handles status computation correctly. The frontend should never override it.

The guard was originally added to catch stale rows where a settlement was pushed to Xero but the validation row hadn't been updated. That scenario is already handled by the validation sweep edge function and the DB trigger.

### 2. Fix settlement status: promote `saved` to `ready_to_push`

The eBay AU settlements have `status: 'saved'` which is a legacy intermediate state. Settlements with actual data (non-null `bank_deposit`) that aren't pre-boundary should be `ready_to_push` or at least `ingested`. The `saved` status is functionally equivalent to `ready_to_push` for settlements with complete data.

**No code change needed** — the DB trigger already treats `settlement_uploaded = true` as sufficient for `ready_to_push`. The problem was solely the frontend overriding it.

### Files affected
- `src/components/onboarding/ValidationSweep.tsx` — remove sync guard block (lines 161-205)

