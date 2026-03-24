

## Plan: Hardened Allowlist-Based Settlement Push Policy

### Overview
Replace the current pattern-matching blocklist (`shopify_auto_` + `api_sync` checks) with an allowlist of pushable sources. Only explicitly approved payout sources can be pushed to Xero. Everything else is automatically reconciliation-only.

### Step 1 — Create shared constant (server-side)
**New file: `supabase/functions/_shared/settlementSources.ts`**
```typescript
export const PUSHABLE_SOURCES = [
  'csv_upload', 'manual', 'api', 'ebay_api', 'mirakl_api', 'amazon_api',
] as const;
export type PushableSource = typeof PUSHABLE_SOURCES[number];
```

### Step 2 — Create client-side mirror
**New file: `src/utils/settlementSources.ts`**
- Identical `PUSHABLE_SOURCES` array with sync warning comment
- Edge functions cannot import from `src/` — this is the only acceptable duplication

### Step 3 — Update `src/utils/settlement-policy.ts`
- Import `PUSHABLE_SOURCES` from `./settlementSources`
- Rewrite `isReconciliationOnly`: return `true` if source not in allowlist, keep `shopify_auto_` as secondary safety
- Add `getPushBlockReason()` returning a marketplace-agnostic user-facing message

### Step 4 — Update `supabase/functions/_shared/settlementPolicy.ts`
- Import `PUSHABLE_SOURCES` from `./settlementSources.ts`
- Same allowlist logic as client-side

### Step 5 — Update `supabase/functions/run-validation-sweep/index.ts`
- Already imports and uses `isReconciliationOnly` at lines 408-410 and 499 — these will automatically benefit from the updated policy. No changes needed here since it already calls the helper.

### Step 6 — Update `supabase/functions/sync-settlement-to-xero/index.ts`
- Already has the gate at line 553 using `isReconciliationOnly` — will automatically use the new allowlist logic
- Update the error message at line 556 to be marketplace-agnostic (remove "marketplace CSV" specificity, use `getPushBlockReason`-style wording)

### Step 7 — Update DB trigger `calculate_validation_status`
**New migration** to update the `calculate_validation_status()` function:
- Replace the inline `api_sync` + `shopify_orders_`/`shopify_auto_` check with an allowlist array
- Define `PUSHABLE_SOURCES` as a PL/pgSQL array constant
- If source is NOT in the array, cap status at `settlement_needed`

### Step 8 — Update UI components

**`src/hooks/use-xero-sync.ts`** (line 57):
- Replace hardcoded Shopify-specific toast with `getPushBlockReason()` output

**`src/components/admin/accounting/PushSafetyPreview.tsx`** (line 269):
- Replace "Reconciliation-only source (Shopify-derived marketplace)" with `getPushBlockReason()` output

### Step 9 — Clean up remaining inline checks

Files with direct `shopify_auto_` / `api_sync` string literal checks that should use `isReconciliationOnly()` instead:

1. **`src/utils/marketplace-reconciliation-engine.ts`** (line 408) — `!settlementId.startsWith('shopify_auto_')` → use `isReconciliationOnly()`
2. **`src/components/admin/accounting/SettlementsOverview.tsx`** (lines 67, 175) — `.neq('source', 'api_sync')` → needs `isReconciliationOnly` check post-fetch or use `PUSHABLE_SOURCES` in query
3. **`src/components/dashboard/RecentSettlements.tsx`** (lines 426, 517) — `settlement_id?.startsWith('shopify_auto_')` → use `isReconciliationOnly()`
4. **`src/components/onboarding/ValidationSweep.tsx`** (line 278) — already uses `isUsefulRecon` with `shopify_auto_` check → update to use `isReconciliationOnly()`

Note: `src/actions/settlements.ts` uses `api_sync` for source-priority suppression logic (CSV overrides API) — this is a different concern from push gating and should NOT be changed. Similarly, `ai_policy.ts` is documentation text.

### Files Modified
1. `supabase/functions/_shared/settlementSources.ts` (NEW)
2. `src/utils/settlementSources.ts` (NEW)
3. `src/utils/settlement-policy.ts`
4. `supabase/functions/_shared/settlementPolicy.ts`
5. `supabase/functions/sync-settlement-to-xero/index.ts` (error message only)
6. `src/hooks/use-xero-sync.ts`
7. `src/components/admin/accounting/PushSafetyPreview.tsx`
8. `src/utils/marketplace-reconciliation-engine.ts`
9. `src/components/admin/accounting/SettlementsOverview.tsx`
10. `src/components/dashboard/RecentSettlements.tsx`
11. `src/components/onboarding/ValidationSweep.tsx`
12. New migration for `calculate_validation_status` trigger

### Constraints Honored
- No settlement schema changes
- No connector logic changes
- No CSV parser changes
- `PUSHABLE_SOURCES` never defined inline — always imported
- `actions/settlements.ts` source-priority logic untouched (different concern)

