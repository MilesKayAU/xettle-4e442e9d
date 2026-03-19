# Xettle — Architecture & System Review

**Last updated**: 2026-03-14 (v3 — added Core Matching Rule, settlement-level matching)
**Codebase**: React + Vite + TypeScript + Tailwind CSS + Lovable Cloud (Supabase)

---

## 0. Core Matching Rule (MUST READ FIRST)

> **Xettle = Settlement validation + invoice matching + controlled push to Xero.**
>
> Not bank sync. Not statement reader. Not journal uploader.

### Matching Order (canonical, never deviate)

1. Outstanding invoices (from Xero)
2. Settlement data (Amazon / marketplace / uploaded files)
3. Group by canonical `settlement_id` (after alias resolution)
4. Compare grouped invoice totals to `getSettlementNet(settlement)` = `abs(bank_deposit ?? net_ex_gst ?? 0)`
5. Suggest match with confidence (high ≤$0.10, medium ≤$0.50)
6. User confirms → push to Xero
7. Bank feed only confirms — never drives matching

### Rules

- **Settlement data is the source of truth**, not bank transactions.
- **Match at settlement level**, not invoice level. Invoices may be split (P1/P2), but settlements are the grouping key.
- **Bank feed is optional verification.** Never require it. Never block matching because bank feed is empty.
- **Never match invoice → bank → settlement** when settlement data already exists.
- **Do not create new pipelines** if the data already exists. Fix grouping before adding new APIs.

### UI Rule

Outstanding tab shows: `settlement_matched` · `ready_to_push` · `mismatch` · `missing_settlement` · `missing_invoice`

NOT: `bank not found` · `feed empty` · `waiting for bank`

### Architecture Guardrail

When implementing new logic, ask: *Does this help the user understand which settlement pays which invoices?* If not, it is likely unnecessary complexity.

---

## 1. What Xettle Is

Xettle is an **automated marketplace accounting bridge** designed for Australian e-commerce sellers who sell through multiple marketplaces (Amazon AU, Shopify, Bunnings, Kogan, Catch, eBay, Big W, MyDeal, Everyday Market, etc.) and need those marketplace settlements reconciled into Xero.

The core value proposition:

> **Marketplace settlement → Xero invoice → Bank reconciliation — fully automated.**
>
> The end-to-end flow: Connect Xero → Map bank accounts → Ingest settlements (API or CSV) → Push to Xero as DRAFT → Match against bank deposits → Reconcile in Xero → Verified ✓

Xettle replaces manual data entry, CSV gymnastics, and services like LinkMyBooks by providing a settlement-centric accounting pipeline that:

1. **Ingests** marketplace settlement data (via API or CSV upload)
2. **Normalises** it into a standard financial model (13 categories)
3. **Pushes** it to Xero as DRAFT invoices with correct GST, account codes, and line-by-line breakdowns
4. **Verifies** the Xero entry against bank deposits for one-click reconciliation
5. **Monitors** the full lifecycle from ingestion to bank verification

---

## 2. System Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        FRONTEND                             │
│  React + Vite + TypeScript + Tailwind + shadcn/ui           │
│                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────┐  │
│  │ Landing  │  │  Setup   │  │Dashboard │  │   Admin    │  │
│  │  Page    │  │  Wizard  │  │  (User)  │  │(Accounting)│  │
│  └──────────┘  └──────────┘  └──────────┘  └────────────┘  │
│                                                             │
│  Shared: ErrorBoundary, PinGate, BugReport, AI Assistant    │
│  Auth: Email/password with email verification               │
│  State: React Query (5min stale), Supabase Realtime         │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    EDGE FUNCTIONS (Deno)                     │
│                                                             │
│  Ingestion:          Sync:              Verification:       │
│  ├ fetch-amazon-     ├ sync-xero-       ├ match-bank-       │
│  │ settlements       │ status           │ deposits          │
│  ├ fetch-shopify-    ├ sync-settlement- ├ verify-payment-   │
│  │ payouts           │ to-xero          │ matches           │
│  ├ fetch-shopify-    ├ sync-amazon-     ├ apply-xero-       │
│  │ orders            │ journal          │ payment           │
│  ├ auto-generate-    ├ auto-push-xero   ├ fetch-xero-bank-  │
│  │ shopify-          ├ scan-xero-       │ transactions      │
│  │ settlements       │ history          └───────────────────│
│  └──────────────     └──────────────                        │
│                                                             │
│  Auth:               Admin:             AI:                 │
│  ├ xero-auth         ├ admin-list-users ├ ai-assistant      │
│  ├ amazon-auth       ├ admin-manage-    ├ ai-file-          │
│  ├ shopify-auth      │ users            │ interpreter       │
│  └──────────────     ├ account-reset    ├ ai-account-mapper │
│                      └──────────────    ├ ai-bug-triage     │
│                                         └──────────────     │
│  Orchestration:                                             │
│  ├ scheduled-sync (cron)                                    │
│  ├ run-validation-sweep                                     │
│  ├ historical-audit                                         │
│  ├ scan-shopify-channels                                    │
│  └ fetch-outstanding                                        │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    DATABASE (Postgres)                       │
│                                                             │
│  Core:                    Cache/Index:                       │
│  ├ settlements             ├ xero_accounting_matches        │
│  ├ settlement_lines        ├ xero_chart_of_accounts         │
│  ├ settlement_unmapped     ├ shopify_orders                 │
│  ├ marketplace_validation  ├ bank_transactions              │
│  ├ payment_verifications   ├ shopify_sub_channels           │
│  ├ system_events           └─────────────────────           │
│  ├ sync_history                                             │
│  ├ sync_locks              Auth/Config:                     │
│  └─────────────            ├ xero_tokens                    │
│                            ├ amazon_tokens                  │
│                            ├ shopify_tokens                 │
│                            ├ app_settings                   │
│                            ├ user_roles                     │
│                            ├ profiles                       │
│                            ├ bug_reports                    │
│                            └─────────────────────           │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    EXTERNAL APIs                            │
│                                                             │
│  ├ Xero API (Invoices, Attachments, Bank Transactions,      │
│  │           Chart of Accounts, Contacts, Tracking)         │
│  ├ Amazon SP-API (Settlement Reports)                       │
│  ├ Shopify REST API (Payouts, Balance Transactions, Orders) │
│  └ Lovable AI (Gemini, GPT for assistant & file parsing)    │
└─────────────────────────────────────────────────────────────┘
```

---

## 3. Core Pipeline — The Settlement Lifecycle

### 3.1 State Machine

```
ingested → ready_to_push → pushed_to_xero → reconciled_in_xero → bank_verified
                 ↓
           push_failed → push_failed_permanent
