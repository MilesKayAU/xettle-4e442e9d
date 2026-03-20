

## Fix: FBM Sync — Remove `shopify_tokens` dependency, hardcode store, reset failed order

### Problem
The `sync-amazon-fbm-orders` edge function still queries `shopify_tokens` table for `shop_domain` (line 68-74). The `client_credentials` grant then fails with `shop_not_permitted` (visible in logs). The order `250-3366733-4698245` is stuck in `failed` status.

### Root cause
The function reads `shop_domain` from `shopify_tokens` — this dependency is unnecessary since the FBM bridge always targets the fixed store `mileskayaustralia.myshopify.com`.

### Plan

**1. Rewrite `getShopifyInternalToken` in `sync-amazon-fbm-orders/index.ts`**

Remove all `shopify_tokens` table queries. Replace with:
- Hardcode `shop_domain = 'mileskayaustralia.myshopify.com'`
- Read `SHOPIFY_INTERNAL_CLIENT_ID` and `SHOPIFY_INTERNAL_CLIENT_SECRET` from env
- POST to `https://mileskayaustralia.myshopify.com/admin/oauth/access_token` with `grant_type=client_credentials`
- Return the fresh `access_token` directly — no caching needed (cheap call, one per sync run)
- Remove the `readSetting`/`upsertSetting` token cache logic (lines 93-121)

The simplified function matches exactly what the user provided:
```
POST https://mileskayaustralia.myshopify.com/admin/oauth/access_token
Content-Type: application/x-www-form-urlencoded
grant_type=client_credentials&client_id={id}&client_secret={secret}
```

**2. Reset the failed order row**

Run an UPDATE to reset the stuck order:
```sql
UPDATE amazon_fbm_orders 
SET status = 'pending', error_detail = null
WHERE amazon_order_id = '250-3366733-4698245';
```

**3. Redeploy the edge function**

Deploy `sync-amazon-fbm-orders` and verify via logs on next retry.

### Technical detail
- Lines 62-124 of `sync-amazon-fbm-orders/index.ts` will be replaced with a ~15-line function
- No other files need changes — the shared `shopify-api-policy.ts` helpers (`requestClientCredentialsToken`, etc.) can still be used but the function won't depend on the DB for domain resolution
- The `shopify_tokens` import reference at line 69 is the only one in this file; removing it makes FBM fully independent of stored tokens

