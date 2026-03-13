

# Surface Bank Sync Diagnostics in Outstanding UI

## Problem
1. When bank sync returns `skip_reason: 'no_mapping'`, the UI shows a misleading "Bank feed recently synced — using cache" toast instead of the actual mapping error message.
2. Bank sync diagnostics (mapped account IDs, row count, lookback days, cooldown, rate limit) are only visible in console logs and toasts — not persisted on screen for debugging.

## Changes

### 1. Fix no-mapping toast in `OutstandingTab.tsx`

In `syncBankFeedAndRefresh`, add a dedicated handler for `skip_reason === 'no_mapping'` **before** the generic `skipped` handler:

```typescript
if (resp.data?.skipped && resp.data?.skip_reason === 'no_mapping') {
  toast.warning('No destination account mapped. Go to Settings → Payout Mapping to configure.', { id: 'bank-feed-sync', duration: 10000 });
  await fetchOutstanding({ runSync: false });
  return;
}
```

### 2. Store last bank sync response for diagnostic display

Add state: `const [lastBankSyncResult, setLastBankSyncResult] = useState<any>(null);`

After every bank sync call (success, skip, rate-limit), save `resp.data` to this state.

### 3. Add collapsible diagnostic panel below the bank feed banners

Render a small collapsible section (default collapsed) titled "Bank sync diagnostics" that shows:

| Field | Source |
|-------|--------|
| Mapped account IDs | `lastBankSyncResult.mapped_account_ids` |
| Mapped account count | `lastBankSyncResult.mapped_account_ids_count` |
| Synced rows | `lastBankSyncResult.synced_row_count` |
| Lookback days | `lastBankSyncResult.lookback_days` |
| Cooldown active? | `lastBankSyncResult.cooldown_until` |
| Rate limited? | `lastBankSyncResult.xero_rate_limited` |
| Has mapping? | `lastBankSyncResult.has_any_mapping` |
| Skip reason | `lastBankSyncResult.skip_reason` |
| Refreshed at | `lastBankSyncResult.refreshed_at` |

Only shown after the first bank sync attempt in the current session. Uses a `Collapsible` component with a small toggle link like "Show sync details".

### File changed
- `src/components/dashboard/OutstandingTab.tsx` — all changes here

No backend changes needed — the edge function already returns all required diagnostics.

