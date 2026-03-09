

## Phase 1 — Parser & Registry Hardening

All changes are additive. No existing parsers modified.

### 1. Fix Group Key Bug (Critical)
**File:** `src/utils/shopify-orders-parser.ts` lines 353, 365-370

Current code uses `_` delimiter which breaks for `everyday_market_AUD`. Replace with `JSON.stringify` approach as user suggested:

```typescript
// Line 353: groupKey function
const groupKey = (order: ShopifyOrderRow) => 
  JSON.stringify({ m: order.detectedMarketplace, c: order.currency });

// Lines 365-370: extraction
const { m: actualMktKey, c: currency } = JSON.parse(key);
```

### 2. Registry Updates
**File:** `src/utils/marketplace-registry.ts`

- Add `default_fees_account: string` to interface (default `'405'`)
- Add `skip_reason?: string` alias field
- Add Kogan: `payment_method_patterns: ['commercium by constacloud', 'commercium', 'constacloud', 'kogan']`
- Add Bunnings: note pattern `'Channel_id: 0196'`, payment method pattern `['mirakl']`
- Add eBay: `payment_method_patterns: ['ebay']`
- Add `default_fees_account: '405'` to every entry

### 3. Harden `isShopifyOrdersCSV` Fingerprint
**File:** `src/utils/shopify-orders-parser.ts` lines 575-581

Require all 10 spec columns: Name, Financial Status, Paid at, Subtotal, Shipping, Taxes, Total, Payment Method, Note Attributes, Tags. Explicitly reject if `Bank Reference` or `Payout ID` present.

### 4. SKU Normalisation
**File:** `src/utils/shopify-orders-parser.ts`

Add SKU normalisation helper: `sku.trim().toUpperCase().replace(/[-\s]/g, '')` before any COGS lookup or storage. Add `lineitemSku`, `lineitemQuantity`, `lineitemPrice` to ColumnMap and parsing.

### 5. Bookkeeper Instructions — Verify Against Spec
**File:** `src/components/admin/accounting/ShopifyOrdersDashboard.tsx` lines 644-671

Current code is **missing** from spec:
- Invoice count: "[X] invoices pushed to Xero"
- Total revenue: "Total revenue recognised: $[amount]"
- Total GST: "Total GST on income: $[amount]"

Fix: Track `pushStats` from `handlePushAllToXero` (already calculates `totalRevenue` and `totalGst` in lines 234-255 but doesn't display them). Add these to the bookkeeper info panel header.

### 6. AI Marketplace Detection Mode
**File:** `supabase/functions/ai-file-interpreter/index.ts`

Add a second action mode `detect_marketplace` alongside existing `analyse_file`. When `action === 'detect_marketplace'`:
- Accepts: `note_attributes_samples`, `tags_samples`, `payment_method`, `row_count`
- Uses a new tool function `detect_marketplace` returning: `marketplace_name`, `marketplace_code`, `confidence`, `detection_field`, `reasoning`
- Called from ShopifyOrdersDashboard for unknown groups with 3+ orders

### 7. Wire AI Fallback into Unknown Groups UI
**File:** `src/components/admin/accounting/ShopifyOrdersDashboard.tsx`

For unknown groups with `orderCount >= 3`:
- Auto-call `ai-file-interpreter` with `action: 'detect_marketplace'`
- Show AI suggestion with confidence badge
- If confidence >= 90: auto-assign with "(AI detected)" note
- If 70-89: show "AI thinks this is: [Name] (X%)" with Accept/Choose manually
- If < 70: manual dropdown only (current behavior)

---

### Files Modified
1. `src/utils/marketplace-registry.ts` — fees account, missing patterns, skip_reason
2. `src/utils/shopify-orders-parser.ts` — JSON groupKey, fingerprint hardening, SKU columns + normalisation
3. `src/components/admin/accounting/ShopifyOrdersDashboard.tsx` — bookkeeper stats, AI fallback UI
4. `supabase/functions/ai-file-interpreter/index.ts` — detect_marketplace mode

No existing parsers, settlements, or Xero push logic touched.

