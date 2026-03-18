# XETTLE CODEBASE AUDIT
**Generated: 9 March 2026 — from actual source code**

---

## 1. DATABASE TABLES

All tables from the `settlements` Supabase schema. 17 tables total.

### `settlements`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| user_id | uuid | No | — |
| settlement_id | text | No | — |
| marketplace | text | Yes | 'amazon_au' |
| period_start | date | No | — |
| period_end | date | No | — |
| sales_principal | numeric | Yes | 0 |
| sales_shipping | numeric | Yes | 0 |
| seller_fees | numeric | Yes | 0 |
| fba_fees | numeric | Yes | 0 |
| storage_fees | numeric | Yes | 0 |
| refunds | numeric | Yes | 0 |
| reimbursements | numeric | Yes | 0 |
| promotional_discounts | numeric | Yes | 0 |
| other_fees | numeric | Yes | 0 |
| gst_on_income | numeric | Yes | 0 |
| gst_on_expenses | numeric | Yes | 0 |
| net_ex_gst | numeric | Yes | 0 |
| bank_deposit | numeric | Yes | 0 |
| deposit_date | date | Yes | — |
| source | text | No | 'manual' |
| status | text | Yes | 'parsed' |
| reconciliation_status | text | Yes | 'pending' |
| xero_journal_id | text | Yes | — |
| xero_journal_id_1 | text | Yes | — |
| xero_journal_id_2 | text | Yes | — |
| xero_invoice_number | text | Yes | — |
| xero_status | text | Yes | — |
| is_split_month | boolean | Yes | false |
| split_month_1_data | jsonb | Yes | — |
| split_month_2_data | jsonb | Yes | — |
| parser_version | text | Yes | — |
| bank_verified | boolean | Yes | false |
| bank_verified_amount | numeric | Yes | — |
| bank_verified_at | timestamptz | Yes | — |
| bank_verified_by | uuid | Yes | — |
| created_at | timestamptz | No | now() |
| updated_at | timestamptz | No | now() |

**Foreign keys:** None (user_id not FK to auth.users — by design)
**Indexes:** No unique constraint on (settlement_id, marketplace, user_id) — **GAP**
**RLS Policies:**
- "Users can view their own settlements" — SELECT, authenticated, `auth.uid() = user_id`
- "Users can insert their own settlements" — INSERT, authenticated, `auth.uid() = user_id`
- "Users can update their own settlements" — UPDATE, authenticated, `auth.uid() = user_id`
- "Users can delete their own settlements" — DELETE, authenticated, `auth.uid() = user_id`

### `settlement_lines`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| user_id | uuid | No | — |
| settlement_id | text | No | — |
| transaction_type | text | Yes | — |
| amount_type | text | Yes | — |
| amount_description | text | Yes | — |
| accounting_category | text | Yes | — |
| amount | numeric | Yes | 0 |
| order_id | text | Yes | — |
| sku | text | Yes | — |
| posted_date | date | Yes | — |
| marketplace_name | text | Yes | — |
| created_at | timestamptz | No | now() |

**RLS:** SELECT/INSERT/DELETE by user_id. No UPDATE policy.

### `settlement_unmapped`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| user_id | uuid | No | — |
| settlement_id | text | No | — |
| transaction_type | text | Yes | — |
| amount_type | text | Yes | — |
| amount_description | text | Yes | — |
| amount | numeric | Yes | 0 |
| raw_row | jsonb | Yes | — |
| created_at | timestamptz | No | now() |

**RLS:** SELECT/INSERT/DELETE by user_id. No UPDATE.

### `marketplace_connections`
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| user_id | uuid | No | — |
| marketplace_code | text | No | — |
| marketplace_name | text | No | — |
| country_code | text | No | 'AU' |
| connection_type | text | No | 'manual' |
| connection_status | text | No | 'active' |
| settings | jsonb | Yes | '{}' |
| created_at | timestamptz | No | now() |
| updated_at | timestamptz | No | now() |

**RLS:** Full CRUD by user_id, authenticated role.

### `marketplaces`
Global marketplace metadata table (admin-managed).
| Column | Type | Nullable | Default |
|--------|------|----------|---------|
| id | uuid | No | gen_random_uuid() |
| marketplace_code | text | No | — |
| name | text | No | — |
| currency | text | No | 'AUD' |
| settlement_frequency | text | No | 'fortnightly' |
| settlement_type | text | No | 'csv' |
| gst_model | text | No | 'seller' |
| payment_delay_days | int | No | 14 |
| is_active | boolean | No | true |
| created_at / updated_at | timestamptz | No | now() |

**RLS:** SELECT for all authenticated. INSERT/UPDATE/DELETE requires `has_role('admin')`.

### `marketplace_fee_observations`
| Column | Type | Default |
|--------|------|---------|
| id, user_id, marketplace_code, settlement_id, fee_type (enum), fee_category, observation_method (enum), base_amount, observed_amount, observed_rate (nullable), period_start, period_end, currency, created_at | various | various |

**RLS:** SELECT/INSERT/DELETE by user_id. No UPDATE.

### `marketplace_fee_alerts`
| Column | Type | Default |
|--------|------|---------|
| id, user_id, marketplace_code, settlement_id, fee_type (enum), expected_rate, observed_rate, deviation_pct, status ('pending'), created_at | various | various |

**RLS:** SELECT by user_id + SELECT by admin. INSERT by user_id. UPDATE by user_id. No DELETE.

### `marketplace_ad_spend`
| Column | Type | Default |
|--------|------|---------|
| id, user_id, marketplace_code, period_start, period_end, spend_amount, source, notes, currency, created_at, updated_at | various | various |

**RLS:** Full CRUD, but uses `public` role instead of `authenticated` — **SECURITY GAP**

### `marketplace_shipping_costs`
| Column | Type | Default |
|--------|------|---------|
| id, user_id, marketplace_code, cost_per_order, currency, notes, created_at, updated_at | various | various |

**RLS:** Full CRUD, but uses `public` role instead of `authenticated` — **SECURITY GAP**

### `marketplace_file_fingerprints`
| Column | Type |
|--------|------|
| id, user_id, marketplace_code, column_signature (jsonb), column_mapping (jsonb), file_pattern, created_at |

**RLS:** ALL command, user_id scoped.

### `marketplace_fingerprints`
| Column | Type |
|--------|------|
| id, user_id (nullable), marketplace_code, field, pattern, confidence, source, match_count, created_at |

**RLS:** SELECT where user_id IS NULL OR user_id = auth.uid(). INSERT/UPDATE by user_id. No DELETE.

### `product_costs`
| Column | Type |
|--------|------|
| id, user_id, sku, cost, currency, label, created_at, updated_at |

**RLS:** Full CRUD by user_id, authenticated.

### `xero_tokens`
| Column | Type |
|--------|------|
| id, user_id, tenant_id, tenant_name, access_token, refresh_token, expires_at, scope, token_type, created_at, updated_at |

