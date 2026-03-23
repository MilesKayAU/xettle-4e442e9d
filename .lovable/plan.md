

## Fix: File Reconciliation — Block Push for Failed Checks + Add Drill-Down

### Problems Identified

1. **"Check required" settlements can still be pushed to Xero.** The `isSyncable` check on line 610 only looks at `status` (`ingested` / `ready_to_push`) — it never checks `reconciliation_status`. A settlement that fails internal maths can be pushed without any gate.

2. **No way to click into a File Reconciliation row.** The `FileReconciliationStatus` component renders static rows with no interactivity — users can't expand or drill down to see what went wrong.

3. **SettlementsOverview batch push also ignores reconciliation_status.** The "Push All" button on the overview page queries `status = 'ready_to_push'` without filtering out reconciliation failures.

---

### Changes

#### 1. Block Xero push for unreconciled settlements (`GenericMarketplaceDashboard.tsx`)

Update the `isSyncable` logic (line 610) to also require that `reconciliation_status` is either `'reconciled'`, `'matched'`, or `null` (null = no check performed, e.g. API-synced settlements without file-level reconciliation):

```
const reconOk = !s.reconciliation_status || s.reconciliation_status === 'reconciled' || s.reconciliation_status === 'matched';
const isSyncable = !isReconOnly && reconOk && (s.status === 'ingested' || s.status === 'ready_to_push');
```

For settlements that fail recon, show a warning badge instead of the Push button — e.g. "Fix reconciliation first".

#### 2. Make File Reconciliation rows clickable (`FileReconciliationStatus.tsx`)

- Accept an `onSettlementClick?: (settlementId: string) => void` prop
- Wrap each row in a clickable button/div that calls `onSettlementClick(settlement_id)`
- Add a visual cue (chevron icon or "View details" text) so users know they can click
- In `GenericMarketplaceDashboard`, wire this to the existing `loadLineItems` function (which expands the transaction drilldown) or open the `SettlementDetailDrawer`

#### 3. Filter reconciliation failures from batch push (`SettlementsOverview.tsx`)

In `handlePushAll` (line 168), add a filter to exclude settlements with failed reconciliation:

```sql
.in('reconciliation_status', ['reconciled', 'matched'])
-- or use .or('reconciliation_status.is.null,reconciliation_status.in.(reconciled,matched)')
```

This prevents batch pushes from including settlements that need review.

#### 4. Add a recon-failure explanation to the row

When a settlement has `reconciliation_status = 'warning'` or `'alert'`, show a small inline message like: "Sales − Fees ≠ Net — review line items before pushing" instead of just "check required".

---

### Files Modified

1. **`src/components/admin/accounting/GenericMarketplaceDashboard.tsx`** — add recon gate to `isSyncable`, show warning on failed-recon rows
2. **`src/components/shared/FileReconciliationStatus.tsx`** — add `onSettlementClick` prop, make rows interactive
3. **`src/components/admin/accounting/SettlementsOverview.tsx`** — filter recon failures from batch push query

### Result
- Settlements with "check required" will no longer show a Push button — they must be reviewed first
- Users can click any File Reconciliation row to drill into line items and investigate
- Batch "Push All" on the overview page skips reconciliation failures automatically
- Clear messaging tells users why a settlement is blocked and what to do

