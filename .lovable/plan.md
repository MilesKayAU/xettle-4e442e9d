

## Fix $0.00 Display + Add Review for Saved Settlements

### Root Cause Analysis

Three related issues causing the $0.00 problem:

1. **History tab hardcodes `$0.00`** — Line 1118 of `ShopifyOrdersDashboard.tsx` literally renders `$0.00` instead of using the actual revenue from the DB record. These are clearing invoices (they net to $0.00 in Xero by design), but the History list should show the revenue amount so users know what was captured.

2. **Insights dashboard uses `bank_deposit`** — `InsightsDashboard.tsx` calculates `totalSales` and `netPayout` from `bank_deposit`, which is `0` for Shopify Orders clearing invoices. For `shopify_orders_*` marketplaces, it should use `sales_principal + gst_on_income` as the revenue figure.

3. **No review/re-view capability** — Once saved, there's no way to see the invoice breakdown again from the History tab.

### Changes

**1. `ShopifyOrdersDashboard.tsx` — History tab**
- Replace hardcoded `$0.00` with actual revenue: `formatAUD(s.sales_principal + (s.gst_on_income || 0))` showing the GST-inclusive sales amount
- Add a small "clearing invoice" label so users understand the Xero invoice itself is $0.00
- Add an "Eye" icon button to expand/collapse a saved settlement's line breakdown (sales ex GST, shipping, GST, clearing line) — data is already in the DB fields

**2. `InsightsDashboard.tsx` — Revenue calculation**
- When marketplace code starts with `shopify_orders_`, use `sales_principal` as revenue instead of `bank_deposit`
- Show "$1.00 you keep" correctly (currently showing $1.00 because that's what `sales_principal` is in the test data — the real revenue)

**3. History display format**
Each history row becomes:
```text
MyDeal          Saved     $2,297.00 revenue    Push  🗑
1 Feb – 28 Feb 2026       (clearing invoice: $0.00)
```
With expandable breakdown on click showing the invoice lines.

### Files Changed
1. **Edit**: `src/components/admin/accounting/ShopifyOrdersDashboard.tsx` — History tab: show revenue amount, add expandable review
2. **Edit**: `src/components/admin/accounting/InsightsDashboard.tsx` — Use `sales_principal` for `shopify_orders_*` revenue calc

### No database changes needed
All required data (`sales_principal`, `gst_on_income`, `sales_shipping`) is already saved in the settlements table.

