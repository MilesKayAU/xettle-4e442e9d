

## Plan: Make COA Code Grouping Generic (Not Hardcoded Ranges)

### Problem
The current `generatePatternBatchCodes` hardcodes grouping into `REVENUE_RANGE (200-399)` and `EXPENSE_RANGE (400-599)`. Users with different Xero structures (e.g., 4000-series revenue, 5000-series expenses, or completely custom ranges) will get codes placed in the wrong part of their COA.

### Fix: Infer Ranges from Template Accounts

Instead of classifying bases into revenue vs expense and assigning to hardcoded ranges, the logic should:

1. **Detect the natural range of the template accounts themselves** — group by the "hundreds block" (or "thousands block" for 4-digit codes) each template code lives in
2. **Find contiguous free slots near where the template accounts already sit** — this respects whatever numbering scheme the user has, whether it's 200s, 4000s, or anything else
3. **Fall back to type-based ranges only when the template range is fully exhausted**

### Changes to `src/policy/accountCodePolicy.ts`

**`generatePatternBatchCodes` — replace the revenue/expense split with a proximity-based grouping:**

- Group base accounts by their numeric "neighbourhood" (same hundreds-block, e.g. 200-299, 400-499, or for 4-digit codes 4000-4099)
- For each neighbourhood group, scan forward from the template codes' max to find a contiguous block of free slots within a reasonable proximity (same hundreds or thousands block first, then widen)
- If no space in the neighbourhood, widen the search to the full type-based range as a fallback
- This makes the algorithm work for any COA structure without assuming specific code ranges

**Concrete logic:**

```text
For each base account:
  → compute neighbourhood = floor(code / 100) * 100  (or /1000 for 4-digit)

Group bases by neighbourhood.

For each neighbourhood group:
  → start scanning from neighbourhood_start
  → find contiguous block of N free codes
  → if not found, widen to neighbourhood ± 100
  → last resort: fall back to getRangeForType()
```

### No other files change
The edge function and dialog UI remain as-is — this is purely a code generation policy fix.