**RLS:** Full CRUD by user_id, authenticated.

### `amazon_tokens`
| Column | Type |
|--------|------|
| id, user_id, region, marketplace_id, selling_partner_id, access_token, refresh_token, expires_at, created_at, updated_at |

**RLS:** Full CRUD by user_id, authenticated.

### `app_settings`
| Column | Type |
|--------|------|
| id, user_id, key, value, created_at, updated_at |

**RLS:** SELECT/INSERT/UPDATE by user_id. No DELETE.

### `sync_history`
| Column | Type |
|--------|------|
| id, user_id, event_type, status, error_message, details (jsonb), settlements_affected, created_at |

**RLS:** SELECT/INSERT by user_id. No UPDATE/DELETE.

### `user_roles`
| Column | Type |
|--------|------|
| id, user_id, role (enum: admin, moderator, user, paid, starter, pro), created_at |

**RLS:** SELECT only by user_id. No INSERT/UPDATE/DELETE for users.

### DB Functions
```sql
has_role(_role app_role) → boolean  -- SECURITY DEFINER, checks user_roles
update_updated_at_column() → trigger  -- auto-updates updated_at
```

### DB Triggers
None configured.

---

## 2. EDGE FUNCTIONS

### `sync-settlement-to-xero` (457 lines)
- **Purpose:** Creates or voids Xero invoices for settlements
- **External APIs:** Xero Invoices API (POST/GET), Xero Token refresh
- **DB tables:** reads `xero_tokens`, reads `settlements`, writes `settlements` (status/journal_id), writes `sync_history`
- **Input:** `{ userId, action: 'create'|'rollback', reference, description, date, dueDate, lineItems[], contactName, invoiceIds[] }`
- **Returns:** `{ success, invoiceId, invoiceNumber }` or `{ success: false, error }`
- **Duplicate prevention:** Pre-push Xero API search by reference before creating

### `sync-xero-status` (156 lines)
- **Purpose:** Sync-back invoice statuses from Xero to local DB
- **External APIs:** Xero Invoices API (GET with `where` clause)
- **DB tables:** reads `xero_tokens`, reads/writes `settlements`
- **Input:** `{ userId }`
- **Returns:** `{ success, updated: number }`
- **Reference parsing:** Handles both `Xettle-{id}` (new) and `(id)` suffix (legacy)
- **config.toml:** `verify_jwt = false`

### `ai-file-interpreter` (361 lines)
- **Purpose:** AI-powered marketplace detection + file analysis
- **External APIs:** Lovable AI (Gemini model via LOVABLE_API_KEY)
- **DB tables:** None directly
- **Input (mode 1):** `{ action: 'detect_marketplace', note_attributes_samples[], tags_samples[], payment_method, row_count }`
- **Input (mode 2):** `{ headers[], sampleRows[][], fileName, fileFormat }`
- **Returns:** `{ marketplace_code, confidence, display_name, detection_patterns }` or file analysis
- **config.toml:** `verify_jwt = false`

### `xero-auth` (639 lines)
- **Purpose:** Xero OAuth2 authorization, token exchange, refresh, disconnect
- **External APIs:** Xero identity (authorize, token, connections, revoke)
- **DB tables:** reads/writes `xero_tokens`
- **Input actions:** `authorize`, `exchange`, `refresh`, `status`, `disconnect`
- **Returns:** varies by action — auth URL, token data, status

### `amazon-auth` (237 lines)
- **Purpose:** Amazon SP-API OAuth2 authorization + token exchange
- **External APIs:** Amazon Seller Central OAuth, Amazon API token endpoint
- **DB tables:** reads/writes `amazon_tokens`
- **Input actions:** `authorize`, `exchange` (via x-action header)
- **Returns:** `{ authUrl, state }` or `{ success, sellingPartnerId }`

### `fetch-amazon-settlements` (669 lines)
- **Purpose:** Fetch settlement reports from Amazon SP-API, parse, save to DB
- **External APIs:** Amazon SP-API (Reports, Settlement v2)
- **DB tables:** reads `amazon_tokens`, writes `settlements`, `settlement_lines`, `settlement_unmapped`, `sync_history`
- **Input:** `{ userId }` (via Authorization header)
- **Contains:** Embedded copy of settlement parser (PARSER_VERSION v1.7.0)
- **Returns:** `{ success, newSettlements, skippedDuplicates, details[] }`

### `auto-push-xero` (202 lines)
- **Purpose:** Batch auto-push unsent settlements to Xero for Pro/Admin users
- **External APIs:** Calls `sync-settlement-to-xero` internally
- **DB tables:** reads `user_roles`, `app_settings`, `sync_history`, `settlements`; writes `sync_history`
- **Input:** None (runs on schedule/cron)
- **Returns:** `{ success, results[] }`
- **Gating:** Only for users with `pro` or `admin` role

### `sync-amazon-journal` (449 lines)
- **Purpose:** Create Xero journal entries from Amazon settlement data
- **External APIs:** Xero Invoices API
- **DB tables:** reads `xero_tokens`, `settlements`; writes `settlements`
- **Input:** `{ userId, action: 'create'|'rollback', ... }`
- **Returns:** `{ success, invoiceId, invoiceNumber }`

### `admin-list-users` (95 lines)
- **Purpose:** List all users with their connection status and settlement counts
- **External APIs:** Supabase Auth Admin
- **DB tables:** reads `xero_tokens`, `amazon_tokens`, `settlements`, `user_roles`
- **Auth:** Requires `admin` role via `has_role()` RPC
- **Returns:** `{ users[] }`

### `admin-manage-users` (106 lines)
- **Purpose:** Admin user management (delete, invite, reset password)
- **External APIs:** Supabase Auth Admin
- **DB tables:** deletes from `settlement_lines`, `settlement_unmapped`, `settlements`, `xero_tokens`, `app_settings`, `user_roles`
- **Actions:** `delete_user`, `invite_user`, `reset_password`
- **Auth:** Requires `admin` role

---

## 3. PARSERS (src/utils/)

### `settlement-parser.ts` (715 lines)
- **Purpose:** Amazon AU Settlement Report (TSV) parser
- **Key exports:** `parseSettlementTSV(tsvContent, options?) → ParsedSettlement`
- **Input:** Raw TSV string
- **Output:** `ParsedSettlement { header: SettlementHeader, lines: SettlementLine[], unmapped: UnmappedLine[], summary: SettlementSummary, splitMonth: SplitMonthInfo }`
- **Other exports:** `PARSER_VERSION ('v1.7.0')`, `XERO_ACCOUNT_MAP`, `CATEGORY_MAP`, types
- **Features:** 5 parser rules (header detection, sign normalisation, aggregation, GST calc, recon gate), AU vs international marketplace splitting, LVGT tax detection, split-month support

