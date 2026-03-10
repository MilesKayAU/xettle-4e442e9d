

# Fix Shopify OAuth + Add Reconnect Button

## Blocker: Redirect URI Mismatch

Line 54 of `shopify-auth/index.ts` has:
```
const redirectUri = 'https://xettle.app/shopify/callback'
```
App runs at `https://xettle.lovable.app`. These must match.

**User action required**: Update Allowed redirection URL(s) at partners.shopify.com → xettle dev → App setup to `https://xettle.lovable.app/shopify/callback`.

## Changes

### 1. Fix redirect URI (`supabase/functions/shopify-auth/index.ts`)
- Line 54: Change `https://xettle.app/shopify/callback` → `https://xettle.lovable.app/shopify/callback`

### 2. Add invalid-token warning + Reconnect button (`src/components/admin/ShopifyConnectionStatus.tsx`)
- When connected with `scope === 'custom_app'`, show an amber warning: "Your Shopify token appears invalid. Reconnect via OAuth to fix."
- Add "Reconnect Shopify" button that: deletes existing token → re-initiates OAuth for same shop domain
- Add validation to manual token input: reject tokens not starting with `shpat_`

### 3. Verification sequence
After deploy:
1. User updates redirect URL in Shopify Partners dashboard
2. User clicks "Reconnect Shopify"
3. OAuth flow opens, completes, stores valid token
4. Check `shopify_tokens` — token should not start with `J@`
5. Click "Sync Shopify Payouts" — should pull real data

