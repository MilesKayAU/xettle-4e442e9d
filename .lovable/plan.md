

## Add Settlement Editing to Fix Reconciliation Issues

### Problem
When a settlement has `recon_warning`, users can open the detail drawer but everything is read-only. There's no way to:
1. See exactly what the reconciliation gap is (the maths mismatch)
2. Edit the settlement's breakdown fields (sales, fees, refunds, bank deposit) to correct errors
3. Re-run the reconciliation check after editing

Users are told "delete and re-upload" which is heavy-handed for a rounding issue or a single wrong figure.

### Changes

#### 1. Show Reconciliation Gap in the Detail Drawer (`SettlementDetailDrawer.tsx`)

When the settlement has a `reconciliation_status` that isn't `reconciled`/`matched`, display a prominent "Reconciliation Gap" card showing:
- Expected net (Sales - Fees + Refunds)
- Actual bank deposit
- The delta between them
- A clear message: "The file's figures don't add up — edit below to correct"

#### 2. Add Inline Edit Mode for Settlement Figures (`SettlementDetailDrawer.tsx`)

For unpushed settlements (status not `pushed_to_xero` or `already_recorded`):
- Add an "Edit Figures" button that switches the header metadata into editable inputs for: `sales_principal`, `seller_fees`, `refunds`, `bank_deposit`, `other_fees`, `reimbursements`
- Show a "Save & Re-check" button that:
  - Updates the settlement row in the database
  - Recalculates whether Sales - Fees ≈ Net and updates `reconciliation_status` to `reconciled` or keeps `recon_warning`
  - Refreshes the drawer state
- Show a "Cancel" button to discard changes
- Pushed settlements remain read-only (audit integrity)

#### 3. Recalculate reconciliation_status on save

After updating the settlement fields, run the same maths check the parser uses:
```
gap = bank_deposit - (sales_principal - seller_fees + refunds + reimbursements + other_fees)
if abs(gap) < $1.00 → reconciliation_status = 'reconciled'
else → reconciliation_status = 'recon_warning'
```

This happens client-side before the update call, so the status is written atomically.

#### 4. Update AI policy to guide users to edit (`ai_policy.ts`)

Update the settlements page explainer so the AI tells users: "Open the settlement, click Edit Figures, correct the value that's wrong, and save."

### Files Modified
1. **`src/components/shared/SettlementDetailDrawer.tsx`** — add reconciliation gap display, inline edit mode for unpushed settlements, save + re-check logic
2. **`supabase/functions/_shared/ai_policy.ts`** — update guidance to reference the new edit capability

### Result
- Users see exactly where the maths fails and by how much
- They can fix a wrong figure directly in the drawer without deleting/re-uploading
- Saving auto-rechecks reconciliation — if the numbers now balance, the warning clears
- Pushed settlements remain locked for audit integrity

