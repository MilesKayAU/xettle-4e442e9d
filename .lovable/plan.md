

# Shopify Public App Readiness -- Final Plan

## Fix 1 -- Remove hardcoded shop domain
**File:** `src/components/onboarding/SetupStepConnectStores.tsx`
- Change `useState('mileskayaustralia.myshopify.com')` to `useState('')`
- Add placeholder `"yourstore.myshopify.com"` to the input

## Fix 2 -- Admin role migration
**Migration SQL:**
1. Insert `primary_admin_email = 'mileskayaustralia@gmail.com'` into `app_settings` (system-level, `user_id IS NULL`)
2. Replace `is_primary_admin()` function body to look up `primary_admin_email` from `app_settings` instead of hardcoding the email

## Fix 3 -- Shopify App Store install flow

### 3a. Edge function: `supabase/functions/shopify-install/index.ts`
- **GET endpoint** (Shopify sends browser GET)
- Validates HMAC with timing-safe comparison (crypto.subtle re-sign approach)
- Uses service-role client to check `shopify_tokens` for existing `shop_domain`
- Returns **302 redirect** directly to `https://xettle.app/auth?tab=signup|signin&shop=X&source=shopify_install`
- Logs to `system_events`
- Config: `[functions.shopify-install] verify_jwt = false`

No React page. No route in `App.tsx`. The edge function URL is the App URL registered in Shopify Partner Dashboard.

### 3b. Auth page updates (`src/pages/Auth.tsx`)
- Detect `source=shopify_install` and `shop` URL params
- Show banner: "Complete signup to connect [shop]"
- After auth state change (login OR signup), if params present:
  - Invoke `shopify-auth` with `action: 'initiate'` and the shop domain
  - Redirect to Shopify OAuth URL
- Shop domain is read-only in the UI

### 3c. SetupWizard update (`src/components/onboarding/SetupWizard.tsx`)
- Check for `?shopify_connected=true` URL param
- If present, auto-advance past "Connect Stores" step

### 3d. ShopifyCallback update (`src/pages/ShopifyCallback.tsx`)
- When coming from install flow, redirect to `/setup?shopify_connected=true` instead of `/dashboard`

### 3e. Timing-safe HMAC fix for existing `shopify-auth/index.ts`
- Replace `!==` comparison (line ~117) with the same constant-time approach

## Files created
- `supabase/functions/shopify-install/index.ts`

## Files modified
- `src/components/onboarding/SetupStepConnectStores.tsx` (Fix 1)
- `src/pages/Auth.tsx` (shopify_install auto-OAuth)
- `src/pages/ShopifyCallback.tsx` (redirect to setup)
- `src/components/onboarding/SetupWizard.tsx` (skip Shopify step)
- `supabase/functions/shopify-auth/index.ts` (timing-safe HMAC)

## Database migration
- Seed `primary_admin_email` in `app_settings`
- Replace `is_primary_admin()` with dynamic lookup

## Manual steps (user)
- Set **App URL** to `https://cegwclxbqvitkqxikpss.supabase.co/functions/v1/shopify-install` in Shopify Partner Dashboard
- Set **Allowed redirect URL** to `https://xettle.app/shopify/callback`

## Build order
1. Fix 1 (hardcoded domain)
2. Fix 2 (admin migration)
3. Fix 3a (shopify-install edge function)
4. Fix 3e (timing-safe HMAC in existing shopify-auth)
5. Fix 3b (Auth.tsx updates)
6. Fix 3c + 3d (SetupWizard + ShopifyCallback)

