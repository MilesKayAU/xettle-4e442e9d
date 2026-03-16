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

---

## C) Push to Xero (Manual + Autopost)

| Entry Point | File | Tables Written | Idempotency | Canonical Path |
|---|---|---|---|---|
| PushSafetyPreview (manual) | via `settlement-engine.ts:1199` | `settlements`, `xero_accounting_matches`, `system_events` (via edge fn) | `CAS` (acquire_sync_lock) | ✅ `pushSettlementToXero()` in `xeroPush.ts` |
| settlement-engine.pushSettlementBatch | `settlement-engine.ts:1339` | same as above | `CAS` | ✅ `pushSettlementToXero()` |
| SafeRepostModal rollback | `SafeRepostModal.tsx:173` | `settlements` (via edge fn) | server-side void | ✅ `rollbackFromXero()` in `xeroPush.ts` |
| auto-post-settlement batch | `supabase/functions/auto-post-settlement/` | `settlements`, `system_events`, `sync_locks`, `xero_accounting_matches` | `CAS` (atomic claim L446-498) | ✅ (server-side orchestrator) |
| sync-settlement-to-xero | `supabase/functions/sync-settlement-to-xero/` | `settlements`, `xero_accounting_matches`, `system_events`, `sync_locks` | `CAS` + retry-safe backfill | ✅ (server-side push engine) |
| auto-push-xero (DEPRECATED) | `supabase/functions/auto-push-xero/` | hard-blocked (early return) | n/a | ✅ (disabled) |
| RailPostingSettings retry | `RailPostingSettings.tsx:205` | via edge fn | delegates to server | ✅ `triggerAutoPost()` in `xeroPush.ts` |

### Support Tier Enforcement (Push)

| Tier | Auto-post | Manual Push | AUTHORISED | Server Enforced |
|---|---|---|---|---|
| SUPPORTED | ✅ Allowed | ✅ Allowed | ✅ Allowed (all gates) | ✅ `sync-settlement-to-xero` |
| EXPERIMENTAL | ⚠️ DRAFT only (acknowledged) | ✅ DRAFT only | ❌ Blocked | ✅ Both edge functions |
| UNSUPPORTED | ❌ Blocked | ⚠️ DRAFT + ack required | ❌ Blocked | ✅ `auto-post-settlement` |

### Client → Server Invoke Guard

| Invoke Target | Allowed Callers | Canonical Path |
|---|---|---|
| `sync-settlement-to-xero` | `src/actions/xeroPush.ts` only | ✅ `pushSettlementToXero()`, `rollbackFromXero()` |
| `auto-post-settlement` | `src/actions/xeroPush.ts` only | ✅ `triggerAutoPost()` |

---

## D) Safe Repost / Rollback

| Entry Point | File | Tables Written | Idempotency | Canonical Path |
|---|---|---|---|---|
| SafeRepostModal void+repost | `SafeRepostModal.tsx:173-207` | `settlements` (posting_state, xero fields) | server-side void | ✅ (uses rollbackFromXero internally) |
| use-xero-sync.handleRollback | `use-xero-sync.ts:102` | `settlements` | via canonical action | ✅ `rollbackSettlement()` in `repost.ts` |

---

## E) Mapping / Readiness Checks

| Entry Point | File | Constant Source | Canonical Path |
|---|---|---|---|
| PushSafetyPreview validation | via `xero-mapping-readiness.ts` | `REQUIRED_CATEGORIES` L27 | ✅ `checkXeroReadinessForMarketplace()` |
| sync-settlement-to-xero server gate | `sync-settlement-to-xero/index.ts:787` | `REQUIRED_CATEGORIES` (server copy) | ✅ (server-side, sync-tested) |
| auto-post-settlement mapping check | `auto-post-settlement/index.ts` | queries `marketplace_account_mapping` | ✅ (server-side, same 5 categories) |
| Rail posting eligibility | `src/actions/xeroReadiness.ts` | `getRailPostingEligibility()` | ✅ canonical action |

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

## G) Support Scope & Tier Management

