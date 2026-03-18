

## Fix: Kogan (and all generic CSV) orders showing "0" in validation sweep

### Root cause

The validation sweep edge function (`run-validation-sweep`) counts orders from `settlement_lines` using this filter (line 559):

```
if (line.amount_type === 'ItemPrice' && amt > 0)
```

`'ItemPrice'` is an Amazon-specific value. Generic CSV uploads (Kogan, Catch, MyDeal, etc.) save lines with `amount_type: 'order'` (SmartUploadFlow line 959). So all non-Amazon CSV-uploaded settlements show 0 orders even when line items exist.

### What data goes to Xero

For clarity on the second question:
- **Invoice line items**: Summary-level only (Sales, Fees, GST) — no per-order breakdown
- **File attachment**: Raw `settlement_lines` CSV is attached to the Xero invoice, giving accountants order-level visibility
- This matches the Link My Books pattern

### Fix

**Single change in `supabase/functions/run-validation-sweep/index.ts`** (~line 559):

Broaden the `amount_type` filter to include generic CSV values:

```typescript
// Before:
if (line.amount_type === 'ItemPrice' && amt > 0) {

// After:
const revenueTypes = new Set(['ItemPrice', 'order', 'order_total']);
if (revenueTypes.has(line.amount_type || '') && amt > 0) {
```

This single change makes the Orders column accurate for all marketplaces:
- Amazon: `ItemPrice` (from SP-API)
- Generic CSV (Kogan, Catch, MyDeal, etc.): `order` (from SmartUploadFlow)
- Shopify Orders: `order_total` (from ShopifyOrdersDashboard)

No database migration needed. No client-side changes. Just redeploy the edge function and re-run the validation sweep.

