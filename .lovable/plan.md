

## Plan: Settlement Lines for All Parsers + Drill-Down Overhaul

### Problem
The eye button shows "No transaction detail available" for most settlements because only Amazon, Shopify Orders, and Woolworths MarketPlus save `settlement_lines`. Shopify Payments, generic CSV, and Bunnings settlements save no lines.

### Current State
| Source | Lines Saved? |
|--------|-------------|
| Amazon SP-API (edge function) | ✅ Yes |
| Amazon manual (AccountingDashboard) | ✅ Yes |
| Shopify Orders CSV | ✅ Yes |
| Woolworths MarketPlus CSV | ✅ Yes |
| Shopify Payments (transaction-level) | ❌ No |
| Shopify Payments (payout-level) | ❌ No |
| Generic CSV (any marketplace) | ❌ No |
| Bunnings PDF | ❌ No |

### Changes

**1. Shopify Payments parser — expose raw rows** (`src/utils/shopify-payments-parser.ts`)

Add `rawRows` to `ShopifyParseResult` for transaction-level format. Each `ShopifyTransactionRow` already has order, type, amount, fee, net, gst, date — pass them through in the result so SmartUploadFlow can save them as settlement_lines.

For payout-level format, no individual rows exist — mark metadata with `csvFormat: 'payout_level'` (already done) so the UI can show an appropriate message.

**2. SmartUploadFlow — save settlement_lines for ALL parsers** (`src/components/admin/accounting/SmartUploadFlow.tsx`)

After each `saveSettlement()` call succeeds, save settlement_lines for:

- **Shopify Payments (transaction-level)**: Map each `ShopifyTransactionRow` → `settlement_line` with order_id, type, amount, fee, net, gst, date
- **Shopify Payments (payout-level)**: Save 3 summary lines (charges total, refunds total, fees total) so drill-down shows *something*
- **Generic CSV**: Save each parsed row as a settlement_line using the column mapping (order_id, amount, date, description from mapped columns)
- **Bunnings PDF**: The parser returns a single summary — save summary lines (sales, fees, GST)

Implementation: After the existing woolworths block (line ~572-593), add equivalent blocks for each parser type. Use a helper function `saveSettlementLines(userId, settlementId, lines[])` to avoid repetition.

**3. GenericMarketplaceDashboard — improved drill-down UI** (`src/components/admin/accounting/GenericMarketplaceDashboard.tsx`)

Replace the "No transaction detail available" dead-end message (line 609-611) with a helpful fallback:

```
📋 Transaction detail not available for this settlement — 
it was uploaded before detailed tracking was enabled.

Settlement summary:
Sales: $X | Fees: $X | Net: $X

To see full detail:
[Re-upload this settlement file]
```

For payout-level Shopify, show: "This is a payout summary. For individual transactions: Shopify Admin → Finances → Transactions → Export"

Add color coding to transaction rows:
- refund/Refund → red tint
- fee/Fee → amber tint
- adjustment → blue tint
- order/charge → white (default)

Add a totals row at the bottom of the transaction table.

Add CSV export button in the expanded drill-down view.

**4. Shopify Payments dashboard — save lines on upload** (`src/components/admin/accounting/ShopifyPaymentsDashboard.tsx`)

Check if this component exists and handles its own uploads. If it delegates to SmartUploadFlow, the fix in #2 covers it. If it has its own save path, add line saving there too.

### Files Changed

1. `src/utils/shopify-payments-parser.ts` — Add `rawRows` to parse result
2. `src/components/admin/accounting/SmartUploadFlow.tsx` — Save settlement_lines for Shopify Payments, generic CSV, Bunnings
3. `src/components/admin/accounting/GenericMarketplaceDashboard.tsx` — Improved empty-state message, color-coded rows, totals row, CSV export

### Scope Note

This plan focuses on the critical path: ensuring lines are saved going forward and improving the drill-down UI. Historical settlements without lines will get the graceful fallback message with a re-upload prompt.

