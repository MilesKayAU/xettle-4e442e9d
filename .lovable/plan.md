

## Audit Remediation Plan

This plan addresses all issues flagged by the Copilot security scan, prioritized by severity.

---

### 1. Remove leaked Supabase config from `index.html`

**Problem**: `index.html` hardcodes a Supabase URL and anon key for a *different* project (`wtxqdzcihxjaiosmffvm`), while the actual project uses `cegwclxbqvitkqxikpss` via Vite env vars. This is stale/wrong config that creates confusion.

**Fix**: Delete the inline `<script>` block (lines 4-12) entirely. The app already reads from `import.meta.env.VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` in `src/integrations/supabase/client.ts`.

---

### 2. Replace wildcard CORS in 4 edge functions

**Problem**: Four functions use `Access-Control-Allow-Origin: *` instead of the centralized `getCorsHeaders()`:
- `admin-email-log/index.ts`
- `auth-email-hook/index.ts`
- `shopify-gdpr/index.ts`
- `shopify-uninstall/index.ts`

**Fix**: Import `getCorsHeaders` from `../_shared/cors.ts` and replace the hardcoded `corsHeaders` object in each. For webhook-only functions (`shopify-gdpr`, `shopify-uninstall`) that receive calls from Shopify (not a browser), CORS headers aren't needed at all — but switching to the shared helper is still cleaner and won't break anything since Shopify doesn't send an `Origin` header.

---

### 3. Move trial expiry/downgrade to server-side

**Problem**: `src/hooks/use-trial-status.ts` (lines 50-54) performs client-side `DELETE` and `UPSERT` on `user_roles`. Even with RLS, role mutations should be server-authoritative.

**Fix**: 
- Create a database function `check_and_expire_trial(p_user_id uuid)` that checks `trial_started_at` from `app_settings` and atomically downgrades `trial` → `free` if expired. Runs as `SECURITY DEFINER`.
- Update the hook to call `supabase.rpc('check_and_expire_trial', { p_user_id: userId })` instead of direct table writes.
- Remove the client-side `delete` + `upsert` calls.

---

### 4. Remove `dangerouslySetInnerHTML` from Landing page

**Problem**: `src/pages/Landing.tsx` line 772 uses `dangerouslySetInnerHTML` for list items. Currently hardcoded strings, but risky pattern.

**Fix**: The items contain `<strong>` tags for emphasis. Replace with a small helper that parses bold markers (e.g. `**text**`) into `<span className="font-semibold">text</span>` React elements, avoiding raw HTML injection entirely. The `chart.tsx` usage is a standard Recharts theming pattern with config-only values — leave as-is but add a comment noting config must not accept user input.

---

### 5. Make CORS allowlist environment-driven

**Problem**: `_shared/cors.ts` hardcodes localhost origins that ship to production.

**Fix**: Read `CORS_ALLOWED_ORIGINS` (already exists as a secret) and `CORS_ALLOW_LOCALHOST` from env. If `CORS_ALLOW_LOCALHOST` is not `"true"`, exclude `localhost:*` origins. Keep the hardcoded production domains as defaults, append env-driven extras.

---

### 6. Standardize edge function auth pattern

**Problem**: Auth checking varies across functions (some use `getUser()`, some `getClaims()`, some query `user_roles` directly, some use `rpc('has_role')`).

**Fix**: Create a shared helper `_shared/auth-guard.ts` with:
```
verifyRequest(req, opts: { requireAdmin?: boolean }) → { userId, isCron }
```
This consolidates JWT verification, cron-secret check, service-role detection, and optional admin role check. Migrate functions incrementally — start with the four CORS-fixed functions above.

---

### Files to change

| File | Action |
|------|--------|
| `index.html` | Remove inline Supabase script |
| `supabase/functions/admin-email-log/index.ts` | Use `getCorsHeaders()` |
| `supabase/functions/auth-email-hook/index.ts` | Use `getCorsHeaders()` |
| `supabase/functions/shopify-gdpr/index.ts` | Use `getCorsHeaders()` |
| `supabase/functions/shopify-uninstall/index.ts` | Use `getCorsHeaders()` |
| `src/hooks/use-trial-status.ts` | Replace client-side role mutation with RPC |
| `src/pages/Landing.tsx` | Remove `dangerouslySetInnerHTML` |
| `supabase/functions/_shared/cors.ts` | Read from env vars |
| `supabase/functions/_shared/auth-guard.ts` | New shared auth helper |
| New migration | Create `check_and_expire_trial` DB function |

