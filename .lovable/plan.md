

## Beta Marketplace Support for JB Hi-Fi & Baby Bunting

### Summary
Add JB Hi-Fi and Baby Bunting as beta-selectable Mirakl marketplaces, with a structured issue reporting flow so beta users can help validate the generic rail.

### Changes

**1. Database migration — `mirakl_issue_reports` table**
- Columns: `id` (uuid PK), `user_id` (uuid, references auth.users), `marketplace_label` (text), `base_url` (text), `error_message` (text), `event_log` (jsonb), `resolved` (boolean default false), `created_at` (timestamptz default now())
- RLS: authenticated users can INSERT their own rows; admin (via `is_primary_admin()`) can SELECT all and UPDATE `resolved`

**2. Edge function — `report-mirakl-issue/index.ts`**
- Accepts POST with: `marketplace_label`, `base_url`, `error_message`
- Server-side: redacts API key from base_url, fetches last 10 `system_events` for the user filtered by marketplace, inserts into `mirakl_issue_reports`
- Uses shared auth-guard for JWT validation

**3. Update `MiraklConnectionPanel.tsx`**
- Replace hardcoded Bunnings-only state with a marketplace selector dropdown:
  - Bunnings (stable)
  - JB Hi-Fi (beta badge)
  - Baby Bunting (beta badge)
  - Other Mirakl (manual entry)
- Pre-fill `baseUrl` for Bunnings; show placeholder hints for JB Hi-Fi / Baby Bunting / Other
- When a beta marketplace is selected, show info banner about beta testing
- After any failed connect or fetch, show a "Report Issue" button that invokes `report-mirakl-issue`
- Pass selected `marketplace_label` and resolved `marketplace_code` (e.g. `jbhifi`, `babybunting`) through to `mirakl-auth` connect call

**4. Update `mirakl-auth/index.ts`**
- Accept dynamic `marketplace_code` from the body (default to `bunnings` for backwards compat)
- Use it when upserting `marketplace_connections` and `mirakl_tokens`

**5. Update `fetch-mirakl-settlements/index.ts`**
- Already reads marketplace code from `mirakl_tokens` — no change needed as long as `mirakl-auth` stores the correct code

**6. Add marketplace labels**
- Add `jbhifi: 'JB Hi-Fi'` and `babybunting: 'Baby Bunting'` to `marketplace-labels.ts`
- Add registry entries for both in `marketplace-registry.ts`

**7. Admin panel — `MiraklBetaFeedback` component**
- New component shown in Admin page (gated by `is_primary_admin`)
- Lists all `mirakl_issue_reports` rows: marketplace, error, timestamp, user email
- "Mark Resolved" button toggles `resolved` column
- Filter by resolved/unresolved

### What stays untouched
- Existing Bunnings connection logic and settlement fetch
- Settlement schema, Xero sync, Amazon/eBay connectors
- Dual-auth logic, source enum values

### File list
| File | Action |
|------|--------|
| `supabase/migrations/new` | Create `mirakl_issue_reports` table + RLS |
| `supabase/functions/report-mirakl-issue/index.ts` | New edge function |
| `supabase/functions/mirakl-auth/index.ts` | Accept dynamic marketplace_code |
| `src/components/admin/accounting/MiraklConnectionPanel.tsx` | Marketplace selector, beta badges, report issue button |
| `src/components/admin/MiraklBetaFeedback.tsx` | New admin panel |
| `src/pages/Admin.tsx` | Mount MiraklBetaFeedback |
| `src/utils/marketplace-labels.ts` | Add jbhifi, babybunting |
| `src/utils/marketplace-registry.ts` | Add registry entries |
| `supabase/config.toml` | Add report-mirakl-issue verify_jwt = false |