```

Source of truth: `src/constants/settlement-status.ts`

### 3.2 Sync Orchestration (Xero-First)

The system follows a **Xero-First** philosophy: audit Xero → compute boundary → fetch marketplaces.

**Execution order per sync path:**

| Sync Path | Xero-First? | Boundary Used? | Notes |
|-----------|-------------|----------------|-------|
| **Scheduled cron** (`scheduled-sync`) | ✅ Yes | ✅ `xero_oldest_outstanding_date` | Canonical path. Xero audit → boundary → Amazon/Shopify fetch |
| **UI manual sync** (PostSetupBanner) | ✅ Yes | ✅ Same | Calls same pipeline as cron |
| **Amazon Connection Panel** (Fetch All) | ✅ Yes | ✅ Same | Runs `sync-xero-status` → reads boundary → passes `sync_from` to Amazon fetch |
| **Initial connect** (no Xero data yet) | ⚠️ N/A | ❌ 90-day fallback | No Xero history exists; `createdSince` defaults to 90-day window. Expected behaviour. |

**Steps (when Xero is connected):**

1. **Xero Audit** (`sync-xero-status`) — Scans Xero for existing invoices, pre-seeds `xero_accounting_matches` cache
2. **Boundary Computation** — Derives `xero_oldest_outstanding_date` from the oldest unresolved Xero invoice
3. **Marketplace Fetch** — Amazon and Shopify fetches use the boundary as `sync_from` / `createdSince` to constrain the API query window
4. **Auto-Link** — Newly ingested settlements are matched against pre-seeded `xero_accounting_matches` entries
5. **Validation Sweep** — Cross-checks all settlements for consistency
6. **Bank Matching** — Matches settlements against bank deposits

**Amazon API note:** `fetch-amazon-settlements` uses `sync_from` for `createdSince` when provided. A secondary skip-filter on `dataEndTime < sync_from` exists as defense-in-depth. When no `sync_from` is provided (initial connect), it falls back to a 90-day window — this is correct since there is no Xero data to bound against yet.

### 3.3 Three-Layer Accounting Model (Rule #11)

```
Orders     → NEVER create accounting entries
Payments   → NEVER create accounting entries  
Settlements → ONLY source of accounting entries
```

Payment matching is **verification only** — it confirms bank deposit parity but never creates Xero invoices, journals, or bills.

Source of truth: `src/constants/accounting-rules.ts`

### 3.4 Invoice Reference System

References are generated **server-side only** — the client never controls invoice references.

| Format | Usage |
|--------|-------|
| `Xettle-{settlement_id}` | Standard single-month settlement |
| `Xettle-{settlement_id}-P1` | Split-month: first month (P&L allocation) |
| `Xettle-{settlement_id}-P2` | Split-month: second month (bank deposit match) |

Legacy formats (`AMZN-{id}`, `LMB-*-{id}-*`) are read-only for backwards compatibility.

### 3.5 End-to-End Reconciliation Flow

This is the complete journey from initial setup to fully reconciled accounts:

```
┌──────────────────────────────────────────────────────────────────────┐
│  1. CONNECT                                                          │
│     User connects Xero + marketplace APIs (Amazon, Shopify, etc.)    │
│     Setup Wizard or Dashboard handles OAuth flows                    │
└──────────────────────┬───────────────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│  2. MAP BANK ACCOUNTS                                                │
│     PayoutBankAccountMapper: link each marketplace to a Xero         │
│     bank account (e.g., Amazon AU → "Miles Kay Australia")           │
│     Stored in app_settings as payout_account:{marketplace_code}      │
│     Without this, deposit matching is paused.                        │
└──────────────────────┬───────────────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│  3. INGEST SETTLEMENTS                                               │
│     API: fetch-amazon-settlements, fetch-shopify-payouts             │
│     CSV: Smart Upload Flow (AI-detected marketplace + column map)    │
│     Result: settlement rows in 13-category financial model           │
└──────────────────────┬───────────────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│  4. PUSH TO XERO                                                     │
│     Push Safety Preview validates: sum match, account codes, GST,    │
│     contact mapping, bank verification                               │
│     Creates DRAFT invoice (ACCREC) or bill (ACCPAY for negatives)    │
│     Attaches 16-column audit CSV automatically                       │
└──────────────────────┬───────────────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│  5. OUTSTANDING TAB — TRACK & ACT                                    │
│     Fetches all Xero ACCREC invoices (DRAFT/SUBMITTED/AUTHORISED)    │
│     Shows: which settlements are pushed, awaiting deposit, or        │
│     missing data. Users can upload missing CSVs or trigger fetches.  │
│     Pre-seeds xero_accounting_matches for instant auto-linking.      │
└──────────────────────┬───────────────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│  6. BANK DEPOSIT MATCHING                                            │
│     match-bank-deposits: uses payout_account mapping to filter       │
│     bank transactions per marketplace                                │
│     Two-pass: Individual (±$0.50) then Batch (±$1.00)                │
│     Score ≥ 90 = auto-applied. UI shows Verified/Mismatch badge.     │
└──────────────────────┬───────────────────────────────────────────────┘
                       ▼
┌──────────────────────────────────────────────────────────────────────┐
│  7. RECONCILED                                                       │
│     Settlement status: bank_verified                                 │
│     Xero invoice marked PAID once payment is applied                 │
│     Full audit trail in system_events                                │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 4. Marketplace Support

### 4.1 Built-in Marketplaces (Registry)

Source of truth: `src/utils/marketplace-registry.ts`

| Marketplace | Payment Type | Detection Method |
|-------------|-------------|-----------------|
| Amazon AU | Direct bank transfer | SP-API settlement reports |
| Shopify Payments | Gateway clearing | REST API payouts + balance transactions |
| Bunnings | Direct bank transfer | CSV upload / Shopify sub-channel |
| Kogan | Direct bank transfer | Shopify order tags/notes |
| MyDeal | Direct bank transfer | Shopify order tags/notes |
| Catch | Direct bank transfer | Shopify order tags/notes |
| eBay | Direct bank transfer | Shopify order tags/notes |
| Big W | Direct bank transfer | Shopify order tags/notes |
| Everyday Market | Direct bank transfer | Shopify order tags/notes |
| PayPal | Gateway clearing | Shopify payment method |
| Afterpay | Gateway clearing | Shopify payment method |
| Stripe | Gateway clearing | Shopify payment method |

### 4.2 Sub-Channel Detection

For Shopify sellers who sell on multiple marketplaces via a single Shopify store, Xettle detects sub-channels from order metadata (Note Attributes → Tags → Payment Method) and auto-provisions per-marketplace connections.

### 4.3 Generic CSV Upload

Any marketplace settlement CSV can be uploaded via the Smart Upload Flow. An AI file interpreter detects the marketplace, maps columns, and normalises data into the standard 13-category financial model.

---

## 5. Key Subsystems

### 5.1 Xero Integration

- **Push**: DRAFT invoices (ACCREC) or bills (ACCPAY for negative settlements)
- **Split-Month**: Settlements spanning month boundaries are split into two invoices using Account 612 (Deferred Revenue) for P&L accuracy
- **Tracking Categories**: Optional "Sales Channel" tracking for per-marketplace P&L
- **Chart of Accounts Validation**: Pre-push validation ensures all account codes exist and are correct type (revenue/expense)
- **Audit CSV**: 16-column settlement CSV auto-attached to each Xero invoice
- **Duplicate Guard**: Cache-first check (`xero_accounting_matches`) + Xero API fallback + legacy reference search
- **Rate Limit Protection**: 90-second cooldown after HTTP 429, cursor-based incremental scanning

### 5.2 Push Safety Preview

All Xero pushes are intercepted by a mandatory preview modal showing:
- Full financial breakdown (line items, GST, net total)
- 5-point validation suite (Sum match, Account codes, GST, Contact mapping, Bank verification)
- "Confirm and push" button **disabled** if any red validation errors exist
- All pushes create DRAFT status — user must approve in Xero

### 5.3 Bank Deposit Matching

Two-pass heuristic matcher:
1. **Individual match**: Amount ±$0.50 + bank narration analysis + date proximity → score ≥ 90 = auto-apply
2. **Batch match**: Sum of multiple settlements ±$1.00 → score ≥ 90 = auto-apply

Gateway payment verification (PayPal, Shopify Payments) is **suggestion-only** — never auto-applies.

### 5.4 Insights Engine

- Marketplace profit comparison (revenue, fees, net margin per channel)
- SKU-level cost tracking and comparison
- Fee observation engine (trend detection, alert thresholds)
- Return ratio monitoring per marketplace

### 5.5 AI Assistant

- Chat-based help powered by Lovable AI (Gemini/GPT models)
- AI file interpreter for unknown CSV formats
- AI account mapper for Xero Chart of Accounts suggestions
- AI bug triage for automated issue classification

### 5.6 Payout Bank Account Mapping

Each marketplace must be explicitly linked to a specific Xero bank account to enable deposit matching. Without this mapping, the reconciliation engine cannot verify that a settlement's payout arrived in the correct bank account.

**How it works:**

1. **Xero bank accounts are fetched** via `fetch-xero-bank-accounts` — returns all active bank accounts from the user's Xero organisation
2. **User maps each marketplace** to a bank account (e.g., Amazon AU → "Miles Kay Australia", Shopify → "WISE AUD")
3. **Mappings are stored** in `app_settings` as key-value pairs:
   - `payout_account:_default` → fallback for unmapped marketplaces
   - `payout_account:amazon_au` → marketplace-specific override
   - Value = Xero bank account GUID
4. **Deposit matching engine** (`match-bank-deposits`) reads these mappings to filter bank transactions per marketplace, preventing cross-account false positives and reducing Xero API rate-limit pressure

**UI placement (3 locations for maximum discoverability):**