| Entry Point | File | Tables Written | Idempotency | Canonical Path |
|---|---|---|---|---|
| Scope acknowledgement | `ScopeBanner.tsx` | `app_settings` (scope_acknowledged_at, scope_version) | `upsert` | ✅ `acknowledgeScopeConsent()` in `scopeConsent.ts` |
| Org tax profile | Settings UI | `app_settings` (tax_profile) | `upsert` | ✅ `setOrgTaxProfile()` in `scopeConsent.ts` |
| Rail support acknowledgement | `RailPostingSettings.tsx` | `rail_posting_settings` (support_acknowledged_at), `system_events` | `upsert` | ✅ `acknowledgeRailSupport()` in `scopeConsent.ts` |
| Tier computation | All push/settings UI | (read-only computation) | n/a | ✅ `computeSupportTier()` in `policy/supportPolicy.ts` |
| Rail posting eligibility | PushSafetyPreview, RailPostingSettings | (read-only computation) | n/a | ✅ `getRailPostingEligibility()` in `xeroReadiness.ts` |

### Tier Enforcement Points

| Location | Enforcement | Server-side |
|---|---|---|
| `RailPostingSettings.tsx` | Auto-post toggle disabled for unsupported; AUTHORISED disabled for non-SUPPORTED | Client UX gate |
| `PushSafetyPreview.tsx` | Shows tier warning; blocks push for unacknowledged experimental/unsupported | Client UX gate |
| `auto-post-settlement` edge fn | Skips UNSUPPORTED rails; forces DRAFT for EXPERIMENTAL; blocks REVIEW_EACH_SETTLEMENT | ✅ Server enforced |
| `sync-settlement-to-xero` edge fn | Forces DRAFT for non-SUPPORTED; blocks AUTHORISED for non-SUPPORTED | ✅ Server enforced |

---

## H) Xero Invoice Refresh / Rescan / Compare

| Entry Point | File | Tables Written | Idempotency | Canonical Path |
|---|---|---|---|---|
| Per-row refresh (Outstanding) | `OutstandingTab.tsx` | `xero_invoice_cache`, `system_events` (via edge fn) | `upsert` (user_id, xero_invoice_id) | ✅ `refreshXeroInvoiceDetails()` in `xeroInvoice.ts` |
| Per-row refresh (Settlement drawer) | `SettlementDetailDrawer.tsx` | same | same | ✅ `refreshXeroInvoiceDetails()` |
| Rescan match | `OutstandingTab.tsx`, `SettlementDetailDrawer.tsx` | `xero_accounting_matches`, `system_events` (via edge fn) | `upsert` (user_id, xero_invoice_id) | ✅ `rescanMatchForInvoice()` in `xeroInvoice.ts` |
| Compare payload (legacy) | `OutstandingTab.tsx`, `SettlementDetailDrawer.tsx` | `system_events` (via orchestrator) | n/a | ✅ `getXeroVsXettlePayloadDiff()` in `xeroInvoice.ts` (delegates to `compareXeroInvoiceToSettlement`) |
| **Compare (canonical)** | `XeroInvoiceCompareDrawer`, `OutstandingTab`, `SettlementDetailDrawer`, `XeroPostingAudit` | `system_events` (via edge fn + orchestrator) | n/a (read-only diff) | ✅ `compareXeroInvoiceToSettlement()` in `xeroInvoice.ts` |
| fetch-xero-invoice | `supabase/functions/fetch-xero-invoice/` | `xero_invoice_cache`, `system_events` | `upsert` + 30s cooldown | ✅ (server-side) |
| rescan-xero-invoice-match | `supabase/functions/rescan-xero-invoice-match/` | `xero_accounting_matches`, `system_events` | `upsert` | ✅ (server-side) |
| **preview-xettle-invoice-payload** | `supabase/functions/preview-xettle-invoice-payload/` | `system_events` | n/a (preview only) | ✅ (server-side canonical builder) |

### Client → Server Invoke Guard (Invoice)

| Invoke Target | Allowed Callers | Canonical Path |
|---|---|---|
| `fetch-xero-invoice` | `src/actions/xeroInvoice.ts` only | ✅ `refreshXeroInvoiceDetails()` |
| `rescan-xero-invoice-match` | `src/actions/xeroInvoice.ts` only | ✅ `rescanMatchForInvoice()` |
| `preview-xettle-invoice-payload` | `src/actions/xeroInvoice.ts` only | ✅ `compareXeroInvoiceToSettlement()` |

---

## H) System Events (Audit Trail)

