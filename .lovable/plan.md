

## Problem Analysis

The Woolworths view shows **"Pushed to Xero"** (green badge) for settlements that were never actually pushed. Here's what's really happening:

**Database reality for most Woolworths settlements:**
- `status: already_recorded` — means "pre-accounting boundary" (before user started using Xettle)
- `sync_origin: xettle` with `xero_invoice_id: null` — the system marked them as handled but never created a Xero invoice
- `xero_pushed: true` — incorrectly set; no invoice exists

Only 4 out of 14 settlements have a real `xero_invoice_id` (posted by Link My Books or another external tool, with `sync_origin: external`). The other 10 have `xero_pushed: true` but no invoice — false positives.

**Should they be pushed to Xero?**
No — these are intentionally behind the accounting boundary date. The system correctly decided not to push them. But the **labelling is wrong**. `already_recorded` should NOT show as "Pushed to Xero".

## Plan

### 1. Fix the Woolworths view status badge logic

In `WoolworthsPaymentsView.tsx`, the `allPushed` check (line 201) lumps `already_recorded` with `pushed_to_xero`. Split these into distinct visual states:

- **`pushed_to_xero` / `reconciled_in_xero`** → Green "In Xero ✓"
- **`already_recorded`** with `sync_origin: external` → Grey outline "Already in Xero (external)"
- **`already_recorded`** with no `xero_invoice_id` → Grey "Pre-boundary — Not in Xero"

Add a new `overallStatus` value: `'pre_boundary'` alongside the existing `'pushed'`.

### 2. Update the group status badge renderer

In `getStatusBadge()` (line 412), add:
- `'pre_boundary'` → Grey secondary badge: "Pre-accounting boundary"
- Keep `'pushed'` → Green badge but relabel to "In Xero ✓"

### 3. Fix the group action button

Line 458: When `overallStatus === 'pre_boundary'`, show "Pre-boundary" text instead of "Complete".

### 4. Fix false `xero_pushed` data (migration)

Run a data fix migration to correct settlements where `xero_pushed = true` but `xero_invoice_id IS NULL`:
```sql
UPDATE marketplace_validation
SET xero_pushed = false
WHERE xero_pushed = true AND xero_invoice_id IS NULL;
```

This ensures the data accurately reflects reality. Settlements that are genuinely already in Xero (via external tools) keep their `xero_pushed = true` and valid `xero_invoice_id`.

### 5. Update stats counts

The "Needs Attention" counter (line 558) currently excludes `pushed`. It should also exclude `pre_boundary` since those are intentionally not actionable.

### Summary of status meanings after fix

| Settlement state | Badge shown | Actionable? |
|---|---|---|
| `already_recorded` + no xero_invoice_id | "Pre-boundary" (grey) | No |
| `already_recorded` + xero_invoice_id | "In Xero (external)" (outline) | No |
| `ready_to_push` | "Ready to Push" (blue) | Yes — push button |
| `pushed_to_xero` / `reconciled_in_xero` | "In Xero ✓" (green) | No |
| `gap_detected` | "Gap Detected" (amber) | Yes — fix gap |

**Files changed:** `WoolworthsPaymentsView.tsx` + 1 data migration