| Location | When shown | Purpose |
|----------|------------|---------|
| **Dashboard banner** (amber nudge) | When `payout_account:_default` is missing AND Xero is connected | Guides existing users to configure mapping |
| **Settings tab** (first item) | Always visible in Settlements → Settings | Primary configuration interface |
| **Setup Hub** (`/setup`) | When Xero is connected during onboarding | New user onboarding — configure before first reconciliation |

Component: `src/components/settings/PayoutBankAccountMapper.tsx`

### 5.7 Outstanding Tab — Source of Truth for Reconciliation

The Outstanding tab is the system's **primary action centre** for reconciliation. It fetches all Xero `ACCREC` invoices with `DRAFT`, `SUBMITTED`, or `AUTHORISED` status, providing comprehensive visibility of what needs attention.

**Workflow:**

```
Xero Outstanding Invoices
    │
    ├─ Marketplace invoice found → Link to settlement
    │   ├─ Settlement exists → Show "Awaiting deposit" (grey clock) or "Deposit matched ✓"
    │   └─ Settlement missing → Show "Syncing settlement..." (blue spinner)
    │       └─ User can: Upload CSV or trigger API fetch
    │
    ├─ Non-marketplace invoice → Tagged separately, still visible
    │
    └─ Rate limited (429) → Show "Rate limited — retrying automatically" banner
        └─ Returns 200 OK with empty data + sync_info to prevent UI crashes
```

**Key behaviours:**
- **Pre-seeds `xero_accounting_matches` cache** — newly imported settlements auto-link to Xero records instantly
- **Context-aware connection prompts** — identifies unmatched invoices per marketplace and shows "Connect" (for API-capable) or "Upload" (for CSV-only) buttons
- **Deposit coverage view** — links multiple settlements to a single bank deposit via `deposit_group_id` (UUID), verifying aggregate deposits (e.g., Amazon batched payouts) within $0.05 tolerance
- **Resilient data fetching** — Xero 429 responses return structured empty data, not errors

### 5.8 Onboarding

- 5-step setup wizard (Connect Stores → Connect Xero → Upload CSVs → Scanning → Results)
- Accounting boundary date configuration (temporal gate for all accounting entries)
- **Bank account mapping** embedded in Setup Hub between channel detection and settlement validation
- Post-setup banner with live sync status per integration
- Welcome guide with contextual next-action suggestions

### 5.9 Admin & Platform

- Role-based access: `admin`, `pro`, `starter`, `trial`, `user`
- Trial system with configurable duration and tier-gated features
- Bug report system with AI triage
- Pre-launch checklist dashboard
- Data integrity monitoring
- Knowledge base management
- Account reset capability (admin-only)

---

## 6. Multi-Tenant Safety

Every database query touching user data **must** include `.eq('user_id', userId)`. This is enforced at:

- **Edge function level**: Authenticated `userId` derived from JWT, never from request body
- **Database level**: `UNIQUE(user_id, marketplace, settlement_id)` on settlements
- **Cache level**: `UNIQUE(user_id, settlement_id)` on `xero_accounting_matches`
- **RLS policies**: Row-level security on all user-facing tables

Roles are stored in a separate `user_roles` table (never on profiles) with `has_role()` security definer function.

---

## 7. Dashboard Composition Architecture

All marketplace dashboards use a **composition pattern** — shared hooks for logic, shared components for UI.

### Mandatory Hooks

| Hook | Purpose |
|------|---------|
| `useSettlementManager` | Load, delete, realtime subscription |
| `useBulkSelect` | Checkbox selection, Xero-aware bulk delete |
| `useXeroSync` | Push, rollback, refresh, mark-as-synced |
| `useReconciliation` | Inline recon checks per settlement |
| `useTransactionDrilldown` | Line item expansion + loading |

### Mandatory Components

| Component | Purpose |
|-----------|---------|
| `SettlementStatusBadge` | Consistent status badges across all dashboards |
| `ReconChecksInline` | Reconciliation check display |
| `BulkDeleteDialog` | Xero-aware delete confirmation |
| `GapDetector` | Period gap warnings |

### Feature Checklist (every dashboard MUST implement)

- Dedup on save (`settlement_id + marketplace + user_id`)
- Transaction drill-down (settlement_lines query)
- Inline reconciliation checks
- Xero push with recon gate
- Rollback (void Xero invoice + reset status)
- Refresh from Xero
- Bulk select + delete (Xero-aware)
- Gap detection
- Mark as Already in Xero

---

## 8. Idempotency & Data Integrity

| Table | Method | Constraint |
|-------|--------|-----------|
| `settlements` | upsert | `UNIQUE(user_id, marketplace, settlement_id)` |
| `settlement_lines` | delete + insert | delete by `(user_id, settlement_id)` first |
| `settlement_unmapped` | delete + insert | delete by `(user_id, settlement_id)` first |
| `xero_accounting_matches` | upsert | `UNIQUE(user_id, settlement_id)` |
| `payment_verifications` | upsert | `onConflict: 'settlement_id,gateway_code'` |
| `sync_locks` | atomic RPC | `UNIQUE(user_id, integration, lock_key)` |

---

## 9. Deterministic vs Heuristic Matching

| Function | Type | Method | Overwrites Deterministic? |
|----------|------|--------|--------------------------|
| `sync-xero-status` reference match | **Deterministic** | `Xettle-{id}` / `AMZN-{id}` / `LMB-*` | No — only if uncached |
| `sync-xero-status` fuzzy match | **Heuristic** | Amount ±$5/5% + date ±7d + contact | No — guarded by cache-miss check |
| `match-bank-deposits` individual | **Heuristic** | Amount ±$0.50 + narration + date | No — status guard |
| `match-bank-deposits` batch | **Heuristic** | Sum ±$1.00 + narration | No — status guard |
| `verify-payment-matches` | **Heuristic** | Order sums ±3% | Never writes — suggestions only |
| Auto-link on ingestion | **Deterministic** | Pre-seeded `xero_accounting_matches` | Yes — first ingestion only |

---

## 10. Parser Architecture

| Location | Runtime | Purpose |
|----------|---------|---------|
| `src/utils/settlement-parser.ts` | Browser | CSV upload parsing |
| `supabase/functions/fetch-amazon-settlements/index.ts` (embedded) | Deno | API settlement parsing |

Both maintain a `PARSER_VERSION` constant (currently `v1.7.1`). Deno edge functions cannot import from `src/`, so the parser is duplicated. Version drift is the primary risk.

---

## 11. Tech Stack Summary

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, TypeScript, Vite, Tailwind CSS, shadcn/ui |
| State | React Query, Supabase Realtime |
| Routing | React Router v6 (lazy-loaded pages) |
| Charts | Recharts |
| PDF | pdfjs-dist |
| Spreadsheets | xlsx |
| Backend | Lovable Cloud (Supabase — Postgres + Edge Functions) |
| Auth | Supabase Auth (email/password with verification) |
| AI | Lovable AI (Gemini 2.5/3, GPT-5 series) |
| Testing | Vitest (unit), Playwright (visual/E2E) |
| CI | Percy (visual regression via GitHub Actions) |

---

## 12. Architecture Review — Strengths

### What Xettle does well:

1. **Settlement-centric model is correct** — Using settlements (not orders/payments) as the sole accounting source is the right abstraction for marketplace sellers. It matches how Amazon/Shopify actually pay sellers and eliminates double-counting.

2. **Deterministic reference system** — Server-side `Xettle-{id}` generation with legacy format support and cache-first duplicate detection is robust. The recent fix to remove client-controlled references was critical.

3. **Xero-First sync philosophy** — Scanning Xero before marketplace ingestion is architecturally sound. It minimises API calls and enables instant auto-linking.

4. **Composition architecture** — The shared hooks pattern ensures feature parity across 11+ marketplace dashboards without class inheritance.

5. **Push Safety Preview** — Mandatory pre-push validation with a disabled button on errors is a strong safeguard for financial data.

6. **GST handling** — The Australian GST extraction formula (`÷11` for 10% inclusive amounts) is correctly implemented throughout.

7. **Idempotency** — Most write paths use upsert with proper unique constraints, making retries safe.

8. **Multi-tenant scoping** — JWT-based user isolation with database-level unique constraints prevents cross-user data contamination.

---

