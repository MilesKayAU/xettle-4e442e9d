

## Email Monitoring Dashboard — Admin Panel

### Overview
Add an "Emails" tab to the existing admin panel that provides visibility into all sent, failed, bounced, and suppressed emails via the `email_send_log` table.

### What gets built

**New component: `src/components/admin/EmailMonitoringDashboard.tsx`**

Contains all six required features:

1. **Time range filter** — Preset buttons (24h, 7d, 30d) plus custom date picker. Default: last 7 days.

2. **Email type filter** — Multi-select dropdown filtering by `template_name` (e.g. "auth_emails", "signup", etc.). Populated dynamically from distinct values in the data.

3. **Status filter** — Filter by status with color-coded badges: green = sent, red = failed/dlq, yellow = suppressed, gray = pending.

4. **Summary stat cards** — Four cards at top: Total Emails, Sent, Failed, Suppressed. All deduplicated by `message_id` to avoid double-counting.

5. **Email log table** — Sortable, paginated table (50 per page) showing: Template, Recipient, Status (badge), Timestamp, Error message (for failed). Deduplicated by `message_id`, showing latest status per email. Default sort: newest first.

6. **Deduplication** — All queries use the pattern of fetching from `email_send_log`, then deduplicating client-side by `message_id` (keeping the latest `created_at` per message).

**Changes to `src/pages/Admin.tsx`**
- Import `EmailMonitoringDashboard`
- Add a new `TabsTrigger` with `Mail` icon labeled "Emails"
- Add corresponding `TabsContent` rendering the dashboard

### No database changes needed
The `email_send_log` table already exists with the correct schema. RLS policies allow authenticated users to read — the admin check is handled by the existing admin guard in the Admin page component.

### Technical notes
- Queries use the Supabase JS client with `.from('email_send_log')` — no raw SQL
- Client-side dedup groups rows by `message_id`, keeps the row with the latest `created_at`
- Pagination via `.range()` on the query, with client-side dedup applied after fetch
- No new dependencies required — uses existing UI components (Card, Table, Badge, Button, Select)

