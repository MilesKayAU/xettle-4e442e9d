
Goal: make Outstanding a true Xero-first source of truth, then drive Amazon/Shopify sync windows from that truth.

What I found (root causes)
1) Live network evidence shows no Xero token in the app session:
   - `GET /rest/v1/xero_tokens?select=id&limit=1` returns `[]`.
   - `sync-xero-status` returns `{ success:false, error:"No Xero connection found" }`.
   This means Outstanding currently cannot read Xero invoices for that user session.
2) UX bug: the app can still look “connected” due flag-based UI logic:
   - `DashboardConnectionStrip` treats `setup_phase1_xero` / `xero_scan_completed` as connected even when token is missing.
3) Outstanding flow bug:
   - `OutstandingTab.fetchOutstanding()` ignores `syncResp.data.success === false` from `sync-xero-status`.
   - `fetch-outstanding` returns an empty “all clear” payload when no token exists, which masks connection failure.
4) Priority logic gap:
   - `scheduled-sync` computes `sync_from` from local settlements only, not from oldest Xero awaiting-payment invoice.
   - `sync-xero-status` outstanding pre-seed runs only in specific branch (`uncachedSettlements.length === 0`), so discovery can be skipped in real scenarios.

Implementation plan
1) Enforce “real connection” as token-based everywhere
- Update UI connection logic to require token presence for connected state (flags can indicate “scan completed”, not “connected”).
- Files:
  - `src/components/dashboard/DashboardConnectionStrip.tsx`
  - `src/components/shared/ConnectionStatusBar.tsx` (keep token-based, ensure no fallback flags)
  - `src/components/dashboard/PostSetupBanner.tsx` (if flags exist but token missing, show reconnect state)

2) Make Outstanding fail-safe and explicit (never false “All clear”)
- `fetch-outstanding`:
  - When no token: return structured `sync_info.no_xero_connection=true` and `status='no_connection'` (still HTTP 200 to avoid crashes).
  - Keep rows empty, but never represent this as “no invoices”.
- `OutstandingTab`:
  - Treat `syncResp.data.success === false` as actionable error state.
  - Read `sync_info.no_xero_connection` and render reconnect banner/empty state (not “All clear”).
  - Handle 401 gracefully with “session expired / re-auth needed” banner instead of generic failure.
- Files:
  - `supabase/functions/fetch-outstanding/index.ts`
  - `src/components/dashboard/OutstandingTab.tsx`

3) Make Xero outstanding discovery always run first (true priority)
- `sync-xero-status`:
  - Always run a lightweight outstanding pass (AUTHORISED/DRAFT/SUBMITTED ACCREC), not only when `uncachedSettlements.length===0`.
  - Persist oldest outstanding invoice date in `app_settings` (e.g. `xero_oldest_outstanding_date_<tenant>`).
  - Continue pre-seeding `xero_accounting_matches` for missing settlements every run.
- Also normalize and log discovered refs to improve traceability.
- File:
  - `supabase/functions/sync-xero-status/index.ts`

4) Drive Amazon/Shopify date windows from Xero outstanding first
- `scheduled-sync` step 3:
  - Compute `sync_from` priority:
    1) oldest Xero outstanding date (minus safety buffer),
    2) fallback to oldest unreconciled settlement date,
    3) fallback default (2 months).
- Keep existing rate-limit guards.
- File:
  - `supabase/functions/scheduled-sync/index.ts`

5) Close matching pipeline gaps
- Add Shopify pre-seed auto-link parity (already present for Amazon):
  - On payout import, check `xero_accounting_matches` and auto-link settlement status/xero ids immediately.
- File:
  - `supabase/functions/fetch-shopify-payouts/index.ts`

Technical details
```text
Current (problem):
Outstanding page -> maybe run sync-xero-status -> ignores success:false
               -> fetch-outstanding no-token => empty payload
               -> UI shows "All clear" (false)

Target:
Outstanding page -> verify token-backed Xero connection
               -> run lightweight Xero outstanding discovery
               -> pre-seed match cache + store oldest outstanding date
               -> fetch-outstanding reads live/cache + explicit sync_info states
               -> UI shows rows OR explicit "Reconnect Xero"/"Rate limited" states
               -> scheduled-sync sync_from derives from Xero outstanding first
```

Validation plan (must pass before marking done)
1) Connection truth test
- With no token: header/status must show “not connected”; Outstanding must show reconnect state (not all clear).
2) Xero priority test
- With 21 Awaiting Payment invoices in Xero (as screenshot): `sync-xero-status` must report seeded/discovered > 0.
3) Outstanding parity test
- Outstanding count equals Xero Awaiting Payment count (or clearly annotated exclusions with reason).
4) Smart window test
- `scheduled-sync` logs show `sync_from` anchored to oldest outstanding Xero invoice date.
5) Auto-link test
- After Amazon/Shopify fetch, newly imported matching settlements are immediately linked to pre-seeded Xero invoices.
6) Rate-limit resilience test
- 429 returns soft-success UI state (no blank screen), retries continue, cached data shown when available.

Scope of files to change
- `src/components/dashboard/OutstandingTab.tsx`
- `src/components/dashboard/DashboardConnectionStrip.tsx`
- `src/components/dashboard/PostSetupBanner.tsx`
- `supabase/functions/fetch-outstanding/index.ts`
- `supabase/functions/sync-xero-status/index.ts`
- `supabase/functions/scheduled-sync/index.ts`
- `supabase/functions/fetch-shopify-payouts/index.ts`

This plan directly addresses the failure mode you’re seeing and makes Xero outstanding invoices the hard priority signal for downstream Amazon/Shopify sync windows.
