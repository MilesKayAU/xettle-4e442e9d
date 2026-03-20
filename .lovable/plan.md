

# Plan: Client Error Monitor + Admin Health Scanner

## What This Builds

A two-part system modeled on how IT teams monitor production apps:

1. **Background Error Capture** — A global error listener that silently logs all client-side JS errors, unhandled promises, and failed network requests to the `system_events` table. Runs on every page load for all users, not just test mode.

2. **Admin Health Scanner** — A "Run Scan" button on the admin panel that triggers the existing `page-scanner` to audit the current page, logs results to `system_events`, and displays a dashboard of open vs resolved issues over time.

3. **Issue Lifecycle** — Each logged issue gets a fingerprint (error message hash). When a scan runs and a previously-seen error no longer appears, it's auto-marked `resolved`. New errors are marked `open`. This lets you see what's been fixed.

## Architecture

```text
┌─────────────────────────────────────────────┐
│  Global Error Listener (all pages)          │
│  - window.onerror, unhandledrejection       │
│  - Failed fetch (4xx/5xx) interception      │
│  - ErrorBoundary catches                    │
│  Batches → system_events (event_type:       │
│    'client_error', severity by type)        │
└─────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│  Admin Health Scanner Dashboard             │
│  - "Run Scan" button → page-scanner         │
│  - Results stored in system_events          │
│  - Fingerprint comparison: open/resolved    │
│  - Table: error, page, first_seen,          │
│    last_seen, status, occurrence_count      │
│  - Auto-resolve when error not seen in      │
│    latest scan                              │
└─────────────────────────────────────────────┘
```

## Files Changed

### New files
- **`src/utils/global-error-capture.ts`** — Installs global listeners (onerror, unhandledrejection, fetch wrapper). Batches errors and writes to `system_events` every 30s or on page unload. Deduplicates by error fingerprint (hash of message + source). Each entry: `event_type: 'client_error'`, `severity: 'error'|'warning'`, `details: { message, stack, page, fingerprint, user_agent }`.

- **`src/components/admin/HealthScannerDashboard.tsx`** — New admin tab. Contains:
  - "Run Scan" button that calls `scanPage()` from existing page-scanner
  - Stores scan results as `event_type: 'health_scan_result'` in system_events
  - Reads all `client_error` and `health_scan_result` events
  - Groups by fingerprint, shows: error message, page, first seen, last seen, occurrence count, status (open/resolved)
  - Auto-resolves: if a fingerprint hasn't appeared in 24h after a scan, marks resolved
  - Filters: open/resolved/all, severity, date range

### Modified files
- **`src/main.tsx`** — Import and call `installGlobalErrorCapture()` on app boot (one line)
- **`src/components/ErrorBoundary.tsx`** — Add `logErrorToSystem()` call in `componentDidCatch` to persist boundary errors to system_events
- **`src/pages/Admin.tsx`** — Add "Health Scanner" tab wired to new dashboard component

## No DB/Edge Function Changes
Uses existing `system_events` table with existing RLS policies. No migrations needed. No new edge functions.

## Issue Lifecycle Logic
- Each error gets a fingerprint: `sha256(error_message + source_file)` truncated to 16 chars
- On "Run Scan": compare current scan issues against last scan's issues
- Issues present in last scan but absent in current scan → `resolved`
- New issues not in previous scan → `open`
- Recurring issues → increment count, update `last_seen`
- Admin can manually mark issues as `resolved` or `ignored`

