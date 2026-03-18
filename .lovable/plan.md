

# Fix: Canonical Parity Between App and Deno Shared Module

## Issue

The Deno shared module (`supabase/functions/_shared/fulfilment-policy.ts`) uses a bare `default: return 0` in its switch, while the app canonical (`src/utils/fulfilment-settings.ts`) explicitly lists `marketplace_fulfilled`, `not_sure`, `null`, `undefined` before `default`. Behavior is identical today, but the branching structure differs, violating the "byte-identical in logic" requirement.

## Change

**File**: `supabase/functions/_shared/fulfilment-policy.ts` — update the switch block (lines 25-31) to explicitly list all cases, matching the app canonical:

```typescript
  switch (fulfilmentMethod) {
    case "self_ship":
    case "third_party_logistics":
      return postageCostPerOrder * orderCount;
    case "marketplace_fulfilled":
    case "not_sure":
    case null:
    case undefined:
    default:
      return 0;
  }
```

Also add the inline comments from the app file for full parity:
- `// Zero-cost guard`
- `// Line-level channel takes priority when in mixed mode`
- `// Only MFN (merchant-fulfilled) lines get postage deducted`
- `// AFN, MCF, or unknown/null → no deduction`
- `// For explicit line channels regardless of marketplace setting`
- `// Fall back to marketplace-level method`

Single file, ~10 lines changed. No behavioral change — structure alignment only.

