# Xettle — Product Capabilities Reference

> **Last validated:** 2026-03-19 — Audited against live codebase.
> Use this as the single source of truth for marketing, investor decks, and feature pages.

---

## 1. Core Value Proposition

**Australian marketplace settlements → verified Xero invoices, automatically.**

Xettle replaces the manual spreadsheet workflow that Australian e-commerce sellers and their bookkeepers use to reconcile marketplace payouts with their Xero accounting. Upload a settlement file (or connect an API), and Xettle parses, categorises, reconciles, and pushes a line-item invoice directly into Xero — with full GST handling.

---

## 2. Supported Marketplaces (AU-Validated, Phase 1)

| Marketplace | Code | API Sync | CSV/TSV Upload | Payout Rail |
|---|---|---|---|---|
| Amazon AU | `amazon_au` | ✅ SP-API | ✅ TSV/CSV | Bank / Clearing |
| Shopify Payments | `shopify_payments` | ✅ Admin API | ✅ CSV | Bank / Clearing |
| eBay AU | `ebay_au` | ✅ Browse API | ✅ CSV | Bank / Clearing |
| Bunnings MarketLink | `bunnings` | — | ✅ PDF/CSV | Bank / Clearing |
| Catch | `catch` | — | ✅ CSV | Bank / Clearing |
| Kogan | `kogan` | — | ✅ CSV | Bank / Clearing |
| MyDeal | `mydeal` | — | ✅ CSV | Bank / Clearing |
| Everyday Market | `everyday_market` | — | ✅ CSV | Bank / Clearing |
| PayPal | `paypal` | — | ✅ CSV | PayPal / Bank |

**Self-learning support:** Any new marketplace CSV can be learned via the 3-level fingerprint engine (see §5), so this list grows automatically.

---

## 3. Integrations

### 3a. Xero (Two-Way)
- **OAuth 2.0 connection** with automatic token refresh
- **Chart of Accounts sync** — pull COA from Xero, cache for 24h, detect marketplace-related accounts automatically
- **COA Clone** — one-click creation of new marketplace account sets in Xero (Sales, Fees, Refunds, Other Fees, Shipping) with PIN approval
- **Invoice push** — create DRAFT or AUTHORISED invoices with full line-item breakdown per accounting category
- **Journal push** — alternative journal entry mode for split-month settlements
- **Invoice comparison** — fetch live Xero invoice and diff against Xettle's expected payload
- **Payment application** — apply payments to invoices in Xero
- **Bank transaction fetch** — pull bank statement lines for deposit verification
- **Outstanding invoice cache** — periodic sync of unpaid invoices
- **Xero history scan** — detect previously-posted marketplace invoices to prevent duplicates
- **Rollback** — void/reverse a pushed invoice and reset settlement to draft

### 3b. Amazon SP-API
- **OAuth 2.0 connection** with selling partner ID
- **Auto-fetch settlements** — scheduled pull of new settlement reports
- **Settlement line storage** — full transaction-level data with order IDs, SKUs, and fulfilment channel
- **Fulfilment channel backfill** — retroactive FBA/FBM/MCF classification

### 3c. Shopify Admin API
- **OAuth 2.0 connection** (App Store install) + Custom App token support
- **Auto-fetch payouts** — scheduled pull of Shopify Payments payouts
- **Order sync** — fetch orders with full line-item detail
- **Channel scanning** — detect active sales channels and sub-channels
- **Sub-channel detection** — identify orders from third-party marketplaces (Kogan, Catch, etc.) sold through Shopify
- **Auto-generate settlements** — create settlement records from Shopify payout data
- **GDPR webhooks** — customer data deletion/redaction compliance

### 3d. eBay Browse API
- **OAuth 2.0 connection** with refresh token management
- **Auto-fetch settlements** — scheduled pull of seller payouts

### 3e. Email System
- **Transactional email** via Resend (custom domain support)
- **Email queue** (PGMQ-backed) with retry, DLQ, and rate-limit handling
- **Custom HTML email templates** — signup confirmation, password recovery, magic link, invite, reauthentication, email change
- **Unsubscribe token management**

---

## 4. File Ingestion & Parsing

### Supported formats
- **CSV**, **TSV**, **XLSX**, **PDF** (Bunnings statements)