## 13. Architecture Review — Gaps & Recommendations

### 13.1 Critical Gaps

| Gap | Risk | Recommendation |
|-----|------|---------------|
| **Parser duplication** — Settlement parser exists in both browser and Deno with no automated sync check | CSV uploads and API imports could produce different totals if versions drift | Add CI check comparing `PARSER_VERSION` between both files. Long-term: generate a shared parser artifact. |
| **No UNIQUE(user_id, xero_invoice_id) on xero_accounting_matches** | Two settlements could link to the same Xero invoice without detection | Add partial unique index `WHERE xero_invoice_id IS NOT NULL` |
| **Non-canonical `mapping_error` status** — `sync-settlement-to-xero` writes `mapping_error` directly to `settlements.status` (line 643) | Violates the canonical state machine; can strand settlements in an unrecoverable state | Log to `system_events` only; keep settlement in current workflow status |
| **`marketplace_validation` has no hard unique constraint** | Race conditions on upsert could create duplicate validation rows | Add `UNIQUE(user_id, marketplace_code, period_label)` |

### 13.2 Missing Features (Product Gaps)

| Feature | Impact | Complexity |
|---------|--------|-----------|
| **Multi-currency support** — Everything assumes AUD | Cannot serve NZ, UK, US, or multi-country Amazon sellers | High — requires currency field on settlements, exchange rate handling, and Xero multi-currency API integration |
| **Stripe direct integration** — Stripe detected as Shopify sub-channel only | Sellers using Stripe outside Shopify have no ingestion path | Medium — Stripe Connect API for payout/balance transaction sync |
| **Scheduled sync dashboard** — `scheduled-sync` runs as cron but has no user-facing status/config | Users can't see when last sync ran, can't adjust frequency, can't see errors | Low — add UI card showing `sync_history` with cron status |
| **Webhook-based ingestion** — All syncs are poll-based | Adds latency; wastes API calls when nothing changed | Medium — Amazon SNS notifications, Shopify webhooks for new payouts |
| **Xero bill support for all marketplaces** — Negative settlement → ACCPAY only works for simple cases | Complex fee-only periods with mixed revenue/expense may not push correctly | Low — extend `buildInvoiceLineItems` to handle mixed-sign scenarios |
| **Offline/retry queue** — If Xero is down during push, settlement is marked `push_failed` | No visible retry queue or manual retry UI beyond `auto-push-xero` | Low — add "Retry failed pushes" button with visible queue |
| **Audit log export** — `system_events` captures everything but has no export | Users/accountants can't download an audit trail for BAS/tax purposes | Low — CSV export of system_events filtered by date range |
| **Mobile responsive admin** — Admin/accounting dashboard optimised for desktop | Common use case: quick check on phone shows poor layout | Medium — responsive layout pass on AccountingDashboard |

### 13.3 Technical Debt

| Item | Location | Impact |
|------|----------|--------|
| `sync-amazon-journal` is a near-duplicate of `sync-settlement-to-xero` | Two edge functions doing the same job with slightly different features | Should be consolidated into one function |
| `AccountingDashboard.tsx` is 4200+ lines | Difficult to maintain, test, or review | Should be decomposed into sub-components per concern (push flow, settlement list, settings, insights) |
| No integration tests for edge functions | Bugs like `deriveStatus()` object assignment survived until manual audit | Add Deno test files alongside edge functions |
| `callEdgeFunctionSafe` in `sync-capabilities.ts` bypasses Supabase client | Uses raw fetch with manual auth headers | Consider standardising on `supabase.functions.invoke()` everywhere |
| Legacy status values still exist in database | `normaliseStatus()` maps 12+ legacy values | Run a one-time migration to normalise all existing settlements |

### 13.4 Security Considerations

| Area | Status | Note |
|------|--------|------|
| JWT verification in edge functions | ✅ All functions verify JWT | Uses `getUser()` from anon client |
| User ID from JWT (not request body) | ✅ Fixed | `authenticatedUserId = authUser.id` |
| RLS on user tables | ✅ Enabled | All user-facing tables have RLS |
| Admin role check | ✅ Server-side | Uses `has_role()` security definer |
| Input sanitization | ⚠️ Partial | `src/utils/input-sanitization.ts` exists but not universally applied |
| Rate limiting | ⚠️ API-level only | Xero 429 handling exists; no application-level rate limiting on edge functions |
| CORS | ⚠️ Permissive | `Access-Control-Allow-Origin: *` on all edge functions |

---

## 14. File Map

```
src/
├── pages/            # Route-level components (lazy loaded)
├── components/
│   ├── admin/        # Admin panel (accounting dashboards, settings)
│   ├── dashboard/    # User dashboard (action centre, recent uploads)
│   ├── onboarding/   # Setup wizard steps
│   ├── insights/     # Profit comparison, SKU analysis
│   ├── settings/     # Account mapper, payment verification
│   ├── shared/       # Cross-cutting UI (logos, status bars, modals)
│   ├── shopify/      # Channel management, sub-channel detection
│   ├── ai-assistant/ # Chat panel, ask button
│   ├── bug-report/   # Bug report modal + notification
│   └── ui/           # shadcn/ui primitives
├── hooks/            # Shared stateful logic
├── constants/        # Canonical rules (accounting, status, categories)
├── utils/            # Parsers, engines, API adapters
└── integrations/     # Supabase client (auto-generated)

supabase/
├── functions/        # 25+ Deno edge functions
├── config.toml       # Function configuration
└── create_storage.sql # Storage bucket definitions
```

---

## 15. Design System

- **Tokens**: HSL-based semantic tokens in `index.css` (`--primary`, `--background`, etc.)
- **Components**: shadcn/ui with custom variants via `class-variance-authority`
- **Rule**: No raw color classes in components — always use design tokens
- **Dark mode**: Supported via `next-themes` provider
- **Icons**: Lucide React

---

## 16. External Feed Sync — Core Rules

All external connectors (Xero bank feeds, PayPal, Stripe, Shopify, Wise, future connectors) must follow these principles:

### Default Behaviour
- Fetch **only the date range required** for reconciliation
- Range derived from outstanding invoices / unreconciled settlements
- Apply a buffer around the range (rail-specific: e.g. -7/+21 days for Amazon)
- Limit to **mapped destination accounts only**
- Never fetch full history by default

### Fallback Behaviour
If reconciliation range cannot be determined:
- Use a bounded default lookback (e.g. 30 days)
- Enforce a maximum range cap (e.g. 90 days)
- Never fetch all accounts
- Never fetch unlimited pages

### Pagination Rules
- Paging allowed only within the bounded range
- Enforce safety limits (max pages, max rows, time budget)
- Store checkpoints so later syncs continue incrementally

### Deep Sync
Full-history or long-range sync must only run when:
- User explicitly requests it, **or**
- System detects missing historical data

Deep syncs must use throttling + checkpoints.

### Applies To
Xero bank feeds, PayPal API, Stripe API, Shopify payouts, Wise feeds, and all future connectors.

---

## 12. Utility Capability Map

**Source of truth:** `src/utils/index.ts` — always check this barrel file before writing new utility logic.

