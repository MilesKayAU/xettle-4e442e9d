# Cross-App Action Audit Matrix

> Generated: 2026-03-16 | Status: **Live document — update on every PR that touches key actions**

---

## A) Marketplace Provisioning / Add Marketplace

| Entry Point | File | Tables Written | Method | Canonical? |
|---|---|---|---|---|
| Shopify auto-provision | `src/components/admin/ShopifyConnectionStatus.tsx:162` | `marketplace_connections` | `insert` (with manual dedup check) | ❌ → `provisionMarketplace()` |
| Shopify orders auto-provision | `src/components/admin/accounting/ShopifyOrdersDashboard.tsx:701` | `marketplace_connections` | `insert` (with `existingCodes` Set check) | ❌ → `provisionMarketplace()` |
| Shopify onboarding | `src/components/admin/accounting/ShopifyOnboarding.tsx:197` | `marketplace_connections` | `insert` (with `existingCodes` Set check) | ❌ → `provisionMarketplace()` |
| SmartUploadFlow detect new marketplace | `src/components/admin/accounting/SmartUploadFlow.tsx:2656` | `marketplace_connections` | `insert` (no dedup) | ❌ → `provisionMarketplace()` |
| CoA detected panel confirm | `src/components/dashboard/CoaDetectedPanel.tsx:33` | `marketplace_connections` | `update` (set active) | ✅ (update only, no provision) |
| CoA detected panel dismiss | `src/components/dashboard/CoaDetectedPanel.tsx:49` | `marketplace_connections` | `delete` | ✅ (dismiss action) |
| MarketplaceSwitcher delete | `src/components/admin/accounting/MarketplaceSwitcher.tsx:262` | `marketplace_connections` | `delete` (+ cascade deletes) | ❌ → `removeMarketplace()` |
| eBay OAuth callback | `supabase/functions/ebay-auth/index.ts:164` | `marketplace_connections` | `upsert` | ✅ (server-side, idempotent) |
| Ghost cleanup | `src/utils/marketplace-token-map.ts:115,138` | `marketplace_connections` | `delete` | ✅ (cleanup utility) |

**Invariant risks:**
- SmartUploadFlow has NO dedup check before insert — can create duplicate connections
- ShopifyConnectionStatus, ShopifyOrdersDashboard, ShopifyOnboarding all do the same "check existingCodes then insert" pattern independently
- No normalisation of marketplace_code at insert time (some use `shopify_orders_${g.marketplaceKey}`)

---

## B) Settlement Ingestion

| Entry Point | File | Tables Written | Method | Canonical? |
|---|---|---|---|---|
| SmartUploadFlow CSV parse | `src/components/admin/accounting/SmartUploadFlow.tsx:854-857` | `settlements`, `settlement_lines` | `insert` | ❌ → `saveIngestedSettlement()` |
| AccountingDashboard save | `src/components/admin/accounting/AccountingDashboard.tsx:142,235` | `settlements`, `settlement_lines` | `insert` | ❌ → `saveIngestedSettlement()` |
| ShopifyOrdersDashboard save | `src/components/admin/accounting/ShopifyOrdersDashboard.tsx:387-390` | `settlements`, `settlement_lines` | `insert` | ❌ → `saveIngestedSettlement()` |
| settlement-engine.saveSettlement | `src/utils/settlement-engine.ts:847,913` | `settlements` | `insert` (two code paths: pre-boundary vs normal) | ❌ → consolidate |
| settlement-engine.promote_and_save_settlement | DB function `promote_and_save_settlement` | `settlements`, `marketplace_file_fingerprints`, `system_events` | `insert` (atomic RPC) | ✅ (server-side atomic) |
| fetch-amazon-settlements | `supabase/functions/fetch-amazon-settlements/index.ts:639,1049,1473` | `settlements`, `settlement_lines`, `settlement_components` | `insert` + `upsert` | ✅ (server-side) |
| fetch-shopify-payouts | `supabase/functions/fetch-shopify-payouts/` | `settlements`, `settlement_lines` | `insert` | ✅ (server-side) |

**Delete paths (must also be canonical):**

| Entry Point | File | Tables Deleted | Canonical? |
|---|---|---|---|
| settlement-engine.deleteSettlement | `src/utils/settlement-engine.ts:1364-1368` | `settlement_lines`, `settlement_unmapped`, `settlements` | ❌ → `deleteSettlement()` |
| use-settlement-manager.handleDelete | `src/hooks/use-settlement-manager.ts:99-101` | `settlement_lines`, `settlement_unmapped`, `settlements` | ❌ duplicate of above |
| AutoImportedTab single delete | `src/components/admin/accounting/AutoImportedTab.tsx:466-468` | `settlement_lines`, `settlement_unmapped`, `settlements` | ❌ duplicate of above |
| AutoImportedTab bulk delete | `src/components/admin/accounting/AutoImportedTab.tsx:505-507` | `settlement_lines`, `settlement_unmapped`, `settlements` | ❌ duplicate of above |
| MarketplaceSwitcher cascade | `src/components/admin/accounting/MarketplaceSwitcher.tsx:243` | `settlement_lines` (then settlements) | ❌ |
| admin-manage-users reset | `supabase/functions/admin-manage-users/index.ts:47-49` | `settlement_lines`, `settlement_unmapped`, `settlements` | ✅ (admin, server-side) |

