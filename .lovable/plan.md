

# Fix: Add Missing MarketplaceIds to Amazon FBM Orders API Call

## Problem

The edge function logs show:
```
Value null at 'marketplaceId' failed to satisfy constraint: Member must not be null
```

The Amazon SP-API Orders endpoint requires `MarketplaceIds` as a query parameter, but `sync-amazon-fbm-orders` doesn't include it. The existing `fetch-amazon-settlements` function gets `marketplace_id` from the `amazon-auth` helper -- this function should do the same.

## Changes

### 1. Edge function: use amazon-auth for token + marketplace_id

**File**: `supabase/functions/sync-amazon-fbm-orders/index.ts`

Replace the direct `amazon_tokens` table read + manual `refreshAccessToken` with a call to the existing `amazon-auth` edge function (same pattern as `fetch-amazon-settlements`). This returns `access_token`, `marketplace_id`, `region`, and `selling_partner_id` in one call.

Then add `MarketplaceIds` to the orders query params:

```
const ordersParams = new URLSearchParams({
  MarketplaceIds: marketplace_id,
  FulfillmentChannels: 'MFN',
  OrderStatuses: 'Unshipped',
  LastUpdatedAfter: lastUpdatedAfter,
})
```

### 2. Remove unused refreshAccessToken helper

Since we delegate token refresh to `amazon-auth`, the local `refreshAccessToken` function can be removed to reduce code duplication.

### Technical Detail

The Amazon SP-API Orders v0 endpoint requires `MarketplaceIds` as a mandatory parameter. For Australian sellers this is typically `A39IBJ37TRP1C6`. The `amazon-auth` function already resolves this from the stored token data and returns it alongside the fresh access token.

