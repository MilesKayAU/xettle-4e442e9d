# Xettle Complete Technical Audit — Cross-Referenced
**Date: 9 March 2026 (v2 — verified against codebase)**
**Scope: Full codebase — frontend, backend, parsers, engines, edge functions, database, security**

---

## 1. Architecture Overview

### Stack
- **Frontend**: React 18 + Vite + TypeScript + Tailwind CSS + shadcn/ui
- **Backend**: Lovable Cloud (Supabase) — Postgres, Edge Functions, Auth, RLS
- **Integrations**: Xero (OAuth2), Amazon SP-API (OAuth2)
- **State**: React Query (5-min stale time), Supabase Realtime subscriptions
- **Routing**: React Router v6 with lazy-loaded pages

### Key Pages
| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | Landing | Marketing page |
| `/auth` | Auth | Sign in / Sign up with email verification |
| `/dashboard` | Dashboard | Main app — marketplace tabs, Smart Upload, Insights |
| `/admin` | Admin | Admin panel (role-gated) |
| `/pricing` | Pricing | Plan tiers |
| `/xero/callback` | XeroCallback | OAuth2 callback for Xero |
| `/amazon/callback` | AmazonCallback | OAuth2 callback for Amazon SP-API |
| `/reset-password` | ResetPassword | Password reset flow |

### Architecture Rules (ARCHITECTURE.md)
Three enforced rules:
1. **All dashboards MUST use shared hooks** — useSettlementManager, useBulkSelect, useXeroSync, useReconciliation, useTransactionDrilldown
2. **No direct color classes** — use semantic design tokens only
3. **Secrets never in code** — use Lovable Cloud secrets

---

## 2. Database Schema (17 tables)

| Table | Purpose | RLS |
|-------|---------|-----|
| `settlements` | Core settlement records — one per marketplace period | ✅ user_id scoped |
| `settlement_lines` | Transaction-level line items per settlement | ✅ user_id scoped |
| `settlement_unmapped` | Rows that couldn't be categorized during parsing | ✅ user_id scoped |
| `marketplace_connections` | User's active marketplace tabs | ✅ user_id scoped |
| `marketplaces` | Global marketplace metadata (admin-managed) | ✅ read=all, write=admin |
| `marketplace_fee_observations` | Fee rate observations per settlement | ✅ user_id scoped |
| `marketplace_fee_alerts` | Anomaly alerts when fee rates deviate | ✅ user_id + admin read |
| `marketplace_ad_spend` | Manual ad spend entries per marketplace | ⚠️ public role (Gap 4) |
| `marketplace_shipping_costs` | Estimated shipping cost per order | ⚠️ public role (Gap 4) |
| `marketplace_file_fingerprints` | User-specific column signature fingerprints | ✅ user_id scoped |
| `marketplace_fingerprints` | Global + user-specific marketplace detection patterns | ✅ mixed |
| `product_costs` | SKU-level COGS data | ✅ user_id scoped |
| `xero_tokens` | Xero OAuth2 tokens | ✅ user_id scoped |
| `amazon_tokens` | Amazon SP-API OAuth2 tokens | ✅ user_id scoped |
| `app_settings` | Per-user key/value settings | ✅ user_id scoped |
| `sync_history` | Xero sync event log | ✅ user_id scoped |
| `user_roles` | RBAC roles (admin, paid, starter, pro) | ✅ read-only for user |

---

## 3. Verified ✅ — What IS Built

### Parsers (all working)
| Parser | File | Lines | Status |
|--------|------|-------|--------|
| Amazon AU Settlement | `settlement-parser.ts` | ~400 | ✅ Production |
| Shopify Payments | `shopify-payments-parser.ts` | ~300 | ✅ Production |
| Shopify Orders | `shopify-orders-parser.ts` | ~250 | ✅ Production |
| Bunnings Billing Cycle | `bunnings-summary-parser.ts` | ~200 | ✅ Production |
| Woolworths MarketPlus | `woolworths-marketplus-parser.ts` | 481 | ✅ Production — splits by Order Source column |
| Generic CSV | `generic-csv-parser.ts` | ~200 | ✅ Fallback for any marketplace |