**Invariant risks:**
- 4 independent delete implementations that each delete `settlement_lines` → `settlement_unmapped` → `settlements` separately
- No post-ingestion duplicate check in AccountingDashboard (relies on UI flow only)
- settlement_lines not always written on CSV upload (some parsers skip if no line data)

---

## C) Push to Xero (Manual + Autopost)

| Entry Point | File | Tables Written | Method | Canonical? |
|---|---|---|---|---|
| settlement-engine.syncSettlementToXero | `src/utils/settlement-engine.ts:1199` | `settlements` (via edge fn) | `functions.invoke('sync-settlement-to-xero')` | ✅ canonical client path |
| settlement-engine.pushSettlementBatch | `src/utils/settlement-engine.ts:1339` | `settlements` (via edge fn) | `functions.invoke('sync-settlement-to-xero')` | ✅ canonical client path |
| SafeRepostModal rollback | `src/components/admin/accounting/SafeRepostModal.tsx:173` | `settlements` (via edge fn) | `functions.invoke('sync-settlement-to-xero')` rollback action | ✅ |
| auto-post-settlement batch | `supabase/functions/auto-post-settlement/index.ts` | `settlements`, `system_events`, `sync_locks` | direct table writes | ✅ (server-side) |
| auto-push-xero (DEPRECATED) | `supabase/functions/auto-push-xero/index.ts` | `settlements`, `system_events` | direct writes + early return block | ✅ (hard-blocked) |
| RailPostingSettings retry | `src/components/settings/RailPostingSettings.tsx:205` | via `functions.invoke('auto-post-settlement')` | single-mode invoke | ✅ |

**Invariant risks:**
- GenericMarketplaceDashboard resets failed settlements directly: `update({ status: 'ready_to_push', push_retry_count: 0 })` — bypasses any canonical action
- use-xero-sync rollback does its own `settlements.update` after `rollbackSettlementFromXero` — should be inside the rollback function

---

## D) Safe Repost / Rollback

| Entry Point | File | Tables Written | Method | Canonical? |
|---|---|---|---|---|
| SafeRepostModal void+repost | `SafeRepostModal.tsx:173-207` | `settlements` (posting_state, xero fields) | `functions.invoke` + update | ✅ canonical |
| use-xero-sync.handleRollback | `src/hooks/use-xero-sync.ts:104-108` | `settlements` (status, xero_journal_id, etc.) | `rollbackSettlementFromXero()` + manual update | ❌ → should use canonical repost action |

**Invariant risks:**
- use-xero-sync does NOT set `manual_hold` even when `auto_repost_after_rollback=false` — SafeRepostModal does
- Two rollback paths with different post-rollback state handling

---

## E) Mapping / Readiness Checks

| Entry Point | File | Constant Source | Canonical? |
|---|---|---|---|
| PushSafetyPreview validation | via `xero-mapping-readiness.ts` | `REQUIRED_CATEGORIES` in `xero-mapping-readiness.ts:27` | ✅ |
| sync-settlement-to-xero server gate | `sync-settlement-to-xero/index.ts:787` | `REQUIRED_CATEGORIES` (hardcoded duplicate) | ❌ → should import from shared constant |
| auto-post-settlement mapping check | `auto-post-settlement/index.ts` | queries `marketplace_account_mapping` directly | ❌ → should use same category list |

**Invariant risks:**
- `REQUIRED_CATEGORIES` defined in TWO places: client (`xero-mapping-readiness.ts:27`) and server (`sync-settlement-to-xero:787`)
- If a new category is added to one but not the other, manual push may accept what autopost rejects (or vice versa)
- Edge functions can't import from `src/`, so server must duplicate — but needs a sync check

---

## F) Settlement Status Updates (Scattered)

| Entry Point | File | Update Pattern | Canonical? |
|---|---|---|---|
| Hide settlement | `RecentSettlements.tsx:476` | `update({ is_hidden: true })` | ❌ → `updateSettlementVisibility()` |
| Unhide settlement | `RecentSettlements.tsx:482` | `update({ is_hidden: false })` | ❌ → `updateSettlementVisibility()` |
| Revert to saved | `AccountingDashboard.tsx:2199` | `update({ status: 'saved' })` | ❌ → `revertSettlementStatus()` |
| Reset failed | `GenericMarketplaceDashboard.tsx:532` | `update({ status: 'ready_to_push', push_retry_count: 0 })` | ❌ → `resetFailedSettlement()` |
| Bank verify | `use-xero-sync.ts:72` | `update({ bank_verified: true, ... })` | ❌ → `markBankVerified()` |
| match-bank-deposits auto-verify | `match-bank-deposits/index.ts:323,509` | `update({ status: 'bank_verified', ... })` | ✅ (server-side) |

---

## Summary: Divergent Patterns Found

| Issue | Severity | Fix |
|---|---|---|
| 4 independent settlement delete implementations | 🔴 High | Consolidate to `deleteSettlement()` in actions |
| 5 independent marketplace provision inserts | 🔴 High | Consolidate to `provisionMarketplace()` |
| `REQUIRED_CATEGORIES` duplicated client/server | 🟡 Medium | Add sync test |
| SmartUploadFlow provision has no dedup | 🔴 High | Use canonical upsert |
| use-xero-sync rollback skips `manual_hold` | 🟡 Medium | Route through canonical repost action |
| GenericMarketplaceDashboard direct status reset | 🟡 Medium | Use canonical `resetFailedSettlement()` |
| Hide/unhide scattered across components | 🟢 Low | Optional consolidation |
