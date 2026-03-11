

## Fix: GST Tax Type on Negative Settlement ACCPAY Bill

### Summary
One-line critical fix: ACCPAY bills (negative settlements) incorrectly use `OUTPUT` tax when they must use `INPUT` tax (fees are purchases, not sales).

---

### File 1: `supabase/functions/sync-settlement-to-xero/index.ts`

**Line 495 — Before:**
```
            TaxType: "OUTPUT",
```

**Line 495 — After:**
```
            TaxType: "INPUT",
```

**Context around the line:**
```typescript
LineItems: isNegativeSettlement
  ? [{
      Description: `Fee-only period — ${contactName || 'Marketplace'} ${date}\nNo sales revenue. Platform fees charged.`,
      AccountCode: getCode('Other Fees'),
      TaxType: "INPUT",  // ← FIXED
      UnitAmount: Math.round(Math.abs(netAmount) * 100) / 100,
      Quantity: 1,
    }]
```

---

### File 2: `supabase/functions/auto-push-xero/index.ts`

**Reviewed entire file — NO ACCPAY path exists.**

This function:
1. Builds positive-settlement line items only (lines 169-178)
2. All fee lines already correctly use `TaxType: 'INPUT'` (lines 174-177)
3. Calls `sync-settlement-to-xero` for actual pushing (line 206-226)
4. Does NOT handle negative settlements directly

**No changes required** — the tax type bug only exists in `sync-settlement-to-xero` where the negative settlement ACCPAY bill is built.

---

### Files Modified
- `supabase/functions/sync-settlement-to-xero/index.ts` — 1 line changed (line 495)

