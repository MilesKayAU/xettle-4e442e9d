

## Problem

Marketplaces like Catch that no longer operate in Australia still generate validation rows, "Upload Needed" prompts, and status alerts. Users need a way to **pause/hide** a marketplace connection without deleting it (preserving historical data).

## Approach: "Paused" Connection Status

The system already filters connections using `ACTIVE_CONNECTION_STATUSES = ['active', 'connected']`. Adding a `paused` status to `marketplace_connections.connection_status` is the cleanest solution — all existing queries that filter by `ACTIVE_CONNECTION_STATUSES` will automatically exclude paused marketplaces from:

- Validation sweep period generation (edge function)
- Dashboard task counts
- Channel alerts banner
- Account mapping UI
- Destination mapper

### User-Facing UX

Add a **Pause/Resume toggle** to the marketplace connections list on the Settings or Dashboard page. When paused:
- The marketplace won't generate new validation rows in the sweep
- Existing validation rows for paused marketplaces are hidden from the Overview grid
- No "Upload Needed" or "Sync Needed" prompts appear
- Historical settlements and pushed Xero invoices remain intact
- A small "Paused channels" section or filter lets users see and re-activate them

### Changes

1. **`supabase/functions/run-validation-sweep/index.ts`** — When querying `marketplace_connections` to build the list of active marketplaces, already filters by `ACTIVE_CONNECTION_STATUSES`. Paused connections will be excluded automatically. Additionally, skip generating new validation rows for marketplace codes that have no active connection.

2. **`src/components/onboarding/ValidationSweep.tsx`** — Filter out rows where `marketplace_code` belongs to a paused connection. Add a small "N paused" indicator so users know hidden channels exist.

3. **`src/components/dashboard/DashboardConnectionStrip.tsx`** or equivalent settings UI — Add a pause/resume button per marketplace connection. This updates `connection_status` to `'paused'` or back to `'active'`.

4. **`src/hooks/useDashboardTaskCounts.ts`** — Already filters by `ACTIVE_CONNECTION_STATUSES`, so paused channels are automatically excluded from task counts.

5. **`src/constants/connection-status.ts`** — No change needed. `ACTIVE_CONNECTION_STATUSES` stays as `['active', 'connected']`, which naturally excludes `'paused'`.

6. **DB migration** — None required. The `connection_status` column is a plain `text` field, not an enum. `'paused'` is valid without schema changes.

### Technical Details

- No schema migration needed — `connection_status` is already a free-text column
- The validation sweep edge function queries `marketplace_connections` with `ACTIVE_CONNECTION_STATUSES` filter, so paused marketplaces won't generate new period rows
- All 6 consumer sites of `ACTIVE_CONNECTION_STATUSES` already exclude non-active statuses
- Historical data (settlements, validation rows, Xero invoices) is preserved — only new generation and UI visibility are affected
- Users can unpause at any time to resume tracking