### Engines (all working)
| Engine | File | Lines | Purpose |
|--------|------|-------|---------|
| Settlement Engine | `settlement-engine.ts` | ~500 | CRUD operations, dedup (app-level), Supabase persistence |
| Reconciliation Engine | `reconciliation-engine.ts` | ~300 | Amazon-specific recon |
| Universal Reconciliation | `universal-reconciliation.ts` | ~250 | Balance + GST + Sanity checks for any marketplace |
| Fee Observation Engine | `fee-observation-engine.ts` | ~350 | Fee rate tracking + anomaly alerts |
| Profit Engine | `profit-engine.ts` | 135 | COGS calculation from product_costs table |
| File Fingerprint Engine | `file-fingerprint-engine.ts` | ~200 | Column signature detection |
| File Marketplace Detector | `file-marketplace-detector.ts` | ~300 | 3-level detection pipeline |

### Shared Hooks (all built, GenericMarketplaceDashboard uses them)
| Hook | File | Purpose |
|------|------|---------|
| `useSettlementManager` | `use-settlement-manager.ts` | Fetch + filter + loading states |
| `useBulkSelect` | `use-bulk-select.ts` | Checkbox selection + Xero-aware bulk delete |
| `useXeroSync` | `use-xero-sync.ts` | Push/sync/rollback with Xero |
| `useReconciliation` | `use-reconciliation.ts` | Inline Balance/GST/Sanity checks |
| `useTransactionDrilldown` | `use-transaction-drilldown.ts` | Line-item drill-down per settlement |

### Shared UI Components (all built)
| Component | File | Purpose |
|-----------|------|---------|
| `SettlementStatusBadge` | `shared/SettlementStatusBadge.tsx` | Consistent status badges |
| `ReconChecksInline` | `shared/ReconChecksInline.tsx` | Expandable recon results |
| `BulkDeleteDialog` | `shared/BulkDeleteDialog.tsx` | Xero-aware delete confirmation |
| `GapDetector` | `shared/GapDetector.tsx` | Missing period detection |

### Dashboard Components (verified)
| Component | File | Status |
|-----------|------|--------|
| `GenericMarketplaceDashboard` | ✅ Fully refactored — uses all shared hooks, ~700 lines |
| `AccountingDashboard` | ❌ 4,395 lines — NOT on shared hooks (Gap 2) |
| `ShopifyPaymentsDashboard` | ❌ ~800 lines — NOT on shared hooks (Gap 2) |
| `BunningsDashboard` | ❌ ~1,230 lines — NOT on shared hooks (Gap 2) |
| `ShopifyOrdersDashboard` | ❌ ~1,315 lines — NOT on shared hooks (Gap 2) |
| `InsightsDashboard` | ✅ Cross-marketplace analytics |
| `SkuCostManager` | ✅ SKU cost CRUD UI |
| `MonthlyReconciliationStatus` | ✅ Built |
| `OnboardingChecklist` | ✅ Built |
| `MarketplaceReturnRatio` | ✅ Built |

### Edge Functions (10 deployed)
| Function | Purpose | JWT |
|----------|---------|-----|
| `ai-file-interpreter` | AI-powered file classification | verify_jwt=false |
| `sync-xero-status` | Sync-back invoice status from Xero | verify_jwt=false |
| `sync-settlement-to-xero` | Push settlement as Xero invoice | auth in code |
| `auto-push-xero` | Batch auto-push new settlements | auth in code |
| `xero-auth` | Xero OAuth2 token exchange | auth in code |
| `amazon-auth` | Amazon SP-API OAuth2 token exchange | auth in code |
| `fetch-amazon-settlements` | Pull settlements from Amazon SP-API | auth in code |
| `sync-amazon-journal` | Create Xero journal from Amazon data | auth in code |
| `admin-list-users` | List users (admin only) | auth in code |
| `admin-manage-users` | Manage user roles (admin only) | auth in code |

### Other Verified
- ✅ Rollback flow (void Xero invoice + reset local status)
- ✅ Xero reference format: `Xettle-{settlement_id}` (new) + legacy `(ID)` parsing
- ✅ Duplicate prevention: pre-push Xero API search + local journal ID check
- ✅ Smart Upload Flow with marketplace auto-detection
- ✅ MarketplaceSwitcher with tab management
- ✅ Marketplace config tab (admin)
- ✅ Seller Central Guide for Amazon
- ✅ Shopify onboarding flow

---

## 4. THE REAL GAPS — Priority Ordered

### Gap 1 — CRITICAL: No DB Unique Constraint on Settlements
**Risk**: Race condition = duplicate settlements possible
**Current state**: Dedup is application-level only in `settlement-engine.ts`
**Fix**: Single migration:
```sql
CREATE UNIQUE INDEX idx_settlement_dedup ON settlements (settlement_id, marketplace, user_id);
```
**Effort**: 5 minutes

### Gap 2 — CRITICAL: 4 Dashboards NOT on Shared Hooks
**Risk**: Feature drift, inconsistent UX, duplicated bug-prone code

