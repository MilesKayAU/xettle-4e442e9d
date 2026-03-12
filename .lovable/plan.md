

# Internal Financial Categories — Standardization Plan

## Current State Assessment

The architecture **already follows the correct principle**: insights queries (`get_marketplace_fee_analysis`, `get_channel_comparison`, `get_rolling_12_month_trend`) all query the `settlements` table directly and never reference COA mappings. The COA layer in `app_settings` is purely optional and only used during Xero push. This is correct.

However, the `accounting_category` values in `settlement_lines` are **inconsistent across ingestion paths**:

| Source | Values Used |
|--------|------------|
| Auto-generate Shopify settlements | `Sales`, `GST`, `PromotionalDiscounts` (PascalCase) |
| SmartUploadFlow (generic CSV) | `sales`, `fees`, `refunds`, `gst` (lowercase) |
| SmartUploadFlow (Shopify payments) | `sales`, `fees`, `refunds` (lowercase) |
| SmartUploadFlow (Bunnings) | `sales`, `fees`, `gst` (lowercase) |
| fetch-amazon-settlements | Uses `l.accountingCategory` from parser (mixed) |
| fetch-shopify-payouts | `sales`, `fees`, `refunds` (lowercase) |

Additionally, `MARKETPLACE_CONTACTS` and `MARKETPLACE_LABELS` in `settlement-engine.ts` are hardcoded dictionaries — they should fall back to the `marketplace_registry` DB table for unknown codes.

## Fixes Required

### 1. Define Canonical Internal Categories

Create a constants file with the standard Xettle internal financial categories. All ingestion pipelines must use these exact values.

**New file: `src/constants/financial-categories.ts`**

Categories:
- `revenue` — item sale
- `marketplace_fee` — commission / referral fee
- `payment_fee` — gateway fee (Stripe, PayPal)
- `shipping_income` — shipping charged
- `shipping_cost` — shipping expense
- `refund` — refunded sale
- `gst_income` — GST collected on sales
- `gst_expense` — GST on fees
- `promotion` — discount / promotional rebate
- `adjustment` — reserve, correction, reimbursement
- `fba_fee` — fulfilment fee (Amazon-specific but normalized)
- `storage_fee` — storage/warehousing
- `advertising` — sponsored product costs

All lowercase, snake_case, stable across all marketplaces.

### 2. Normalize `accounting_category` Values

Update all ingestion paths to use the canonical constants:

| File | Change |
|------|--------|
| `auto-generate-shopify-settlements/index.ts` | `Sales` → `revenue`, `GST` → `gst_income`, `PromotionalDiscounts` → `promotion` |
| `SmartUploadFlow.tsx` | `sales` → `revenue`, `fees` → `marketplace_fee`, `refunds` → `refund`, `gst` → `gst_income` |
| `fetch-shopify-payouts/index.ts` | `sales` → `revenue`, `fees` → `marketplace_fee`, `refunds` → `refund` |
| `fetch-amazon-settlements/index.ts` | Normalize parser output to use canonical categories |
| `ShopifyOrdersDashboard.tsx` | `sales` → `revenue` |
| `AccountingDashboard.tsx` | Map legacy values during read |

### 3. Make `MARKETPLACE_LABELS` Dynamic

Update `settlement-engine.ts` to add a fallback function:

```typescript
export function getMarketplaceLabel(code: string): string {
  // Check hardcoded first (instant, no DB)
  if (MARKETPLACE_LABELS[code]) return MARKETPLACE_LABELS[code];
  // Title-case the code as fallback
  return code.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
```

This ensures unknown marketplaces (e.g. `shopify_temu`) display as "Shopify Temu" without needing a code change.

### 4. Add Edge Function Comment Block

Add the canonical internal categories as a comment in the auto-generate edge function (which can't import from `src/`), mirroring the accounting-rules pattern.

## Files Affected

| File | Change |
|------|--------|
| `src/constants/financial-categories.ts` | **New** — canonical category constants |
| `supabase/functions/auto-generate-shopify-settlements/index.ts` | Normalize category values |
| `src/components/admin/accounting/SmartUploadFlow.tsx` | Normalize category values |
| `supabase/functions/fetch-shopify-payouts/index.ts` | Normalize category values |
| `src/components/admin/accounting/ShopifyOrdersDashboard.tsx` | Normalize category values |
| `src/utils/settlement-engine.ts` | Add `getMarketplaceLabel()` fallback |

## What This Does NOT Change

- Insights queries — they already query `settlements` directly (correct)
- COA mapping in `app_settings` — remains optional (correct)
- Xero push validation — continues to use COA as a mapping layer only (correct)
- No database migration needed — `accounting_category` is a text column

## Architecture Confirmation

After these fixes, the system matches the target architecture exactly:

```text
Transaction → Detection → Settlement normalization
                              ↓
                    Internal categories (revenue, marketplace_fee, refund...)
                              ↓
              ┌───────────────┴───────────────┐
              ↓                               ↓
        Insights Engine                 COA Mapping (optional)
   (Fee Intelligence, Profit)          (Xero push only)
```

