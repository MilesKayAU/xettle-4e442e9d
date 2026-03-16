

## Problem

Three gaps in the current system:

1. **No data completeness assessment.** When a file is detected (by fingerprint, heuristic, or AI), the system never checks whether the mapped columns provide enough data for full accounting (gross, fees, net, settlement ID, dates). Files like the eBay "Order Earnings" report DO have enough data, but other partial exports (e.g., an orders-only report without fees) would be silently imported with zeroes in critical fields.

2. **No marketplace-specific guidance when data is incomplete.** The `wrongFileMessage` and `correctReportPath` fields only exist for files explicitly fingerprinted as "wrong." There's no mechanism for files that are *partially* useful but missing critical accounting columns.

3. **No upgrade path for partial imports.** If a user uploads a partial report today (e.g., order-level without fee breakdown), and later uploads the proper settlement report, there's no link between them. The dedup engine treats them as separate records. The user has no way to know which settlements are "partial" and need supplementing.

Additionally, the eBay "Order Earnings" format (with `Order earnings`, `Gross amount`, `Expenses` columns and a 15-line metadata preamble) still needs a fingerprint and the header-row scanner from the previously approved plan.

---

## Plan

### 1. Add smart header-row scanner (preamble skipper)

**Files:** `file-fingerprint-engine.ts`, `generic-csv-parser.ts`

Add a `findHeaderRow()` function that scans the first 30 lines for the actual header row by counting matches against a keyword set (`order|amount|fee|total|payout|gross|net|date|quantity|earnings|refund|commission|currency|subtotal`). Require 3+ keyword hits and 5+ non-empty fields. Apply in both `extractFileHeaders()` and `parseGenericCSV()`. Extract metadata (date range, seller info) from preamble lines above the header.

### 2. Add eBay Order Earnings fingerprint

**File:** `file-fingerprint-engine.ts`

New fingerprint:
- `requiredColumns: ['order earnings', 'gross amount']`
- `anyOfColumns: ['final value fee - fixed', 'expenses']`
- `columnMapping: { gross_sales: 'Gross amount', fees: 'Expenses', refunds: 'Refunds', net_payout: 'Order earnings', order_id: 'Order number', period_start: 'Order creation date', currency: 'Payout currency' }`
- `groupBySettlement: false` (treat entire file as one settlement, use preamble date range)
- Mark as `isSettlementFile: true` but add a new field `dataCompleteness: 'partial'` with guidance.

### 3. Add data completeness assessment to detection result

**File:** `file-fingerprint-engine.ts`

Add new fields to `FileDetectionResult`:
```typescript
dataCompleteness?: 'full' | 'partial' | 'orders_only';
missingFields?: string[];        // e.g. ['settlement_id', 'fees']
completenessWarning?: string;    // human-readable warning
upgradeAdvice?: string;          // "Download the Transaction Report from..."
```

After detection (Level 1, 2, or 3), run a `assessCompleteness(mapping)` function that checks:
- **Full**: Has `gross_sales` + `fees` + `net_payout` + (`settlement_id` or `period_start`)
- **Partial**: Has `net_payout` or `gross_sales` but missing fees or settlement ID
- **Orders only**: Has order data but no fee/payout columns

For partial/orders-only, populate `upgradeAdvice` with marketplace-specific guidance pulled from a lookup map:

| Marketplace | Upgrade advice |
|---|---|
| `ebay_au` | "For full accounting, download the **Transaction Report** from Seller Hub → Payments → Reports. This groups data by Payout ID for bank matching." |
| `amazon_au` | "Download the **Settlement Report** from Seller Central → Reports → Payments → All Statements → Download TSV." |
| `shopify_payments` | "Export the **Payouts** CSV from Shopify Admin → Finances → Payouts → Export." |
| Generic | "Look for a 'Settlements', 'Payouts', or 'Payments' report in your marketplace seller portal that includes fee breakdowns and payout totals." |

### 4. Show completeness warning in SmartUploadFlow UI

**File:** `SmartUploadFlow.tsx`

In the `FileResultCard`, after the confidence bar, show a yellow info banner when `dataCompleteness !== 'full'`:

```text
┌─────────────────────────────────────────────────────┐
│ ⚠ Partial data — this report is missing: Payout ID │
│                                                     │
│ This file will be imported but may not provide full │
│ accounting detail. For complete data:               │
│ 📥 Download the Transaction Report from             │
│    Seller Hub → Payments → Reports                  │
│                                                     │
│ You can upload the full report later to supplement   │
│ this data.                                          │
│                                          [Got it]   │
└─────────────────────────────────────────────────────┘
```

The file still imports — it's not blocked. The warning is informational.

### 5. Mark partial settlements in database

When saving a settlement from a partial-completeness file, set `metadata.data_completeness = 'partial'` and `metadata.upgrade_source = 'ebay_transaction_report'`. This allows:
- Future UI to show a "partial data" badge on the settlement
- A future upload of the proper report to be linked/matched to supplement the partial record

### 6. eBay-specific: research-based guidance content

The eBay Order Earnings report the user uploaded has these columns and IS sufficient for accounting:
- `Gross amount` = sales + shipping (GST-inclusive)
- `Expenses` = sum of all fees (FVF fixed + variable + promo + regulatory + processing)
- `Refunds` = refund amounts
- `Order earnings` = net after all deductions

**However**, it lacks a `Payout ID`, so it can't be matched to specific bank deposits. The Transaction Report is preferred because it groups by payout. The upgrade advice for eBay will reflect this distinction.

---

## Summary of file changes

| File | Change |
|---|---|
| `src/utils/file-fingerprint-engine.ts` | Add `findHeaderRow()`, eBay Order Earnings fingerprint, `assessCompleteness()`, `dataCompleteness` fields on `FileDetectionResult`, marketplace guidance map |
| `src/utils/generic-csv-parser.ts` | Use `findHeaderRow()` to skip preambles, extract metadata dates |
| `src/components/admin/accounting/SmartUploadFlow.tsx` | Show completeness warning banner, pass `data_completeness` to settlement metadata |

