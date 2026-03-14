

## Align Xero Posting to Preview — Canonical Builder + Attachment Enforcement + Audit CSV

### Problem

Three trust gaps in the push pipeline:

1. **Preview shows 8 lines, push sends 2.** `PushSafetyPreview.buildLineItemsFromSettlement()` shows Sales, Refunds, Seller Fees, FBA, Storage, Advertising, Other, Reimbursements. But all 6 manual callers use `buildSimpleInvoiceLines()` which collapses into "Marketplace Sales" + "Marketplace Commission". Shipping is lumped into Sales in both paths.
2. **Manual push never sends `settlementData`.** The edge function only attaches CSV when `body.settlementData` is provided. No manual caller passes it. Attachment is always silently skipped.
3. **CSV is a single summary row** with no per-category breakdown, no account codes, no tax types.
4. **Auto-post lumps shipping into Sales** (line 353: `sales_principal + sales_shipping`).

### Plan

**1. Create `src/utils/xero-posting-line-items.ts` — canonical builder**

Single shared module exporting:
- `POSTING_CATEGORIES` — constant array of 10 category definitions (name, settlement field, tax type, sign), with `CANONICAL_VERSION = 'v2-10cat'`
- `buildPostingLineItems(settlement, userAccountCodes)` → `XeroLineItem[]` — 10-category breakdown: Sales (principal), Shipping Revenue, Promotional Discounts, Refunds, Reimbursements, Seller Fees, FBA Fees, Storage Fees, Advertising, Other Fees. Zero-amount lines filtered. Uses settlement DB columns directly (not metadata).
- `buildAuditCsvRows(settlement, lineItems)` → string — multi-row CSV (one row per line item + totals row), columns: `settlement_id, period_start, period_end, marketplace, category, amount_ex_gst, gst_amount, amount_inc_gst, account_code, tax_type`
- Golden test fixture + unit test asserting 10 lines, correct tax types, correct CSV row count, sum matches expected net.

**2. Update `PushSafetyPreview.tsx`**

- Import `buildPostingLineItems` from shared module, remove local `buildLineItemsFromSettlement()` (lines 428-446).
- Map output to `LineItemPreview` format for display.
- Remove hardcoded `ACCOUNT_NAMES` map (lines 95-106); derive from builder output.

**3. Update `settlement-engine.ts` — `syncSettlementToXero()`**

- Replace the 2-line fallback (lines 809-826) with `buildPostingLineItems()` from shared module.
- Always pass `settlementData` from the already-fetched settlement row (line 788) to the edge function.
- Deprecate `buildSimpleInvoiceLines()` export (keep as alias pointing to new builder for safety, mark deprecated).

**4. Simplify 5 manual callers**

`use-xero-sync.ts`, `ValidationSweep.tsx`, `MonthlyReconciliationStatus.tsx`, `SettlementsOverview.tsx`, `BunningsDashboard.tsx` — since `syncSettlementToXero` now builds lines internally + passes settlementData, these callers no longer need to build lines manually. Remove `buildSimpleInvoiceLines` calls; just call `syncSettlementToXero(id, marketplace)`.

**5. Update `sync-settlement-to-xero` edge function**

- Replace `buildSettlementCsv()` (lines 71-99) with multi-row category breakdown CSV.
- **Enforce attachment**: if `settlementData` is missing on `action=create`, return error `missing_attachment_data`. If CSV upload to Xero fails, return error `xero_attachment_failed` (not silently continue).
- Compute SHA-256 hash of CSV content, include in `xero_push_success` event details as `csv_hash`, `attachment_filename`, `canonical_version`.

**6. Update `auto-post-settlement` edge function**

- Split `categoryAmounts` line 353: `'Sales (Principal)'` uses `sales_principal`, new `'Shipping Revenue'` uses `sales_shipping`.
- Mirror the 10-category list from canonical module with comment block referencing source file.
- Add `CANONICAL_VERSION = 'v2-10cat'` constant, included in `auto_post_success` event payload.

**7. Golden test**

Create `src/utils/xero-posting-line-items.test.ts`:
- Fixed settlement JSON fixture with all 10 categories non-zero.
- Assert `buildPostingLineItems()` returns exactly 10 lines with correct tax types.
- Assert `buildAuditCsvRows()` contains 10 category rows + 1 totals row.
- Assert sum of line amounts matches expected net within rounding tolerance.

### Category Constants (single source of truth)

```text
Name                  Field                  Tax           Sign
Sales (Principal)     sales_principal        OUTPUT        +
Shipping Revenue      sales_shipping         OUTPUT        +
Promotional Discounts promotional_discounts  OUTPUT        + (usually negative)
Refunds               refunds                OUTPUT        + (usually negative)
Reimbursements        reimbursements         BASEXCLUDED   +
Seller Fees           seller_fees            INPUT         -abs
FBA Fees              fba_fees               INPUT         -abs
Storage Fees          storage_fees           INPUT         -abs
Advertising           advertising_costs      INPUT         -abs
Other Fees            other_fees             INPUT         -abs
```

### Files Changed

| File | Change |
|------|--------|
| `src/utils/xero-posting-line-items.ts` | **NEW** — canonical builder, CSV builder, constants |
| `src/utils/xero-posting-line-items.test.ts` | **NEW** — golden test |
| `src/components/admin/accounting/PushSafetyPreview.tsx` | Use shared builder |
| `src/utils/settlement-engine.ts` | Use shared builder in `syncSettlementToXero`, deprecate `buildSimpleInvoiceLines` |
| `src/hooks/use-xero-sync.ts` | Simplify — stop building lines |
| `src/components/onboarding/ValidationSweep.tsx` | Simplify caller |
| `src/components/admin/accounting/MonthlyReconciliationStatus.tsx` | Simplify caller |
| `src/components/admin/accounting/SettlementsOverview.tsx` | Simplify caller |
| `src/components/admin/accounting/BunningsDashboard.tsx` | Simplify caller |
| `supabase/functions/sync-settlement-to-xero/index.ts` | Rich CSV, enforce attachment, CSV hash |
| `supabase/functions/auto-post-settlement/index.ts` | Split shipping, add canonical version |

No database changes required.

### Acceptance Criteria

- For a settlement with non-zero values in all 10 categories, preview and posted Xero invoice both show 10 matching lines.
- Shipping is always a separate line (never lumped into Sales).
- Attachment is always present. Manual push fails if `settlementData` unavailable. Auto-post fails with `missing_attachment_data` if CSV can't be built.
- `xero_push_success.details` contains `csv_hash`, `attachment_filename`, `canonical_version`.
- Category names are constants; changing them requires bumping `CANONICAL_VERSION`.
- Golden test passes with fixed fixture.

