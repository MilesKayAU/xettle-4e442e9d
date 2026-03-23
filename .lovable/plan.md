

## Plan: Site-Wide Marketplace Deactivation & Orphan Filtering

### Problem
1. **Temu** and **Catch** appear in the validation grid despite having no `marketplace_connections` entry — they are orphaned `marketplace_validation` rows
2. The frontend only filters out `paused` codes but not `deactivated` or connectionless marketplaces
3. The server-side sweep correctly queries only `active`/`connected` connections, but stale rows from previous sweeps persist in `marketplace_validation`
4. There is no easy way to turn off unwanted marketplaces — the existing Deactivate dialog is buried in Account Mapper settings

### Changes

#### 1. Frontend: Filter out orphaned & deactivated marketplaces (ValidationSweep.tsx)

Build a set of **active marketplace codes** from `allConnections` (only `active`/`connected` status). In `filteredRows`, exclude any row whose `marketplace_code` is not in this active set — in addition to the existing `paused` filter. This immediately removes Temu, Catch, and any other orphaned rows from all tabs and status counts.

```typescript
const activeCodes = useMemo(() => new Set(
  allConnections
    .filter(c => ['active', 'connected'].includes(c.connection_status))
    .map(c => c.marketplace_code)
), [allConnections]);

// In filteredRows:
let result = rows.filter(r => activeCodes.has(r.marketplace_code) && !pausedCodes.has(r.marketplace_code));
```

Update `statusCounts` to use the same `activeCodes` filter so the summary cards stay consistent.

#### 2. Server-side: Clean orphaned validation rows (run-validation-sweep edge function)

At the end of `sweepUser()`, after processing all active connections, delete `marketplace_validation` rows for the user whose `marketplace_code` is not in the active connections list. This prevents orphans from accumulating.

```typescript
// After the main loop
const activeCodes = new Set(connections.map(c => c.marketplace_code));
const { data: allValidationRows } = await adminSupabase
  .from('marketplace_validation')
  .select('marketplace_code')
  .eq('user_id', userId);

const orphanCodes = [...new Set((allValidationRows || [])
  .map(r => r.marketplace_code)
  .filter(c => !activeCodes.has(c)))];

if (orphanCodes.length > 0) {
  await adminSupabase.from('marketplace_validation')
    .delete()
    .eq('user_id', userId)
    .in('marketplace_code', orphanCodes);
}
```

#### 3. Dashboard task counts: Respect deactivated status (useDashboardTaskCounts.ts)

Already uses `ACTIVE_CONNECTION_STATUSES` — no change needed. Verified correct.

### Result
- Temu, Catch, and any other connectionless marketplaces vanish from all views immediately (frontend filter)
- Next sweep run will permanently clean up orphaned DB rows (server-side cleanup)
- The existing Deactivate dialog in Account Mapper continues to work as the site-wide off switch for marketplaces users want to disable

### Files Modified
1. **`src/components/onboarding/ValidationSweep.tsx`** — Filter rows to active connections only
2. **`supabase/functions/run-validation-sweep/index.ts`** — Delete orphaned validation rows