| Dashboard | Lines | Missing Features |
|-----------|-------|-----------------|
| `AccountingDashboard.tsx` | 4,395 | Rollback, Refresh from Xero, Inline recon, Xero-aware bulk delete, Gap detection, Mark Already in Xero, Bank verification |
| `ShopifyPaymentsDashboard.tsx` | ~800 | Rollback, Refresh from Xero, Inline recon, Xero-aware bulk delete, Gap detection, Mark Already in Xero, Bank verification |
| `BunningsDashboard.tsx` | ~1,230 | Rollback, Refresh from Xero, Inline recon, Xero-aware bulk delete, Gap detection, Mark Already in Xero, Bank verification |
| `ShopifyOrdersDashboard.tsx` | ~1,315 | Rollback, Refresh from Xero, Inline recon, Xero-aware bulk delete, Gap detection, Mark Already in Xero, Bank verification |

**Fix**: Migrate each to use shared hooks + components (follow GenericMarketplaceDashboard pattern)
**Effort**: 2-4 hours per dashboard

### Gap 3 — CRITICAL: Stripe/Billing = Zero
**Current state**:
- No Stripe code anywhere in codebase
- No subscription enforcement
- Roles exist in DB (`paid`, `starter`, `pro`) but nothing gates features
- Users can use everything for free forever

**Fix needed**:
1. Enable Stripe integration
2. Create subscription products/prices
3. Implement plan-gating middleware
4. Wire role assignment on subscription events
**Effort**: 1-2 days

### Gap 4 — SECURITY: RLS Tightening
| Table | Issue | Fix |
|-------|-------|-----|
| `marketplace_ad_spend` | Uses `public` role instead of `authenticated` | Change RLS policies to `authenticated` |
| `marketplace_shipping_costs` | Uses `public` role instead of `authenticated` | Change RLS policies to `authenticated` |
| Edge functions | No rate limiting | Add rate limiting logic |

**Fix**: Migration to update RLS policies + edge function code updates
**Effort**: 30 minutes for RLS, 1-2 hours for rate limiting

---

## 5. File Detection Pipeline (3-Level)

```
Upload → Fingerprint DB match (highest confidence)
       → Heuristic detection (column pattern matching via fingerprint-library.ts)
       → AI fallback (ai-file-interpreter edge function using Gemini)
```

Each level populates `marketplace_fingerprints` and `marketplace_file_fingerprints` tables for future auto-detection.

---

## 6. Xero Integration Architecture

### Flow
1. **OAuth2**: `xero-auth` edge function handles token exchange + refresh
2. **Push**: `sync-settlement-to-xero` creates Xero invoice with line items
3. **Sync-back**: `sync-xero-status` queries Xero for invoice status updates
4. **Auto-push**: `auto-push-xero` batch-pushes new settlements
5. **Rollback**: Void Xero invoice + reset local `xero_journal_id` and `status`

### Duplicate Prevention (3-layer)
1. Local check: `xero_journal_id` already set → skip
2. Pre-push API search: Query Xero by reference `Xettle-{id}` → skip if found
3. Legacy format support: `sync-xero-status` parses both new and legacy reference formats

### Reference Format
- **New**: `Xettle-{settlement_id}` (in Reference field)
- **Legacy**: Human-readable with `(settlement_id)` suffix
- Both parsed by sync-back function

---

## 7. Secrets Configuration (Verified)

| Secret | Purpose | Status |
|--------|---------|--------|
| `XERO_CLIENT_ID` | Xero OAuth2 | ✅ Set |
| `XERO_CLIENT_SECRET` | Xero OAuth2 | ✅ Set |
| `AMAZON_SP_CLIENT_ID` | Amazon SP-API OAuth2 | ✅ Set |
| `AMAZON_SP_CLIENT_SECRET` | Amazon SP-API OAuth2 | ✅ Set |
| `LOVABLE_API_KEY` | AI file interpreter | ✅ Set |
| `RESEND_API_KEY` | Email sending | ✅ Set |
| `SUPABASE_URL` | Edge function access | ✅ Auto |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge function admin access | ✅ Auto |
| `SUPABASE_PUBLISHABLE_KEY` | Client-side access | ✅ Auto |
| `SUPABASE_ANON_KEY` | Client-side access | ✅ Auto |
| `SUPABASE_DB_URL` | Direct DB access | ✅ Auto |

---

## 8. Recommended Fix Order

### Phase 1 — Integrity (Day 1)
1. ✅ Gap 1: Add DB unique constraint (5 min)
2. ✅ Gap 4: Fix RLS `public` → `authenticated` (30 min)

