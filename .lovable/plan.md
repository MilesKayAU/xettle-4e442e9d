# Xettle Complete Technical Audit
**Date: 9 March 2026**
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

## 2. Database Schema

### Tables (17 total)

| Table | Rows Purpose | RLS |
|-------|-------------|-----|
| `settlements` | Core settlement records — one per marketplace period | ✅ user_id scoped |
| `settlement_lines` | Transaction-level line items per settlement | ✅ user_id scoped |
| `settlement_unmapped` | Rows that couldn't be categorized during parsing | ✅ user_id scoped |
| `marketplace_connections` | User's active marketplace tabs | ✅ user_id scoped |
| `marketplaces` | Global marketplace metadata (admin-managed) | ✅ read=all, write=admin |
| `marketplace_fee_observations` | Fee rate observations per settlement | ✅ user_id scoped |
| `marketplace_fee_alerts` | Anomaly alerts when fee rates deviate | ✅ user_id + admin read |
| `marketplace_ad_spend` | Manual ad spend entries per marketplace | ✅ user_id scoped |
| `marketplace_shipping_costs` | Estimated shipping cost per order | ✅ user_id scoped |
| `marketplace_file_fingerprints` | Learned file column mappings per user | ✅ user_id scoped |
| `marketplace_fingerprints` | Shared + user-specific file detection patterns | ✅ user_id OR null (shared) |
| `product_costs` | SKU-level cost data for COGS | ✅ user_id scoped |
| `xero_tokens` | Xero OAuth2 tokens (encrypted at rest) | ✅ user_id scoped |
| `amazon_tokens` | Amazon SP-API tokens | ✅ user_id scoped |
| `app_settings` | Key-value user preferences | ✅ user_id scoped |
| `sync_history` | Audit log of sync events | ✅ user_id scoped, no delete |
| `user_roles` | Role assignments (admin, paid, pro, etc.) | ✅ read-only for users |

### Database Functions
| Function | Purpose |
|----------|---------|
| `has_role(_role)` | SECURITY DEFINER — checks user_roles without RLS recursion |
| `update_updated_at_column()` | Trigger function for auto-updating `updated_at` |

### Key Design Decisions
- No foreign keys to `auth.users` — user_id stored as UUID, not FK-constrained
- Roles in separate `user_roles` table (not on profiles) — prevents privilege escalation
- `settlement_id + marketplace + user_id` is the logical unique key (enforced in application code, not DB constraint)
- `settlements.source` column tracks origin: `manual`, `csv_upload`, `api`

---

## 3. Parsers (7 total)

| Parser | File | Lines | Input Format | Output |
|--------|------|-------|-------------|--------|
| **Amazon Settlement** | settlement-parser.ts | 715 | TSV (settlement report) | ParsedSettlement (Amazon-specific) |
| **Shopify Payments** | shopify-payments-parser.ts | 648 | CSV (payment_transactions_export) | StandardSettlement[] grouped by Payout ID |
| **Shopify Orders** | shopify-orders-parser.ts | 679 | CSV (orders export) | MarketplaceGroup[] → StandardSettlement[] via registry detection |
| **Bunnings** | bunnings-summary-parser.ts | 316 | PDF (summary of transactions) | StandardSettlement via pdf.js |
| **Woolworths MarketPlus** | woolworths-marketplus-parser.ts | 481 | CSV (combined Woolworths Group) | StandardSettlement[] split by Order Source |
| **Generic CSV** | generic-csv-parser.ts | 343 | CSV/XLSX (any) | StandardSettlement[] via column mapping |
| **File Fingerprint Engine** | file-fingerprint-engine.ts | 556 | Any file | FileDetectionResult (3-level: fingerprint → heuristic → AI) |

### Parser Pipeline
```
File → file-marketplace-detector.ts (sniff)
     → file-fingerprint-engine.ts (3-level detection)
     → specific parser (Amazon/Shopify/Bunnings/Woolworths/Generic)
     → StandardSettlement
     → settlement-engine.ts (save + dedup)
     → fee-observation-engine.ts (fire-and-forget analytics)
```

