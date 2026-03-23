

## ✅ COMPLETED — MarketPlus Transaction Fee Redistribution

Fixed negative MyDeal settlements caused by Woolworths attributing platform-wide "Transaction fee for DD/MM/YYYY" rows to MyDeal.

### Changes shipped

**`src/utils/woolworths-marketplus-parser.ts`**
- Added `isTransactionFee()` helper (exported) — detects fee rows by product name pattern
- Added `redistributeTransactionFees()` — extracts fee rows from all groups, distributes proportionally to siblings with sales, with remainder-based rounding
- Empty groups (e.g. MyDeal with zero rows) are pruned — no settlement created
- Deleted `redistributeAnomalousFees` and `ANOMALOUS_FEE_RATIO_THRESHOLD` — no longer needed

**`src/components/admin/accounting/SmartUploadFlow.tsx`**
- Imported `isTransactionFee` from the parser
- Updated settlement_lines writer: transaction fee rows get `transaction_type: 'TRANSACTION_FEE'` and `accounting_category: 'seller_fees'` — routes to user's mapped seller fees Xero account
