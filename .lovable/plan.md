

## Fix Xero Connection Popup on Back Navigation

### Problem

When you reconnect Xero and then navigate around the dashboard, pressing the browser back button can land you back on `/xero/callback?code=...`. The `useEffect` fires again, attempts to re-use the already-consumed OAuth authorization code, and Xero returns `invalid_grant` — showing an error popup ("Connection Failed").

The edge function logs confirm this: two `invalid_grant` errors from `xero-auth` at 06:00:51 and 06:01:38, both attempting code exchange.

### Root Cause

`XeroCallback.tsx` has no guard against re-processing a consumed code. It fires the edge function on every mount/re-render when search params contain `code=`.

### Fix

**1. XeroCallback.tsx — Prevent re-processing consumed codes**

- Add a `useRef` processing guard so the callback only fires once per mount
- After successful processing, use `navigate('/dashboard?connected=xero', { replace: true })` to **replace** the callback URL in browser history (already partially done for the auto-redirect, but the manual button also needs it)
- Store the consumed code in `sessionStorage` and skip re-processing if the same code is seen again
- On the error fallback "Back to Dashboard" button, also use `{ replace: true }` so back-arrow doesn't loop

**2. XeroCallback.tsx — Replace history entry on mount**

- Immediately call `window.history.replaceState` to strip the `code` param from the URL on first load, preventing back-button re-entry with stale params

### Technical Details

```text
Current flow:
  /dashboard → Xero OAuth → /xero/callback?code=ABC → /dashboard?connected=xero
  Back button → /xero/callback?code=ABC → tries code ABC again → invalid_grant error popup

Fixed flow:
  /dashboard → Xero OAuth → /xero/callback?code=ABC (replaced in history) → /dashboard?connected=xero
  Back button → /dashboard (skips callback entirely)
```

Changes:
- `src/pages/XeroCallback.tsx`: Add processing ref guard, store consumed code in sessionStorage, use `replace: true` on all navigations, replace history state after processing

### Scope

Single file change: `src/pages/XeroCallback.tsx`. No database changes needed.