### StandardSettlement (universal type)
All parsers output `StandardSettlement` containing: marketplace, settlement_id, period_start/end, sales_ex_gst, gst_on_sales, fees_ex_gst, gst_on_fees, net_payout, source, reconciles, metadata.

---

## 4. Engines (5 total)

| Engine | File | Lines | Purpose |
|--------|------|-------|---------|
| **Settlement Engine** | settlement-engine.ts | 421 | Save, sync to Xero, rollback, delete, format helpers |
| **Universal Reconciliation** | universal-reconciliation.ts | 209 | 6-check recon for all non-Amazon marketplaces |
| **Amazon Reconciliation** | reconciliation-engine.ts | 189 | Amazon-specific recon with ParsedSettlement |
| **Fee Observation** | fee-observation-engine.ts | 281 | Extract fee rates, detect anomalies, create alerts |
| **Profit Engine** | profit-engine.ts | 135 | COGS calculation from SKU costs × order quantities |

### Reconciliation Checks (Universal)
1. **Balance Check** — calculated total ≈ net_payout (±$0.10 pass, ±$1.00 warn, >$1.00 fail)
2. **GST Consistency** — GST on sales ≈ sales/10 (±$0.50 pass, ±$2.00 warn)
3. **Refund Completeness** — refunds should have matching commission refunds
4. **Sanity Checks** — negative sales, zero payout with sales, fee rate >50%, payout > sales
5. **Historical Deviation** — fee rate vs average (±15% pass, ±30% warn)
6. **Xero Invoice Accuracy** — 2-line invoice total vs payout

---

## 5. Dashboard Components

### Marketplace Dashboards (5 types)

| Dashboard | File | Lines | Marketplaces | Uses Shared Hooks? |
|-----------|------|-------|-------------|-------------------|
| **AccountingDashboard** | AccountingDashboard.tsx | 4,395 | Amazon AU only | ❌ Own implementation |
| **GenericMarketplaceDashboard** | GenericMarketplaceDashboard.tsx | ~700 | MyDeal, Kogan, BigW, Everyday Market, PayPal, eBay, Manual, Shopify Orders-derived | ✅ Fully refactored |
| **ShopifyPaymentsDashboard** | ShopifyPaymentsDashboard.tsx | 800 | Shopify Payments | ❌ Own implementation |
| **BunningsDashboard** | BunningsDashboard.tsx | 1,230 | Bunnings | ❌ Own implementation |
| **ShopifyOrdersDashboard** | ShopifyOrdersDashboard.tsx | 1,315 | All Shopify gateway sources | ❌ Own implementation |

### Feature Matrix

| Feature | Generic ✅ | Amazon | Shopify Pay | Bunnings | Shopify Orders |
|---------|-----------|--------|-------------|----------|---------------|
| Dedup on save | ✅ engine | ✅ parser | ✅ engine | ✅ engine | ✅ engine |
| Transaction drill-down | ✅ shared | ✅ own | ✅ own | ✅ own | ✅ own |
| Inline recon checks | ✅ shared | ❌ at push only | ❌ at push only | ✅ own | ❌ |
| Xero push + recon gate | ✅ shared | ✅ own | ✅ own | ✅ own | ✅ own |
| Rollback from Xero | ✅ shared | ✅ own | ❌ | ❌ | ❌ |
| Refresh from Xero | ✅ shared | ✅ own | ❌ | ❌ | ❌ |
| Bulk select + delete | ✅ shared | ✅ own | ✅ own | ✅ own | ✅ own |
| Xero-aware bulk delete | ✅ shared | ❌ | ❌ | ❌ | ❌ |
| Gap detection | ✅ shared | ❌ | ✅ own | ✅ own | ❌ |
| Mark Already in Xero | ✅ shared | ✅ own | ✅ own | ❌ | ✅ own |
| Bank verification | ✅ own | ✅ own | ❌ | ❌ | ❌ |
| Split-month handling | ❌ | ✅ own | ❌ | ❌ | ❌ |

### Shared Hooks (created this session)

