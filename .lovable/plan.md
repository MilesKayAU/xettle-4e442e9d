

## Plan: Fix eBay 403 by Adding Inventory Scope

### Root Cause
The eBay OAuth connection requests only two scopes:
- `sell.finances` (for settlements)
- `sell.fulfillment` (for order details)

The inventory endpoint (`GET /sell/inventory/v1/inventory_item`) requires `sell.inventory.readonly`, which was never requested. This means the access token is valid but lacks permission for inventory — hence 403, not 401.

### Fix

**File: `supabase/functions/ebay-auth/index.ts`** (line 8)

Add `sell.inventory.readonly` to the scopes string:

```typescript
const EBAY_SCOPES = 'https://api.ebay.com/oauth/api_scope/sell.finances https://api.ebay.com/oauth/api_scope/sell.fulfillment https://api.ebay.com/oauth/api_scope/sell.inventory.readonly'
```

### User Action Required

Changing the scope in code only affects **new** connections. The existing eBay token was granted with the old scopes — it cannot retroactively gain inventory access.

**The user must reconnect eBay** after this deploy:
1. Go to Settings > API Connections > eBay > Disconnect
2. Reconnect eBay — the new OAuth flow will request all three scopes
3. The inventory tab will then work

### Also update the refresh flow

The refresh call on line 215 of `ebay-auth/index.ts` and line 51 of `fetch-ebay-inventory/index.ts` both pass scopes during refresh. These will automatically pick up the new `EBAY_SCOPES` constant (ebay-auth) or need the scope added (fetch-ebay-inventory hardcodes the refresh). Update `fetch-ebay-inventory/index.ts` line 51 to include the inventory scope in the refresh body.

### Files Modified
1. `supabase/functions/ebay-auth/index.ts` — Add `sell.inventory.readonly` to `EBAY_SCOPES`
2. `supabase/functions/fetch-ebay-inventory/index.ts` — Include inventory scope in inline token refresh

### No database changes needed