| Entry Point | File | Event Types | Notes |
|---|---|---|---|
| auto-post-settlement | edge fn | `auto_post_*` (claimed, success, failed, skipped, stale_lock) | ✅ comprehensive |
| sync-settlement-to-xero | edge fn | `xero_push_success`, `xero_push_failed`, `authorised_blocked_by_tier` | ✅ |
| scope consent | `scopeConsent.ts` | `rail_support_acknowledged` | ✅ |
| fetch-outstanding | edge fn | `xero_api_call` | ✅ |
| match-bank-deposits | edge fn | `bank_match_*` | ✅ |
| ExceptionsInbox | component | `posting_retry_requested`, `exception_resolved`, `exception_snoozed` | ✅ |
| run-validation-sweep | edge fn | `validation_sweep_*` | ✅ |

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
| Scope consent | `acknowledgeScopeConsent()` | n/a (app_settings) | ✅ canonical action |
| Tax profile | `setOrgTaxProfile()` | n/a (app_settings) | ✅ canonical action |
| Rail support ack | `acknowledgeRailSupport()` | n/a (rail_posting_settings) | ✅ canonical action |
| Tier computation | `computeSupportTier()` | duplicated in edge fns | ✅ tier unit tests |
| Rail eligibility | `getRailPostingEligibility()` | n/a | ✅ canonical action |
| Invoice refresh | `refreshXeroInvoiceDetails()` | fetch-xero-invoice | ✅ invoke guard test |
| Invoice rescan | `rescanMatchForInvoice()` | rescan-xero-invoice-match | ✅ invoke guard test |
| Invoice compare | `compareXeroInvoiceToSettlement()` | fetch-xero-invoice, preview-xettle-invoice-payload | ✅ invoke guard test + local builder guard |

### Remaining Migration Targets

| File | Pattern | Status |
|---|---|---|
| `settlement-engine.ts` | `syncSettlementToXero()` orchestrator | ✅ Delegates to `pushSettlementToXero()` for invoke |
| `settlement-engine.ts` | `rollbackSettlementFromXero()` | ✅ Thin wrapper → `rollbackFromXero()` |
| `settlement-engine.ts` | `deleteSettlement()` | ✅ Thin wrapper → `@/actions/settlements.deleteSettlement()` |
| `marketplace-token-map.ts` | Ghost cleanup (delete only) | ✅ Cleanup utility, no provisioning |

**No allowlisted legacy bypasses remain.** All client-side paths route through canonical actions.

---

## I) AI Assistant

| Entry Point | File | Edge Functions | Tables Read | Tables Written | Canonical Path |
|---|---|---|---|---|---|
| AskAiButton (sitewide) | `src/components/AuthenticatedLayout.tsx` | `ai-assistant` | — | `ai_usage` | via `use-ai-assistant` hook |
| AiContextProvider | `src/ai/context/AiContextProvider.tsx` | — | — | — | `useAiPageContext()` per page |
| Tool: getPageReadinessSummary | `ai-assistant/index.ts` | — | `settlements`, `outstanding_invoices_cache`, `marketplace_validation` | — | server-side tool |
| Tool: getInvoiceStatusByXeroInvoiceId | `ai-assistant/index.ts` | — | `outstanding_invoices_cache`, `settlements` | — | server-side tool |
| Tool: getSettlementStatus | `ai-assistant/index.ts` | — | `settlements`, `marketplace_account_mapping` | — | server-side tool |

### Context Contract

- Schema: `src/ai/context/aiContextContract.ts` — `AiPageContext` interface
- Sanitizer: `sanitizeContext()` enforces 2KB cap, PII redaction, DOM blocking
- Provider: `AiContextProvider` in `AuthenticatedLayout`
- Hook: `useAiPageContext(builderFn)` — pages register structured context

### Guardrails

- No raw DOM/HTML may be passed to AI context (DOM_PATTERNS blocked in sanitizer)
- Context size hard-capped at 2KB JSON
- Tools execute server-side with user_id scoping (service role + filter)
- Tool-calling loop limited to 3 rounds max

---

## J) Xero Chart of Accounts / Account Mapper

