# Cross-App Action Audit Matrix

> Generated: 2026-03-16 | Status: **Live document — update on every PR that touches key actions**
> 
> **Legend:** Idempotency methods: `upsert` = ON CONFLICT DO UPDATE | `CAS` = Compare-And-Swap atomic claim | `dedup-check` = SELECT then INSERT | `delete+insert` = DELETE existing then INSERT

---

## A) Marketplace Provisioning / Add Marketplace

| Entry Point | File | Tables Written | Idempotency | Canonical Path |
|---|---|---|---|---|
| Shopify auto-provision | `src/components/admin/ShopifyConnectionStatus.tsx:157` | `marketplace_connections` | via `provisionMarketplace()` | ✅ `provisionMarketplace()` |
| Shopify orders auto-provision | `src/components/admin/accounting/ShopifyOrdersDashboard.tsx:691` | `marketplace_connections` | via `provisionMarketplace()` | ✅ `provisionMarketplace()` |
| Shopify onboarding | `src/components/admin/accounting/ShopifyOnboarding.tsx:184` | `marketplace_connections` | via `provisionMarketplace()` | ✅ `provisionMarketplace()` |
| SmartUploadFlow detect new marketplace | `src/components/admin/accounting/SmartUploadFlow.tsx:2641` | `marketplace_connections` | via `provisionMarketplace()` | ✅ `provisionMarketplace()` |
| CoA detected panel confirm | `src/components/dashboard/CoaDetectedPanel.tsx:33` | `marketplace_connections` | n/a (update only) | ✅ (update, not provision) |
| CoA detected panel dismiss | `src/components/dashboard/CoaDetectedPanel.tsx:49` | `marketplace_connections` | n/a (delete) | ✅ (dismiss) |
| MarketplaceSwitcher delete | `src/components/admin/accounting/MarketplaceSwitcher.tsx` | `marketplace_connections`, `settlements`, `settlement_lines`, fees, fingerprints, ad_spend, shipping_costs | cascade delete | ✅ `removeMarketplace()` |
| eBay OAuth callback | `supabase/functions/ebay-auth/index.ts:164` | `marketplace_connections` | `upsert` (user_id+marketplace_code) | ✅ (server-side, idempotent) |
| Amazon OAuth callback | `supabase/functions/amazon-auth/index.ts` | `amazon_tokens`, `marketplace_connections` | `upsert` | ✅ (server-side) |
| Shopify OAuth callback | `supabase/functions/shopify-auth/index.ts` | `shopify_tokens`, `marketplace_connections` | `upsert` | ✅ (server-side) |
| Ghost cleanup | `src/utils/marketplace-token-map.ts:115,138` | `marketplace_connections` | n/a (cleanup delete) | ✅ (allowed utility) |

**Invariant risks:** None — all client-side provisioning now goes through `provisionMarketplace()` with dedup, normalisation, and race-condition handling.

---

## B) Settlement Ingestion

| Entry Point | File | Tables Written | Idempotency | Canonical Path |
|---|---|---|---|---|
| SmartUploadFlow CSV parse | `SmartUploadFlow.tsx:854` | `settlements`, `settlement_lines` | `dedup-check` (UI flow only) | ❌ → future `saveIngestedSettlement()` |
| AccountingDashboard save | `AccountingDashboard.tsx:142,235` | `settlements`, `settlement_lines` | `dedup-check` (UI flow only) | ❌ → future `saveIngestedSettlement()` |
| ShopifyOrdersDashboard save | `ShopifyOrdersDashboard.tsx:387` | `settlements`, `settlement_lines` | `dedup-check` | ❌ → future `saveIngestedSettlement()` |
| settlement-engine.saveSettlement | `settlement-engine.ts:847,913` | `settlements` | `dedup-check` (2 code paths) | ❌ → consolidate |
| promote_and_save_settlement (RPC) | DB function | `settlements`, `marketplace_file_fingerprints`, `system_events` | atomic RPC | ✅ (server-side atomic) |
| fetch-amazon-settlements | `supabase/functions/fetch-amazon-settlements/` | `settlements`, `settlement_lines`, `settlement_components`, `marketplace_validation`, `system_events` | `upsert` (settlement_id) | ✅ (server-side) |
| fetch-shopify-payouts | `supabase/functions/fetch-shopify-payouts/` | `settlements`, `settlement_lines` | `upsert` | ✅ (server-side) |
| fetch-ebay-settlements | `supabase/functions/fetch-ebay-settlements/` | `settlements`, `settlement_lines` | `upsert` | ✅ (server-side) |
| auto-generate-shopify-settlements | `supabase/functions/auto-generate-shopify-settlements/` | `settlements` | `upsert` | ✅ (server-side) |

