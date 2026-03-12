

# Fix 76b — CoA Intelligence & Fast Channel Detection

## Summary
After connecting Xero, Xettle reads the user's Chart of Accounts, detects likely marketplaces and payment providers from account names, and pre-creates suggested channel connections. The user confirms which are real. Onboarding drops from minutes to seconds.

## Step 1: Migration

**New table: `xero_chart_of_accounts`** — caches user's CoA for detection and mapping.

```sql
CREATE TABLE xero_chart_of_accounts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  xero_account_id text,
  account_code text,
  account_name text NOT NULL,
  account_type text,
  tax_type text,
  description text,
  is_active boolean DEFAULT true,
  synced_at timestamptz DEFAULT now(),
  UNIQUE(user_id, xero_account_id)
);
-- RLS: users manage own rows
```

**Alter `marketplace_connections`** — add `suggested_at` column:

```sql
ALTER TABLE marketplace_connections
  ADD COLUMN suggested_at timestamptz;
```

No new constraint needed — `UNIQUE(user_id, marketplace_code)` already exists (confirmed by `onConflict` usage in `marketplace-token-map.ts` line 74).

## Step 2: New file — `src/utils/coa-intelligence.ts` (~150 lines)

Pure client-side module. Contains:

- **`XETTLE_COA_RULES`** constant (read-only enforcement)
- **`analyseCoA()`** function:
  - Input: `xero_chart_of_accounts[]` rows + `marketplace_registry[]` rows + `payment_processor_registry[]` rows
  - Normalizes account names: `toLowerCase().replace(/[^a-z0-9 ]/g, '')`
  - Matches against `marketplace_registry.detection_keywords` and `payment_processor_registry.detection_keywords` (uses existing DB tables, not hardcoded lists)
  - Confidence scoring: HIGH (direct marketplace name match), MEDIUM (related keyword like "FBA"), LOW (generic like "Online Sales")
  - Only HIGH confidence → auto-suggest channel. MEDIUM → show in "possible" section. LOW → ignore.
  - Output: `{ channels: ChannelSuggestion[], payment_providers: ProviderSuggestion[], mapping_suggestions: MappingSuggestion[] }`

Mapping suggestions pair detected accounts with categories (sales, fees, refunds, etc.) for later use by Fix 76a wizard.

## Step 3: Update `ai-account-mapper` edge function

After fetching Xero accounts (line 115), add ~20 lines to **cache CoA in `xero_chart_of_accounts`**:
- Upsert all active accounts for this user
- Mark accounts not in current fetch as `is_active = false` (soft-delete, not hard-delete — protects against partial Xero API responses)
- Hard-delete only accounts that have been `is_active = false` for 2+ consecutive syncs

## Step 4: Update `XeroCallback.tsx`

After the existing `ai-account-mapper` auto-trigger (line 74-86), add a second step:
1. Wait for `ai-account-mapper` to complete (it now caches CoA)
2. Fetch `xero_chart_of_accounts`, `marketplace_registry`, and `payment_processor_registry` from DB
3. Run `analyseCoA()` client-side
4. For each HIGH confidence channel, upsert into `marketplace_connections`:
   - `connection_type: 'coa_detected'`
   - `connection_status: 'suggested'`
   - `suggested_at: now()`
   - `settings: { detected_from: 'coa', detected_account: 'Amazon Sales' }`
   - Uses existing `onConflict: 'user_id,marketplace_code'` — **never downgrades active to suggested** (WHERE clause)
5. Cache detection results in `app_settings` key `coa_detection_results` with timestamp to skip re-detection within 24 hours

## Step 5: Update ghost cleanup in `marketplace-token-map.ts`

Line 121 — add `coa_detected` to skip list:
```typescript
if (conn.connection_type === 'manual' || conn.connection_type === 'coa_detected') continue;
```

## Step 6: New component — `src/components/dashboard/CoaDetectedPanel.tsx` (~130 lines)

Shows when `marketplace_connections` has rows with `connection_status === 'suggested'`.

UI per detected channel:
- Channel name + "Detected from: [account name]" (read from `settings.detected_account`)
- Actions: **[Connect API]** / **[Upload Settlement]** / **[Not selling here]**
- Connect API → navigates to Setup for that marketplace
- Upload Settlement → sets `connection_status: 'active'`, `connection_type: 'manual'`
- Not selling here → deletes the `marketplace_connections` row

Payment providers shown separately with **[Noted]** / **[Dismiss]** actions.

## Step 7: Filter suggested channels from dashboard

**`Dashboard.tsx` (line ~300)**: Filter `marketplace_connections` query to pass only `connection_status !== 'suggested'` rows to `MarketplaceSwitcher`.

**`MarketplaceSwitcher.tsx`**: No change needed — receives filtered data from parent.

**Analytics queries**: No change needed — they query `settlements` table directly, not `marketplace_connections`.

## Files Created
| File | Purpose |
|------|---------|
| `src/utils/coa-intelligence.ts` | CoA analysis + `XETTLE_COA_RULES` constant |
| `src/components/dashboard/CoaDetectedPanel.tsx` | UI for confirming/dismissing detected channels |
| Migration | `xero_chart_of_accounts` table + `suggested_at` column |

## Files Modified
| File | Change |
|------|--------|
| `supabase/functions/ai-account-mapper/index.ts` | Cache CoA in DB after fetch (~20 lines after line 115) |
| `src/pages/XeroCallback.tsx` | Run CoA intelligence after mapper completes (~30 lines after line 86) |
| `src/utils/marketplace-token-map.ts` | Skip `coa_detected` in ghost cleanup (line 121) |
| `src/pages/Dashboard.tsx` | Filter suggested channels + render `CoaDetectedPanel` (line ~300) |

## Safety Rules Enforced
- Xettle never creates/modifies/deletes Xero accounts
- Never auto-activates channels — user must confirm
- Never downgrades active connections to suggested
- Soft-delete stale CoA cache entries (protects against partial API responses)
- Detection results cached 24h to prevent unnecessary re-scans
- Uses `marketplace_registry` + `payment_processor_registry` for detection keywords (existing DB tables)

