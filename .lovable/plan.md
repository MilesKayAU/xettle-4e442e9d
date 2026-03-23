

## Fix: MarketPlus Transaction Fee Redistribution

### Problem
Daily "Transaction fee for DD/MM/YYYY" rows in the Woolworths MarketPlus CSV have `Order Source = MyDeal` set by Woolworths. These are platform-level fees, not order commissions. Since MyDeal has no sales, they create negative-balance settlements that can't push to Xero.

### Changes

#### File 1: `src/utils/woolworths-marketplus-parser.ts`

**1. Add transaction fee detection helper (~line 76)**
```typescript
const isTransactionFee = (row: WoolworthsOrderRow): boolean =>
  /transaction fee for/i.test(row.product);
```

**2. After grouping rows by Order Source (after line 297), add redistribution pass:**
- Extract all rows matching `isTransactionFee` from every group
- Remove them from their original groups (MyDeal)
- Find sibling groups with `grossSales > 0`
- For each fee row, clone it into each sibling group proportionally by sales share, scaling `commissionFee`, `netAmount`, and `gstOnNetAmount`
- Append `" (allocated from platform fees)"` to the cloned row's `product` field for audit trail
- Edge case: if no siblings have sales, keep fees on the largest group and log a console warning

**3. Prune empty groups**
- After redistribution, remove any group with zero rows — no settlement created for that channel

**4. Recalculate group aggregates**
- After row redistribution, recompute `grossSales`, `commission`, `netAmount`, `gst`, `orderCount` for all affected groups

**5. Delete `redistributeAnomalousFees` (lines 348–452)**
- Remove the function, the `ANOMALOUS_FEE_RATIO_THRESHOLD` constant, and its export
- In `buildWoolworthsSettlements` (line 465), replace `const adjustedGroups = redistributeAnomalousFees(groups)` with using `groups` directly

#### File 2: `src/components/admin/accounting/SmartUploadFlow.tsx`

**Update line 873-876** — the settlement_lines writer for Woolworths. Add a check for redistributed transaction fee rows so they get the correct `accounting_category` and `transaction_type`:

```typescript
transaction_type: row.totalSalePrice < 0 ? 'Refund' 
  : isTransactionFee(row) ? 'TRANSACTION_FEE'
  : (row.commissionFee !== 0 && row.totalSalePrice === 0 ? 'Fee' : 'Order'),
accounting_category: row.totalSalePrice < 0 ? 'refund' 
  : isTransactionFee(row) ? 'seller_fees'
  : (row.totalSalePrice === 0 ? 'marketplace_fee' : 'revenue'),
```

Import `isTransactionFee` from the parser (it operates on the same `WoolworthsOrderRow` type).

### Type safety note
No mutation of `WoolworthsOrderRow` type needed. The `isTransactionFee` helper is a pure function that reads the existing `product` field. No `__txFeeAllocated` flag. The cloned rows are standard `WoolworthsOrderRow` objects with scaled numeric values and an amended `product` string — fully compatible with all existing spread/map operations.

### Result
- No more negative MyDeal settlements when MyDeal has zero sales
- Transaction fees land on BigW/Everyday Market proportionally by revenue
- Fees post to the user's mapped `seller_fees` Xero account
- Total bank deposit amount is conserved (invariant maintained)