### Settlement Delete Paths

| Entry Point | File | Tables Deleted | Canonical Path |
|---|---|---|---|
| use-settlement-manager.handleDelete | `use-settlement-manager.ts:93` | `settlement_lines`, `settlement_unmapped`, `settlements` | ✅ `deleteSettlement()` |
| AutoImportedTab single delete | `AutoImportedTab.tsx:460` | (same cascade) | ✅ `deleteSettlement()` |
| AutoImportedTab bulk delete | `AutoImportedTab.tsx:496` | (same cascade) | ✅ `deleteSettlement()` |
| MarketplaceSwitcher cascade | `MarketplaceSwitcher.tsx` | (via `removeMarketplace()`) | ✅ `removeMarketplace()` |
| settlement-engine.deleteSettlement | `settlement-engine.ts:1359` | `settlement_lines`, `settlement_unmapped`, `settlements` | Delegates to `deleteSettlement()` | ✅ thin wrapper → `@/actions/settlements` |
| admin-manage-users reset | `supabase/functions/admin-manage-users/` | `settlement_lines`, `settlement_unmapped`, `settlements` | ✅ (admin, server-side, service-role) |

**Invariant risks:**
- Client-side delete cascades are RLS-protected and always filter by `user_id`

---

## C) Push to Xero (Manual + Autopost)

| Entry Point | File | Tables Written | Idempotency | Canonical Path |
|---|---|---|---|---|
| PushSafetyPreview (manual) | via `settlement-engine.ts:1199` | `settlements`, `xero_accounting_matches`, `system_events` (via edge fn) | `CAS` (acquire_sync_lock) | ✅ `pushSettlementToXero()` in `xeroPush.ts` |
| settlement-engine.pushSettlementBatch | `settlement-engine.ts:1339` | same as above | `CAS` | ✅ `pushSettlementToXero()` |
| SafeRepostModal rollback | `SafeRepostModal.tsx:173` | `settlements` (via edge fn) | server-side void | ✅ `rollbackFromXero()` in `xeroPush.ts` |
| auto-post-settlement batch | `supabase/functions/auto-post-settlement/` | `settlements`, `system_events`, `sync_locks`, `xero_accounting_matches` | `CAS` (atomic claim L446-498) | ✅ (server-side orchestrator) |
| auto-post-settlement single | `supabase/functions/auto-post-settlement/` | same | `CAS` | ✅ (server-side) |
| sync-settlement-to-xero | `supabase/functions/sync-settlement-to-xero/` | `settlements`, `xero_accounting_matches`, `system_events`, `sync_locks` | `CAS` + retry-safe backfill | ✅ (server-side push engine) |
| auto-push-xero (DEPRECATED) | `supabase/functions/auto-push-xero/` | hard-blocked (early return) | n/a | ✅ (disabled) |
| RailPostingSettings retry | `RailPostingSettings.tsx:205` | via edge fn | delegates to server | ✅ `triggerAutoPost()` in `xeroPush.ts` |

### Client → Server Invoke Guard

| Invoke Target | Allowed Callers | Canonical Path |
|---|---|---|
| `sync-settlement-to-xero` | `src/actions/xeroPush.ts` only | ✅ `pushSettlementToXero()`, `rollbackFromXero()` |
| `auto-post-settlement` | `src/actions/xeroPush.ts` only | ✅ `triggerAutoPost()` |

**Invariant risks:**
- ⚠️ `settlement-engine.ts` still calls `functions.invoke('sync-settlement-to-xero')` directly — legacy, in allowlist
- GenericMarketplaceDashboard reset-failed was direct, now uses ✅ `resetFailedSettlements()`

---

## D) Safe Repost / Rollback

| Entry Point | File | Tables Written | Idempotency | Canonical Path |
|---|---|---|---|---|
| SafeRepostModal void+repost | `SafeRepostModal.tsx:173-207` | `settlements` (posting_state, xero fields) | server-side void | ✅ (uses rollbackFromXero internally) |
| use-xero-sync.handleRollback | `use-xero-sync.ts:102` | `settlements` | via canonical action | ✅ `rollbackSettlement()` in `repost.ts` |

**Key invariant enforced:** `rollbackSettlement()` always checks `rail_posting_settings.auto_repost_after_rollback` and sets `manual_hold` when auto-repost is OFF. Previously `use-xero-sync` skipped this check.