| File | Capability | Key Exports |
|------|-----------|-------------|
| `coa-intelligence.ts` | COA scanning, account mapping suggestions from chart of accounts | `analyseCoA`, `XETTLE_COA_RULES` |
| `xero-mapping-readiness.ts` | Validates account mappings are complete before push | `checkXeroReadinessForMarketplace` |
| `bookkeeper-readiness.ts` | Pre-push safety checks, readiness scoring | `validateBookkeeperMinimumData` |
| `settlement-parser.ts` | Amazon TSV → structured 13-category settlement | `parseSettlementTSV`, `PARSER_VERSION` |
| `settlement-engine.ts` | Settlement CRUD, save/update | `saveSettlement` |
| `settlement-components.ts` | Component-level financial breakdown | `upsertSettlementComponents` |
| `file-marketplace-detector.ts` | Sniff CSV/PDF to detect marketplace | `detectFileMarketplace` |
| `file-fingerprint-engine.ts` | CSV/XLSX header fingerprinting | `detectFromHeaders`, `extractFileHeaders` |
| `fingerprint-library.ts` | Session-cached DB fingerprints, detection | `loadFingerprints`, `detectFromFingerprints` |
| `fingerprint-lifecycle.ts` | Create draft fingerprint records | `createDraftFingerprint` |
| `reconciliation-engine.ts` | Amazon-specific recon checks | `runReconciliation` |
| `universal-reconciliation.ts` | Marketplace-agnostic recon | `runUniversalReconciliation` |
| `marketplace-reconciliation-engine.ts` | Per-marketplace recon with tolerance | `calculateReconciliation`, `autoReconcileSettlement` |
| `xero-entries.ts` | Read/build xero_entries JSON on settlements | `readXeroEntries`, `hasXeroEntries`, `buildSingleEntry` |
| `xero-posting-line-items.ts` | Posting line items with GST & account codes | `buildPostingLineItems` |
| `xero-csv-export.ts` | Export orders as Xero-compatible bill CSV | `downloadXeroCSV`, `ordersToXeroCSV` |
| `parse-xero-date.ts` | Normalise Xero `/Date()/` format | `parseXeroDate` |
| `amazon-xero-push.ts` | Amazon invoice line-item builders, split-month | `buildAmazonInvoiceLineItems`, `computeSplitMonthRollover` |
| `generic-csv-parser.ts` | Parse any CSV with header detection | `parseGenericCSV` |
| `bunnings-summary-parser.ts` | Bunnings PDF/CSV → structured data | `parseBunningsSummaryPdf` |
| `woolworths-marketplus-parser.ts` | Woolworths CSV → structured settlement | `parseWoolworthsMarketPlusCSV` |
| `shopify-payments-parser.ts` | Shopify payout CSV → structured settlement | `parseShopifyPayoutCSV` |
| `shopify-orders-parser.ts` | Shopify orders CSV → order-level data | `parseShopifyOrdersCSV` |
| `shopify-order-detector.ts` | Detect marketplace from Shopify orders (6-priority) | `detectMarketplaceFromOrder`, `detectAllMarketplaces` |
| `shopify-api-adapter.ts` | Convert API orders to parsed rows | `convertApiOrdersToRows`, `fetchAndParseShopifyOrders` |
| `date-parser.ts` | Flexible AU/US/ISO date parsing | `parseDate`, `parseDateOrEmpty` |
| `entity-detection.ts` | Detect entities from line descriptions | `DetectedEntity` (type) |
| `fee-observation-engine.ts` | Track marketplace fee rate changes | `extractFeeObservations`, `extractAmazonFeeObservations` |
| `multi-marketplace-splitter.ts` | Split multi-marketplace files | `detectMultiMarketplace`, `findSplitColumn` |
| `sub-channel-detection.ts` | Detect Shopify sub-channels | `DetectedSubChannel` (type) |
| `marketplace-registry.ts` | Known marketplace definitions & patterns | `MARKETPLACE_REGISTRY` |
| `marketplace-codes.ts` | Canonical code normalisation, alias resolution | `normalizeMarketplaceCode`, `isMarketplaceAlias` |
| `marketplace-connections.ts` | Connection upsert helpers | `upsertMarketplaceConnection` |
| `marketplace-token-map.ts` | Payment processor registry | `PAYMENT_PROCESSORS` |
| `sync-capabilities.ts` | API sync vs CSV-only capabilities | `SyncCapabilities` (type) |
| `profit-engine.ts` | Per-settlement/SKU gross profit calc | `calculateProfit` |
| `input-sanitization.ts` | XSS prevention, text/email sanitizers | `sanitizeText`, `sanitizeEmail` |
| `logger.ts` | Structured logging | `logger` |

---

## 17. Canonical Actions & Guardrails — Complete Status

**Last updated: 2026-03-18**

The canonical actions layer (`src/actions/`) is the exclusive client-side entry point for all accounting-critical operations. Grep-based guardrail tests (`src/actions/__tests__/canonical-actions.test.ts`) block direct database writes and unauthorized edge function calls outside these modules.

### 17.1 Canonical Action Modules

| Module | File | Key Exports | Status |
|--------|------|-------------|--------|
| **Settlement CRUD** | `actions/settlements.ts` | `deleteSettlement`, `deleteSettlements`, `updateSettlementVisibility`, `revertSettlementToSaved`, `resetFailedSettlement`, `resetFailedSettlements`, `markBankVerified`, `applySourcePriority`, `checkSourceOverlap`, `getSourcePreference`, `setSourcePreference` | ✅ Complete |
| **Marketplace Provisioning** | `actions/marketplaces.ts` | `provisionMarketplace`, `provisionMarketplaces`, `removeMarketplace` | ✅ Complete |
| **Xero Push / Rollback** | `actions/xeroPush.ts` | `pushSettlementToXero`, `rollbackFromXero`, `triggerAutoPost`, `checkPushCategoryCoverage` | ✅ Complete |
| **Safe Repost** | `actions/repost.ts` | `rollbackSettlement` | ✅ Complete |
| **Xero Readiness** | `actions/xeroReadiness.ts` | `checkXeroReadinessForMarketplace`, `REQUIRED_CATEGORIES`, `getRailPostingEligibility` | ✅ Complete |
| **Scope Consent** | `actions/scopeConsent.ts` | `getScopeConsent`, `acknowledgeScopeConsent`, `getOrgTaxProfile`, `setOrgTaxProfile`, `acknowledgeRailSupport` | ✅ Complete |
| **Xero Invoice** | `actions/xeroInvoice.ts` | `refreshXeroInvoiceDetails`, `rescanMatchForInvoice`, `getXeroVsXettlePayloadDiff`, `compareXeroInvoiceToSettlement` | ✅ Complete |
| **Xero Accounts (COA)** | `actions/xeroAccounts.ts` | `refreshXeroCOA`, `getCachedXeroAccounts`, `getCachedXeroTaxRates`, `getCoaLastSyncedAt`, `createXeroAccounts` | ✅ Complete |
| **COA Coverage** | `actions/coaCoverage.ts` | `getMarketplaceCoverage`, `findTemplateAccounts`, `generateNewAccountName`, `detectCategoryFromName` | ✅ Complete |
| **COA Clone** | `actions/coaClone.ts` | `buildClonePreview`, `executeCoaClone`, `validateTemplateEligibility`, `logCloneEvent` | ✅ Complete |
| **Account Mappings** | `actions/accountMappings.ts` | `getMappings`, `getMappingsRaw`, `getEffectiveMapping`, `saveDraftMappings`, `confirmMappings`, `mergeIntoConfirmedMappings` | ✅ Complete |
| **Sync Actions** | `actions/sync.ts` | `runXeroSync`, `runMarketplaceSync` | ✅ Complete |
| **Audit Export** | `actions/auditExport.ts` | `exportAuditCsv` | ✅ Complete |

### 17.2 Sitewide Policy Modules

