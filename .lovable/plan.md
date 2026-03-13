

# Fix: Correct Architecture Documentation and Amazon Connection Panel Sync Order

## What the copilot found

Two accurate observations about our ARCHITECTURE.md claims:

1. **Amazon Connection Panel runs fetch-then-audit** — The `AmazonConnectionPanel.tsx` fires `fetch-amazon-settlements` first, then the `onSettlementsAutoFetched` callback in `AccountingDashboard.tsx` runs `sync-xero-status` afterward. This reverses the Xero-first order.

2. **Amazon cron fetch already fixed** — The copilot referenced old code. Our `fetch-amazon-settlements` lines 431-433 already use `sync_from` for `createdSince`. This was fixed in a previous session. However, the skip-logic on lines ~470 still exists as a secondary filter — which is fine as defense-in-depth.

## Changes

### 1. Fix AmazonConnectionPanel sync order

**File:** `src/components/admin/accounting/AmazonConnectionPanel.tsx`

Change `handleFetchNow` to run Xero audit first, read the boundary, then pass `sync_from` to the Amazon fetch:

```
handleFetchNow:
  1. invoke('sync-xero-status', { userId })
  2. read xero_oldest_outstanding_date from app_settings
  3. invoke('fetch-amazon-settlements', { 'x-action': 'sync', sync_from: boundary })
  4. onSettlementsAutoFetched() — now just reloads settlements + runs bank match
```

The `onSettlementsAutoFetched` callback in AccountingDashboard.tsx should be simplified to remove the redundant `sync-xero-status` call (it already ran).

### 2. Update ARCHITECTURE.md

Correct section 3.2 to be precise:

- **Scheduled sync (cron):** Xero-first, fully bounded — correct
- **UI manual sync (PostSetupBanner):** Xero-first, fully bounded — correct (fixed in previous session)
- **Amazon Connection Panel:** Now Xero-first after this fix
- Note: `createdSince` uses `sync_from` when provided, falls back to 90-day window for initial connects (no Xero data yet)

### Files to modify

| File | Change |
|---|---|
| `src/components/admin/accounting/AmazonConnectionPanel.tsx` | Run Xero audit before Amazon fetch in `handleFetchNow` |
| `src/components/admin/accounting/AccountingDashboard.tsx` | Simplify `onSettlementsAutoFetched` callback — remove redundant Xero audit |
| `ARCHITECTURE.md` | Correct section 3.2 to reflect per-flow accuracy |