---

## E) Mapping / Readiness Checks

| Entry Point | File | Constant Source | Canonical Path |
|---|---|---|---|
| PushSafetyPreview validation | via `xero-mapping-readiness.ts` | `REQUIRED_CATEGORIES` L27 | ✅ `checkXeroReadinessForMarketplace()` |
| sync-settlement-to-xero server gate | `sync-settlement-to-xero/index.ts:787` | `REQUIRED_CATEGORIES` (server copy) | ✅ (server-side, sync-tested) |
| auto-post-settlement mapping check | `auto-post-settlement/index.ts` | queries `marketplace_account_mapping` | ✅ (server-side, same 5 categories) |

**Sync guard:** `canonical-actions.test.ts` extracts `REQUIRED_CATEGORIES` from both client and server files and fails if they diverge.

---

## F) Settlement Status Updates

| Entry Point | File | Update Pattern | Canonical Path |
|---|---|---|---|
| Hide settlement | `RecentSettlements.tsx` | `is_hidden: true` | ✅ `updateSettlementVisibility()` |
| Unhide settlement | `RecentSettlements.tsx` | `is_hidden: false` | ✅ `updateSettlementVisibility()` |
| Revert to saved | `AccountingDashboard.tsx` | `status: 'saved'` | ✅ `revertSettlementToSaved()` |
| Reset failed | `GenericMarketplaceDashboard.tsx` | `status: 'ready_to_push'` | ✅ `resetFailedSettlements()` |
| Bank verify | `use-xero-sync.ts` | `bank_verified: true` | ✅ `markBankVerified()` |
| match-bank-deposits auto-verify | `supabase/functions/match-bank-deposits/` | `status: 'bank_verified'` | ✅ (server-side, service-role) |
| apply-xero-payment | `supabase/functions/apply-xero-payment/` | `status: 'reconciled_in_xero'` | ✅ (server-side) |

---

## G) System Events (Audit Trail)

| Entry Point | File | Event Types | Notes |
|---|---|---|---|
| auto-post-settlement | edge fn | `auto_post_*` (claimed, success, failed, skipped, stale_lock) | ✅ comprehensive |
| sync-settlement-to-xero | edge fn | `xero_push_success`, `xero_push_failed` | ✅ |
| fetch-outstanding | edge fn | `xero_api_call` | ✅ |
| match-bank-deposits | edge fn | `bank_match_*` | ✅ |
| ExceptionsInbox | component | `posting_retry_requested`, `exception_resolved`, `exception_snoozed` | ✅ |
| run-validation-sweep | edge fn | `validation_sweep_*` | ✅ |

System events are always written by the code that performs the action (edge fn or component). No canonical wrapper needed — the pattern is: "whoever does the work logs the event."

---

## Summary: Post-Refactor Status

| Action | Client Canonical | Server Canonical | Guardrail Test |
|---|---|---|---|
| Marketplace provision | `provisionMarketplace()` | OAuth edge fns (upsert) | grep: direct insert guard |
| Marketplace remove | `removeMarketplace()` | admin-manage-users | grep: cascade delete guard |
| Settlement delete | `deleteSettlement()` | admin-manage-users | ✅ cascade grep test |
| Settlement status | `revertToSaved()`, `resetFailed()`, `markBankVerified()`, `updateVisibility()` | edge fns (direct) | ✅ status update grep test |
| Push to Xero | `pushSettlementToXero()` | sync-settlement-to-xero | ✅ invoke guard test |
| Rollback | `rollbackSettlement()` | sync-settlement-to-xero (void) | manual_hold always checked |
| Auto-post trigger | `triggerAutoPost()` | auto-post-settlement | ✅ invoke guard test |
| Readiness check | `checkXeroReadinessForMarketplace()` | sync-settlement-to-xero | ✅ REQUIRED_CATEGORIES sync test |

### Remaining Migration Targets (allowlisted, non-blocking)

| File | Pattern | Plan |
|---|---|---|
| `settlement-engine.ts` | direct `functions.invoke('sync-settlement-to-xero')` | Migrate to `xeroPush.ts` when PushSafetyPreview is refactored |
| `settlement-engine.ts` | direct delete cascade | Migrate to `deleteSettlement()` |
| 3 Shopify components | direct `marketplace_connections.insert` | Migrate to `provisionMarketplace()` |
| SmartUploadFlow | direct `marketplace_connections.insert` (no dedup) | Migrate to `provisionMarketplace()` |