| Policy | File | Purpose | Enforced Where |
|--------|------|---------|----------------|
| **Accounting Rules (Rule #11)** | `constants/accounting-rules.ts` | Settlements-only accounting source, orders/payments never create entries | All push paths, edge functions (comment block) |
| **Settlement Status Machine** | `constants/settlement-status.ts` | Canonical status values, valid transitions, legacy normalisation | All status writes, UI rendering |
| **Settlement Rails** | `constants/settlement-rails.ts` | Rail codes, payout modes, destination mapping | Push paths, bank matching |
| **Financial Categories** | `constants/financial-categories.ts` | Internal classification keys for settlement_lines | All parsers, edge functions (comment block) |
| **Reconciliation Tolerances** | `constants/reconciliation-tolerance.ts` | Named tolerance thresholds (line sum, payout match, GST) | All reconciliation engines |
| **Connection Statuses** | `constants/connection-status.ts` | `ACTIVE_CONNECTION_STATUSES = ['active', 'connected']` | All marketplace_connections queries |
| **Support Policy** | `policy/supportPolicy.ts` | AU-validated scope, tier computation (SUPPORTED/EXPERIMENTAL/UNSUPPORTED) | Push preview, auto-post, edge functions |
| **AI Policy** | `ai/policy/xettleAiPolicy.ts` | AI capabilities/limits, what assistant can/cannot do | AI context, edge function |
| **Marketplace Contacts** | `constants/marketplace-contacts.ts` | Canonical Xero contact names per marketplace | Invoice builders |

### 17.3 Guardrail Tests (25 tests)

All tests in `src/actions/__tests__/canonical-actions.test.ts`:

| Test | Pattern Blocked | Protection |
|------|----------------|------------|
| **REQUIRED_CATEGORIES sync** | Client vs server drift | Ensures push safety preview and edge function agree on required mapping categories |
| **No direct settlement delete cascades** | `from('settlement_lines').delete()` + `from('settlements').delete()` | Forces use of `deleteSettlement()` canonical action |
| **No direct settlement status updates** | `from('settlements').update({...status:` | Forces use of canonical status actions |
| **No direct settlement visibility updates** | `from('settlements').update({...is_hidden:` | Forces use of `updateSettlementVisibility()` |
| **No direct bank_verified updates** | `from('settlements').update({...bank_verified:` | Forces use of `markBankVerified()` |
| **No direct sync-settlement-to-xero invoke** | `functions.invoke('sync-settlement-to-xero'` | Forces use of `pushSettlementToXero()` |
| **No direct auto-post-settlement invoke** | `functions.invoke('auto-post-settlement'` | Forces use of `triggerAutoPost()` |
| **No direct fetch-xero-invoice invoke** | `functions.invoke('fetch-xero-invoice'` | Forces use of `refreshXeroInvoiceDetails()` |
| **No direct rescan-xero-invoice-match invoke** | `functions.invoke('rescan-xero-invoice-match'` | Forces use of `rescanMatchForInvoice()` |
| **No direct preview-xettle-invoice-payload invoke** | `functions.invoke('preview-xettle-invoice-payload'` | Forces use of `compareXeroInvoiceToSettlement()` |
| **No direct xero_invoice_cache writes** | `from('xero_invoice_cache').insert/upsert/update/delete` | Cache managed only by canonical actions |
| **No local preview builder** | `buildXettlePreviewPayload` outside actions | Prevents duplicate invoice payload builders |
| **No local tier computation** | `AU_VALIDATED_RAILS` outside policy | Forces use of `computeSupportTier()` |
| **No raw DOM in AI context** | `innerHTML/outerHTML/document.body` in AI files | Prevents PII/DOM leakage to AI |
| **No direct AI tool calls** | `getPageReadinessSummary` etc. outside registry | AI tools are server-side only |
| **No direct refresh-xero-coa invoke** | `functions.invoke('refresh-xero-coa'` | Forces use of `refreshXeroCOA()` |
| **No direct xero_chart_of_accounts writes** | `from('xero_chart_of_accounts').insert/upsert/update/delete` | COA cache managed only by canonical actions |
| **No direct xero_tax_rates writes** | `from('xero_tax_rates').insert/upsert/update/delete` | Tax rates managed only by canonical actions |
| **No direct create-xero-accounts invoke** | `functions.invoke('create-xero-accounts'` | Forces use of `createXeroAccounts()` |
| **No direct settlements.insert()** | `from('settlements').insert(` outside allowed paths | Forces use of `saveSettlement()` → `applySourcePriority()` |
| **Support tier: AU + AU_GST → SUPPORTED** | Unit test | Tier computation correctness |
| **Support tier: AU + non-AU → EXPERIMENTAL** | Unit test | Tier computation correctness |
| **Support tier: unknown rail → UNSUPPORTED** | Unit test | Tier computation correctness |
| **AUTHORISED blocked outside SUPPORTED** | Unit test | Automation gating correctness |
| **AUTHORISED allowed for SUPPORTED** | Unit test | Automation gating correctness |

### 17.4 Source Priority Guard (New)

Ensures CSV settlements override Shopify-derived API settlements consistently:

| Rule | Trigger | Action |
|------|---------|--------|
| CSV supersedes API | `source='manual'` inserted, overlapping `source='api_sync'` exists | API record → `status='duplicate_suppressed'` |
| API self-suppresses | `source='api_sync'` inserted, overlapping `source='manual'` exists | New API record → self-suppressed |
| Source preference | User sets `source_preference:{marketplace}` = `'csv'` or `'api'` | `auto-generate-shopify-settlements` skips generation if CSV preferred |

Enforcement: `applySourcePriority()` called post-insert in `settlement-engine.ts` and `AccountingDashboard.tsx`. Edge function checks preference + manual overlap before insert.

### 17.5 Remaining Canonicalization Gaps

| Area | Current State | Risk | Priority |
|------|--------------|------|----------|
| **Settlement ingestion (saveSettlement)** | Lives in `utils/settlement-engine.ts`, not `actions/`. `applySourcePriority()` bolted on post-insert. | Conceptually should be in actions/ but works — all paths call it consistently | Low — functional, not yet architecturally clean |
| **Period locks** | `PeriodLockManager.tsx` writes directly to `period_locks` | Low — single UI path, non-financial | Low |
| **Product costs** | `SkuCostManager.tsx` writes directly to `product_costs` | Low — single UI path, user's own data | Low |
| **Bug reports** | `BugReportModal.tsx` writes directly to `bug_reports` | None — non-financial table | None |
| **AI usage** | `use-ai-assistant.ts` writes directly to `ai_usage` | None — usage tracking only | None |
| **Marketplace validation** | Written by `run-validation-sweep` edge fn + some client reads | Server-side controlled, client is read-only | None |
| **Payment verifications** | Written by `match-bank-deposits` + `verify-payment-matches` edge fns | Server-side only, suggestion layer | None |
| **Dashboard migration** | `AccountingDashboard` (4200+ lines), `ShopifyPaymentsDashboard`, `BunningsDashboard`, `ShopifyOrdersDashboard` NOT on shared hooks | Feature drift, inconsistent UX | Medium — product quality |
| **Deprecated `marketplace_account_mapping` table** | Still read by edge functions (`auto-post-settlement`, `ai-assistant`) | Legacy reads; no new writes | Low — migration in progress |

### 17.6 Canonical Constants (Single Source of Truth)

| Constant | File | Used By |
|----------|------|---------|
| `ACCOUNTING_RULES` | `constants/accounting-rules.ts` | All push/sync paths, edge fn comment blocks |
| `SETTLEMENT_STATUS` | `constants/settlement-status.ts` | All status reads/writes, UI badges |
| `VALID_TRANSITIONS` | `constants/settlement-status.ts` | Status mutation validation |
| `PHASE_1_RAILS` | `constants/settlement-rails.ts` | Support tier, rail posting settings |
| `RAIL_PAYOUT_MODE` | `constants/settlement-rails.ts` | Bank match requirement checks |
| `FINANCIAL_CATEGORIES` | `constants/financial-categories.ts` | All parsers, settlement_lines writes |
| `ACTIVE_CONNECTION_STATUSES` | `constants/connection-status.ts` | All marketplace_connections queries |
| `REQUIRED_CATEGORIES` | `actions/xeroReadiness.ts` | Push safety preview, edge functions (sync-tested) |
| `MARKETPLACE_CONTACTS` | `constants/marketplace-contacts.ts` | Invoice builders, push safety |
| `TOL_*` tolerances | `constants/reconciliation-tolerance.ts` | All reconciliation engines |
| `XETTLE_AI_CAPABILITIES` | `ai/policy/xettleAiPolicy.ts` | AI context, edge function |
| `SCOPE_VERSION` | `policy/supportPolicy.ts` | Scope consent tracking |

### 17.7 Edge Function → Client Guardrail Summary

Edge functions that MUST be invoked through canonical actions (never directly from components):

| Edge Function | Canonical Wrapper | Guardrail Test |
|--------------|-------------------|----------------|
| `sync-settlement-to-xero` | `pushSettlementToXero()`, `rollbackFromXero()` | ✅ |
| `auto-post-settlement` | `triggerAutoPost()` | ✅ |
| `fetch-xero-invoice` | `refreshXeroInvoiceDetails()` | ✅ |
| `rescan-xero-invoice-match` | `rescanMatchForInvoice()` | ✅ |
| `preview-xettle-invoice-payload` | `compareXeroInvoiceToSettlement()` | ✅ |
| `refresh-xero-coa` | `refreshXeroCOA()` | ✅ |
| `create-xero-accounts` | `createXeroAccounts()` | ✅ |

Edge functions that are called directly (no guardrail needed — server-initiated or auth-flow):

| Edge Function | Reason |
|--------------|--------|
| `xero-auth`, `amazon-auth`, `shopify-auth`, `ebay-auth` | OAuth flows — browser redirect callbacks |
| `fetch-amazon-settlements`, `fetch-shopify-payouts`, `fetch-ebay-settlements` | Triggered via `runMarketplaceSync()` canonical action |
| `fetch-shopify-orders`, `scan-shopify-channels` | Triggered via sync flows |
| `ai-assistant`, `ai-file-interpreter`, `ai-account-mapper`, `ai-bug-triage` | AI features — no accounting writes |
| `scheduled-sync` | Cron-triggered, no client invoke |
| `run-validation-sweep` | Server-side sweep, read-heavy |
| `auto-generate-shopify-settlements` | Server-side, source priority enforced internally |
| `match-bank-deposits`, `verify-payment-matches` | Server-side, suggestion-only |
| `admin-list-users`, `admin-manage-users`, `account-reset` | Admin-only, service-role |
| `historical-audit`, `growth-scout` | Analytics/admin features |
| `export-system-events-csv` | Export utility |
| `generate-gst-summary`, `generate-gst-variance`, `generate-gst-audit-pack`, `fetch-gst-variance-evidence` | GST reporting — read-heavy |
| `fetch-xero-bank-accounts`, `fetch-xero-bank-transactions` | Bank sync — single-caller architecture |
| `fetch-outstanding` | Outstanding tab data — read-heavy |
| `scan-xero-history` | Xero audit — read-heavy |
| `apply-xero-payment` | Server-side payment application |

### 17.8 Database Tables — Write Protection Matrix

Tables with canonical write protection (client-side writes blocked by guardrails):

| Table | Protected Writes | Canonical Path |
|-------|-----------------|----------------|
| `settlements` | insert, update (status, is_hidden, bank_verified), delete | `actions/settlements.ts` |
| `xero_invoice_cache` | insert, upsert, update, delete | `actions/xeroInvoice.ts` |
| `xero_chart_of_accounts` | insert, upsert, update, delete | `actions/xeroAccounts.ts` |
| `xero_tax_rates` | insert, upsert, update, delete | `actions/xeroAccounts.ts` |
| `marketplace_connections` | insert (provisioning) | `actions/marketplaces.ts` |

Tables with server-side-only protection (RLS + service role):

| Table | Protected By |
|-------|-------------|
| `xero_accounting_matches` | `safeUpsertXam()` helper in edge functions |
| `sync_locks` | `acquire_sync_lock()` / `release_sync_lock()` DB functions |
| `user_roles` | RLS: read-only for users, write by triggers/admin only |
| `xero_tokens`, `amazon_tokens`, `ebay_tokens` | RLS: user-scoped, written by OAuth edge functions |

Tables with no write protection needed (non-financial, user-scoped):

| Table | Reason |
|-------|--------|
| `app_settings` | Key-value config, user's own data |
| `bug_reports` | Bug tracking |
| `ai_usage` | Usage counters |
| `product_costs` | User's COGS data |
| `period_locks` | Single UI path |
| `settlement_lines` | Always written alongside settlement (cascaded) |
| `settlement_unmapped` | Always written alongside settlement (cascaded) |
| `reconciliation_notes` | User annotations |
| `community_contact_classifications` | Community voting |

---

## 18. Pre-Release Audit — March 2026 (Post-Hardening)

**Last updated**: 2026-03-19
**Scope**: Full codebase re-audit following the 6-item Pre-Release Hardening Plan.

### 18.1 Hardening Items — Status

| # | Item | Status | Evidence |
|---|------|--------|----------|
| 1 | Commission rate calibration | ✅ Landed | `_shared/commission-rates.ts` is canonical edge-function source; `attributeFees()` accepts `observedRates` param; `repair-settlement-fees` reads `observed_commission_rate:*` from `app_settings` |
| 2 | Pagination fix (1000-row cap) | ✅ Landed | `fetchAllRows<T>()` helper in `recalculate-profit` and `repair-settlement-fees`; paginated query loops with `pageSize=1000` |
| 3 | RLS policy inventory | ✅ Landed | `rls-audit` edge function calls `get_rls_inventory()` RPC; `DataQualityPanel` renders table-by-table coverage with gap highlighting |
| 4 | Commission parity test | ✅ Landed | `commission-parity.test.ts` — 3 assertions verify frontend `COMMISSION_ESTIMATES` matches canonical fixture; fails on any drift |
| 5 | Show implied commission rate | ✅ Landed | `MarketplaceProfitComparison` tooltip: "Using 12% estimated commission rate" when `has_estimated_fees` is true |
| 6 | Data quality warnings | ✅ Landed | `InsightsDashboard` shows amber alert strip for estimated fees, missing fee data, or unknown fulfilment methods |

### 18.2 Strengths (Confirmed)

| Strength | Evidence | Confidence |
|----------|----------|------------|
| **Canonical Actions Layer** | 12 modules in `src/actions/`, 25 grep-based guardrail tests block direct writes to settlements, xero_invoice_cache, COA tables, and 7 edge function invocations | High — automated enforcement |
| **Support Policy Tiering** | `SUPPORTED` / `EXPERIMENTAL` / `UNSUPPORTED` tiers computed from rail + tax profile + currency; `AUTHORISED` invoice status restricted to `SUPPORTED` tier only | High — unit-tested |
| **Settlement-centric accounting (Rule #11)** | `accounting-rules.ts` constants + hardcoded comment blocks in every edge function; orders and payments never create accounting entries | High — structural |
| **Idempotent writes** | Upsert with `UNIQUE(user_id, marketplace, settlement_id)` on settlements; `safeUpsertXam` on xero_accounting_matches with `INVOICE_ALREADY_LINKED` error handling | High — constraint-enforced |
| **Push Safety Preview** | 5-point validation suite; confirm button disabled on red errors; all pushes create DRAFT invoices | High — user-facing gate |
| **Commission rate parity** | Canonical `_shared/commission-rates.ts` for edge functions + parity test for frontend copy; `getCommissionRate()` checks observed rates first | High — test-enforced |
| **Pagination protection** | `fetchAllRows()` in both profit-critical edge functions prevents silent 1000-row truncation | High — structural |
| **RLS coverage** | RLS appears consistently applied across user-owned tables; spot-checks confirm `auth.uid() = user_id` scoping. RLS audit edge function provides on-demand inventory. Full policy inventory should be reviewed before each release. | Medium — tooling exists, periodic verification needed |
| **Multi-tenant isolation** | JWT-based userId derivation (never from request body in accounting paths); database unique constraints; RLS policies | High — layered enforcement |

### 18.3 Qualified Claims (Previously Absolute)

| Original Claim | Qualified Assessment | Action Needed |
|----------------|---------------------|---------------|
| "Every user-facing table has RLS" | RLS appears consistently applied; `rls-audit` edge function generates on-demand inventory. Some tables (e.g. `marketplace_registry`, `marketplaces`, `community_contact_classifications`) intentionally use read-all policies. | Run `rls-audit` before each release; review any table with 0 policies |
| "No privilege escalation vectors found" | No obvious escalation vectors identified in reviewed flows. Security-definer functions (`has_role`), service-role edge functions, and storage bucket policies should be reviewed as a separate security pass. | Dedicated security review of all `SECURITY DEFINER` functions and service-role usage |
| "Commission parity is byte-identical" | Parity is test-enforced via `commission-parity.test.ts`. Frontend and edge functions maintain separate copies with a shared fixture test. True single-source would require a build step. | Parity test catches drift; acceptable for current scale |
| "New marketplaces are data-only" | New CSV-based marketplaces can often be enabled as data rows, but fee estimates, rails, platform families, and bespoke parsing quirks may still require code updates. | Document per-marketplace code touchpoints |

### 18.4 Remaining Gaps (Post-Hardening)

#### Architecture

| Gap | Risk | Severity | Recommendation |
|-----|------|----------|----------------|
| **InsightsDashboard duplicates fee attribution logic** | Lines 331–370 compute estimated fees inline instead of calling `attributeFees()` from the canonical utility | Data inconsistency between Insights cards and Profit Ranking table | Medium — Refactor to use `attributeFees()` for all marketplace stats |
| **`fetchAllRows` duplicated in 2 edge functions** | Same pagination helper copy-pasted in `recalculate-profit` and `repair-settlement-fees` | Maintenance burden, potential divergence | Low — Extract to `_shared/pagination.ts` |
| **InsightsDashboard doesn't load observed rates** | `attributeFees()` accepts `observedRates` but dashboard passes `{}` implicitly; only `repair-settlement-fees` reads `observed_commission_rate:*` | Calibrated rates not reflected in dashboard UI | Medium — Load from `app_settings` in `loadStats()` |
| **AccountingDashboard.tsx is 4200+ lines** | Difficult to maintain, test, or review | Increased regression risk | Medium — Decompose into sub-components |
| **Parser duplication (browser vs Deno)** | `settlement-parser.ts` exists in both `src/utils/` and embedded in `fetch-amazon-settlements` | Version drift could produce different totals | Medium — `PARSER_VERSION` check exists but no automated CI comparison |

#### Security

| Gap | Risk | Severity | Recommendation |
|-----|------|----------|----------------|
| **`repair-settlement-fees` accepts userId from body** | Line 46: `userId = body.userId` before JWT fallback; service-role client then operates on that userId | Low — function is admin-triggered, but pattern enables spoofing | Low — Remove body.userId path; always derive from JWT |
| **CORS headers** | `getCorsHeaders()` returns origin-specific headers but some functions may still be permissive | Potential CSRF on state-changing endpoints | Low — Audit all edge functions for origin validation |
| **No application-level rate limiting** | Xero 429 handling exists; no rate limiting on edge function invocations from the client | Abuse potential on AI or sync endpoints | Medium — Add per-user rate limits on expensive operations |
| **Input sanitization not universally applied** | `input-sanitization.ts` exists but not imported in all user-input paths | XSS risk on non-sanitized fields | Low — Audit all text input paths |

#### Scalability

| Gap | Risk | Severity | Recommendation |
|-----|------|----------|----------------|
| **Edge function timeouts on large accounts** | `recalculate-profit` processes all settlements sequentially; 10K+ settlement_lines could approach Deno timeout | Silent failure for power users | Medium — Add progress logging and chunked processing |
| **No pagination on settlements query in InsightsDashboard** | Client-side `loadStats()` fetches all settlements without `.range()` | 1000-row cap applies; large accounts see incomplete insights | Medium — Add paginated fetch or server-side aggregation |
| **Settlement_profit re-calculation is full-replace** | `recalculate-profit` upserts ALL profit rows on every run | Expensive for incremental changes | Low — Add incremental mode (only recalc settlements modified since last run) |

#### Onboarding — Xero Health Check (Not Yet Built)

| Gap | Risk | Severity | Recommendation |
|-----|------|----------|----------------|
| **No inbound Xero data quality scan** | System is defensive about outbound pushes (5-point safety preview, mapping gates, DRAFT enforcement) but blind to pre-existing problems in the connected Xero org | High trust risk during onboarding — bookkeepers won't trust Xettle if it doesn't acknowledge the mess it's inheriting | High — Build before first paid cohort |

**Problem**: Real customers migrating from LMB, A2X, or manual processes will have Xero organisations containing duplicate invoices, wrong account codes, missing GST, orphaned contacts, and inconsistent naming. Xettle currently ignores all of this. The accounting boundary date prevents Xettle from *adding* to the mess, but it doesn't help the bookkeeper understand or clean up what's already there.

**Proposed Feature: "Xero Health Check"**

A structured onboarding scan that runs against the connected Xero org and surfaces known problem patterns:

| Check | What It Detects | Why It Matters |
|-------|----------------|----------------|
| **Duplicate invoice detection** | Multiple AUTHORISED/PAID invoices with the same marketplace reference (e.g. two invoices both referencing settlement `16727637921`) | Common when switching from another tool or manual process; causes double-counted revenue |
| **Account code audit** | Marketplace income/fees posted to generic accounts (e.g. all Amazon fees to "General Expenses") instead of dedicated accounts | Prevents forensic reconciliation; Xettle's account mapper can fix this going forward but the bookkeeper needs to know it was wrong before |
| **GST classification errors** | Invoices with `LineAmountTypes: Exclusive` where the marketplace collects GST (platform-collected model), or vice versa | Causes BAS discrepancies; particularly acute for Amazon AU where GST model changed |
| **Orphaned marketplace contacts** | Multiple Xero contacts for the same marketplace (e.g. "Amazon", "Amazon AU", "Amazon.com.au", "AMAZON SELLER") | Splits reporting; Xettle's contact classification can recommend consolidation |
| **Missing settlement coverage** | Periods where bank deposits from marketplace narration patterns exist but no corresponding invoice was created | Identifies historical gaps that the bookkeeper may need to journal-adjust |
| **Stale draft invoices** | DRAFT invoices older than 90 days with marketplace references that were never approved | Likely abandoned attempts from a previous tool; should be voided or completed |

**Implementation approach**:
- New edge function `xero-health-check` that uses the existing Xero token to scan invoices, contacts, and bank transactions for the last 12 months
- Returns a structured report with severity levels (🔴 action required, 🟡 review recommended, 🟢 clean)
- Surface in a new "Xero Health Check" card during onboarding (post-Xero-connect, pre-first-upload)
- Results stored in `app_settings` so the bookkeeper can revisit and track resolution
- Each finding links to the specific Xero invoice/contact where possible

**Trust impact**: This is the single highest-trust feature Xettle could ship for bookkeeper onboarding. It says "we looked at your books, we understand the problems, and we won't make them worse." No competitor does this.

### 18.5 Competitive Positioning

| Capability | Xettle | LinkMyBooks | A2X | Connector by Synder |
|-----------|--------|------------|-----|---------------------|
| Settlement-centric model | ✅ | ✅ | ✅ | ❌ (transaction-level) |
| Multi-marketplace from single Shopify | ✅ (sub-channel detection) | ❌ | ❌ | ❌ |
| AU GST handling | ✅ (validated) | ✅ | ✅ | ⚠️ (generic) |
| Push Safety Preview | ✅ (5-point validation) | ❌ | ❌ | ❌ |
| Bank deposit matching | ✅ (two-pass heuristic) | ❌ | ✅ | ⚠️ |
| CSV + API hybrid ingestion | ✅ | ❌ (API only) | ❌ (API only) | ❌ (API only) |
| AI file interpreter | ✅ | ❌ | ❌ | ❌ |
| QuickBooks support | ❌ | ✅ | ✅ | ✅ |
| Multi-currency | ❌ (AUD only) | ✅ | ✅ | ✅ |
| Automated ad spend ingestion | ❌ (manual) | ❌ | ❌ | ✅ |
| SKU-level profit analysis | ✅ | ❌ | ❌ | ❌ |
| Fee observation & alerts | ✅ | ❌ | ❌ | ❌ |

**Key differentiators**: Sub-channel detection, AI file interpretation, push safety gates, and CSV+API hybrid model.
**Key gaps**: Multi-currency and QuickBooks support limit international expansion.

### 18.6 Release Readiness Assessment

| Area | Verdict | Notes |
|------|---------|-------|
| **Core accounting pipeline** | ✅ Release-ready | Settlement → Xero → Bank Verified flow is robust with multiple safety gates |
| **Data integrity** | ✅ Release-ready | Idempotent writes, canonical actions, guardrail tests, source priority |
| **Security** | ⚠️ Conditional | RLS broadly applied; `repair-settlement-fees` body.userId should be removed; CORS and rate limiting need review |
| **Scalability** | ⚠️ Conditional | Pagination fix landed for edge functions; InsightsDashboard still has 1000-row client limit |
| **Profit reporting** | ⚠️ Labelled correctly | Estimates are clearly badged; implied rates shown; data quality strip warns on missing inputs. Commission accuracy risk is contained but not eliminated. |
| **Multi-marketplace** | ✅ Release-ready | Registry-based detection, fingerprinting, generic CSV parser handle new marketplaces as data |

**Bottom line**: Release-ready for AU/Xero with known estimate areas clearly signposted. Pre-release checklist should include: run `rls-audit`, verify pagination in InsightsDashboard for largest test account, and remove `body.userId` from `repair-settlement-fees`.

---

*This document is the single source of truth for Xettle's architecture. Update it when systems change.*
