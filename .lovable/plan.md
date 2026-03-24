

## Plan: Fix Overlapping Kogan Period Rows in Validation Sweep

### Root Cause

The `auto-generate-shopify-settlements` function creates ONE settlement per marketplace per month (deterministic ID: `shopify_auto_kogan_2026-01_abc12345`). But it calculates `period_start` and `period_end` from the actual min/max order dates:

```text
Run on Jan 15: period_start = Jan 13, period_end = Jan 15
Run on Jan 20: period_start = Jan 13, period_end = Jan 20  (updates same record)
Run on Jan 31: period_start = Jan 13, period_end = Jan 31  (updates same record)
```

The settlement record itself is updated each time (same deterministic ID). But the **validation table** keys rows by `period_label` (e.g., `2026-01-13 → 2026-01-31`). Each time the period boundaries shift, a new validation row is created with a new `period_label`, and the old one is never cleaned up. This produces the 8 overlapping rows seen in the screenshot.

### Fix (Two Parts)

**Part 1 — Use fixed calendar month boundaries for auto-generated settlements**

File: `supabase/functions/auto-generate-shopify-settlements/index.ts`

Instead of calculating period boundaries from actual order dates:
```typescript
// Before (dynamic — shifts every run)
const periodStart = new Date(Math.min(...dates.map(d => d.getTime())));
const periodEnd = new Date(Math.max(...dates.map(d => d.getTime())));
```

Use fixed calendar month boundaries:
```typescript
// After (stable — never shifts)
const [year, month] = monthStr.split('-').map(Number);
const periodStart = `${monthStr}-01`;
const lastDay = new Date(year, month, 0).getDate();
const periodEnd = `${monthStr}-${String(lastDay).padStart(2, '0')}`;
```

This means the `period_label` in the validation table will always be `2026-01-01 → 2026-01-31` regardless of when the auto-generate runs. No more orphaned rows.

Store actual order date range in `raw_payload` for reference (e.g., `first_order_date`, `last_order_date`).

**Part 2 — Clean up orphaned validation rows for auto-generated settlements**

File: `supabase/functions/run-validation-sweep/index.ts`

After the main sweep loop, delete any validation rows whose `settlement_id` starts with `shopify_auto_` but whose `period_label` doesn't match the current settlement's actual `period_start → period_end`. This catches any legacy orphans from before the fix.

Also add this as a one-time migration cleanup:
```sql
-- Delete orphaned validation rows for shopify_auto settlements
-- where the period_label doesn't match the current settlement boundaries
DELETE FROM marketplace_validation mv
WHERE mv.settlement_id LIKE 'shopify_auto_%'
  AND NOT EXISTS (
    SELECT 1 FROM settlements s
    WHERE s.settlement_id = mv.settlement_id
      AND s.user_id = mv.user_id
      AND mv.period_label = (s.period_start || ' → ' || s.period_end)
  );
```

### Files Modified

| File | Changes |
|------|---------|
| Migration | Clean up orphaned validation rows |
| `supabase/functions/auto-generate-shopify-settlements/index.ts` | Use fixed calendar month boundaries |
| `supabase/functions/run-validation-sweep/index.ts` | Add orphan cleanup after sweep |