### 3-Level Detection Engine
1. **Level 1 — Hardcoded fingerprints:** Known column signatures for Amazon, Shopify, eBay, Bunnings, Woolworths, and generic formats
2. **Level 1.5 — Learned fingerprints:** User-confirmed column signatures stored in `marketplace_file_fingerprints` table, shared across sessions
3. **Level 3 — AI fallback:** Unknown files sent to `ai-file-interpreter` edge function for column mapping; high-confidence results auto-promoted to Level 1.5

### Specialised Parsers
- **Amazon TSV parser** — 13-category breakdown (sales principal, shipping, seller fees, FBA fees, storage fees, advertising, refunds, reimbursements, other fees, GST on income, GST on expenses, promotional discounts, bank deposit)
- **Bunnings PDF/CSV parser** — billing cycle extraction
- **Woolworths MarketPlus CSV parser**
- **Shopify Payments CSV parser**
- **Shopify Orders CSV parser**
- **Generic CSV parser** — adaptive header detection (scans up to 30 rows for preamble)

### Multi-Marketplace Splitter
- Detects files containing data from multiple marketplaces
- Identifies the split column automatically
- Groups rows by marketplace before parsing each chunk independently

### Duplicate Detection
- **Settlement fingerprinting** — SHA-256 hash of marketplace + currency + dates + net amount
- **Duplicate suppression** — flagged with reason, excluded from pipeline

---

## 5. Settlement Processing Pipeline

### 5-Stage Accounting Workflow
1. **Setup Required** — missing account mappings or Xero connection gaps
2. **Needs Review** — ingested, awaiting user confirmation
3. **Ready to Post** — passed all safety checks, eligible for Xero push
4. **Awaiting Reconciliation** — pushed to Xero, pending bank verification
5. **Alerts** — validation mismatches or reconciliation failures

### Pre-Push Safety
- **5 required mapping categories** — Sales, Seller Fees, Refunds, Other Fees, Shipping (all must be mapped before push)
- **PushSafetyPreview** — shows exact line items, amounts, and account codes before confirmation
- **Support tier gating** — SUPPORTED rails get full automation; EXPERIMENTAL = DRAFT-only; UNSUPPORTED = blocked
- **Period lock enforcement** — locked months cannot receive new pushes
- **Split-month handling** — settlements spanning two calendar months auto-split into separate journal entries

### Automation
- **Auto-post** — scheduled push of ready settlements (SUPPORTED tier only, with AUTHORISED status)
- **Auto-push to Xero** — background function for batch processing
- **Safe repost** — rollback existing invoice and re-push with updated data, preserving chain history

---

## 6. Reconciliation

### Multi-Layer Verification
- **Line-sum tolerance** — ±$0.01 (parsed line items vs settlement total)
- **Parser-total tolerance** — ±$0.01
- **Payout match tolerance** — ±$0.05 (settlement net vs bank deposit)
- **GST consistency tolerance** — ±$0.50

### Xero Deposit Verification
- Fetch bank transactions from Xero
- Match settlements to bank deposits by amount, date, and reference
- Confidence scoring (high/medium/low)
- User confirmation required before marking as verified

### Marketplace Validation Tracking
- 5-step lifecycle per marketplace/period: Orders → Settlement → Reconciliation → Xero → Bank
- Gap detection — identifies missing settlement periods
- Best-settlement priority when multiple records exist
- Bulk selection for batch Xero push

---

## 7. Financial Intelligence & Insights

### Per-Settlement Breakdown
- 13+ financial categories with component-level storage
- GST on income / GST on expenses separation
- Net-ex-GST computation

### Marketplace Comparison
- Side-by-side channel comparison (revenue, fees, margins, refund rates)
- Rolling 12-month trend analysis
- Fee rate tracking per marketplace over time

### Profit Engine
- Per-settlement gross profit calculation
- Per-SKU cost tracking (product_costs table)
- Fulfilment cost attribution (FBA vs FBM vs MCF)
- Shipping cost deduction per marketplace
- Margin percentage computation
- Uncosted revenue flagging

### Fee Observation Engine
- Track fee rates across settlements
- Detect rate changes and anomalies
- Generate alerts when fees deviate from historical norms

### GST Intelligence
- Quarterly GST liability summaries
- GST payable vs claimable breakdown
- Variance evidence generation
- GST audit pack export

---

