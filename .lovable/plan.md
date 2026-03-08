

# Bunnings Settlement: PDF Upload → Invoice → Xero

## Summary

Build a Bunnings-specific dashboard that accepts a single PDF upload (Summary of Transactions), extracts the key financial figures, and creates a Xero invoice — matching the same mental model bookkeepers already use with Amazon.

## PDF Structure (from uploaded file)

The Summary of Transactions PDF contains one critical table:

```text
                    Excl. taxes   Taxes      Incl. taxes
Payable orders      AUD 805.41   AUD 80.58   AUD 885.99
Commission          AUD -100.63  AUD -10.07  AUD -110.70
Total                                        AUD 775.29
```

Plus: billing period dates, shop name, and an invoice number in the filename.

## What Gets Built

### 1. PDF Parser — `src/utils/bunnings-summary-parser.ts`

Extracts from the parsed PDF text:
- `period_start`, `period_end` (from "15/02/2026 to 28/02/2026")
- `orders_ex_gst` = 805.41, `orders_gst` = 80.58
- `commission_ex_gst` = -100.63, `commission_gst` = -10.07
- `net_payout` = 775.29
- `invoice_number` from filename pattern or document content

Uses regex against the text content extracted via `pdfjs-dist` (already installed).

### 2. Bunnings Dashboard — `src/components/admin/accounting/BunningsDashboard.tsx`

Three tabs matching the Amazon flow:

**Upload Tab**
- Single PDF file input (accept `.pdf`)
- Parse on upload, show extracted summary immediately
- Validation: net_payout must equal orders_incl - commission_incl

**Review Tab**
- Clean summary card showing period, gross sales, GST, commission, net payout
- Reconciliation badge (pass/fail)
- "Send to Xero" button — creates an invoice (not a journal)

**History Tab**
- List of saved Bunnings settlements from `settlements` table where `marketplace = 'bunnings'`
- Status badges: parsed, synced, error

### 3. Xero Invoice Model

Creates an invoice to contact "Bunnings Marketplace":

| Line | Account | Amount | Tax |
|---|---|---|---|
| Marketplace Sales | 200 (Sales) | 805.41 | GST on Income |
| Marketplace Commission | 407 (Seller Fees) | -100.63 | GST on Expenses |

**Total = $775.29** (matches bank deposit)

Bookkeeper workflow: bank feed shows $775.29 from Bunnings → match to invoice → done.

### 4. Database — No Migration Needed

Reuses existing `settlements` table:
- `marketplace` = `'bunnings'`
- `settlement_id` = invoice number from PDF
- `sales_principal` = orders excl GST
- `seller_fees` = commission excl GST
- `gst_on_income` = orders GST
- `gst_on_expenses` = commission GST
- `bank_deposit` = net payout
- `source` = `'manual'`
- Unused Amazon fields (`fba_fees`, `storage_fees`, etc.) stay at default 0

### 5. Dashboard Routing — `src/pages/Dashboard.tsx`

When marketplace switcher is set to `bunnings`, render `BunningsDashboard` instead of `GenericMarketplaceDashboard`.

### 6. Xero Push — Reuse Existing Edge Function

Extend `sync-amazon-journal` (or create `sync-bunnings-invoice`) to handle `marketplace = 'bunnings'` with the simpler 2-line invoice structure. Contact = "Bunnings Marketplace", reference = invoice number + period.

## Files

| File | Action |
|---|---|
| `src/utils/bunnings-summary-parser.ts` | Create — PDF text parser |
| `src/components/admin/accounting/BunningsDashboard.tsx` | Create — full Upload/Review/History dashboard |
| `src/pages/Dashboard.tsx` | Edit — route Bunnings to new component |
| `supabase/functions/sync-amazon-journal/index.ts` | Edit — add Bunnings invoice creation path |

No database migrations required.

