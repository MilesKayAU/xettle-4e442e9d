# Xettle Test Parameters

These URL parameters and env variables are available for testing.
All are disabled on production domain automatically.

## URL Parameters

- `?test_wizard=true` — Shows onboarding wizard regardless of state
- `?test_mode=true` — Bypasses PIN lock (localhost/preview only)

## Environment Variables

- `VITE_TEST_MODE=true` — Bypasses PIN lock at build time (localhost/preview only)

## Security

The PIN bypass is **double-gated** and requires BOTH:

1. `VITE_TEST_MODE=true` or `?test_mode=true` in the URL
2. Hostname is `localhost`, `*.lovable.app`, or `*.lovableproject.com`

### Never works on production

`xettle.app` (or any custom domain) **always enforces PIN lock** regardless of parameters or env variables.

## GitHub Actions Secrets Required

| Secret | Description |
|---|---|
| `PERCY_TOKEN` | From percy.io → Project Settings → Project token |
| `VITE_SUPABASE_URL` | Backend URL (found in Lovable Cloud settings) |
| `VITE_SUPABASE_ANON_KEY` | Publishable key (found in Lovable Cloud settings) |
| `TEST_EMAIL` | Email of a test user account for automated login |
| `TEST_PASSWORD` | Password for that test account |