## 8. AI Capabilities

### AI Assistant (Chat)
- Contextual chat panel on every page
- Explains settlement data, fee breakdowns, reconciliation mismatches
- Guides users through upload → map → push workflow
- Tool-augmented (can look up specific settlements, invoices, readiness status)
- Monthly question limit: 50
- Max tool rounds per question: 3

### AI-Powered Features
- **AI File Interpreter** — classify unknown CSV formats and suggest column mappings
- **AI Account Mapper** — suggest Xero account mappings based on COA analysis
- **AI COA Audit** — review chart of accounts for marketplace readiness
- **AI Bug Triage** — classify and prioritise bug reports automatically

### AI Product Policy (Hard Rules)
- ✅ Can explain data, summarise status, guide workflows
- ❌ Cannot create/modify Xero accounts directly
- ❌ Cannot auto-save mappings without confirmation
- ❌ Cannot skip PushSafetyPreview
- ❌ Cannot push without all 5 mapping categories
- ❌ Cannot use AUTHORISED status for EXPERIMENTAL tier

---

## 9. Onboarding

### 4-Step Setup Wizard
1. **Connect Xero** — OAuth flow
2. **Select Marketplaces** — choose active channels
3. **Add Settlements** — upload first files or connect APIs
4. **Verify** — confirm parsing results and account mappings

### Smart Defaults
- Auto-detect marketplace from COA (existing Xero accounts)
- Suggest account mappings from COA naming patterns
- Trial role auto-assigned on signup (14-day window)
- Accounting boundary date for historical data cutoff
- Backfill horizon selector for API-connected channels

---

## 10. Admin & Operations

### Admin Dashboard
- **User Overview** — all users with revenue totals, marketplace breakdown, usage metrics
- **Usage Tracking** — AI questions, Xero pushes, syncs per user
- **Bug Reports** — user-submitted reports with AI triage
- **Data Integrity** — RLS audit, system event monitoring
- **Email Monitoring** — send log, queue status, delivery tracking
- **Growth Scout** — community opportunity detection
- **Knowledge Base** — entity library management
- **Pre-Launch Checklist** — deployment readiness validation
- **Account Reset** — wipe user data for testing

### System Events & Audit
- Full event log (settlement_saved, xero_api_call, sync events, etc.)
- CSV export of system events
- Historical audit trail
- Period lock management with pre-lock snapshots

---

## 11. Security & Compliance

### Authentication
- Email/password signup with email verification
- Password recovery flow
- PIN-gated settings (account mappings, COA changes)
- Admin authentication via primary_admin_email in system_config

### Row-Level Security
- All tables have RLS enabled
- User isolation on every query
- Service-role-only access for admin functions
- RLS audit function (`get_rls_inventory`)

### Data Protection
- Input sanitization (XSS prevention)
- Honeypot fields on public forms
- CORS enforcement on all edge functions
- Shopify HMAC verification
- GDPR compliance webhooks (Shopify)

### Scope & Tier Enforcement
- AU-Validated scope acknowledgment required sitewide
- Tax profile selection (AU_GST or EXPORT_NO_GST)
- Per-rail support tier with explicit acknowledgment for EXPERIMENTAL rails

---

## 12. Pricing Tiers

| Tier | Price (Yearly) | Price (Monthly) | Key Features |
|---|---|---|---|
| **Free** | $0 | $0 | Manual CSV upload, full parsing, manual Xero push, unlimited settlements, AU marketplace support |
| **Starter** | $129/yr | $14.99/mo | + Amazon SP-API connection, auto-fetch settlements, settlement notifications |
| **Pro** | $229/yr | $26.99/mo | + Daily auto-push to Xero, email digests, priority support, early access |

---

## 13. Technical Architecture

- **Frontend:** React 18 + TypeScript + Vite + Tailwind CSS + shadcn/ui
- **Backend:** Lovable Cloud (Supabase) — PostgreSQL, Edge Functions (Deno), Auth, Storage, Realtime
- **AI Models:** Lovable AI (Gemini, GPT) — no user API keys required
- **Email:** Resend with PGMQ queue
- **Sync:** Scheduled edge functions for API integrations
- **Concurrency:** Database-level sync locks with TTL
- **File Storage:** Audit CSV exports in private storage bucket

---

*This document is auto-maintained. Update after every feature release.*
