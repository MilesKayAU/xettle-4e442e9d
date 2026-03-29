

## Fix Valid CleanVibes Findings (Round 2)

### Finding 1: Move AuthProvider to App root
**File:** `src/App.tsx`, `src/components/AuthenticatedLayout.tsx`

The `AuthProvider` currently only wraps authenticated routes. Moving it to `App.tsx` (wrapping all routes) means any component anywhere can use `useAuth()` without independent `getUser()` calls. Remove the `AuthProvider` wrapper from `AuthenticatedLayout.tsx`.

### Finding 2: Add isMounted guard to MarketplaceAlertsBanner
**File:** `src/components/MarketplaceAlertsBanner.tsx`

Add `let isMounted = true` + cleanup return in the `useEffect` to prevent state updates after unmount.

### Finding 7: Add AbortController to SettlementsSummaryStrip
**File:** `src/components/admin/accounting/SettlementsSummaryStrip.tsx`

Add an `AbortController` in the `useEffect` so rapid month changes cancel stale requests. Use Supabase's `.abortSignal(signal)` method.

---

### Not fixing (with rationale)

- **Finding 3 (DashboardConnectionStrip)**: The parallel queries are valid — they don't cause lock contention. The `Promise.all` pattern is correct and doesn't need an RPC. The component already has a session guard.
- **Findings 4 & 5 (pdfjs-dist / xlsx)**: Major version upgrades with breaking APIs. Neither causes the lock errors. Previously assessed as skip.
- **Finding 6 (NextExpectedSettlements)**: The date estimation is intentionally approximate for a UI hint. Not a bug — it's a design choice. The lock error cited as "runtime evidence" is unrelated.

### Summary: 3 files modified

| File | Change |
|------|--------|
| `src/App.tsx` | Wrap routes in `AuthProvider` |
| `src/components/AuthenticatedLayout.tsx` | Remove `AuthProvider` wrapper |
| `src/components/MarketplaceAlertsBanner.tsx` | Add `isMounted` cleanup |
| `src/components/admin/accounting/SettlementsSummaryStrip.tsx` | Add `AbortController` cancellation |