### `shopify-orders-parser.ts` (679 lines)
- **Purpose:** Shopify Orders CSV parser — splits by marketplace using registry
- **Key exports:** `parseShopifyOrdersCSV(csvContent, options?) → ShopifyOrdersResult`
- **Input:** Raw CSV string
- **Output:** `ShopifyOrdersResult { groups: MarketplaceGroup[], skippedGroups, unknownGroups, settlements: StandardSettlement[], statusBreakdown }`
- **Other exports:** `normaliseSku()`, `ShopifyOrderRow`, `MarketplaceGroup`, `GatewayGroup` (legacy)
- **Features:** Multi-line CSV handling (Bunnings notes spanning 7+ lines), registry-based detection (Note Attributes → Tags → Payment Method), order dedup by Name, partial refund inclusion, line-item SKU extraction for profit engine

### `shopify-payments-parser.ts` (648 lines)
- **Purpose:** Shopify Payments CSV parser — auto-detects payout-level vs transaction-level format
- **Key exports:** `parseShopifyPayoutCSV(csvContent) → ShopifyParseResult`
- **Input:** Raw CSV string
- **Output:** `ShopifyParseResult { settlements: StandardSettlement[], extra: ShopifyParseExtra, rawRows?, rowsByPayout? }`
- **Other exports:** `ShopifyTransactionRow`, `ShopifyPayoutGroup`
- **Features:** Dual-format detection (payout-level: one row per payout; transaction-level: one row per transaction grouped by Payout ID), GST calculation at 1/11th

### `bunnings-summary-parser.ts` (316 lines)
- **Purpose:** Bunnings (Mirakl) Summary of Transactions PDF parser
- **Key exports:** `parseBunningsSummaryPdf(file, invoiceNumberOverride?) → BunningsParseResult`
- **Input:** File (PDF)
- **Output:** `BunningsParseResult { settlement: StandardSettlement, extra: BunningsParseExtra }`
- **Features:** PDF text extraction via pdfjs-dist, 10 row patterns (payable orders, commission, refunds, refund on commission, shipping, subscription, manual credit/debit, other, delivery charges), 1-4 AUD amount interpretation, reconciliation check

### `woolworths-marketplus-parser.ts` (481 lines)
- **Purpose:** Woolworths MarketPlus combined CSV parser (Big W + Everyday Market + MyDeal)
- **Key exports:** `parseWoolworthsMarketPlusCSV(csvContent) → WoolworthsResult`, `buildWoolworthsInvoiceLines(settlement) → WoolworthsXeroLineItem[]`, `isWoolworthsMarketPlusCSV(headers) → boolean`
- **Input:** Raw CSV string
- **Output:** `WoolworthsResult { groups: WoolworthsMarketplaceGroup[], bankPaymentRef, totalNet, settlements: StandardSettlement[], allRows }`
- **Features:** Splits by "Order Source" column, ORDER_SOURCE_MAP (bigw → 'bigw', everydaymarket → 'woolworths', mydeal → 'mydeal'), clearing invoice builder with 4-line Xero format (Sales, Refunds, Commission, Clearing)

### `generic-csv-parser.ts` (343 lines)
- **Purpose:** Mapping-driven parser for any CSV/XLSX — no marketplace-specific code
- **Key exports:** `parseGenericCSV(content, options) → GenericParseResult`, `parseGenericXLSX(file, options) → GenericParseResult`
- **Input:** CSV string + `GenericParseOptions { marketplace, mapping: ColumnMapping, gstModel, gstRate, groupBySettlement }`
- **Output:** `GenericParseResult { success, settlements: StandardSettlement[], rowCount, warnings[] }`

### `settlement-engine.ts` (421 lines)
- **Purpose:** Shared types and helpers for all marketplace settlements — CRUD, Xero sync, rollback
- **Key exports:**
  - `saveSettlement(settlement: StandardSettlement) → SaveResult` — dedup check (app-level), insert to DB, fire-and-forget fee observation extraction
  - `syncSettlementToXero(settlementId, marketplace, options?) → SyncResult` — push to Xero via edge function, update local status
  - `rollbackSettlementFromXero(settlementId, marketplace, invoiceIds, rollbackScope?) → RollbackResult`
  - `syncXeroStatus() → { success, updated }` — call sync-xero-status edge function
  - `deleteSettlement(id) → { success, error? }`
  - `buildSimpleInvoiceLines(settlement) → XeroLineItem[]` — 2-line model (Sales + Fees) with optional refunds, refund commission, shipping, subscription lines
  - `buildInvoiceReference(settlement) → string` — format: `Xettle-{settlement_id}`
  - `buildInvoiceDescription(settlement) → string`
  - `MARKETPLACE_CONTACTS` — map of marketplace → Xero contact name (12 entries)
  - `MARKETPLACE_LABELS` — map of marketplace code → display name (18 entries including composite codes)
  - `formatSettlementDate()`, `formatAUD()`

### `reconciliation-engine.ts` (189 lines)
- **Purpose:** Amazon-specific settlement reconciliation — runs 5 checks before Xero sync
- **Key exports:** `runReconciliation(parsed: ParsedSettlement, historicalStats?) → ReconciliationResult`
- **Checks:** Balance, Column Totals, GST Consistency, Sanity (5 sub-checks), Historical Deviation
- **Output:** `ReconciliationResult { checks: ReconCheck[], overallStatus, canSync }`

### `universal-reconciliation.ts` (209 lines)
- **Purpose:** Universal reconciliation for any marketplace (not just Amazon)
- **Key exports:** `runUniversalReconciliation(settlement: StandardSettlement, historicalStats?) → UniversalReconciliationResult`
- **Checks:** Balance, GST Consistency, Refund Completeness, Sanity (5 sub-checks), Historical Fee Rate Deviation, Xero Invoice Accuracy
- **Output:** `UniversalReconciliationResult { checks, overallStatus, canSync }`

### `fee-observation-engine.ts` (281 lines)
- **Purpose:** Extract fee rate observations and detect anomalies (>15% deviation from historical average)
- **Key exports:** `extractFeeObservations(settlement, userId)`, `extractAmazonFeeObservations(record, userId)`
- **DB writes:** `marketplace_fee_observations` (upsert), `marketplace_fee_alerts` (insert on anomaly)
- **Thresholds:** MIN_BASE_AMOUNT = $100, deviation threshold = 15%, minimum 3 prior observations

### `file-fingerprint-engine.ts` (556 lines)
- **Purpose:** 3-level file detection pipeline
- **Key exports:** `detectFromHeaders(headers) → FileDetectionResult | null`, `detectByFingerprint(headers)` (Level 1), `detectByHeuristic(headers)` (Level 2), `extractFileHeaders(file)`
- **Level 1 fingerprints:** 13 patterns (Amazon AU, Shopify Payments x2, Woolworths MarketPlus, Kogan, BigW, Catch, MyDeal, Amazon Orders WRONG, Shopify Orders, Amazon Inventory WRONG, Amazon Advertising WRONG)
- **Level 2 heuristics:** 10 field patterns (gross_sales, fees, refunds, net_payout, settlement_id, period_start, period_end, gst, order_id, currency)

