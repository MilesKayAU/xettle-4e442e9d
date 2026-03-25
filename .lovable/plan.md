


## Plan: Inline Upload Dialog Per Row Instead of Page Navigation
<!-- COMPLETED -->

### Problem
When users click "Upload" on a row in the Settlements Overview table, it navigates them away to the full upload page. They lose context, can't see their list of outstanding items, and have to go back and forth. There's no contextual guidance about what specific files are needed for that marketplace/period.

### Solution
Replace the navigate-away behavior with an inline upload dialog (modal) — DONE.

## Plan: Reconciliation Gap Gate — All Push-to-Xero Paths (Site-Wide)
<!-- COMPLETED -->

### Enforcement layers

1. **DB trigger** (`calculate_validation_status`) — won't promote to `ready_to_push` if `reconciliation_difference > $1.00`; sets `gap_detected` instead
2. **PushSafetyPreview** — RED block check in `buildValidationChecks()`, Confirm button disabled
3. **Canonical action** (`xeroPush.ts`) — fetches settlement financials, returns `RECON_GAP` error if gap > $1.00
4. **Edge function** (`sync-settlement-to-xero`) — server-side 400 rejection (defense-in-depth)
5. **Auto-post** — already required `reconciliation_status = 'matched'`

### Canonical reconciliation gap formula
```text
computed_net = sales_principal + sales_shipping
             - |seller_fees| - |fba_fees| - |storage_fees|
             - |advertising_costs| - |other_fees|
             + refunds + reimbursements

gap = |bank_deposit - computed_net|
tolerance = $1.00
```
