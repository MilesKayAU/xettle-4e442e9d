

## Deduplicate Push Events, Label GST as Estimate, Rebuild Lines Server-Side

### Changes

**1. Deduplicate `xero_push_success` — single authoritative event**

In `sync-settlement-to-xero/index.ts`:
- Remove the first `xero_push_success` insert (lines 959-966).
- Move the single event write to after attachment succeeds (replacing lines 1126-1141), always including `csv_hash`, `attachment_filename`, `canonical_version` in the details.
- Keep the `xero_push_balance_check` event (lines 969-984) as a separate diagnostic event — it serves a different purpose.

**2. Rename CSV GST column to `gst_estimate` (Option A)**

In both the edge function `buildSettlementCsv()` (line 78) and `src/utils/xero-posting-line-items.ts` `buildAuditCsvContent()` (line 256):
- Rename header `gst_amount` → `gst_estimate`
- Rename header `amount_inc_gst` → `amount_inc_gst_estimate`
- Add a comment row at the top of CSV: `# GST values are estimates (10% flat rate). Refer to settlement source for authoritative GST.`

This prevents bookkeepers from treating the CSV GST column as source-of-truth.

**3. Rebuild line items server-side from `settlementData`**

In `sync-settlement-to-xero/index.ts`:
- Add a server-side `buildServerLineItems(settlementData)` function mirroring the 10-category canonical logic already present in `buildSettlementCsv`.
- When `body.settlementData` is present and settlement is not negative: rebuild line items server-side, ignore `body.lineItems`.
- Use the server-rebuilt items for both the Xero invoice payload (line 833) and the CSV attachment.
- Include `canonical_version` and `line_items_source: 'server_rebuilt'` in the single `xero_push_success` event.
- Fallback: if `settlementData` is missing (shouldn't happen after enforcement), use client `lineItems` but log `line_items_source: 'client_provided'` as a warning.

### Files Changed

| File | Change |
|------|--------|
| `supabase/functions/sync-settlement-to-xero/index.ts` | Remove duplicate event, rename CSV headers, add `buildServerLineItems()`, rebuild lines server-side |
| `src/utils/xero-posting-line-items.ts` | Rename `gst_amount` → `gst_estimate` in `buildAuditCsvContent` headers |
| `src/utils/xero-posting-line-items.test.ts` | Update assertions for renamed CSV headers |

No database changes required.

### Acceptance Criteria

- A successful push writes exactly one `xero_push_success` event containing `csv_hash`, `attachment_filename`, `canonical_version`, and `line_items_source`.
- CSV header reads `gst_estimate` (not `gst_amount`).
- Posted invoice line items are deterministically rebuilt from `settlementData` on the server, not passed through from client.