### `file-marketplace-detector.ts` (89 lines)
- **Purpose:** Quick file sniff by filename and content (first 2KB)
- **Key exports:** `detectFileMarketplace(file) → DetectedMarketplace`
- **Detection:** Filename patterns + content-based signals for Amazon, Bunnings, Shopify, Woolworths MarketPlus

### `fingerprint-library.ts` (166 lines)
- **Purpose:** Level 2 detection — learned patterns from `marketplace_fingerprints` table
- **Key exports:** `loadFingerprints()`, `detectFromFingerprints(noteAttributes, tags, paymentMethod)`, `saveFingerprint(params)`, `incrementFingerprintMatch(field, pattern)`
- **DB reads/writes:** `marketplace_fingerprints` table
- **Caching:** In-memory session cache with `invalidateFingerprintCache()`

### `marketplace-registry.ts` (319 lines)
- **Purpose:** Central marketplace definition — single source of truth for detection + Xero accounts
- **Key exports:** `MARKETPLACE_REGISTRY` (14 entries), `detectMarketplaceFromRow(noteAttributes, tags, paymentMethod)`, `getRegistryEntry(key)`
- **Full registry is in Section 6 below**

### `profit-engine.ts` (135 lines)
- **Purpose:** COGS calculation from product_costs + Shopify Orders groups
- **Key exports:** `calculateProfit(groups, costMap) → ProfitEngineResult`, `extractUniqueSKUs(groups) → string[]`
- **Input:** `MarketplaceGroup[]` + `Map<string, ProductCost>`
- **Output:** per-marketplace revenue, COGS, gross profit, margin %, costed/uncosted SKU counts

### `xero-csv-export.ts` (620 lines)
- **Purpose:** Generate Xero Bill Import CSV from Alibaba orders
- **Key exports:** `orderToXeroRows(order) → XeroBillRow[]`, `ordersToXeroCSV(orders) → string`, `validateExport(orders) → ExportValidationResult`
- **Features:** GL account mapping (Product→631, Freight→425, Service Fee→411), tax type mapping (GST Free for international, GST on Expenses for domestic), AUD/USD proportional split, service fee estimation

### `input-sanitization.ts` (50 lines)
- **Purpose:** Basic input sanitization
- **Key exports:** `sanitizeText(input)`, `sanitizeEmail(email)`, `sanitizePhone(phone)`, `isSpamSubmission(honeypotValue)`

---

## 4. COMPONENTS (src/components/)

### Core Components

#### `ErrorBoundary.tsx`
- **Purpose:** React error boundary wrapping the app
- **Props:** `children`
- **Renders:** Error fallback UI with retry button

#### `PinGate.tsx`
- **Purpose:** Optional PIN protection gate before accessing the app
- **State:** PIN input, verified state
- **Renders:** PIN input form or children

#### `PublicDemoUpload.tsx`
- **Purpose:** Landing page file upload demo — parses files without auth, stores in sessionStorage for claim after signup
- **Props:** None
- **State:** File drag/drop, parsing state, parsed settlements
- **Calls:** `extractFileHeaders`, `detectFromHeaders`, parsers

#### `MarketplaceAlertsBanner.tsx`
- **Purpose:** Banner showing fee anomaly alerts across marketplaces
- **Props:** None
- **State:** Loads from `marketplace_fee_alerts` table
- **Renders:** Dismissible alert badges with fee deviation info

#### `MarketplaceInfoPanel.tsx`
- **Purpose:** Information panel about marketplace features
- **Renders:** Static content about supported marketplaces

### Admin Components

#### `admin/AdminHeader.tsx`
- **Purpose:** Admin page header
- **Props:** User info, sign out handler

#### `admin/AdminLoginView.tsx`
- **Purpose:** Admin login form wrapper

#### `admin/LoginForm.tsx`
- **Purpose:** Email/password login form with honeypot spam protection
- **Props:** `onSubmit`
- **State:** email, password, honeypot

#### `admin/XeroConnectionStatus.tsx`
- **Purpose:** Shows Xero OAuth connection status with connect/disconnect buttons
- **State:** Loading xero_tokens from DB

### Accounting Dashboard Components

#### `admin/accounting/AccountingDashboard.tsx` (~4,395 lines) ❌ NOT ON SHARED HOOKS
- **Purpose:** Amazon AU settlement dashboard — THE LARGEST FILE
- **State:** settlements, parsing, Xero sync, split-month, recon, transaction drill-down, onboarding, settings panel
- **Features:** TSV upload + parse, settlement save with dedup, multi-line Xero invoice builder (7+ line items for Amazon), split-month handling with P1/P2 invoices, reconciliation checks, fee observation extraction, Seller Central guide, Amazon SP-API connection panel, bank verification
- **Missing from shared hooks:** Inline recon (uses own), bulk delete (uses own), rollback (uses own), gap detection (none), mark-already-in-Xero (none)

#### `admin/accounting/GenericMarketplaceDashboard.tsx` (~700 lines) ✅ FULLY REFACTORED
- **Purpose:** Universal dashboard for non-Amazon marketplaces
- **Props:** `marketplace: UserMarketplace`, `onMarketplacesChanged`, `onSwitchToUpload`
- **Hooks used:** `useSettlementManager`, `useBulkSelect`, `useXeroSync`, `useReconciliation`, `useTransactionDrilldown`
- **Features:** Settlement history table, push to Xero, rollback, refresh from Xero, inline recon checks, Xero-aware bulk delete with dialog, gap detection, mark already in Xero, bank verification, transaction drill-down with eye button, delete marketplace tab

#### `admin/accounting/ShopifyPaymentsDashboard.tsx` (~800 lines) ❌ NOT ON SHARED HOOKS
- **Purpose:** Shopify Payments payout dashboard
- **State:** Own settlement loading, own Xero push logic
- **Missing:** Rollback, refresh from Xero, inline recon, Xero-aware bulk delete, gap detection, bank verification

#### `admin/accounting/BunningsDashboard.tsx` (~1,230 lines) ❌ NOT ON SHARED HOOKS
- **Purpose:** Bunnings billing cycle PDF dashboard
- **State:** Own settlement loading, own parsing, own Xero push
- **Missing:** Rollback, refresh from Xero, inline recon, Xero-aware bulk delete, gap detection, bank verification

#### `admin/accounting/ShopifyOrdersDashboard.tsx` (~1,315 lines) ❌ NOT ON SHARED HOOKS
- **Purpose:** Shopify Orders marketplace splitter dashboard
- **State:** Own parsing, group management, per-group Xero push
- **Missing:** Rollback, refresh from Xero, inline recon, Xero-aware bulk delete, gap detection, bank verification

