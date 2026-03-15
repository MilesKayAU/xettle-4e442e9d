

## eBay Support — File Detection, Parsing & Upload Guide

### Problem
The user uploaded an eBay "Order Proceeds" report. The AI file interpreter recognized it as eBay, but the generic CSV parser failed with "Could not find sales or net payout columns" because eBay uses column names like `Item subtotal`, `Gross amount`, `Net proceeds` that don't match our expected patterns.

Additionally, there's no eBay fingerprint in the detection engine, no upload guide (like the Amazon SellerCentralGuide), and no marketplace registry entry for eBay.

### Which eBay Report to Use

eBay offers two main downloadable reports:

| Report | Where | Best For |
|--------|-------|----------|
| **Transaction Report** | Seller Hub → Payments → Reports | Settlement-level data — has `Payout ID`, `Net amount`, `Final Value Fee`, groups by payout cycle |
| **Earnings / Order Proceeds** | Seller Hub → Payments → Earnings | Order-level data — has `Item subtotal`, `Gross amount`, `Net proceeds` per order |

**Recommendation**: Support BOTH. The Transaction Report is ideal (maps directly to settlements via `Payout ID`), but the Order Proceeds report also works (aggregate by date range).

### Changes

**1. Add eBay fingerprints to `file-fingerprint-engine.ts`**

Add two new fingerprint entries in the `FINGERPRINTS` array:

- **eBay Transaction Report** (settlement-level, preferred):
  - Required: `payout id` + `net amount`
  - AnyOf: `final value fee`, `item subtotal`, `gross transaction amount`
  - Column mapping: `settlement_id` → `Payout ID`, `gross_sales` → `Item subtotal`, `fees` → composite of fee columns, `net_payout` → `Net amount`, `period_start` → `Payout date`

- **eBay Order Proceeds / Earnings Report** (order-level):
  - Required: `item subtotal` + `net proceeds` (or `gross amount`)
  - AnyOf: `ebay collected tax`, `final value fee`, `order id`
  - Column mapping: `gross_sales` → `Item subtotal`, `net_payout` → `Net proceeds`, `order_id` → `Order ID`

- **eBay Orders (WRONG file)** — if it has `order id` but no fee/net columns, show guidance pointing to Transaction Report

**2. Add eBay to `file-marketplace-detector.ts`**

Add filename and content signals:
- Filename: `ebay`, `order_proceeds`, `transaction_report`
- Content: `payout id` + `net amount`, or `item subtotal` + `net proceeds`

**3. Add eBay upload guide component**

Create `src/components/admin/accounting/EbayUploadGuide.tsx` — similar to `SellerCentralGuide.tsx` but for eBay:
- Step 1: Go to Seller Hub → Payments → Reports
- Step 2: Select "Transaction Report" and choose date range
- Step 3: Generate CSV and download
- Alternative: Earnings tab → Download Order Proceeds

**4. Wire eBay guide into SmartUploadFlow**

Show the eBay guide when the active marketplace tab is `ebay` (same pattern as `SellerCentralGuide` for Amazon).

**5. Add eBay to marketplace registry (database)**

Run a migration to insert eBay AU into the `marketplace_registry` table with detection keywords (`ebay`, `order_proceeds`), xero contact patterns (`eBay`), and bank narration patterns (`EBAY`, `PAYPAL`).

### Files to Modify

| File | Change |
|------|--------|
| `src/utils/file-fingerprint-engine.ts` | Add 3 eBay fingerprints (transaction report, order proceeds, wrong-file) |
| `src/utils/file-marketplace-detector.ts` | Add eBay filename + content signals |
| `src/components/admin/accounting/EbayUploadGuide.tsx` | New — step-by-step download guide |
| `src/components/admin/accounting/SmartUploadFlow.tsx` | Show EbayUploadGuide for eBay marketplace tab |
| Database migration | Insert eBay AU into `marketplace_registry` |

