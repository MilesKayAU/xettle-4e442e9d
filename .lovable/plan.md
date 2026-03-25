

## Universal Settlement API Verification

### Problem
The current verification system is Mirakl-only. The edge function (`verify-mirakl-settlement`), the UI button ("Verify via Mirakl API"), and the transaction filter logic all assume Mirakl. This means:
- eBay API settlements have no verification path
- Amazon API settlements have no verification path
- CSV-uploaded settlements for any marketplace fail verification because the filter tries to match document numbers extracted from PDF filenames (e.g. `BUN-2301-...`) against API transaction references — which never match
- Future marketplace APIs would each need a bespoke verify function

### Solution

Build a single universal `verify-settlement` edge function that detects the marketplace type and routes to the correct API verification path. The UI becomes marketplace-agnostic.

---

### Step 1 — Create `verify-settlement` universal edge function

A new function that:
1. Loads the settlement from DB
2. Detects the marketplace type from `settlement.marketplace` and available API connections (`mirakl_tokens`, `ebay_tokens`, `amazon_tokens`)
3. Routes to the correct verification logic:
   - **Mirakl marketplaces** (Bunnings, Catch, etc.): Reuse existing Mirakl API fetch logic but with **fixed filtering** — for `csv_upload` source, match by date range only (no document number matching); for `mirakl_api` source, match by the actual payout reference
   - **eBay**: Fetch from eBay Sell Finances API `/sell/finances/v1/payout` for the matching period, compare totals
   - **Amazon**: Fetch from SP-API settlement reports for the matching period, compare totals
   - **No API connection**: Return `{ verdict: "no_api_connection" }` with a message like "No API connection found for this marketplace"
4. Returns a standardized response shape (same as current: `verdict`, `api_totals`, `stored_settlement`, `discrepancies`, etc.)

The existing `verify-mirakl-settlement` function's Mirakl-specific logic moves into a helper within this new function. The old function can be kept as a thin redirect for backwards compatibility.

### Step 2 — Fix the Mirakl transaction filter (the immediate bug)

Inside the Mirakl verification path:
- If `settlement.source === 'csv_upload'` or `settlement.source === 'manual'`: filter transactions by **date range only** (period_start to period_end with 1-day buffer). Do NOT attempt document number matching — CSV-uploaded settlements have no Mirakl-native reference.
- If `settlement.source === 'mirakl_api'`: extract the payout reference from the settlement's `raw_payload` or `settlement_id` pattern and match against `payment_reference` / `accounting_document_number`.
- Log the filter path taken and sample transaction references for diagnostics.

### Step 3 — Add eBay verification path

Query eBay Sell Finances API for payouts within the settlement's date range. Map eBay transaction types to the standard comparison fields (sales, fees, refunds, bank_deposit). Return in the same standardized format.

### Step 4 — Add Amazon verification path  

Query Amazon SP-API settlement reports for the matching period. Map Amazon transaction types to standard fields. Return in standardized format.

### Step 5 — Update the UI to be marketplace-agnostic

In `SettlementDetailDrawer.tsx`:
- Rename `handleVerifyMirakl` → `handleVerifyApi`
- Change the button label from "Verify via Mirakl API" to "Verify via API"
- Show the button for **any** settlement where the marketplace has an active API connection (check `mirakl_tokens`, `ebay_tokens`, `amazon_tokens`), not just Bunnings/Catch/MyDeal
- Call the new `verify-settlement` function instead of `verify-mirakl-settlement`
- Handle the `no_api_connection` verdict with a clear message

In `SettlementCorrectionPanel.tsx`:
- Update to call `verify-settlement` instead of `verify-mirakl-settlement`

### Step 6 — Update the plan file

Update `.lovable/plan.md` to reflect the universal verification architecture.

---

### Files to create/modify
- **Create**: `supabase/functions/verify-settlement/index.ts` — universal router with Mirakl, eBay, Amazon paths
- **Edit**: `supabase/functions/verify-mirakl-settlement/index.ts` — thin redirect to new function (or deprecate)
- **Edit**: `src/components/shared/SettlementDetailDrawer.tsx` — marketplace-agnostic verify button + handler
- **Edit**: `src/components/shared/SettlementCorrectionPanel.tsx` — use new universal function

### Standardized response shape (all marketplaces)
```text
{
  settlement_id, marketplace, source,
  verdict: "match" | "discrepancy" | "no_data" | "api_error" | "no_api_connection",
  filter_method: "date_range_only" | "payout_reference" | "document_number",
  transaction_count,
  api_totals: { sales, shipping, fees, refunds, payment, sales_tax },
  stored_settlement: { ... },
  discrepancies: [{ field, stored_value, api_value, difference }],
  missing_transaction_types: [...]
}
```

