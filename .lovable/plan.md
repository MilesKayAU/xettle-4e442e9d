

## Settlement Audit Fix — Reconciliation-Only Push Prevention

### Status: ✅ IMPLEMENTED

### Problem
Shopify-derived `api_sync` settlements with `shopify_auto_*` IDs were incorrectly reaching `ready_to_push` status, risking $0 invoices and double-counting in Xero. The `isReconciliationOnly()` policy only caught `shopify_orders_*` marketplaces but missed the actual settlement ID pattern.

### Changes Made

**1. Policy helper broadened** (`src/utils/settlement-policy.ts` + `supabase/functions/_shared/settlementPolicy.ts`)
- Added `settlementId` parameter
- New rule: `source === 'api_sync' && settlementId.startsWith('shopify_auto_')` → reconciliation-only
- Original `shopify_orders_*` rule preserved
- Both files kept identical

**2. All callers updated to same signature**
- `src/hooks/use-xero-sync.ts` — passes `settlement.settlement_id`
- `supabase/functions/sync-settlement-to-xero/index.ts` — selects `settlement_id` in gate check, uses shared helper
- `supabase/functions/run-validation-sweep/index.ts` — imports and uses shared helper for skip

**3. Defense-in-depth in push endpoint**
- `sync-settlement-to-xero` hard-refuses reconciliation-only rows with clear error message regardless of status
- Fixed duplicate variable declarations bug

**4. Validation sweep hardened**
- Excludes reconciliation-only settlements BEFORE choosing "best settlement" per period
- Uses shared `isReconciliationOnly()` helper (no inline logic)

**5. Database trigger updated**
- `calculate_validation_status` now derives decision from the actual linked settlement row
- Caps reconciliation-only settlements at `settlement_needed` max status
- Never allows `ready_to_push`, `ready_to_export`, or `exported`

**6. Data migration executed**
- Downgraded `shopify_auto_*` settlements from `ready_to_push`/`validated`/`matched` → `ingested`
- Suppressed `api_sync` settlements where CSV/API data exists for same marketplace+period
- Null-period safety included in suppression query
- Never touched `exported`, `pushed_to_xero`, or `locked` statuses
- Refreshed affected `marketplace_validation` rows

### Spot-check cases
- ✅ Bunnings with CSV overlap → api_sync suppressed
- ✅ eBay with real API payout + Shopify-derived row → api_sync suppressed
- ✅ Marketplace with only shopify_auto_* data → visible for reconciliation, never pushable
