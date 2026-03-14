

# Plan: Settlement-Grouped Outstanding View + Anchor Fix

## Summary

Two changes: (1) fix the backend anchor to use `bank_deposit` (not `bank_deposit + gst_on_income`), with GST handled via the existing explainable tier; (2) refactor the frontend to group invoices by settlement and count KPIs at the group level.

## 1. Backend: Fix anchor in `fetch-outstanding/index.ts`

**Remove the GST-inclusive anchor entirely.** The copilot confirmed this is wrong and breaks the "no heuristics" rule.

- **`getInvoiceBasisNet()`** (lines 846-854): Always return `anchor = abs(bank_deposit ?? net_ex_gst ?? 0)`. Remove the `GST_INCLUSIVE_RAILS` set, `isGstInclusiveInvoiceModel()`, and the `bank_deposit_plus_gst` path.
- **`getGroupAnchor()`** (lines 947-996): Remove `gstApplied` field. Keep `gstOnIncome` available for the explainable tier.
- **Explainable tier** (lines 1067-1093): Already handles `gst_on_income` with $2 tolerance. This is the correct mechanism for GST-inclusive invoice diffs. No changes needed here.
- **Split parts**: Keep `getInvoiceBasisNetPart()` using `grossTotal` from split data. No change.
- **Diagnostics**: Remove `gst_anchor_applied_count`, `gst_anchor_helped_count`, `gst_anchor_diagnostics` from `syncInfo` (lines 1556-1558). They tracked the now-removed GST anchor path.

## 2. Frontend: Settlement-grouped rendering in `OutstandingTab.tsx`

**Client-side grouping only** (no backend `settlement_groups` array -- avoids duplicating logic).

### 2a. Build settlement groups from `data.rows`

Add a `useMemo` that groups `filteredRows` by `settlement_id`:

```text
Map<settlement_id, {
  rows: OutstandingRow[],
  matched: boolean,
  group_sum: number,
  group_net: number,
  group_diff: number,
  confidence: string | null,
  explanation: string | null,
  expected_parts: 1 | 2,
  unexpected_extras: OutstandingRow[],
}>
```

- Groups keyed by `settlement_id` (from row fields already present)
- `matched` = first row's `settlement_group_matched` (all rows in group share same result)
- For split settlements (`settlement_evidence?.is_split_month`): `expected_parts = 2`; flag invoices beyond 2 as unexpected
- For non-split: `expected_parts = 1`; flag invoices beyond 1 as unexpected
- Duplicate part detection: if two rows have same `split_part`, flag one as unexpected
- Rows without `settlement_id` go into an "ungrouped" bucket

### 2b. Render grouped table

Replace the flat `paginatedRows.map()` with a two-section layout:

**Section 1 — Settlement groups:**
- Each group renders a collapsible header row showing:
  - Settlement ID (truncated)
  - Match status badge (green "Matched" / amber "Mismatch" / red "Missing")
  - Confidence label (exact/high/grouped/explainable)
  - Group total amount
  - Diff (if mismatched)
  - Part count (e.g., "P1+P2" for splits, "1 inv" for non-split)
- Child rows indented below (existing row rendering, with part label added)
- Unexpected extras get an amber "Unexpected -- review" badge

**Section 2 — Ungrouped invoices:**
- Invoices with no `settlement_id` render as flat rows (current behavior)

### 2c. Update KPIs (lines 1456-1493)

Change from counting individual invoices to counting distinct settlement groups:

- **Settlement found**: count of distinct `settlement_id` values (groups)
- **Settlement matched**: count of groups where `matched = true`
- **Needs attention**: groups with `matched = false` + ungrouped marketplace invoices
- **Total outstanding**: sum of all invoice amounts (unchanged)

### 2d. Pagination

Paginate at the group level (each group = 1 item regardless of invoice count inside it), plus ungrouped invoices as individual items.

## Files to edit

1. `supabase/functions/fetch-outstanding/index.ts` -- remove GST-inclusive anchor, simplify to `bank_deposit` only
2. `src/components/dashboard/OutstandingTab.tsx` -- settlement-grouped rendering + group-level KPIs

## Technical notes

- The anchor fix alone will cause diffs to increase for AU settlements (since `bank_deposit` < `AmountDue` by ~10% GST). But the explainable tier already catches `gst_on_income` with $2 tolerance, so these will resolve as "Matched (gst_on_income)" instead of "exact". This is correct and auditable.
- Client-side grouping is safe because all group metadata (`settlement_group_matched`, `settlement_group_sum`, etc.) is already computed server-side and attached to each row. The frontend just groups rows sharing the same `settlement_id` and reads the pre-computed fields.

