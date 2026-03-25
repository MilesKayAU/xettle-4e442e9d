

## Plan: Add Reconciliation Gap Gate to All Push-to-Xero Paths (Site-Wide)

### Audit Results

There are **4 paths** that can push settlements to Xero. Here is the reconciliation gap enforcement status of each:

| Push Path | File | Has Recon Gate? |
|-----------|------|----------------|
| **Auto-post** | `supabase/functions/auto-post-settlement/index.ts` | YES — requires `reconciliation_status = 'matched'` |
| **PushSafetyPreview** (manual push modal) | `src/components/admin/accounting/PushSafetyPreview.tsx` | NO — shows bank deposit check as amber, no recon gap check at all |
| **sync-settlement-to-xero** (server-side edge function) | `supabase/functions/sync-settlement-to-xero/index.ts` | NO — only checks `isReconciliationOnly()`, no recon gap gate |
| **syncSettlementToXero** (client orchestrator) | `src/utils/settlement-engine.ts` | NO — no recon check before calling push |

Only auto-post enforces reconciliation. The manual push path (which is what the user uses day-to-day) has **zero reconciliation gating**.

### What Needs to Change

**1. PushSafetyPreview — Add reconciliation gap validation check (RED block)**

File: `src/components/admin/accounting/PushSafetyPreview.tsx`

In `buildValidationChecks()`, add a new check after the line-items-sum check (check #1):

- Calculate recon gap: `|bank_deposit - (sales_principal + sales_shipping - |seller_fees| - |fba_fees| - |storage_fees| - |advertising_costs| - |other_fees| + refunds + reimbursements)|`
- If gap > $1.00 → RED block: "Reconciliation gap: $X.XX — edit figures to resolve before pushing"
- If gap > $0.05 and ≤ $1.00 → GREEN with note: "Within rounding tolerance ($X.XX)"
- If gap ≤ $0.05 → GREEN: "Settlement reconciles ✓"

This makes the "Confirm Push" button disabled when a recon gap exists, enforcing the gate via the existing `hasRedCheck` logic.

**2. sync-settlement-to-xero edge function — Add server-side recon gate (defense-in-depth)**

File: `supabase/functions/sync-settlement-to-xero/index.ts`

After the existing source push gate (~line 562), add a reconciliation gate:

- Fetch settlement's `bank_deposit`, `sales_principal`, `seller_fees`, `fba_fees`, `other_fees`, `refunds`, `reimbursements`, `storage_fees`, `advertising_costs`, `sales_shipping`
- Calculate the gap server-side
- If gap > $1.00, return 400 with error: `"Reconciliation gap of $X.XX exceeds tolerance. Edit figures to resolve before pushing."`
- This prevents any bypass of the client-side gate

**3. Canonical push action — Add recon check before invoke**

File: `src/actions/xeroPush.ts`

In `pushSettlementToXero()`, before calling `supabase.functions.invoke`, fetch the settlement's `reconciliation_status` and `bank_deposit` + financial fields. If the calculated gap > $1.00, return early with `{ success: false, errorCode: 'RECON_GAP', error: '...' }`.

This catches any code path that calls the canonical action directly without going through PushSafetyPreview (e.g. auto-retry, settlement-engine orchestrator).

**4. Client orchestrator — Inherit gate from canonical action**

File: `src/utils/settlement-engine.ts`

`syncSettlementToXero()` already delegates to `pushSettlementToXero()` from the canonical action, so it inherits the gate from fix #3 automatically. No additional changes needed.

### Reconciliation Gap Formula (canonical, used everywhere)

```text
computed_net = sales_principal + sales_shipping
             - |seller_fees| - |fba_fees| - |storage_fees|
             - |advertising_costs| - |other_fees|
             + refunds + reimbursements

gap = |bank_deposit - computed_net|
```

Tolerance: $1.00 (configurable via `RECONCILIATION_TOLERANCE` constant).

### Files Modified

| File | Changes |
|------|---------|
| `src/components/admin/accounting/PushSafetyPreview.tsx` | Add recon gap RED check in `buildValidationChecks()` |
| `src/actions/xeroPush.ts` | Add recon gap pre-check in `pushSettlementToXero()` |
| `supabase/functions/sync-settlement-to-xero/index.ts` | Add server-side recon gap gate after source push gate |
| `src/constants/reconciliation-tolerance.ts` | Export `RECONCILIATION_TOLERANCE = 1.00` (shared constant) |

### Database changes

Migration: Update the `compute_overall_status` trigger to gate `ready_to_push` on reconciliation difference:

```sql
-- If settlement uploaded but recon gap > $1.00, don't promote to ready_to_push
ELSIF NEW.settlement_uploaded = true AND NEW.xero_pushed = false THEN
  IF COALESCE(ABS(NEW.reconciliation_difference), 0) > 1.00 THEN
    NEW.overall_status := 'gap_detected';
  ELSE
    NEW.overall_status := 'ready_to_push';
  END IF;
```

This prevents settlements with gaps from ever appearing as "Ready to Push" in the dashboard.

### Summary of enforcement layers after fix

```text
Layer 1: DB trigger        — won't promote to ready_to_push if gap > $1
Layer 2: PushSafetyPreview — RED block, Confirm button disabled
Layer 3: Canonical action  — returns error before calling edge function
Layer 4: Edge function     — server-side 400 rejection (defense-in-depth)
Layer 5: Auto-post         — already requires reconciliation_status = 'matched'
```

