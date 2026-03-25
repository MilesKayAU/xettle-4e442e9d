

## Root Cause Analysis: Why So Many Settlements Have Reconciliation Gaps

### The Reconciliation Gap Formula

```text
computedNet = sales_principal + sales_shipping
            - |seller_fees| - |fba_fees| - |storage_fees|
            - |advertising_costs| - |other_fees|
            + refunds + reimbursements

gap = |bank_deposit - computedNet|
```

### Marketplace-by-Marketplace Audit

---

**1. eBay (API) — CONFIRMED BUG: Fee double-counting**

The eBay Sell Finances API returns transaction `amount` as NET (fees already deducted). The code stores this as `sales_principal` and then subtracts fees again:

```text
eBay returns:  tx.amount = $31.14 (net),  tx.totalFeeAmount = $5.16
Code stores:   sales_principal = $31.14,   seller_fees = -$5.16
Formula:       31.14 - 5.16 = $25.98
Bank deposit:  $31.14
Gap:           $5.16 (exactly the fee amount — every single eBay settlement)
```

**Fix:** In `buildSettlementFromPayout()`, reconstruct gross: `salesTotal += amount + Math.abs(feeAmount)` for SALE and CREDIT transactions.

---

**2. Kogan (CSV + PDF) — CONFIRMED BUG: bank_deposit uses CSV "Remitted" column, not PDF "Total paid amount"**

The Kogan CSV parser sets `net_payout = totalRemitted` (sum of per-line "Remitted" column). But the Kogan Remittance PDF shows the actual bank deposit which includes returns, ad fees, and monthly seller fees that the CSV doesn't contain. When a PDF is merged, `bank_deposit` gets updated to the PDF's `totalPaidAmount` — but `sales_principal`, `seller_fees`, etc. stay from the CSV which doesn't include those deductions.

```text
CSV:   sales = $800, commission = $96, remitted = $704
PDF:   Total paid = $663.15 (after returns -$30, ad fees -$8, seller fee -$2.85)
Stored: sales_principal = $727.27, seller_fees = -$87.27, bank_deposit = $663.15
Formula: 727.27 - 87.27 = $640 ≠ $663.15
Gap: $23.15 (the returns/ad fees/seller fees from PDF not reflected in line items)
```

**Fix:** When merging PDF into settlement, also update `advertising_costs`, `other_fees`, and `refunds` from the PDF-extracted `advertisingFees`, `monthlySellerFee`, and `returnsCreditNotes`.

---

**3. Shopify auto-generated (api_sync) — NOT A BUG but expected**

These use estimated commission rates (`COMMISSION_ESTIMATES`). The `bank_deposit` is set to `grossSales - estimatedFees`, so by construction `computedNet ≈ bank_deposit`. These are reconciliation-only anyway (blocked from push by `isReconciliationOnly()`). No fix needed.

---

**4. Mirakl (API) — LIKELY OK**

Uses explicit transaction type mapping where each type maps to a specific field. The `bank_deposit` is set from the payout `amount` field which is the actual transfer. All transaction types are accounted for. Low risk of double-counting.

---

**5. Amazon (API) — LIKELY OK**

Uses CSV flat-file reports where sales and fees are separate line items. Each line has a `transaction-type` and `amount-description` that maps to specific fields. No net-of-fee amounts involved.

---

**6. Generic CSV parser (BigW, MyDeal, etc.) — POTENTIAL ISSUE**

The generic parser maps columns from fingerprints. The `bank_deposit` comes from the `net_payout` mapped column. Whether there's a gap depends on whether the CSV format includes all fee types that the reconciliation formula checks. If the CSV only has one "fees" column but the formula checks `seller_fees + fba_fees + storage_fees + advertising_costs + other_fees`, and all fees land in just `seller_fees`, the other fee fields are 0 — which should still reconcile correctly. **No bug, but worth monitoring.**

---

### Implementation Plan

**1. Fix eBay fee double-counting**

File: `supabase/functions/fetch-ebay-settlements/index.ts`

In `buildSettlementFromPayout()`, lines 346-348:
- SALE case: change `salesTotal += amount` to `salesTotal += amount + Math.abs(feeAmount)` (reconstruct gross from net + fees)
- CREDIT case: change `salesTotal += amount` to `salesTotal += amount + Math.abs(feeAmount)` (same pattern)
- GST calculation: use the gross amount (not net) for `extractTransactionGst()`

**2. Fix Kogan PDF merge — propagate PDF-only adjustments**

File: `src/components/admin/accounting/SmartUploadFlow.tsx`

In the Kogan PDF merge logic, when merging PDF data into a saved settlement, also update:
- `advertising_costs` from `pdfResult.advertisingFees` (already negative)
- `other_fees` from `pdfResult.monthlySellerFee` (negate it)
- `refunds` from `pdfResult.returnsCreditNotes` (negate it — returns reduce the deposit)

This ensures the formula's `computedNet` matches the PDF's `totalPaidAmount`.

**3. Fix Kogan initial save — include PDF adjustments when both files present**

File: `src/components/admin/accounting/SmartUploadFlow.tsx`

When saving a paired Kogan settlement (CSV + PDF uploaded together), the PDF adjustments should be included in the initial settlement record, not just the CSV figures.

### Files Modified

| File | Changes |
|------|---------|
| `supabase/functions/fetch-ebay-settlements/index.ts` | Reconstruct gross sales from net + fees for SALE and CREDIT transactions |
| `src/components/admin/accounting/SmartUploadFlow.tsx` | Propagate Kogan PDF adjustments (ad fees, seller fees, returns) into settlement fields during both initial save and late-PDF merge |

### What happens to existing settlements

- **eBay:** Next sync will overwrite via `settlement_id` upsert — gaps disappear automatically
- **Kogan:** Existing Kogan settlements need the PDF to be re-merged (or user re-uploads). New uploads will be correct immediately.

### No database changes needed