| Hook | File | Purpose |
|------|------|---------|
| useSettlementManager | src/hooks/use-settlement-manager.ts | Load, delete, realtime |
| useBulkSelect | src/hooks/use-bulk-select.ts | Checkbox + Xero-aware bulk delete |
| useXeroSync | src/hooks/use-xero-sync.ts | Push, rollback, refresh, mark-synced |
| useReconciliation | src/hooks/use-reconciliation.ts | Inline recon per card |
| useTransactionDrilldown | src/hooks/use-transaction-drilldown.ts | Line item expansion |

### Shared Components

| Component | File | Purpose |
|-----------|------|---------|
| SettlementStatusBadge | shared/SettlementStatusBadge.tsx | Consistent status badges |
| ReconChecksInline | shared/ReconChecksInline.tsx | Recon check display |
| BulkDeleteDialog | shared/BulkDeleteDialog.tsx | Xero-aware delete confirmation |
| GapDetector | shared/GapDetector.tsx | Period gap warnings |

### Other Key Components

| Component | File | Lines | Purpose |
|-----------|------|-------|---------|
| SmartUploadFlow | SmartUploadFlow.tsx | 1,516 | Universal file upload with 3-level detection |
| InsightsDashboard | InsightsDashboard.tsx | 1,186 | Cross-marketplace analytics, fee trends, ad spend |
| MarketplaceSwitcher | MarketplaceSwitcher.tsx | 409 | Tab management, add/remove marketplaces |
| MonthlyReconciliationStatus | MonthlyReconciliationStatus.tsx | — | Monthly recon status overview |
| SkuCostManager | SkuCostManager.tsx | — | SKU cost CRUD for COGS |
| OnboardingChecklist | OnboardingChecklist.tsx | — | New user setup wizard |

---

## 6. Edge Functions (10 total)

| Function | Purpose | Auth | Secrets Used |
|----------|---------|------|-------------|
| `sync-settlement-to-xero` | Create/void Xero invoices | user_id | XERO_CLIENT_ID, XERO_CLIENT_SECRET |
| `sync-xero-status` | Refresh invoice statuses from Xero | user_id | XERO_CLIENT_ID, XERO_CLIENT_SECRET |
| `xero-auth` | OAuth2 token exchange for Xero | user_id | XERO_CLIENT_ID, XERO_CLIENT_SECRET |
| `auto-push-xero` | Cron: auto-push unsaved settlements for Pro users | service_role | XERO_CLIENT_ID, XERO_CLIENT_SECRET |
| `sync-amazon-journal` | Sync Amazon settlements as Xero journals | user_id | XERO_CLIENT_ID, XERO_CLIENT_SECRET |
| `amazon-auth` | OAuth2 token exchange for Amazon SP-API | user_id | AMAZON_SP_CLIENT_ID, AMAZON_SP_CLIENT_SECRET |
| `fetch-amazon-settlements` | Fetch settlement reports from Amazon | user_id | AMAZON_SP_CLIENT_ID, AMAZON_SP_CLIENT_SECRET |
| `ai-file-interpreter` | AI-powered file detection (Level 3) | anon | LOVABLE_API_KEY |
| `admin-list-users` | List all users (admin only) | admin role | SERVICE_ROLE_KEY |
| `admin-manage-users` | Manage user roles (admin only) | admin role | SERVICE_ROLE_KEY |

---

## 7. Security Assessment

### ✅ Strengths
- **RLS on all tables** — every table has user_id-scoped policies
- **Roles in separate table** — user_roles is read-only for users, no privilege escalation
- **SECURITY DEFINER function** — has_role() bypasses RLS recursion safely
- **Input sanitization** — email, text, phone sanitizers in input-sanitization.ts
- **Honeypot anti-spam** — on auth forms
- **Email verification required** — auto-confirm is NOT enabled
- **No secrets in code** — all API keys in Lovable Cloud secrets
- **Error boundary** — global ErrorBoundary wraps the app
- **PinGate** — additional access control layer