#### `admin/accounting/InsightsDashboard.tsx` (1,186 lines)
- **Purpose:** Cross-marketplace analytics
- **Query:** Loads ALL settlements (`supabase.from('settlements').select(...)`) + `marketplace_ad_spend` + `marketplace_shipping_costs`
- **Marketplace normalisation:** Strips `woolworths_marketplus_` and `shopify_orders_` prefixes to aggregate under base codes
- **Stats:** Per-marketplace: total sales (inc GST), total fees, refunds, net payout, return ratio, fee load, commission rate, ad spend impact, shipping cost estimate, fee breakdown waterfall
- **Why only 2 marketplaces showing:** It shows ALL marketplaces that have settlements in the DB. If only 2 show, the user has only uploaded data for 2 marketplaces.
- **Features:** Ad spend entry dialog, shipping cost per order dialog, hero insight generator, fee breakdown bar chart, per-marketplace cards

#### `admin/accounting/SmartUploadFlow.tsx`
- **Purpose:** Universal file upload flow — auto-detects marketplace and routes to correct parser
- **Props:** `onSettlementsSaved`, `onMarketplacesChanged`, `onViewSettlements`
- **Flow:** File drop → `extractFileHeaders` → `detectFromHeaders` (Level 1/2) → if unknown, AI fallback via edge function → route to marketplace parser → save settlements

#### `admin/accounting/MarketplaceSwitcher.tsx`
- **Purpose:** Tab bar for switching between marketplace dashboards
- **Props:** `selectedMarketplace`, `onMarketplaceChange`, `userMarketplaces`, `onMarketplacesChanged`
- **Exports:** `MARKETPLACE_CATALOG` (catalog of all supported marketplaces with phases/icons), `UserMarketplace` type
- **Features:** Add marketplace dialog, delete marketplace tab with cascade cleanup

#### `admin/accounting/MonthlyReconciliationStatus.tsx`
- **Purpose:** Monthly reconciliation summary across all marketplaces
- **Props:** `userMarketplaces`, `onSwitchToUpload`, `onSelectMarketplace`

#### `admin/accounting/OnboardingChecklist.tsx`
- **Purpose:** New user onboarding checklist
- **Checks:** Upload first file, connect Xero, push first settlement

#### `admin/accounting/MarketplaceReturnRatio.tsx`
- **Purpose:** Quick return-per-dollar metric display

#### `admin/accounting/SkuCostManager.tsx`
- **Purpose:** CRUD interface for product costs (SKU → cost mapping)
- **DB table:** `product_costs`
- **Features:** Add/edit/delete SKU costs, CSV import

#### `admin/accounting/SellerCentralGuide.tsx`
- **Purpose:** Step-by-step guide for downloading Amazon AU settlement reports

#### `admin/accounting/ShopifyOnboarding.tsx`
- **Purpose:** Onboarding guide for Shopify Payments CSV download

#### `admin/accounting/AmazonConnectionPanel.tsx`
- **Purpose:** Amazon SP-API OAuth connection + manual token entry
- **Features:** Auto-fetch settlements, manual refresh, connection status

#### `admin/accounting/AutomationSettingsPanel.tsx`
- **Purpose:** Settings for auto-push schedule (cron interval)

#### `admin/accounting/SyncComponents.tsx`
- **Purpose:** Xero sync UI components (push button, status indicators)

#### `admin/accounting/UpgradePlanComponents.tsx`
- **Purpose:** Upgrade prompt components for gated features

### Shared Dashboard Components (new architecture)

#### `admin/accounting/shared/SettlementStatusBadge.tsx`
- **Purpose:** Consistent status badge rendering
- **Props:** `status, xeroStatus, xeroInvoiceNumber`

#### `admin/accounting/shared/ReconChecksInline.tsx`
- **Purpose:** Expandable inline reconciliation check results
- **Props:** `result: UniversalReconciliationResult`

#### `admin/accounting/shared/BulkDeleteDialog.tsx`
- **Purpose:** Xero-aware bulk delete confirmation dialog
- **Props:** `open, selectedCount, syncedCount, onConfirm, onCancel, loading`

#### `admin/accounting/shared/GapDetector.tsx`
- **Purpose:** Missing settlement period detection
- **Props:** `settlements, expectedFrequencyDays?`

### Admin Marketplace Config

#### `admin/marketplace/MarketplaceConfigTab.tsx`
- **Purpose:** Admin-only marketplace configuration (CRUD on `marketplaces` table)

---

## 5. PAGES (src/pages/)

| File | Route | Renders | Auth Protected |
|------|-------|---------|----------------|
| `Landing.tsx` (553 lines) | `/` | Marketing page with hero, feature sections, marketplace logos, PublicDemoUpload component, CTA | No |
| `Auth.tsx` (345 lines) | `/auth` | Sign in / Sign up tabs, forgot password, resend verification email, honeypot spam protection | No |
| `Dashboard.tsx` (326 lines) | `/dashboard` | Main app — MarketplaceSwitcher tabs, Smart Upload, Settlements view (AccountingDashboard/GenericMarketplaceDashboard/ShopifyOrdersDashboard), Insights view | Yes |
| `Admin.tsx` (373 lines) | `/admin` | Admin panel — user management (list, invite, delete, reset password), role management, MarketplaceConfigTab | Yes + admin role |
| `Pricing.tsx` (208 lines) | `/pricing` | 3-tier pricing page (Free/Starter/Pro) with toggle for monthly/yearly | No |
| `XeroCallback.tsx` | `/xero/callback` | Xero OAuth2 callback handler | Yes |
| `AmazonCallback.tsx` | `/amazon/callback` | Amazon SP-API OAuth2 callback handler | Yes |
| `ResetPassword.tsx` | `/reset-password` | Password reset form | No |
| `Privacy.tsx` | `/privacy` | Privacy policy page | No |
| `Terms.tsx` | `/terms` | Terms of service page | No |
| `NotFound.tsx` | `*` | 404 page | No |

---

## 6. MARKETPLACE REGISTRY

Complete contents of `src/utils/marketplace-registry.ts`:

```
MARKETPLACE_REGISTRY (14 entries):
```

