

## Plan: Fix Mirakl Inventory 401 — Use Shared Auth Helper

### Root Cause
The `fetch-mirakl-inventory` edge function builds its authorization header inline (lines 50-55) instead of using the shared `getMiraklAuthHeader()` helper. This means:
- If `auth_mode` is `oauth`, expired tokens are **never refreshed** — the stale token is sent and gets 401
- If `auth_header_type` is `x-api-key`, the wrong header name (`Authorization` instead of `X-API-KEY`) is used
- The `both` mode fallback (OAuth → API key) is not implemented

The settlements function (`fetch-mirakl-settlements`) already uses `getMiraklAuthHeader()` correctly and works fine. The inventory function just needs to do the same.

### Fix

**File: `supabase/functions/fetch-mirakl-inventory/index.ts`**

1. Import `getMiraklAuthHeader` from `../_shared/mirakl-token.ts`
2. Replace the inline auth header construction (lines 50-55) with a call to `getMiraklAuthHeader(supabase, token)` which handles OAuth refresh, header type variants, and fallback logic
3. Use the returned `{ headerName, headerValue }` in the fetch headers

This is a ~5 line change. The shared helper already handles all auth modes, token refresh, and error cases.

### Files Modified
1. `supabase/functions/fetch-mirakl-inventory/index.ts` — Replace inline auth with `getMiraklAuthHeader()` call

### Redeploy
Edge function will be redeployed automatically.

