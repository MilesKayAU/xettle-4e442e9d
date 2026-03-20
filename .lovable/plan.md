

# Fix: Shopify Token Lookup in Product Links Helper

## Problem
The "Load Details" handler looks for Shopify credentials in `app_settings` table under keys `fbm:primary:shopify_token` and `fbm:primary:shopify_domain`. These keys don't exist — the repo stores Shopify credentials in the `shopify_tokens` table.

## Fix
In `src/components/admin/FulfillmentBridge.tsx`, replace the `app_settings` lookup (lines ~113-133) with a query to `shopify_tokens`:

```typescript
const { data: tokenRow } = await supabase
  .from('shopify_tokens')
  .select('shop_domain, access_token')
  .eq('user_id', user.id)
  .eq('is_active', true)
  .limit(1)
  .maybeSingle();
```

If `tokenRow` exists, use `tokenRow.shop_domain` and `tokenRow.access_token` to call the Shopify Admin API (`/admin/api/2026-01/products.json?handle={handle}`) and extract variant IDs.

If no token row found, show the existing "No Shopify credentials" toast.

This matches the pattern used throughout the repo (e.g., `DashboardConnectionStrip`, `ShopifyConnectionStatus`, `GenericMarketplaceDashboard`).

## Scope
- **One file**: `src/components/admin/FulfillmentBridge.tsx`
- No DB, edge function, cron, or RLS changes

