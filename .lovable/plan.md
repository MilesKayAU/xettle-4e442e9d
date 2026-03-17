

# Runbook: Bootstrap xettle-prod from Scratch

This runbook assumes **this project is DEV** and a brand-new Lovable project will be created as **PROD**, with `xettle.app` as the canonical production domain.

---

## Phase 1 — Create the Prod Project

1. Create a new Lovable project (e.g. "xettle-prod")
2. Enable Lovable Cloud on the new project (this provisions an isolated database, auth, edge functions, storage, and secrets)
3. Connect the same GitHub repo to the prod project, pointed at a `prod` or `main` branch

---

## Phase 2 — Database Bootstrap (176 Migrations)

The dev project has 176 migrations in `supabase/migrations/`. These must be applied to prod in order.

**Steps:**
1. In the prod project, sync code from the `prod` GitHub branch (which contains all migration files)
2. Lovable Cloud will detect unapplied migrations and prompt for approval
3. Review each migration batch before approving — watch for:
   - Any `DROP COLUMN` / `DROP TABLE` statements (should be none on fresh DB)
   - Any references to dev-specific data or IDs
4. Approve migrations in chronological order
5. **Verify** by spot-checking key tables exist: `settlements`, `xero_tokens`, `amazon_tokens`, `shopify_tokens`, `ebay_tokens`, `user_roles`, `app_settings`, `sync_locks`, `marketplace_file_fingerprints`, `xero_accounting_matches`, `system_events`, `sync_history`
6. Verify database functions exist: `has_role`, `acquire_sync_lock`, `release_sync_lock`, `promote_and_save_settlement`, `generate_settlement_fingerprint`, `calculate_validation_status`, `assign_trial_role`
7. Create the `audit-csvs` storage bucket (private) if not auto-created by migrations

---

## Phase 3 — Secrets Checklist

Every secret must be set independently in the prod project. **Never copy dev secret values to prod.**

| Secret | Source | Notes |
|---|---|---|
| `XERO_CLIENT_ID` | Xero Developer Portal — prod app | Must be a separate Xero app from dev |
| `XERO_CLIENT_SECRET` | Xero Developer Portal — prod app | |
| `AMAZON_SP_CLIENT_ID` | Amazon SP API Console — prod app | |
| `AMAZON_SP_CLIENT_SECRET` | Amazon SP API Console — prod app | |
| `SHOPIFY_CLIENT_ID` | Shopify Partners — prod app | |
| `SHOPIFY_CLIENT_SECRET` | Shopify Partners — prod app | |
| `EBAY_CLIENT_ID` | eBay Developer Portal — prod keyset | |
| `EBAY_CERT_ID` | eBay Developer Portal — prod keyset | |
| `EBAY_RUNAME` | eBay Developer Portal — prod RuName | Must point to `xettle.app/ebay/callback` |
| `RESEND_API_KEY` | Resend dashboard | Can share with dev or use separate |
| `ANTHROPIC_API_KEY` | Anthropic console | Can share with dev |
| `CORS_ALLOWED_ORIGINS` | Set manually | `https://xettle.app,https://www.xettle.app,https://xettle.com.au,https://www.xettle.com.au` |
| `CORS_ALLOW_LOCALHOST` | Set to `false` | **Must be false in prod** |

Auto-provisioned (do not set manually): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL`, `SUPABASE_PUBLISHABLE_KEY`, `LOVABLE_API_KEY`

---

## Phase 4 — CORS Configuration

The shared CORS helper (`supabase/functions/_shared/cors.ts`) has hardcoded origins. For the **prod project**, the allowlist must be updated to remove dev-only origins:

```text
Prod CORS allowlist:
  https://xettle.app
  https://www.xettle.app
  https://xettle.com.au
  https://www.xettle.com.au
  https://[prod-project].lovable.app          ← prod published subdomain
  https://id-preview--[prod-project-id].lovable.app  ← prod preview URL
```

**Remove from prod:**
- `http://localhost:5173`
- `http://localhost:3000`
- The dev preview URL (`id-preview--7fd99b7a-...`)

**Implementation:** After syncing code to prod, edit `_shared/cors.ts` in the prod project to replace the dev preview origin with the prod preview origin. This deploys immediately.

---

## Phase 5 — OAuth Redirect Setup

Each marketplace OAuth flow has hardcoded redirect URIs. These already point to `xettle.app`, which is correct for prod. Verify each:

| Integration | Redirect URI in Code | Third-Party Console Must Match |
|---|---|---|
| **Xero** | Passed dynamically from frontend (`redirect_uri` param) | Xero app → Redirect URIs: add `https://xettle.app/xero/callback` |
| **Amazon** | Hardcoded: `https://xettle.app/amazon/callback` | Amazon SP API → App URLs: `https://xettle.app/amazon/callback` |
| **Shopify** | Hardcoded: `https://xettle.app/shopify/callback` | Shopify Partners → App setup: `https://xettle.app/shopify/callback` |
| **eBay** | Uses `EBAY_RUNAME` secret | eBay Developer Portal → RuName must resolve to `https://xettle.app/ebay/callback` |

