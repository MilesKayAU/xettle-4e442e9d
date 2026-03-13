

## Add Clear Diagnostic Fields to Bank Sync Response

### Problem
The current response uses `outcome = rate_limited` for both stored cooldown blocks and live Xero 429 responses, making it impossible to tell which path was taken. Several diagnostic fields are also misleading (e.g., `if_modified_since_used: true` when the header is disabled).

### Analysis of Current Code
The function has three distinct "blocked" paths:
1. **Stored cooldown** (line 179-205): reads `xero_api_cooldown_until` from `app_settings`, returns early without calling Xero
2. **Change detection skip** (line 426-438): per-account skip when cache is fresh — no Xero call
3. **Live 429** (line 471-520): actual Xero API returns 429, sets new cooldown, returns

Currently `cooldown_applied` exists but `live_xero_call_attempted` and `live_xero_429_received` do not. The `if_modified_since_used` field is hardcoded `true` even though the header is commented out.

### Changes

**File: `supabase/functions/fetch-xero-bank-transactions/index.ts`**

1. **Stored cooldown return** (line ~186): add `live_xero_call_attempted: false`, `live_xero_429_received: false`, `recent_success_guard_applied: false`, `xero_api_cooldown_until: cooldownUntilStored`

2. **Live 429 return** (line ~489): add `live_xero_call_attempted: true`, `live_xero_429_received: true`, `recent_success_guard_applied: false`, `xero_api_cooldown_until: newCooldownUntil`

3. **All-accounts-skipped-by-change-detection return** (line ~660): add `live_xero_call_attempted: false`, `live_xero_429_received: false`, `recent_success_guard_applied: true`, `xero_api_cooldown_until: null`

4. **Success return** (line ~738): add `live_xero_call_attempted: performedRealXeroFetch`, `live_xero_429_received: false`, `recent_success_guard_applied: accountsSkippedByChangeDetection > 0`, `xero_api_cooldown_until: null`

5. **No-mapping return** (line ~307): add `live_xero_call_attempted: false`, `live_xero_429_received: false`, `recent_success_guard_applied: false`, `xero_api_cooldown_until: null`

6. **Token-failed return** (line ~233): add same three fields as false/null

7. **Fix `if_modified_since_used`** — set to `false` on all paths since the header is currently disabled

8. **Deploy** the updated edge function

### No database changes needed
All fields are response-only diagnostics.

