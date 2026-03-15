

## Plan: Match Link My Books Attachment Quality

### Gap Analysis

Xettle already uses the Xero Attachments API (`PUT /Invoices/{id}/Attachments/{filename}`) to upload a CSV breakdown. But compared to LMB, two things are missing:

1. **No history note on the invoice** — LMB adds a note like "This invoice relates to the total settlement of AUD 2571.95 for period 2026-03-10 - 2026-03-14". This helps accountants immediately understand context without opening attachments.

2. **No raw source data attachment** — LMB attaches the original settlement report data. Xettle only attaches a derived CSV with line items. The original uploaded CSV or Amazon API response is not attached.

### Changes

#### 1. Add a Xero History Note after invoice creation

In `supabase/functions/sync-settlement-to-xero/index.ts`, after the invoice is created and before/after the CSV attachment, call the Xero History API:

```
PUT /api.xro/2.0/Invoices/{invoiceId}/History
Body: { "HistoryRecords": [{ "Details": "This invoice relates to the total settlement of AUD {netAmount} for period {period_start} - {period_end}. Posted by Xettle (csv_hash: {hash})." }] }
```

This is a simple additional API call using the same token and tenant_id already available. Non-fatal — if it fails, log to system_events but don't block the push.

#### 2. Attach the raw source settlement data

After the derived CSV attachment, also attach the original settlement source data (the raw CSV content from the uploaded file or API fetch). This requires:

- Reading the original file content from the `settlement_files` or `audit-csvs` bucket (if stored), or reconstructing from `settlement_lines`
- Attaching as a second file: `xettle-raw-{marketplace}-{settlement_id}.csv`

If the raw source isn't available (legacy records), skip gracefully.

#### 3. File changes

**`supabase/functions/sync-settlement-to-xero/index.ts`**:
- Add `addHistoryNote()` helper function (~15 lines) that calls Xero History API
- Call it after successful invoice creation with period/amount context
- Add raw source attachment logic after the existing CSV attachment (optional, non-fatal)

### What this achieves

Accountants opening any Xettle-posted invoice in Xero will see:
- A history note explaining the settlement period and amount (like LMB)
- The derived line-item CSV (existing)
- The raw settlement source data (new, when available)
- All via the Xero API, no manual steps needed

