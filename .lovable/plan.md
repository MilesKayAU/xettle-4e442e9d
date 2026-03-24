

## Plan: Accurate Shipping with Free-Shipping Threshold and Order-Level Data

### Problem (3 issues)

**1. Free shipping threshold ignored**
All marketplaces offer free shipping above a threshold (typically $50). Currently, the system applies $9 shipping to EVERY order. Real data from Shopify orders:

| Channel | Total Orders | Under $50 (pay shipping) | Over $50 (free) | Current Est. | Correct Est. |
|---------|-------------|--------------------------|------------------|-------------|-------------|
| Kogan | 158 | 153 | 5 | $1,233 (137×$9) | ~$1,197 (133×$9) |
| Bunnings | 110 | 99 | 11 | $153 (17×$9) | ~$891 (99×$9) |
| Shopify | 60 | 43 | 17 | $477 (53×$9) | ~$387 (43×$9) |

Kogan barely changes (most orders are small), but Bunnings is massively wrong — and that's compounded by issue #2.

**2. Bunnings CSV order counts still broken**
Despite the cross-reference code in `recalculate-profit`, each Bunnings CSV settlement still shows `orders_count: 2`. The auto-settlement data exists (36 + 61 + 4 = 101 orders) but the profit rows aren't reflecting it. The `orders_count` in the upsert (line 315) uses the raw `ordersCount` from line 239, NOT the corrected `shippingOrderCount`. So the profit table stores 2 orders per CSV settlement, and the Insights dashboard reads THAT number.

**3. No shipping revenue visibility**
Amazon stores shipping revenue in `sales_shipping` ($4,366). All other marketplaces bundle shipping revenue into `sales_principal`. The Fee Intelligence table doesn't show this, making it impossible to see the true product-only margin.

### Fix

**Step 1: Add free-shipping threshold config**

- Add `free_shipping_threshold:{marketplace}` key in `app_settings`
- Add threshold input to `FulfilmentMethodsPanel` (where postage cost is already configured)
- Default to $0 (no threshold = charge all orders) so existing behaviour is unchanged until configured

**Step 2: Fix `recalculate-profit` to use threshold-aware order counts**

In `supabase/functions/recalculate-profit/index.ts`:
- Load `free_shipping_threshold:*` from app_settings
- Query `shopify_orders` to get order values per marketplace
- Count only orders where `total_price < threshold` for shipping deduction
- Fix line 315: store `shippingOrderCount` (not `ordersCount`) in the profit row so Insights reads the corrected count

**Step 3: Update InsightsDashboard shipping calculation**

In `src/components/admin/accounting/InsightsDashboard.tsx`:
- Load free-shipping thresholds from app_settings  
- Use threshold-aware order count from `settlement_profit.orders_count` (now fixed)
- Show "X of Y orders shipped (free shipping over $Z)" in tooltip

**Step 4: Show shipping revenue column in Fee Intelligence**

Where `sales_shipping > 0` (Amazon), show it as a separate column. For other marketplaces, show "Included in Sales" to make it clear the revenue is bundled.

### Files Modified

| File | Changes |
|------|---------|
| `src/components/settings/FulfilmentMethodsPanel.tsx` | Add free-shipping threshold input per marketplace |
| `supabase/functions/recalculate-profit/index.ts` | Load thresholds; query shopify_orders for order values; threshold-aware shipping count; fix orders_count storage |
| `src/components/admin/accounting/InsightsDashboard.tsx` | Load thresholds; threshold-aware shipping display; shipping revenue column |
| `src/utils/fulfilment-settings.ts` | Add `loadFreeShippingThresholds()` helper |

### No database schema changes needed
Uses existing `app_settings` table for threshold config and existing `shopify_orders.total_price` for order-level data.

