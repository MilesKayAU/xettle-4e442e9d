## ✅ Completed: Account Mapper Suggestion Accuracy

Pattern-aware, revenue/expense-partitioned gap-fill is now live. Uses `detectCodePattern()` and `generateCodeFromPattern()` to extend category neighbourhoods.

---

## Next: Xero COA Sync UX — "Create New vs Overwrite" Flow

### Design Decisions (User-Confirmed)
- **Sync modes**: Toggle between "Create New Only" (safe default) and "Overwrite Existing" (opt-in)
- **Risk consent**: PIN + checkbox acknowledgment for overwrite mode
- **Preview**: Full line-by-line table showing each account with status badge (New / Changed / Unchanged)

### UX Flow

1. **User clicks "Sync to Xero"** from the Account Mapper
2. **Preview modal opens** with a full line-by-line table:
   - Each row: Account Code | Account Name | Category | Marketplace | Status Badge
   - Status badges: 🟢 **New** (will be created) | 🟠 **Changed** (code or name differs from Xero) | ⚪ **Unchanged** (already exists, identical)
   - Summary strip at top: "5 new · 2 changed · 18 unchanged"
3. **Mode toggle** (default: "Create New Only"):
   - **Create New Only**: Only 🟢 New rows are actionable. 🟠 Changed rows shown as "Skipped — toggle Overwrite to update"
   - **Overwrite Existing**: 🟠 Changed rows become actionable. Shows amber warning banner: "⚠️ Overwriting will modify existing Xero accounts. This cannot be undone."
4. **Confirmation gate** (when Overwrite enabled):
   - Checkbox: "I understand this will modify existing accounts in my Xero Chart of Accounts"
   - PIN entry (existing `useSettingsPin` hook)
   - Both must be satisfied before "Confirm & Sync" enables
5. **Confirm & Sync** calls `create-xero-accounts` edge function with a `mode` param (`create_only` | `create_and_update`)
6. **Post-sync**: Toast with result summary, auto-refresh COA cache

### Technical Implementation

**Frontend** (new component):
- `src/components/settings/XeroCoaSyncModal.tsx` — the preview + toggle + consent modal
- Uses existing `createXeroAccounts` action, extended with `mode` and `updates` payload
- Compares local `coaSuggestions` against `cachedXeroAccounts` to compute New/Changed/Unchanged

**Backend** (`supabase/functions/create-xero-accounts/index.ts`):
- Add `mode` field to request body: `'create_only'` (default) | `'create_and_update'`
- For `create_and_update`: use Xero Accounts API PUT to update existing accounts
- Log all changes to `system_events` with `event_type: 'coa_sync'` for audit trail
- Never delete accounts — only create or update

**Existing hooks/actions to leverage**:
- `useSettingsPin` for PIN gate
- `createXeroAccounts` action (extend, don't replace)
- `getCachedXeroAccounts` for diff comparison
- `refreshXeroCOA` for post-sync cache refresh

### Safety Invariants
- Default mode is ALWAYS "Create New Only" — overwrite requires explicit opt-in per session
- PIN + checkbox required for every overwrite sync (no "remember" option)
- All overwrite operations logged to `system_events` with before/after values
- Edge function validates `mode` server-side — rejects `create_and_update` without proper auth
