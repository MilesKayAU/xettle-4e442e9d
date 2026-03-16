

# Accountant-Safe Push Rules — Upgrade Plan

## Current State Summary

| Area | Current Behaviour | Risk |
|------|------------------|------|
| Account resolver fallback | `override → base → defaultAccountCode → '400'` | Silent wrong-account posting |
| Per-marketplace completeness | No check; base mappings silently cover gaps | New marketplace uses wrong accounts |
| CoA cache freshness | No CoA = amber (allow push) | Push to deleted/renamed accounts |
| Contact mapping in preview | Amber warning; server hard-blocks | Bad UX — user sees "ok" then gets server error |

## Changes

### 1. Remove hardcoded fallback `400` — return `null`, block push

**Client** (`src/utils/xero-posting-line-items.ts`):
- Change `createAccountCodeResolver` return type to `string | null`
- Final fallback: return `null` instead of `def?.defaultAccountCode || '400'`
- Keep `defaultAccountCode` on category defs for documentation only
- `buildPostingLineItems`: if resolver returns `null`, tag the line with a sentinel `accountCode: 'UNMAPPED'`

**Server** (`supabase/functions/sync-settlement-to-xero/index.ts`):
- Same change to `getCode`: return `null` if no user mapping and no `DEFAULT_ACCOUNT_CODES` entry
- Before Xero API call: if any line has `null` AccountCode, hard-fail with `MAPPING_REQUIRED` error and log to `system_events`

**Preview** (`PushSafetyPreview.tsx`):
- In `buildValidationChecks`: detect `UNMAPPED` account codes → red block with detail listing which categories are unmapped

### 2. Per-marketplace mapping completeness gate

Define required categories (subset of 10):
```
REQUIRED_CATEGORIES = ['Sales', 'Seller Fees', 'Refunds', 'Other Fees', 'Shipping']
```

**Preview** (`PushSafetyPreview.tsx`):
- After resolving line items, check: for the settlement's marketplace, do all required categories have an explicit mapping (not falling back to `null`)?
- If any required category is unmapped → red validation check: "eBay Australia: missing account mapping for Sales, Refunds"

**Server** (`sync-settlement-to-xero`):
- Same check before invoice creation. If required categories unmapped → hard-fail `MAPPING_INCOMPLETE`

### 3. CoA cache freshness requirement

**Preview** (`PushSafetyPreview.tsx`):
- Already queries `xero_chart_of_accounts`. Add: check the `MAX(updated_at)` of cached rows for the user
- If cache is empty or older than 24h:
  - Auto-trigger a CoA refresh by calling `fetch-xero-bank-accounts` (which refreshes CoA)
  - If refresh fails → red block: "Chart of Accounts could not be verified. Reconnect Xero."
  - If refresh succeeds → continue with fresh data

**Server** (`sync-settlement-to-xero`):
- Before invoice creation: query `MAX(updated_at)` from `xero_chart_of_accounts` for the user
- If stale (>24h) or empty → attempt refresh via Xero API inline
- If refresh fails → hard-fail `COA_STALE`

### 4. Contact mapping → red block in preview

**Preview** (`PushSafetyPreview.tsx` line 596-601):
- Change check #4 from `amber` to `red` when `!knownContact`
- Update detail text: "No Xero contact mapping for this marketplace. Add to marketplace contacts before pushing."
- Server guard remains unchanged (already hard-blocks)

### 5. Optional: per-marketplace `use_global_mappings` flag

Store in `marketplace_connections.settings` JSON as `use_global_mappings: boolean` (default `true`).

**Resolver change**: When `use_global_mappings === false` for a marketplace:
- Skip step 2 (base key fallback) in the resolver
- Only allow marketplace-specific keys or return `null`

**UI**: Add toggle in `AccountMapperCard` per marketplace: "Use global account mappings" with explanation.

No schema change needed — uses existing `settings` JSONB column on `marketplace_connections`.

## Files to Edit

| File | Change |
|------|--------|
| `src/utils/xero-posting-line-items.ts` | Resolver returns `null` instead of fallback; `UNMAPPED` sentinel on line items |
| `src/components/admin/accounting/PushSafetyPreview.tsx` | Add UNMAPPED check (red), completeness gate (red), CoA freshness auto-refresh, contact → red |
| `supabase/functions/sync-settlement-to-xero/index.ts` | Server resolver returns `null`; hard-fail on unmapped lines, incomplete mappings, stale CoA |
| `src/components/settings/AccountMapperCard.tsx` | Add per-marketplace `use_global_mappings` toggle |

## Safety Notes

- All existing users who have configured mappings will see no change — their explicit codes still resolve first
- Users relying on hardcoded defaults (200, 407, etc.) will now see a red block prompting them to confirm mappings — this is the intended behaviour
- Server guards are defence-in-depth; client preview catches issues first

