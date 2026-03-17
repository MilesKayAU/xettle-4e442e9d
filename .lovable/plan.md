

## Problem: Xero "Not Connected" — Custom headers blocked by CORS

### Root cause

The `XeroConnectionStatus` component sends custom headers `x-action` and `x-redirect-uri` to the `xero-auth` edge function. These headers are **not listed** in the CORS `Access-Control-Allow-Headers` response, which only permits:

```
authorization, x-client-info, apikey, content-type
```

When the browser sends a preflight (OPTIONS) request, the edge function responds without allowing `x-action` / `x-redirect-uri`, so the browser blocks the actual request. The edge function never receives the call — confirmed by the empty logs.

This affects **all** edge function calls that use custom headers like `x-action`, not just Xero. The `callEdgeFunctionSafe` function in `sync-capabilities.ts` also passes custom `x-action` headers for Amazon and other functions.

### Fix

**One file change: `supabase/functions/_shared/cors.ts`**

Add the custom headers to the allowlist on line 38:

```
"Access-Control-Allow-Headers":
  "authorization, x-client-info, apikey, content-type, x-action, x-redirect-uri",
```

Also add the `.lovableproject.com` origin (for editor preview testing) while we're here:

```
"https://7fd99b7a-85b4-49c3-9197-4e0e88f0fa66.lovableproject.com",
```

### Why this worked before

It may have worked previously if:
- The browser was reusing a cached preflight from before these custom headers were added
- Or the calls were made without custom headers initially, and `x-action` was added later without updating CORS

### Impact

All 41 edge functions import from this shared file, so they all get the fix. After deployment, Xero status checks, connect flows, Amazon smart-sync, and any other calls using `x-action` headers will work on both `xettle.app` and the preview domain.