| Key | display_name | contact_name | payment_type | Sales Acct | Shipping Acct | Clearing Acct | Fees Acct | GST | skip | Detection Patterns |
|-----|-------------|-------------|-------------|-----------|-------------|-------------|---------|-----|------|-------------------|
| mydeal | MyDeal | MyDeal | direct_bank_transfer | 200 | 206 | 613 | 405 | ✅ | — | note: MyDealOrderID, mydeal_order; tags: mydeal, my deal; pm: mydeal |
| bunnings | Bunnings Marketplace | Bunnings Marketplace | direct_bank_transfer | 200 | 206 | 613 | 405 | ✅ | — | note: "Order placed from: Bunnings", Tenant_id: Bunnings, Channel_id: 0196, mirakl; tags: bunnings, mirakl, mirakl-connector; pm: mirakl, bunnings |
| kogan | Kogan | Kogan | direct_bank_transfer | 200 | 206 | 613 | 405 | ✅ | — | note: "Order placed from: Kogan", KoganOrderID; tags: kogan, cedcommerce, kogan.com; pm: commercium, constacloud, kogan |
| bigw | Big W Marketplace | Big W | direct_bank_transfer | 200 | 206 | 613 | 405 | ✅ | — | note: "Order placed from: Big W", bigw; tags: big w, bigw |
| everyday_market | Everyday Market | Everyday Market | direct_bank_transfer | 200 | 206 | 613 | 405 | ✅ | — | note: Everyday Market, woolworths; tags: everyday market, woolworths |
| catch | Catch | Catch | direct_bank_transfer | 200 | 206 | 613 | 405 | ✅ | — | note: "Order placed from: Catch", CatchOrderID; tags: catch |
| ebay | eBay | eBay | direct_bank_transfer | 200 | 206 | 613 | 405 | ✅ | — | note: "Order placed from: eBay", eBayOrderID; tags: ebay; pm: ebay |
| paypal | PayPal | PayPal | gateway_clearing | 201 | 206 | 613 | 405 | ✅ | — | pm: paypal express checkout, paypal |
| afterpay | Afterpay | Afterpay | gateway_clearing | 201 | 206 | 613 | 405 | ✅ | — | pm: afterpay, afterpay_v2 |
| stripe | Stripe | Stripe | gateway_clearing | 201 | 206 | 613 | 405 | ✅ | — | pm: stripe |
| manual_order | Manual Orders | Manual Orders | gateway_clearing | 201 | 206 | 613 | 405 | ✅ | — | pm: manual |
| shopify_payments | Shopify Payments | Shopify Payments | gateway_clearing | 201 | 206 | 613 | 405 | ✅ | **SKIP** | pm: shopify_payments, shopify payments, shopify. Reason: "Handled by Shopify Payments payout CSV — skipped" |

**Detection priority:** Note Attributes → Tags → Payment Method
**Fallback:** `getRegistryEntry(key)` returns generic entry for unknown keys with account 201/206/613/405.

---

## 7. SETTLEMENT ENGINE

### `syncSettlementToXero()` — full signature
```typescript
export async function syncSettlementToXero(
  settlementId: string,
  marketplace: string,
  options?: {
    lineItems?: XeroLineItem[];
    reference?: string;
    contactName?: string;
  }
): Promise<SyncResult>
```

### `saveSettlement()` — full signature
```typescript
export async function saveSettlement(settlement: StandardSettlement): Promise<SaveResult>
// SaveResult = { success: boolean; error?: string; duplicate?: boolean }
```
Dedup: queries `settlements` table for `settlement_id + user_id + marketplace`. Application-level only — no DB unique constraint.

### `buildInvoiceReference()` — current format
```typescript
export function buildInvoiceReference(settlement: StandardSettlement): string {
  return `Xettle-${settlement.settlement_id}`;
}
```

### `MARKETPLACE_CONTACTS` — all entries
```typescript
{
  amazon_au: 'Amazon.com.au',
  bunnings: 'Bunnings Marketplace',
  bigw: 'Big W Marketplace',
  shopify_payments: 'Shopify Payments',
  shopify_orders: 'Shopify',
  catch: 'Catch Marketplace',
  mydeal: 'MyDeal Marketplace',
  kogan: 'Kogan Marketplace',
  woolworths: 'Woolworths Marketplace',
  woolworths_marketplus: 'Woolworths MarketPlus',
}
```

### `syncXeroStatus()` — signature
```typescript
export async function syncXeroStatus(): Promise<{ success: boolean; updated?: number; error?: string }>
```
Calls `sync-xero-status` edge function.

### `rollbackSettlementFromXero()` — signature
```typescript
export async function rollbackSettlementFromXero(
  settlementId: string,
  marketplace: string,
  invoiceIds: string[],
  rollbackScope: 'all' | 'journal_1' | 'journal_2' = 'all'
): Promise<RollbackResult>
```

### `deleteSettlement()` — signature
```typescript
export async function deleteSettlement(id: string): Promise<{ success: boolean; error?: string }>
```

---

## 8. STRIPE / BILLING

### Stripe imports or config
**NONE.** Zero Stripe imports, zero Stripe SDK, zero Stripe webhook handlers anywhere in the codebase.

### Subscription tier definitions
In `src/pages/Pricing.tsx` — **UI only, no enforcement:**
```typescript
const tiers = [
  { name: 'Free', monthlyPrice: 0, yearlyPrice: 0, cta: 'Current Plan' },
  { name: 'Starter', monthlyPrice: 14.99, yearlyPrice: 129, cta: 'Coming Soon' },
  { name: 'Pro', monthlyPrice: 26.99, yearlyPrice: 229, cta: 'Coming Soon' },
];
```
Both paid tiers have `cta: 'Coming Soon'` — buttons are disabled.

### Billing UI components
- `src/components/admin/accounting/UpgradePlanComponents.tsx` — renders upgrade prompts but **does not gate any features**

### Billing edge functions
**NONE.**

### Plans page content
Shows 3 tiers with feature lists. Free = unlimited settlements, manual upload, manual push. Starter = Amazon SP-API auto-fetch. Pro = daily auto-push to Xero.

### Role-based gating
- DB roles exist: `admin`, `moderator`, `user`, `paid`, `starter`, `pro`
- `auto-push-xero` edge function checks for `pro` or `admin` role before auto-pushing
- **No other feature gating exists.** All users get full access to everything.

---

## 9. GENERIC MARKETPLACE DASHBOARD

Current state of `GenericMarketplaceDashboard.tsx`:

### Features implemented ✅
- Settlement history table with period, sales, fees, net, status
- Push to Xero with reconciliation gate
- Rollback from Xero (void invoice + reset status)
- Refresh from Xero (sync-back statuses)
- Inline reconciliation checks (Balance, GST, Refund Completeness, Sanity, Invoice Accuracy)
- Xero-aware bulk delete with confirmation dialog
- Gap detection (missing settlement periods)
- Mark Already in Xero (single + bulk)
- Bank verification (enter bank amount, stored in DB)
- Transaction drill-down (eye button) — loads `settlement_lines` for that settlement_id
- Delete marketplace tab with cascade cleanup
- Realtime subscription for auto-refresh
- Status badges (saved, synced, push_failed, synced_external)

### What is placeholder/stub
**Nothing.** All features are fully implemented.

### Does it save settlement_lines?
**No.** GenericMarketplaceDashboard does not save `settlement_lines`. It saves to the `settlements` table only. The eye button loads lines IF they were saved by the parser (Amazon parser saves lines; generic parser does not).