### Phase 2 — Dashboard Migration (Day 1-3)
3. Gap 2: Migrate `AccountingDashboard.tsx` to shared hooks (largest, highest impact)
4. Gap 2: Migrate `ShopifyPaymentsDashboard.tsx`
5. Gap 2: Migrate `BunningsDashboard.tsx`
6. Gap 2: Migrate `ShopifyOrdersDashboard.tsx`

### Phase 3 — Monetisation (Day 3-5)
7. Gap 3: Enable Stripe
8. Gap 3: Create subscription tiers matching existing roles
9. Gap 3: Implement plan-gating
10. Gap 3: Wire webhook for role assignment

### Phase 4 — Hardening (Day 5+)
11. Rate limiting on edge functions
12. Unit tests (Vitest) for parsers and engines
13. E2E tests for critical flows
14. Error monitoring setup

---

## 9. Code Quality Notes

### Strengths
- Clean separation: parsers → engines → hooks → components
- Consistent RLS pattern across 17 tables
- Smart 3-level file detection with learning
- Universal reconciliation works for any marketplace
- Well-structured edge functions with proper CORS

### Weaknesses
- `AccountingDashboard.tsx` at 4,395 lines is unmaintainable
- Some `as any` type casts in dashboard components
- No automated tests anywhere
- No error boundary at dashboard level (only app-level)
- Console.log statements in production code

---

## 10. Summary Stats

| Metric | Count |
|--------|-------|
| Total files | ~120 |
| React components | ~60 |
| Custom hooks | 8 |
| Utility modules | 14 |
| Edge functions | 10 |
| Database tables | 17 |
| RLS policies | ~40 |
| Parsers | 6 |
| Engines | 7 |
| Lines of dashboard code | ~8,500 |
| Lines on shared hooks | ~700 (GenericMarketplaceDashboard only) |
| Lines NOT on shared hooks | ~7,800 |

---

## Session 10+ — Gateway-Aware Payout Splitting

### Problem
Shopify payouts aggregate all transactions (direct + marketplace) into a single payout. Gateway names like "Mirakl", "Commercium by constacloud", and "Manual" indicate marketplace or non-standard origins but are not currently used to split settlements.

### Approach (Approved)
1. **Cross-reference `source_order_id`**: Each Shopify Balance Transaction has a `source_order_id`. Look this up against the cached `shopify_orders` table to get the `gateway` field.
2. **Group by gateway**: Within each payout, group transactions by resolved gateway → generate sub-settlements per marketplace.
3. **Mirakl resolution**: When gateway = "mirakl", cross-reference the order's `source_name` or tags to resolve the specific marketplace (Bunnings, Kmart, Target AU).
4. **Registry entries**: `mirakl` and `manual_bank_transfer` are already in `payment_processor_registry` (added Session 9).

### Performance Considerations
- Large payout histories (1000+ transactions) need batched lookups against `shopify_orders`
- Consider pre-building a gateway map during `fetch-shopify-orders` sync
- May need an index on `shopify_orders(shopify_order_id)` for fast joins

### Registry Data (already seeded)
- `mirakl` → type: `marketplace_operator`, needs source_name cross-reference
- `manual_bank_transfer` → type: `bank_transfer`, exclude from channel alerts
- `commercium by constacloud` → already in `GATEWAY_REGISTRY` → maps to Kogan

### Implementation Steps
1. Add `gateway` column awareness to `fetch-shopify-payouts` transaction processing
2. Build gateway→marketplace resolver function
3. Generate sub-settlement records per marketplace within a single payout
4. Update `marketplace_validation` to track split payouts
5. UI: Show split payout breakdown in Shopify Payments dashboard

---

## Session 10+ — Amazon Aggregate Bank Deposit Matching

### Problem
Amazon batches multiple settlements into a single bank deposit. The current matching engine compares individual invoice amounts against individual bank transactions, which will never match for Amazon.

### Approach
1. **Group Amazon invoices by settlement period**: Cluster by `deposit_date` or `period_end` within 3-day windows
2. **Sum net deposit amounts across settlements**: Calculate the expected aggregate deposit total
3. **Match sum against single bank transaction**: $1.00 tolerance and ±5-day date window
4. **Amazon deposit narration**: Typically contains "AMAZON" or seller account reference number — use for fuzzy matching

### UI Changes
- Outstanding tab: Show "Matched (aggregated)" badge for Amazon invoices matched via aggregate
- Bank deposit card: Show aggregate match count separately
- Drill-down: Show which settlements were grouped into the aggregate match
