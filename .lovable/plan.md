

# COA Code Pattern Detection & Replication

## What this solves

Current `accountCodePolicy.ts` generates sequential integers (200, 201, 202...). But real COAs use structured conventions:

```text
200  — Amazon Sales AU        (base: Sales)
200.1 — Amazon Shipping       (sub: Shipping under Sales range)
201  — Shopify Sales          (base: Sales)
206  — Shopify Shipping Revenue (base: Shipping)
206.1 — Bunnings Shipping     (sub: decimal of Shopify Shipping)
400  — Amazon Seller Fees     (base: Fees)
400.1 — Amazon FBA Fees       (sub: under Fees range)
```

The pattern: **whole numbers = base category, decimals = sub-categories or marketplace variants within that base**.

## How this differs from Clone

| Aspect | Clone (existing) | Pattern Replication (new) |
|--------|-----------------|--------------------------|
| **What it copies** | Account names + types | Numbering convention |
| **Code generation** | Next available integer | Decimal suffix matching template |
| **Policy layer** | `accountCodePolicy.ts` | Same — enhanced |
| **Action layer** | `coaClone.ts` | Same — calls enhanced policy |

**Verdict**: This is an enhancement to `accountCodePolicy.ts` that clone (and inline create) both consume. Not a separate feature.

## Design

### 1. Add pattern detection to `accountCodePolicy.ts`

New function: `detectCodePattern(templateAccounts)`

Scans a marketplace's accounts and returns the convention:

```text
interface CodePattern {
  baseCodeByCategory: Record<string, string>;  // e.g. { Sales: '200', Shipping: '206' }
  usesDecimals: boolean;                        // true if any .X codes found
  decimalStrategy: 'suffix' | 'none';          // how decimals are used
  nextDecimalByBase: Record<string, number>;   // e.g. { '200': 2, '206': 2 }
}
```

### 2. Add pattern-aware code generation

New function: `generateCodeFromPattern(pattern, category, existingCodes)`

Logic:
- Find the base code for this category from the template
- If template uses decimals for this category, generate `{base}.{nextDecimal}`
- If template uses whole numbers, find next available whole number near the base
- Always validate against existing codes and Xero limits

Example: Template Amazon has `200` (Sales), `200.1` (Shipping). Cloning to BigW:
- BigW Sales → find next whole number near 200 → `204`
- BigW Shipping → `204.1` (mirrors the decimal convention)

### 3. Wire into clone flow

In `coaClone.ts` `buildClonePreview()`:
- Before generating codes, call `detectCodePattern(templateAccounts)`
- If pattern detected, use `generateCodeFromPattern()` instead of `generateNextCode()`
- If no clear pattern, fall back to current sequential behavior

### 4. Optional: "Match numbering style" toggle in CloneCoaDialog

Simple toggle (default ON) that lets user choose:
- **ON**: Replicate the decimal/numbering convention from template
- **OFF**: Use sequential codes (current behavior)

No PIN required for this toggle — it only affects code suggestions, not accounting writes.

## Files changed

| File | Change |
|------|--------|
| `src/policy/accountCodePolicy.ts` | Add `detectCodePattern()`, `generateCodeFromPattern()` |
| `src/actions/coaClone.ts` | Call pattern detection in `buildClonePreview()` |
| `src/components/settings/CloneCoaDialog.tsx` | Add "Match numbering style" toggle |

## Safety

- Pattern detection is pure logic — no API calls, no side effects
- Generated codes still validated via `validateAccountCode()` (duplicate + range + length checks)
- Falls back to sequential if pattern is ambiguous or codes conflict
- Does not change any existing accounts — only affects NEW code suggestions