### Does it run reconciliation?
**Yes.** Uses `useReconciliation` hook → `runUniversalReconciliation()`. Checks: Balance, GST, Refund Completeness, Sanity, Historical Deviation, Xero Invoice Accuracy.

### Does it have bulk delete?
**Yes.** Uses `useBulkSelect` hook → `BulkDeleteDialog` component. Xero-aware: warns if selected items are synced to Xero.

### What does the eye button actually do?
Opens transaction drill-down: queries `settlement_lines` table for the given `settlement_id + user_id`, displays line-by-line amounts with ex-GST and incl-GST totals. If no lines exist (non-Amazon marketplace), shows "No transaction lines found."

---

## 10. SHOPIFY ORDERS PARSER

Current state of `src/utils/shopify-orders-parser.ts`:

### Does it save settlement_lines per order?
**No.** The parser returns `StandardSettlement[]` objects (one per marketplace group). It does NOT save individual order rows as `settlement_lines`. The `settlement_lines` table is only populated by the Amazon parser.

### How does it group by marketplace?
Uses `detectMarketplaceFromRow(noteAttributes, tags, paymentMethod)` from the marketplace registry. Groups by `JSON.stringify({ m: marketplace_key, c: currency })`.

### What marketplace_codes does it produce?
`shopify_orders_{registry_key}` — e.g.:
- `shopify_orders_mydeal`
- `shopify_orders_bunnings`
- `shopify_orders_kogan`
- `shopify_orders_bigw`
- `shopify_orders_catch`
- `shopify_orders_ebay`
- `shopify_orders_paypal`
- `shopify_orders_afterpay`
- `shopify_orders_stripe`
- `shopify_orders_manual_order`
- `shopify_orders_unknown` (for unrecognised)

### Does it feed GenericMarketplaceDashboard?
**Indirectly.** ShopifyOrdersDashboard is a separate component. But settlements saved with `shopify_orders_X` marketplace codes will appear in GenericMarketplaceDashboard if a user has that marketplace tab. The InsightsDashboard normalises `shopify_orders_kogan` → `kogan` for aggregation.

---

## 11. INSIGHTS DASHBOARD

### What query does it run?
```typescript
supabase.from('settlements')
  .select('marketplace, sales_principal, gst_on_income, seller_fees, refunds, bank_deposit, fba_fees, other_fees, storage_fees, period_end, period_start')
  .order('period_end', { ascending: false })
```
Plus:
```typescript
supabase.from('marketplace_ad_spend').select('marketplace_code, spend_amount')
supabase.from('marketplace_shipping_costs').select('marketplace_code, cost_per_order')
```

### What marketplace_codes does it include?
**ALL** marketplace codes from the user's settlements. It normalises composite codes:
```typescript
function normalizeMarketplace(mp: string): string {
  if (mp.startsWith('woolworths_marketplus_')) return mp.replace('woolworths_marketplus_', '');
  if (mp.startsWith('shopify_orders_')) return mp.replace('shopify_orders_', '');
  return mp;
}
```
So `woolworths_marketplus_bigw` → `bigw`, `shopify_orders_kogan` → `kogan`, etc.

### Why only 2 marketplaces showing?
The dashboard shows whatever marketplaces exist in the user's `settlements` table. If only 2 show, the user has only uploaded/synced data for 2 marketplaces. This is not a code limitation — it's data-driven.

---

## 12. KNOWN GAPS

### TODO/FIXME/HACK comments
**None found.** No TODO, FIXME, or HACK comments exist in the `src/` directory.

### Placeholder/stub functions
**None found.** All exported functions have real implementations.

### Hardcoded test values
- `src/pages/Pricing.tsx`: Prices are hardcoded (Free=$0, Starter=$14.99/$129, Pro=$26.99/$229) — no Stripe product IDs
- `supabase/functions/amazon-auth/index.ts`: Hardcoded `application_id: 'amzn1.sp.solution.d95a6e1f-2b22-4bb1-a6de-73427cb73bd9'` and `redirect_uri: 'https://xettle.app/amazon/callback'`

### console.log that should be removed
Found in production code:
1. `src/utils/settlement-parser.ts` line 240: `console.log('[PARSER START]', ...)`
2. `src/components/admin/LoginForm.tsx` line 27: `console.log('Spam attempt detected')`
3. `src/components/admin/accounting/AmazonConnectionPanel.tsx` line 143: `console.log('[Sync Details]', ...)`
4. `src/utils/xero-csv-export.ts` lines 365, 377: `console.log(...)` for AUD adjustment debugging

Additionally, `settlement-parser.ts` has ~10 `console.info` calls for debugging marketplace splits. These are useful during development but noisy in production.

### Features mentioned in comments but not implemented
1. `settlement-engine.ts` line 37: `shopify_orders: 'Shopify', // Dynamic per-gateway contact name in metadata` — comment says "dynamic" but contact name is static 'Shopify'
2. `MARKETPLACE_LABELS` includes `theiconic: 'The Iconic'` but The Iconic has no registry entry, no parser, and no detection pattern

---

## 13. WHAT IS NOT BUILT

### Stripe billing (CRITICAL)
- **Missing:** No `stripe` npm package, no Stripe webhook handler, no checkout session creation, no subscription management, no customer portal, no plan enforcement middleware
- **Impact:** All users get full access forever for free
- **What exists:** Pricing page UI (3 tiers), DB roles (paid/starter/pro), `auto-push-xero` checks for `pro` role

### DB unique constraint on settlements
- **Missing:** `CREATE UNIQUE INDEX idx_settlement_dedup ON settlements (settlement_id, marketplace, user_id)`
- **Impact:** Race conditions can create duplicate settlements (dedup is application-level only in `saveSettlement()`)

### Rate limiting on edge functions — ROOT CAUSE IDENTIFIED (14 Mar 2026)
- **Root cause:** Absence of a tenant-scoped Xero request governor (shared budget + priority + cooldown + coalescing) allows invoice/status traffic (`sync-xero-status` ~40 calls, `fetch-outstanding` ~4 retries) to exhaust the shared Xero tenant/app rate limit, starving `fetch-xero-bank-transactions` (1 call → immediate 429). Bank cache never seeds → `bank_feed_empty=true` → reconciliation blocked.
- **Fix deployed (14 Mar 2026):**
  - Global Xero rate governor with priority lanes (P0 bank sync, P1 outstanding, P2 status checks)
  - Shared `xero_api_cooldown_until` key respected by all functions before any Xero call
  - `fetch-outstanding`: 0 retries on 429, 1 retry on 5xx only
  - `sync-xero-status`: stops all pagination on 429, checks shared cooldown before each batch
  - Frontend: 30s throttle + AbortController dedup on Outstanding refresh
  - Structured audit logging (`system_events.xero_api_call`) for every outbound Xero request
- **Secondary contributors (may need tuning):**
  - Frontend refresh/deduping patterns on other views
  - Retry policies on any new endpoints added later
  - Other Xero endpoints that may spike under load

