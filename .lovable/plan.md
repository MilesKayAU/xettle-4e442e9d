

## Audit: Xero Push COA Alignment Across All Marketplaces

### Audit Scope
Traced the full data pipeline from ingestion → DB storage → Xero push for every marketplace to verify that each financial category lands on the correct marketplace-specific COA account.

### How the Xero Push Works (Current Architecture)

The push pipeline has **two layers** — and they are already correctly structured:

**Layer 1: Settlement Aggregates (what Xero sees)**
Every settlement stores 10 canonical aggregate fields: `sales_principal`, `sales_shipping`, `seller_fees`, `refunds`, `reimbursements`, `fba_fees`, `storage_fees`, `advertising_costs`, `other_fees`, `promotional_discounts`.

**Layer 2: Server-Side Line Item Builder**
The `sync-settlement-to-xero` edge function rebuilds line items server-side from these aggregates. For each non-zero field, it resolves the COA account via:
```
getCode(legacyKey, marketplace) → checks marketplace-specific override → global default → null (blocks push)
```

### Audit Results By Marketplace

| Marketplace | Ingestion Path | `seller_fees` Populated From | Marketplace Passed to `getCode` | COA Resolution | Status |
|---|---|---|---|---|---|
| Amazon AU | `fetch-amazon-settlements` | SP-API settlement data | `settlement.marketplace` | Per-marketplace override | Correct |
| eBay AU | `fetch-ebay-settlements` | eBay API payout data | `settlement.marketplace` | Per-marketplace override | Correct |
| Shopify Payments | `fetch-shopify-payouts` | Shopify payout API | `settlement.marketplace` | Per-marketplace override | Correct |
| Woolworths (BigW/EM) | CSV parser + redistribution | Commission + redistributed tx fees | `settlement.marketplace` per group | Per-marketplace override | Correct |
| Bunnings | PDF parser | Commission from PDF summary | `settlement.marketplace` | Per-marketplace override | Correct |
| Kogan/Catch/etc | `auto-generate-shopify-settlements` | Shopify order aggregation | `settlement.marketplace` | Per-marketplace override | Correct |
| Generic CSV | SmartUploadFlow | Parsed from CSV columns | `settlement.marketplace` | Per-marketplace override | Correct |

### Transaction Fee Redistribution (Woolworths) — Verified Correct

The recently added redistribution correctly flows through:
1. Parser extracts tx fee rows → redistributes proportionally to BigW/Everyday Market groups
2. Each group's `commission` total includes redistributed fees (line 329)
3. Settlement builder converts `commission` → `fees_ex_gst` (line 471)
4. Settlement engine stores `fees_ex_gst` → `seller_fees` column (line 611)
5. Xero push reads `seller_fees` → resolves via `getCode('Seller Fees', 'bigw')` or `getCode('Seller Fees', 'everyday_market')`
6. Each marketplace gets its own mapped COA account

### Issues Found

**1. Dead code: `buildWoolworthsInvoiceLines` (Medium — cleanup)**
Lines 520-573 of `woolworths-marketplus-parser.ts` contain a legacy Xero line builder with hardcoded account codes (`'200'`, `'405'`, `'613'`). This function is exported but **never imported anywhere**. It bypasses the COA mapping system entirely. While it's not called, its presence is a maintenance risk — a future developer might use it by mistake.

**Fix**: Delete `buildWoolworthsInvoiceLines` and the `WoolworthsXeroLineItem` interface. All Xero pushes already go through the canonical `buildServerLineItems` in the edge function.

**2. Hardcoded fallback account codes in settlement metadata (Low — cosmetic)**
The Woolworths settlement builder writes hardcoded codes into metadata (`salesAccountCode: '200'`, `feesAccountCode: '405'`, `clearingAccountCode: '613'`). These are never read by the Xero push (which uses the proper COA resolution), but they could mislead debugging.

**Fix**: Remove `salesAccountCode`, `shippingAccountCode`, `clearingAccountCode`, `feesAccountCode` from the Woolworths metadata block. They serve no functional purpose.

**3. `settlement_lines.accounting_category` not used by Xero push (Informational — no fix needed)**
The `accounting_category` field on `settlement_lines` (where we set `'seller_fees'` for transaction fees) is only used for GST variance analysis and drill-down display. The actual Xero push reads from settlement-level aggregate columns. This is correct by design — `settlement_lines` are for audit trail, not for posting.

### Summary
The existing architecture is sound. Every marketplace push correctly resolves COA accounts via the per-marketplace override hierarchy. The two cleanup items above remove dead code that could cause confusion but do not affect any live push behavior.

### Changes (1 file)

**`src/utils/woolworths-marketplus-parser.ts`**
1. Delete `WoolworthsXeroLineItem` interface (lines 511-518)
2. Delete `buildWoolworthsInvoiceLines` function (lines 520-573)
3. Remove hardcoded account code fields from settlement metadata (lines 499-502): `salesAccountCode`, `shippingAccountCode`, `clearingAccountCode`, `feesAccountCode`

