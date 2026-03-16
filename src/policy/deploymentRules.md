# Xettle Deployment Rules

## Architecture

- **Dev project**: All development, testing, and iteration
- **Prod project**: Production-only, receives promoted changes
- Both projects have independent Lovable Cloud backends (DB, edge functions, secrets)

## What Deploys Automatically (No Publish Required)

- Edge functions — deploy immediately on code change
- DB migrations — apply immediately after approval
- Secrets — take effect immediately

## What Requires Manual Publish

- Frontend SPA build — click "Update" in publish dialog

## Pre-Promotion Checklist (Before Pushing to Prod)

- [ ] All 215+ unit tests pass (`vitest`)
- [ ] CORS guardrails test passes (no wildcard origins)
- [ ] Canonical actions test passes (no direct Supabase calls in UI)
- [ ] Edge function compile check passes
- [ ] Push preview test passes (Xero posting logic)
- [ ] Reconciliation engine test passes
- [ ] Manual smoke test in dev preview (upload → parse → push flow)
- [ ] No `console.log` in edge functions (use `logger` from `_shared/logger.ts`)
- [ ] Migration SQL reviewed — no destructive changes without data check

## Promotion Workflow: Dev → Prod

1. Verify all tests pass in dev
2. Commit to GitHub (dev branch)
3. Create PR: dev → prod branch
4. Review diff — especially edge functions and migrations
5. Merge PR
6. In prod project: sync from GitHub
7. Re-apply any new migrations in prod (review SQL first)
8. Verify prod secrets are correct (never copy dev secrets)
9. Click "Update" in prod publish dialog
10. Smoke test prod: login → dashboard → upload → verify

## Schema Change Rules

- Never drop columns without checking prod data first
- Never rename columns — add new + backfill + deprecate old
- Always use validation triggers, never CHECK constraints with `now()`
- Never modify `auth`, `storage`, `realtime`, or `supabase_functions` schemas
- Always add RLS policies for new tables

## Edge Function Rules

- All functions use `_shared/cors.ts` — no inline CORS headers
- All functions use `_shared/logger.ts` — no bare `console.log/info/warn`
- JWT validation required on all authenticated endpoints
- Service role used only when necessary, always filtered by `user_id`
- Never accept raw SQL or user-provided query strings

## Rollback Procedures

### Frontend Rollback
1. In Lovable chat history, click revert on the last known-good message
2. Click "Update" in publish dialog to push reverted frontend

### Edge Function Rollback
1. Revert in chat history — function redeploys immediately
2. No publish step needed (this is a risk — revert fast)

### Database Rollback
1. No automatic rollback — write a compensating migration
2. For data loss scenarios: restore from backup (contact Lovable support)
3. Prevention: always test migrations in dev first

## CORS Production Origins

```
xettle.app
www.xettle.app
xettle.com.au
www.xettle.com.au
xettle.lovable.app
```

## Secrets That Must Differ Per Environment

- `XERO_CLIENT_ID` / `XERO_CLIENT_SECRET`
- `AMAZON_SP_CLIENT_ID` / `AMAZON_SP_CLIENT_SECRET`
- `SHOPIFY_CLIENT_ID` / `SHOPIFY_CLIENT_SECRET`
- `EBAY_CLIENT_ID` / `EBAY_CERT_ID`
- `CORS_ALLOWED_ORIGINS`
- `SUPABASE_URL` / `SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY` (auto-set per project)