### ⚠️ Warnings
1. **No DB-level unique constraint** on `(settlement_id, marketplace, user_id)` — dedup is application-level only. A race condition could theoretically create duplicates.
2. **settlement_lines has no UPDATE RLS** — intentional (immutable), but worth documenting
3. **marketplace_fee_alerts has no DELETE RLS** — alerts are permanent
4. **sync_history has no UPDATE/DELETE** — audit log is append-only (good)
5. **marketplace_ad_spend and marketplace_shipping_costs use `public` role** instead of `authenticated` — should be tightened

### 🔴 Issues
1. **No rate limiting** on edge functions — a malicious user could spam Xero API calls
2. **`as any` casts** used in several places when updating settlements — type safety bypassed
3. **No CSRF protection** on auth forms beyond honeypot

---

## 8. Marketplace Registry

Central registry at `src/utils/marketplace-registry.ts` (319 lines) defines:
- 15+ marketplace entries (MyDeal, Bunnings, Kogan, BigW, Catch, eBay, PayPal, etc.)
- Detection patterns: Note Attributes, Tags, Payment Method columns
- Xero contact names and account codes per marketplace
- Skip rules for gateways that shouldn't generate invoices (Shopify Payments, Afterpay, etc.)

### Supported Marketplaces
| Marketplace | Payment Type | Detection Source |
|------------|-------------|-----------------|
| MyDeal | direct_bank_transfer | Note Attributes / Tags |
| Bunnings | direct_bank_transfer | Note Attributes / Tags |
| Kogan | direct_bank_transfer | Note Attributes / Tags |
| Big W | direct_bank_transfer | Woolworths MarketPlus CSV |
| Everyday Market | direct_bank_transfer | Woolworths MarketPlus CSV |
| Catch | direct_bank_transfer | Note Attributes / Tags |
| eBay | direct_bank_transfer | Tags / Payment Method |
| PayPal | gateway_clearing | Payment Method |
| Amazon AU | direct_bank_transfer | Dedicated parser (TSV) |
| Shopify Payments | gateway_clearing | Dedicated parser (CSV) |
| The Iconic | direct_bank_transfer | Tags |
| Afterpay | gateway_clearing | Payment Method (skipped) |
| Zip Pay | gateway_clearing | Payment Method (skipped) |

---

## 9. File Sizes & Complexity

### Largest Files (risk areas for maintenance)
| File | Lines | Recommendation |
|------|-------|---------------|
| AccountingDashboard.tsx | 4,395 | 🔴 Needs refactor to shared hooks |
| SmartUploadFlow.tsx | 1,516 | ⚠️ Large but cohesive |
| ShopifyOrdersDashboard.tsx | 1,315 | ⚠️ Should migrate to shared hooks |
| BunningsDashboard.tsx | 1,230 | ⚠️ Should migrate to shared hooks |
| InsightsDashboard.tsx | 1,186 | ⚠️ Large but read-only analytics |
| ShopifyPaymentsDashboard.tsx | 800 | ⚠️ Should migrate to shared hooks |
| settlement-parser.ts | 715 | OK — complex by nature |
| GenericMarketplaceDashboard.tsx | ~700 | ✅ Refactored to shared hooks |

---

## 10. Gap Analysis & Recommendations

### Priority 1: Migrate Remaining Dashboards to Shared Hooks
**Impact: HIGH — prevents feature drift**

The following dashboards still have inline implementations of features now available as shared hooks:
- **ShopifyPaymentsDashboard** — missing rollback, refresh, inline recon, Xero-aware delete
- **BunningsDashboard** — missing rollback, refresh, Xero-aware delete, mark-as-synced
- **ShopifyOrdersDashboard** — missing inline recon, rollback, refresh, gap detection
- **AccountingDashboard** — massive (4,395 lines), uses its own reconciliation engine, would benefit from partial extraction

### Priority 2: Database Integrity
**Impact: MEDIUM — prevents data corruption**

