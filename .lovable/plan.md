

## Plan: Fix fetch-shopify-orders Silent Failure

### Problem
The `fetch-shopify-orders` edge function boots but produces zero log output — no auth logs, no success logs, nothing. It silently fails and returns an error that the client may be swallowing. `shopify_orders` has 0 rows despite valid Shopify credentials.

### Root Cause (Most Likely)
The global catch block (line 193-197) returns a JSON error response but **does not `console.error`** the exception. Combined with potential issues in `supabase.auth.getUser(token)` or `req.json()`, errors are completely invisible.

### Changes

**1. Fix `supabase/functions/fetch-shopify-orders/index.ts`**

- Add `console.log` as the very first line inside the handler (before any async work) so we can confirm the function actually executes
- Add `console.error` in the global catch block so crashes are visible in logs
- Add `console.log` after `req.json()` to confirm body parsing succeeds
- Add `console.log` after auth check to confirm user identity
- Add `console.log` after Shopify API response to confirm data returned
- Remove the `getUser(token)` call — the client already has the Authorization header set, so just use `getUser()` without args (the session-based version). Passing raw JWT to `getUser()` may be failing silently on this Supabase JS version.

**2. Fix `src/components/dashboard/ChannelAlertsBanner.tsx`**

- Log the actual response/error from `supabase.functions.invoke` to the console so the client-side error is visible
- Show the actual error detail in the toast (currently it may show "undefined")

**3. Redeploy the edge function**

After changes, deploy `fetch-shopify-orders` to ensure the latest code is active.

### Key Code Changes

```typescript
// fetch-shopify-orders/index.ts — top of handler
console.log("[fetch-shopify-orders] Handler invoked");

// Fix auth: use getUser() without args (session from Authorization header)
const { data: { user }, error: userError } = await supabase.auth.getUser();
console.log("[fetch-shopify-orders] Auth result:", user?.id, userError?.message);

// After req.json()
console.log("[fetch-shopify-orders] Body:", { shopDomain, dateFrom, dateTo, limit: effectiveLimit });

// Global catch — add logging
} catch (err) {
  console.error("[fetch-shopify-orders] FATAL:", err);
  return new Response(...);
}
```

### Expected Outcome
After redeployment, clicking "Sync now" will either:
- Successfully fetch orders from Shopify and persist them to `shopify_orders`, then trigger channel scan
- Produce visible error logs that pinpoint the exact failure (auth, API, upsert, etc.)

