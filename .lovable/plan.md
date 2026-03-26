

## Fix: Use Mirakl IV01 Invoices API for Settlement Verification

### Problem
The current `verifyMirakl` function queries `/api/sellerpayment/transactions_logs` and tries to reconstruct settlement totals from individual transactions. This returns 0 transactions for Bunnings `BUN-2301-2026-03-14` due to date format and filtering issues. The data exists — the Mirakl billing screen shows it — but we're using the wrong endpoint.

### Solution
Use the IV01 accounting documents API (`/api/invoices`) as the **primary** verification method. This returns billing cycle documents directly with `amount_due_to_seller` already calculated. Fall back to transaction logs only if IV01 returns nothing.

### Changes

**File: `supabase/functions/verify-settlement/index.ts`**

Insert an IV01 verification attempt inside `verifyMirakl()`, after auth succeeds but before the existing transaction logs code:

1. **Extract billing cycle number** from settlement_id using regex `(\d{4,})`:
   - `BUN-2301-2026-03-14` → `2301`
   - `291854_MyDeal` → `291854`

2. **Call IV01** at `{base_url}/api/invoices?accounting_document_number={number}&type=ALL` using the same auth header/fallback logic already in place.

3. **If IV01 returns an invoice**: compare `amount_due_to_seller` (or `total_amount`) against `settlement.bank_deposit`. Build a StandardResponse with `filter_method: "iv01_invoice"`. If `auto_correct` is true and discrepancy > $1 and settlement is not pushed, correct `bank_deposit` and log `gap_auto_corrected`.

4. **If IV01 returns nothing or errors**: fall through to existing transaction logs path (with the date format fix from the previous plan also applied — `T00:00:00Z` without milliseconds + `end_date` parameter).

5. **Diagnostic logging**: The existing `gap_resolve_attempt` log at the end of the function will capture `filter_method: "iv01_invoice"` and the IV01-specific data.

### Key details
- IV01 response structure: `{ invoices: [{ accounting_document_number, amount_due_to_seller, total_amount, ... }] }`
- The auth fallback candidates array already handles multiple auth modes — reuse it for the IV01 call
- Same safety guards apply: never correct `pushed_to_xero`/`already_recorded`, always log before writing, never touch `overall_status`
- Transaction logs path remains as fallback for settlements where the billing cycle number can't be extracted or IV01 returns empty

### Expected outcome
- `BUN-2301-2026-03-14` → IV01 returns invoice 2301 with `amount_due_to_seller = 526.44` → auto-corrects `bank_deposit` from `-50.00` to `526.44` → validation sweep clears the gap
- Other Mirakl settlements (MyDeal, etc.) also benefit from IV01 as primary path