- Add unique constraint: `CREATE UNIQUE INDEX idx_settlement_dedup ON settlements (settlement_id, marketplace, user_id)`
- Tighten RLS on marketplace_ad_spend and marketplace_shipping_costs: change `public` → `authenticated`
- Add DELETE policy for marketplace_fee_alerts (or document why it's intentionally absent)

### Priority 3: Edge Function Hardening
**Impact: MEDIUM — prevents abuse**

- Add rate limiting to sync-settlement-to-xero (e.g. 60 calls/min per user)
- Add request validation schemas to all edge functions
- Log all Xero API errors to sync_history for audit trail

### Priority 4: Type Safety
**Impact: LOW — developer experience**

- Remove `as any` casts in settlement-engine.ts and dashboard components
- Create proper TypeScript types for Xero API responses
- Use zod schemas for edge function request validation

### Priority 5: Testing
**Impact: HIGH — regression prevention**

- No test files exist in the project
- Priority test targets: settlement-parser.ts, universal-reconciliation.ts, settlement-engine.ts
- Consider Vitest for unit tests on parsers and engines

---

## 11. Xero Integration Deep Dive

### Invoice Model
- **Simple marketplaces** (Generic): 2+ line invoice (Sales + Fees + optional Refunds/Shipping/Subscription)
- **Amazon**: Multi-line invoice with FBA fees, storage, refunds, reimbursements, promotions
- **Shopify Orders**: $0.00 clearing invoices (gateway already collected payment)

### Xero Sync Flow
```
User clicks "Push to Xero"
→ runUniversalReconciliation() — blocks if canSync=false
→ buildSimpleInvoiceLines() — creates line items
→ syncSettlementToXero() — calls edge function
→ sync-settlement-to-xero edge function:
  1. Refresh Xero token if expired
  2. Create/find Xero contact
  3. Check for duplicate invoice (by reference)
  4. Create AUTHORISED invoice via Xero API
  5. Return invoiceId + invoiceNumber
→ Update settlement: status='synced', xero_journal_id, xero_invoice_number
```

### Rollback Flow
```
User clicks "Rollback"
→ rollbackSettlementFromXero() — calls edge function with action='rollback'
→ Edge function voids invoice(s) in Xero
→ Update settlement: status='saved', clear xero fields
```

---

## 12. Smart Upload Pipeline

### 3-Level Detection
| Level | Method | Speed | Accuracy |
|-------|--------|-------|----------|
| 1 | Fingerprint matching (column patterns) | <50ms | 95%+ |
| 2 | Heuristic column mapping with scoring | <200ms | 85%+ |
| 3 | AI analysis (edge function → LLM) | 2-5s | 90%+ |

### Supported File Types
- CSV, TSV (text parsing)
- XLSX (via xlsx library)
- PDF (via pdfjs-dist — Bunnings only)

### Upload Flow
```
Drop file(s)
→ detectFile() — 3-level detection
→ Show preview card with marketplace, confidence, financial summary
→ User confirms or overrides marketplace
→ Route to correct parser
→ saveSettlement() — with dedup check
→ Auto-create marketplace tab if new
→ Toast success/error
```

---

## 13. Authentication & Authorization

### Auth Flow
- Email/password with mandatory email verification
- Password reset via Supabase Auth
- Session management via onAuthStateChange listener
- Redirect to /auth if unauthenticated

### Role System
| Role | Purpose | Capabilities |
|------|---------|-------------|
| `user` | Default | Basic CRUD on own data |
| `paid` | Paid tier | — |
| `starter` | Starter plan | — |
| `pro` | Pro plan | Auto-push Xero cron |
| `admin` | Administrator | Manage users, global marketplace config |
| `moderator` | Moderator | — |

### Admin Features
- User listing via admin-list-users edge function
- Role management via admin-manage-users edge function
- Both require `admin` role check

---

## 14. Summary Statistics

| Metric | Count |
|--------|-------|
| Total source files | ~90 |
| Total lines of code (est.) | ~25,000 |
| Database tables | 17 |
| Edge functions | 10 |
| Parsers | 7 |
| Engines | 5 |
| Dashboard components | 5 |
| Shared hooks | 5 |
| Shared UI components | 4 |
| Supported marketplaces | 15+ |
| Xero API integrations | 4 (create, void, status, auto-push) |
| Amazon SP-API integrations | 2 (auth, fetch settlements) |

---

*Last updated: 9 March 2026 — post shared-hooks architecture refactor*
