

## Diagnosis: Why Xettle Shows 36 vs Xero's 22

The `fetch-outstanding` edge function queries the Xero API with `Statuses=AUTHORISED` but does **not** filter by invoice type. The Xero Invoices API returns both:
- **ACCREC** (sales invoices — money owed TO you) — these are the 22 you see in Xero's "Awaiting Payment" tab
- **ACCPAY** (bills — money YOU owe) — these are the extra ~14 items (HD-prefixed entries like Bunnings bills, BAS obligations, etc.)

Your Xero screenshot is from **Sales → Invoices**, which only shows ACCREC. But the API returns everything, inflating Xettle's count by ~$12,500.

The "HD" prefixed entries, "BAS Q2 2026", random number strings, and the 577-day-old entry are all **bills or non-marketplace invoices** that should never appear in the Outstanding reconciliation view.

## Plan

### Fix 1 — Filter Xero API to sales invoices only
In `fetch-outstanding/index.ts`, add `Type=="ACCREC"` to the API query so only accounts receivable invoices are returned. This immediately drops the count from 36 to ~22.

```
Current:  Invoices?Statuses=AUTHORISED&order=Date DESC
Fixed:    Invoices?Statuses=AUTHORISED&where=Type=="ACCREC"&order=Date DESC
```

### Fix 2 — Exclude non-marketplace invoices (optional filter)
Add a marketplace-relevance check: if the contact name and reference don't match any known marketplace pattern, classify the row as `non_marketplace` and either hide it by default or show it in a separate "Other invoices" section. This handles edge cases like BAS invoices that are technically ACCREC but irrelevant to settlement reconciliation.

### Fix 3 — Improve settlement matching for existing 22
The `extractSettlementId` function already handles `AMZN-`, `Xettle-`, and `LMB-` prefixes. For the 22 legitimate Amazon invoices, it should be matching against the `settlements` table. The fact that Xettle shows "19 of 36 settlement found" means some of the 22 real invoices aren't matching — likely because the settlement data from the Amazon API sync hasn't completed (the 429 rate-limit issue from earlier).

### Fix 4 — Add invoice type awareness to the UI
Show a small badge or filter toggle so the user can optionally see bills (ACCPAY) in a separate section if they want visibility into what they owe marketplaces (negative settlements pushed as bills).

### Files to change
- `supabase/functions/fetch-outstanding/index.ts` — Add `Type=="ACCREC"` filter, add marketplace-relevance classification
- `src/components/dashboard/OutstandingTab.tsx` — Minor: add optional "Show non-marketplace" toggle if needed