**For dev project**, these hardcoded URIs mean OAuth callbacks only work when accessed via `xettle.app`. If you need dev OAuth testing, you would need to temporarily change these or use the Xero dynamic approach.

---

## Phase 6 — Auto-Push Safety Flag

The `auto-push-xero` edge function checks `app_settings` for the key `automation_xero_auto_push`. It only pushes to Xero when the value is `'true'`.

**Prod safety steps:**
1. Do **not** seed any `automation_xero_auto_push = 'true'` rows in prod
2. Users must explicitly enable auto-push in their settings after connecting Xero
3. The `scheduled-sync` function also checks `auto_push_live_mode` — ensure no prod rows have this set to `'true'` until ready
4. Recommend: after first publish, manually verify no `app_settings` rows exist with these keys before announcing to users

---

## Phase 7 — Domain Setup

1. In the prod Lovable project, go to **Settings → Domains**
2. Add `xettle.app` as a custom domain
3. Add `www.xettle.app` as a second domain entry
4. At your DNS registrar, set:
   - `A` record for `@` → `185.158.133.1`
   - `A` record for `www` → `185.158.133.1`
   - `TXT` record for `_lovable` → value provided by Lovable
5. Set `xettle.app` as the **Primary** domain (www redirects to it)
6. Wait for SSL provisioning (up to 72 hours, usually minutes)
7. Repeat for `xettle.com.au` / `www.xettle.com.au` if needed

---

## Phase 8 — First Publish

1. **Pre-publish checks** (run in dev first, verify code is identical in prod branch):
   - [ ] All 215+ vitest tests pass
   - [ ] CORS guardrails test passes
   - [ ] Canonical actions test passes
   - [ ] Edge function compile check passes
2. **Verify backend is ready:**
   - [ ] All 176 migrations applied successfully
   - [ ] All 14 secrets configured with prod values
   - [ ] `audit-csvs` storage bucket exists
   - [ ] CORS origins in `_shared/cors.ts` are prod-only
3. **Publish:**
   - Click **Publish → Update** in the prod project
   - This deploys the frontend SPA only (edge functions are already live)
4. **Post-publish smoke test:**
   - [ ] `https://xettle.app` loads the landing page
   - [ ] Sign-up flow works (email verification)
   - [ ] Login redirects to dashboard
   - [ ] File upload parses correctly
   - [ ] Xero OAuth connect flow completes
   - [ ] Settlement push preview renders (do NOT push on first test)
   - [ ] No console errors in browser
   - [ ] No CORS errors in network tab

---

## Recommended Workflow Checklist (paste into policy)

```text
## Prod Bootstrap Checklist

### Infrastructure
- [ ] New Lovable project created with Cloud enabled
- [ ] GitHub repo connected (prod branch)
- [ ] All 176 migrations reviewed and applied
- [ ] Storage bucket "audit-csvs" created (private)

### Secrets (all set independently, never copied from dev)
- [ ] XERO_CLIENT_ID (prod Xero app)
- [ ] XERO_CLIENT_SECRET (prod Xero app)
- [ ] AMAZON_SP_CLIENT_ID (prod SP app)
- [ ] AMAZON_SP_CLIENT_SECRET (prod SP app)
- [ ] SHOPIFY_CLIENT_ID (prod Shopify app)
- [ ] SHOPIFY_CLIENT_SECRET (prod Shopify app)
- [ ] EBAY_CLIENT_ID (prod keyset)
- [ ] EBAY_CERT_ID (prod keyset)
- [ ] EBAY_RUNAME (prod RuName → xettle.app/ebay/callback)
- [ ] RESEND_API_KEY
- [ ] ANTHROPIC_API_KEY
- [ ] CORS_ALLOWED_ORIGINS (prod domains only)
- [ ] CORS_ALLOW_LOCALHOST = false

### CORS
- [ ] _shared/cors.ts updated with prod origins only
- [ ] localhost origins removed
- [ ] Dev preview URL removed

### OAuth Redirects (verified in third-party consoles)
- [ ] Xero → https://xettle.app/xero/callback
- [ ] Amazon → https://xettle.app/amazon/callback
- [ ] Shopify → https://xettle.app/shopify/callback
- [ ] eBay → RuName resolves to https://xettle.app/ebay/callback

### Safety
- [ ] No automation_xero_auto_push rows in app_settings
- [ ] No auto_push_live_mode rows in app_settings
- [ ] auto-push-xero edge function verified as gated

### Domains
- [ ] xettle.app A record → 185.158.133.1
- [ ] www.xettle.app A record → 185.158.133.1
- [ ] _lovable TXT record set
- [ ] SSL provisioned and active
- [ ] xettle.app set as Primary domain

### First Publish
- [ ] All tests pass in dev
- [ ] Frontend published via Update dialog
- [ ] Smoke test: landing → signup → login → upload → parse → preview push
- [ ] No CORS errors in network tab
- [ ] No console errors
```

