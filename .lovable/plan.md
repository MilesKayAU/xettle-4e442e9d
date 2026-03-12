

# Shipping Account Separation Fix

## What Changes

Add a dedicated `Shipping` category to the account mapping system so shipping revenue posts to a separate Xero account (default `206`) instead of being merged into Sales (`200`).

## Files to Modify

### 1. `src/utils/settlement-engine.ts`
- Add `'Shipping': '206'` to `DEFAULT_ACCOUNT_CODES` (line 102-112)
- Change line 196 from `getCode('Sales')` to `getCode('Shipping')`

### 2. `src/utils/amazon-xero-push.ts`
- Line 91: Change `'Sales - Shipping'` mapping from `getAccountCode('Sales')` to `getAccountCode('Shipping')`

### 3. `supabase/functions/sync-settlement-to-xero/index.ts`
- Add `'Shipping': '206'` to `DEFAULT_ACCOUNT_CODES` (line 531-541)

### 4. `src/components/admin/accounting/AccountingDashboard.tsx`
- Add `'Shipping'` entry to `DEFAULT_ACCOUNT_CODES` (line 3534-3543): `{ code: '206', name: 'Shipping Income', type: 'Revenue', taxType: 'OUTPUT', description: 'Revenue, GST on Income' }`

### 5. `src/components/admin/accounting/BunningsDashboard.tsx`
- Line 1025: Change hardcoded `AccountCode: '200'` to use the Shipping account code

### 6. `src/components/settings/AccountMapperCard.tsx`
- Update `CATEGORY_DESCRIPTIONS` to add `'Shipping': 'Shipping revenue charged to customers'`
- Update `Sales` description to remove "& shipping revenue"

## Result

```text
Product Sales    → Sales account (200)
Shipping Revenue → Shipping Income account (206)
GST              → Unchanged (OUTPUT tax type on both)
```

All three invoice builders (simple, Amazon, Shopify) will use the dedicated Shipping account. Users can override via Account Mapper UI. No GST logic changes needed.

