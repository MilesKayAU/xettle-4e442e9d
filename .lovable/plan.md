

## Bunnings Upload Guidance — What Files Does Xettle Need?

### The 3 Bunnings Marketplace Files

1. **Summary of Transactions PDF** (`summary-of-transactions-XXXX-YYYY-MM-DD.pdf`)
   - Settlement-level totals: payable orders, commissions, refunds, shipping, subscription fees, net payout
   - Contains billing period dates, shop name/ID, GST breakdowns
   - **This is what Xettle currently parses** via `parseBunningsSummaryPdf()`

2. **Billing Cycle Orders CSV** (`billing-cycle-orders_X.csv`)
   - Order-level detail: every order in the cycle with SKU, quantity, shipping, commission per line, customer address
   - Semicolon-delimited, includes refund status per order
   - **Xettle does NOT currently parse this** but it's valuable for: SKU-level profitability, raw source attachment to Xero, order-count validation

3. **Commission Invoice PDF** (`invoice-XXXXXXXXX_X.pdf`)
   - Bunnings' tax invoice TO the seller for commission fees
   - Contains the commission total + GST — a subset of what's already in the Summary PDF
   - Useful for: BAS reconciliation (input tax credit evidence), accountant filing

### What to tell users

- **Required**: Summary of Transactions PDF — this is the settlement file Xettle needs to create the Xero invoice
- **Recommended**: Billing Cycle Orders CSV — attached to the Xero invoice as raw evidence (like Link My Books does)
- **Optional**: Commission Invoice PDF — useful for accountants but data is already captured in the Summary

### Changes

#### 1. Update upload hint text in `SmartUploadFlow.tsx`
Change the Bunnings source hint from the vague one-liner to clear guidance:
```
bunnings: 'Upload the "Summary of Transactions" PDF from Bunnings Marketplace portal. Optionally include the "Billing Cycle Orders" CSV for order-level detail.'
```

#### 2. Update `BunningsDashboard.tsx` upload section
Add a small info panel/collapsible near the file upload input that explains the 3 files:
- **Required**: Summary of Transactions PDF (settlement totals)
- **Recommended**: Billing Cycle Orders CSV (order-level backup — will be attached to your Xero invoice)
- **Optional**: Commission Invoice PDF (for BAS/accountant records)

Include a note like: "You can download all 3 from the Bunnings Marketplace portal under Accounting → Billing Cycles."

#### 3. Accept the Orders CSV alongside the PDF
Update `BunningsDashboard.tsx` file input to accept both `.pdf` and `.csv` files. When a CSV is uploaded alongside a PDF:
- Detect it as the orders file (has `billing-cycle-orders` in name or semicolon-delimited with `Invoice number;Order number;Date created` header)
- Store the raw CSV content so it can be attached to the Xero invoice (using the raw attachment logic we just added to `sync-settlement-to-xero`)
- Save order count and total from CSV into settlement metadata for cross-validation against the Summary PDF totals

#### 4. Update `file-marketplace-detector.ts`
Add detection for the Bunnings orders CSV format (semicolon-delimited, contains `Invoice number;Order number;Date created;Order status`). Return `bunnings` marketplace.

#### 5. Store raw orders CSV for Xero attachment
When saving the settlement, if an orders CSV was provided, store it in the `audit-csvs` bucket with a key like `bunnings/{settlement_id}/orders.csv`. The `sync-settlement-to-xero` function's new raw attachment logic can then retrieve and attach it.

### Files to modify
- `src/components/admin/accounting/SmartUploadFlow.tsx` — update hint text
- `src/components/admin/accounting/BunningsDashboard.tsx` — add guidance panel, accept CSV, cross-validate
- `src/utils/file-marketplace-detector.ts` — detect Bunnings orders CSV
- `supabase/functions/sync-settlement-to-xero/index.ts` — fetch orders CSV from storage for attachment (minor)

