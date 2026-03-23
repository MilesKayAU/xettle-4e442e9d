

## Mirakl Safety Fixes — Verification Audit

### Item 1: settlement_lines delete-before-insert — PASS

**Lines 459-481** of `fetch-mirakl-settlements/index.ts` contain the actual implementation:

```text
// 1. Delete existing lines
await adminClient
  .from("settlement_lines")
  .delete()
  .eq("user_id", userId)
  .eq("settlement_id", settlementId);

// 2. Batch insert in chunks of 500
for (let i = 0; i < lineRows.length; i += 500) { ... }
```

This is a real `DELETE` call followed by `INSERT`, not insert-only. The delete filters on both `user_id` and `settlement_id`. Idempotency is correct — re-running the fetch will delete old lines and rewrite them. Each transaction produces one `settlement_lines` row with all required fields (lines 316-328): `settlement_id`, `user_id`, `order_id`, `amount`, `transaction_type`, `accounting_category`, `posted_date`, `marketplace_name`.

**One missing field**: The line rows do NOT include `source: "mirakl_api"`. The spec requires `source = mirakl_api` on each line row. This needs to be added.

---

### Item 4: Date logic for ungrouped settlement ID — PASS (with caveat)

**Lines 399-408**: The ungrouped ID uses `periodStart`, which is computed via string comparison `if (!periodStart || dateOnly < periodStart) periodStart = dateOnly;` (line 284). This is a correct `Math.min` equivalent for ISO date strings — lexicographic comparison of `YYYY-MM-DD` strings gives the earliest date.

It does NOT use `new Date()`, does NOT use the first transaction encountered blindly, and does NOT use `dateFrom` (the fetch date) except as a fallback when `periodStart` is still empty (meaning zero transactions had valid dates — edge case).

**Correct behavior confirmed.**

---

### Item 5: marketplace_connections — upsert, not insert — PASS

**Lines 81-92** of `mirakl-auth/index.ts`:

```text
await adminClient
  .from("marketplace_connections")
  .upsert(
    { ... },
    { onConflict: "user_id,marketplace_code" },
  );
```

This is an upsert with `onConflict`, not a bare insert. Reconnecting will update the existing row rather than failing silently.

---

### Item 6: UI message for pre_boundary — FAIL

The `StatusBadge` component in `RecentSettlements.tsx` (lines 118-200) has **no case for `pre_boundary` status**. It falls through to the generic "Pending" badge at line 194. The user sees a generic clock icon with "Pending" — no mention of accounting boundary, no "import only" message.

The `SettlementDetailDrawer.tsx` also has **zero references** to `pre_boundary` or `is_pre_boundary`. The drawer does not surface the boundary message at all.

The `categorize()` function (lines 98-115) also has no case for `pre_boundary` — it falls to `'other'`.

The DB status is set correctly, but the UI does not render it.

---

### Item 1 addendum: missing `source` field on settlement_lines

Line rows (316-328) include `marketplace_name` but not `source`. The spec requires `source = mirakl_api`.

---

## Fixes Required

### Fix 1: Add `source` to settlement_lines rows
In `fetch-mirakl-settlements/index.ts`, line 328, add `source: "mirakl_api"` to each line row object.

### Fix 2: Add `pre_boundary` to StatusBadge
In `RecentSettlements.tsx`, add a case in `StatusBadge` before the fallback:
```
if (status === 'pre_boundary') {
  return <Badge>Import Only — Before Boundary</Badge>;
}
```
With message: "Period is before your accounting boundary date — import only"

### Fix 3: Add `pre_boundary` to categorize()
Map `pre_boundary` to `'completed'` or a new `'boundary'` category so it doesn't show as actionable.

### Fix 4: Add pre_boundary message to SettlementDetailDrawer
Show an alert banner when `settlement.status === 'pre_boundary'` or `settlement.is_pre_boundary === true` with the text: "Period is before your accounting boundary date — import only".

### Fix 5: Block push action for pre_boundary settlements
In `RecentSettlements.tsx` line 817, add `&& row.status !== 'pre_boundary'` to prevent showing the "Send to Xero" menu item for boundary-blocked settlements.

### No changes needed for
- Items 2-3 (source priority) — correctly implemented
- Item 4 (date logic) — correctly uses string comparison for earliest date
- Item 5 (upsert) — correctly uses upsert with onConflict