### Unit tests
- **Missing:** No test files anywhere (`*.test.ts`, `*.spec.ts`). No Vitest config. No test script in `package.json` (it uses `tsc` only).
- **Impact:** Zero automated test coverage for parsers, engines, or components

### Settlement lines for non-Amazon marketplaces
- **Missing:** Shopify Orders, Bunnings, Woolworths, and Generic parsers do NOT save `settlement_lines`. Only Amazon parser saves per-transaction lines.
- **Impact:** Eye button drill-down shows "No transaction lines found" for all non-Amazon marketplaces

### Dashboard migration (4 of 5 dashboards)
- **Missing:** `AccountingDashboard.tsx`, `ShopifyPaymentsDashboard.tsx`, `BunningsDashboard.tsx`, `ShopifyOrdersDashboard.tsx` do NOT use shared hooks
- **Impact:** These dashboards are missing features that GenericMarketplaceDashboard has (rollback, refresh, inline recon, Xero-aware bulk delete, gap detection, mark-already-in-Xero, bank verification)

### The Iconic marketplace
- **Missing:** `MARKETPLACE_LABELS` has `theiconic: 'The Iconic'` but no registry entry, parser, or detection patterns exist
- **Status:** Label placeholder only

### Email notifications
- **Missing:** `RESEND_API_KEY` secret is configured but no edge function sends emails. No notification system exists.
- **Status:** Secret provisioned but unused

### eBay settlement parser
- **Missing:** eBay is in the marketplace registry for Shopify Orders detection, but has no dedicated settlement CSV parser
- **Status:** Only detectable via Shopify Orders; no direct eBay settlement import

### Scheduled auto-push trigger
- **Missing:** `auto-push-xero` edge function exists but no cron trigger is configured in `supabase/config.toml`
- **Impact:** Auto-push never runs automatically — must be invoked manually

### Error monitoring
- **Missing:** No Sentry, LogRocket, or similar error tracking
- **Status:** Errors caught by ErrorBoundary but not reported externally

### Profiles table
- **Missing:** No `profiles` table for storing user display names, avatars, or preferences beyond `app_settings`
- **Status:** User metadata stored only in `auth.users` (inaccessible via client)

---

## 11. PHASE B — FULFILMENT CHANNEL ENRICHMENT (18 March 2026)

### Summary
Added fulfilment channel tracking (FBA/FBM/MCF) across Amazon settlement ingestion, historical backfill via fee-pattern inference, and MCF cost support for Shopify orders fulfilled by Amazon.

### Changed Files

| # | File | Action | Description |
|---|------|--------|-------------|
| 1 | `supabase/functions/backfill-fulfilment-channel/index.ts` | **NEW** | Fee-pattern inference backfill edge function. Scans `settlement_lines` for FBA fee descriptions, classifies as `AFN_inferred` or `MFN_inferred`. Auth: `verify_jwt = true`. |
| 2 | `supabase/functions/fetch-amazon-settlements/index.ts` | Modified | Reads `fulfillment-channel` column from Amazon TSV. Maps `Amazon` → `AFN`, `Merchant` → `MFN`. Passes to all 3 `settlement_lines` insert sites. |
| 3 | `src/utils/settlement-parser.ts` | Modified | Same `fulfillment-channel` mapping for CSV-based Amazon uploads. Added `fulfilmentChannel` to `SettlementLine` interface. |
| 4 | `src/utils/fulfilment-settings.ts` | Modified | `getPostageDeductionForOrder()` now strips `_INFERRED` suffix before logic. Added `mcfCostPerOrder` parameter. MCF channel returns MCF cost instead of postage. Changed default for new Amazon connections to `mixed_fba_fbm`. |
| 5 | `supabase/functions/_shared/fulfilment-policy.ts` | Modified | Deno mirror of Fix 4 — identical `_INFERRED` stripping + MCF handling. |
| 6 | `src/utils/profit-engine.ts` | Modified | Loads `mcf_cost` from `app_settings`, passes as `mcfCostPerOrder` to canonical function. |
| 7 | `supabase/functions/recalculate-profit/index.ts` | Modified | Server-side mirror — loads MCF cost setting, passes to `getPostageDeductionForOrder()`. |
| 8 | `supabase/functions/auto-generate-shopify-settlements/index.ts` | Modified | Detects CedCommerce MCF indicators in Shopify `note_attributes` (e.g. `cedcommerce_channel`, `mcf_order`, `fulfillment_by_amazon`). Sets `fulfilment_channel = 'MCF'`. |
| 9 | `src/components/settings/DataQualityPanel.tsx` | Modified | Added "Classify Amazon fulfilment data" button. Calls `backfill-fulfilment-channel` edge function, shows summary toast. |
| 10 | `src/components/settings/FulfilmentMethodsPanel.tsx` | Modified | Added MCF cost input (default $8.00) under Amazon section when method is `mixed_fba_fbm`. Added one-time dismissible upgrade prompt for existing users on `marketplace_fulfilled`. |
| 11 | `src/components/admin/accounting/AccountingDashboard.tsx` | Modified | Passes `fulfilment_channel` at Amazon settlement_lines insert site. |
| 12 | `supabase/config.toml` | Modified | Registered `backfill-fulfilment-channel` with `verify_jwt = true`. |

### Key Logic Change
```typescript
// getPostageDeductionForOrder() — both client + Deno
const raw = (lineChannel || "").toUpperCase().trim();
const ch = raw.replace("_INFERRED", ""); // AFN_inferred → AFN
if (ch === "MCF") return (mcfCostPerOrder || 0) * orderCount;
// ... existing AFN/MFN/mixed logic unchanged
```

### Inference Backfill Logic
```
For each order_id where fulfilment_channel IS NULL and marketplace ILIKE '%amazon%':
  IF any row has amount_description IN ('FBAPerUnitFulfillmentFee', 'FBAWeightBasedFee', 'FBAPerOrderFulfillmentFee')
    → all rows for that order_id = 'AFN_inferred'
  ELSE
    → 'MFN_inferred'
  Special: refund-only orders default to 'AFN_inferred'
```

### Pre-Build Validation
| Metric | Count |
|--------|-------|
| Total Amazon AU settlement_lines rows | 14,664 |
| Distinct order_ids with FBA fee lines | 3,873 |
| Amazon orders without FBA fees (refund-only) | 3 |
| Non-Amazon orders (correctly excluded) | 955 |

### Security
- Backfill function uses `verify_jwt = true` — requires authenticated user
- All queries scoped to `user_id` from JWT
- `_inferred` values can be overwritten by confirmed parser values on re-import

### Not Changed
- Non-Amazon marketplace parsers (Woolworths, Kogan, Bunnings, eBay)
- Xero push / accounting / invoice logic
- RLS policies
- Database schema (no migrations required — `fulfilment_channel` column already existed)
