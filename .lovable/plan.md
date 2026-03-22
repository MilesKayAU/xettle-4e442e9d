

## Investigation Summary

The MCF order was **never actually created**. The `mcf_orders` table is completely empty. Two bugs found:

### Bug 1 — CORS failure in `create-mcf-order` (critical)
The function calls `getCorsHeaders()` without passing the request origin (line 7). This returns empty headers `{}`, so the browser blocks every response as a CORS violation. The UI likely caught a network error but displayed a misleading "success" toast.

In contrast, `poll-mcf-status` correctly passes origin: `getCorsHeaders(origin)`.

**Fix**: Update `create-mcf-order/index.ts` to read `origin` from request headers and pass it to `getCorsHeaders()`, matching the pattern used in `poll-mcf-status`.

### Bug 2 — Wrong environment variable names for Amazon OAuth (both functions)
Both `create-mcf-order` and `poll-mcf-status` reference `AMAZON_CLIENT_ID` and `AMAZON_CLIENT_SECRET`, but the actual secrets are named `AMAZON_SP_CLIENT_ID` and `AMAZON_SP_CLIENT_SECRET`. If the token is expired, the refresh will silently fail.

**Fix**: Update both functions to use `AMAZON_SP_CLIENT_ID` and `AMAZON_SP_CLIENT_SECRET`.

### Files to modify
1. `supabase/functions/create-mcf-order/index.ts` — fix CORS + env var names
2. `supabase/functions/poll-mcf-status/index.ts` — fix env var names

### Technical details
- `getCorsHeaders(origin?)` returns `{}` when no origin is passed, per `_shared/cors.ts` line 48
- Secret names confirmed: `AMAZON_SP_CLIENT_ID`, `AMAZON_SP_CLIENT_SECRET`