| Entry Point | File | Tables Written | Idempotency | Canonical Path |
|---|---|---|---|---|
| Refresh COA button | `AccountMapperCard.tsx` → `refreshXeroCOA()` | `xero_chart_of_accounts`, `xero_tax_rates`, `system_events` | `upsert` (user_id + xero_account_id / tax_type) | ✅ `refreshXeroCOA()` |
| AI Account Mapper scan | `ai-account-mapper` edge fn | `xero_chart_of_accounts`, `app_settings`, `system_events` | `upsert` | ✅ (server-side) |
| Confirm mapping | `AccountMapperCard.tsx` → `confirmMappings()` | `app_settings` (accounting_xero_account_codes) | `upsert` (user_id + key) | ✅ `confirmMappings()` canonical action |
| Save draft mapping | `AccountMapperCard.tsx` → `saveDraftMappings()` | `app_settings` (accounting_xero_account_codes_draft) | `upsert` (user_id + key) | ✅ `saveDraftMappings()` canonical action |
| refresh-xero-coa | `supabase/functions/refresh-xero-coa/` | `xero_chart_of_accounts`, `xero_tax_rates`, `system_events` | `upsert` | ✅ (server-side) |
| Create account in Xero | `AccountMapperCard.tsx` → `createXeroAccounts()` | Xero API (PUT /Accounts), `xero_chart_of_accounts`, `system_events` | dedup-check (code vs cached COA) | ✅ `createXeroAccounts()` |

### Account Mapping Source of Truth

**Canonical store:** `app_settings` table, key `accounting_xero_account_codes` (confirmed) / `accounting_xero_account_codes_draft` (draft).

**Canonical actions:** `src/actions/accountMappings.ts`
- `getMappings()` — load confirmed (falls back to draft)
- `getMappingsRaw()` — load raw confirmed codes for posting builders
- `getEffectiveMapping(codes, category, marketplace?)` — resolve with fallback
- `saveDraftMappings(codes)` — save draft (no PIN)
- `confirmMappings(codes)` — save confirmed + cleanup draft (PIN required by caller)
- `mergeIntoConfirmedMappings(newCodes)` — merge after COA clone

**DEPRECATED:** `marketplace_account_mapping` table. Legacy reads remain in edge functions (`auto-post-settlement`, `ai-assistant`) and will be migrated. No new writes should target this table.

### COA Clone Flow (Sitewide Guided)

| Entry Point | File | Canonical Actions Used | Tables Written | Notes |
|---|---|---|---|---|
| Settings → Account Mapper | `AccountMapperCard.tsx` | `buildClonePreview()`, `executeCoaClone()`, `logCloneEvent()` | Xero API, `xero_chart_of_accounts`, `system_events` | PIN-gated, original path |
| PushSafetyPreview (MAPPING_REQUIRED) | `PushSafetyPreview.tsx` → `CoaBlockerCta` | Same canonical actions | Same | Inline CTA when push blocked |
| Onboarding connect flow | `SetupStepConnectStores.tsx` → `CoaBlockerCta` | `getMarketplaceCoverage()` + clone | Same | Post-provision gap detection |
| Compare drawer (BLOCKED) | `SettlementDetailDrawer.tsx` → `CoaBlockerCta` | Same | Same | Future: wire when BLOCKED verdict surfaces |

### Clone Safety Invariants

- Clone always requires PIN verification (client-side gate)
- Clone always shows preview before executing (no automatic creation)
- `buildClonePreview()` is pure logic — no side effects
- `executeCoaClone()` calls `createXeroAccounts()` canonical action (admin-gated server-side)
- Auto-map after clone uses `mergeIntoConfirmedMappings()` canonical action
- All events logged to `system_events`: `coa_clone_previewed`, `coa_clone_executed`, `coa_clone_failed`, `coa_clone_cancelled`

### Canonical Action: `src/actions/xeroAccounts.ts`

- `refreshXeroCOA()` — invokes `refresh-xero-coa` edge function
- `getCachedXeroAccounts()` — reads cached COA from `xero_chart_of_accounts`
- `getCachedXeroTaxRates()` — reads cached tax rates from `xero_tax_rates`
- `getCoaLastSyncedAt()` — returns latest synced_at timestamp
- `createXeroAccounts()` — invokes `create-xero-accounts` edge function (admin-only, creates accounts in Xero then refreshes COA cache)

### Guardrails

- No component may invoke `refresh-xero-coa` directly (must use canonical action)
- No component may invoke `create-xero-accounts` directly (must use canonical action)
- No component may write directly to `xero_chart_of_accounts` or `xero_tax_rates`
- No component may write directly to `accounting_xero_account_codes` — must use `confirmMappings()` or `saveDraftMappings()`
- Account codes validated against cached COA before save
- Account creation gated server-side by admin role check
- COA clone reachable from multiple surfaces via `CoaBlockerCta` shared component (all use same canonical path)
