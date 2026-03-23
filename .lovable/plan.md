
# ✅ COMPLETED: External Xero Invoices (Link My Books) Not Recognized

## Changes Made

### 1. `supabase/functions/run-validation-sweep/index.ts`
- Loads `xero_accounting_matches` table before the per-period loop
- In Step 4 (Xero check), added fallback: if settlement exists in `xero_accounting_matches` with PAID/AUTHORISED status, marks `xero_pushed = true`
- PAID matches also auto-update the settlement to `already_recorded`

### 2. `supabase/functions/sync-xero-status/index.ts`
- Expanded auto-resolve from PAID-only to PAID+AUTHORISED
- After auto-resolving settlements, now also updates `marketplace_validation` rows with `xero_pushed = true` so dashboard counts are correct
