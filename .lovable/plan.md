

# Full Codebase Audit — Xettle

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 1. DATABASE TABLES

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**settlements**
Columns: id (uuid PK), user_id, settlement_id, marketplace, period_start (date), period_end (date), sales_principal, sales_shipping, seller_fees, promotional_discounts, fba_fees, storage_fees, refunds, reimbursements, other_fees, gst_on_income, gst_on_expenses, net_ex_gst, bank_deposit, deposit_date, status, reconciliation_status, source (default 'manual'), xero_journal_id, xero_journal_id_1, xero_journal_id_2, xero_invoice_number (text), xero_status (text), is_split_month, split_month_1_data (jsonb), split_month_2_data (jsonb), bank_verified, bank_verified_amount, bank_verified_at, bank_verified_by, parser_version, created_at, updated_at.
RLS: Users CRUD own rows (auth.uid() = user_id).

**settlement_lines**
Columns: id, user_id, settlement_id, transaction_type, amount_type, amount_description, accounting_category, amount, order_id, sku, posted_date, marketplace_name.
RLS: Users SELECT/INSERT/DELETE own rows. No UPDATE.

**settlement_unmapped**
Columns: id, user_id, settlement_id, transaction_type, amount_type, amount_description, amount, raw_row (jsonb).
RLS: Users SELECT/INSERT/DELETE own rows. No UPDATE.

**marketplace_connections**
Columns: id, user_id, marketplace_code, marketplace_name, connection_status, connection_type, country_code, settings (jsonb), created_at, updated_at.
RLS: Users full CRUD own rows.

**marketplaces** (global reference table)
Columns: id, marketplace_code, name, currency, settlement_frequency, settlement_type, gst_model, payment_delay_days, is_active, created_at, updated_at.
RLS: Authenticated SELECT all. Admin-only INSERT/UPDATE/DELETE via `has_role('admin')`.

**xero_tokens**
Columns: id, user_id, tenant_id, tenant_name, access_token, refresh_token, expires_at, token_type, scope, created_at, updated_at.
RLS: Users full CRUD own rows.

**amazon_tokens**
Columns: id, user_id, selling_partner_id, marketplace_id, region, access_token, refresh_token, expires_at, created_at, updated_at.
RLS: Users full CRUD own rows.

**app_settings**
Columns: id, user_id, key, value, created_at, updated_at.
RLS: Users SELECT/INSERT/UPDATE own rows. No DELETE.

**user_roles**
Columns: id, user_id, role (app_role enum: admin, moderator, user), created_at.
RLS: Users SELECT own roles only. No INSERT/UPDATE/DELETE.

**sync_history**
Columns: id, user_id, event_type, status, error_message, settlements_affected, details (jsonb), created_at.
RLS: Users SELECT/INSERT own rows. No UPDATE/DELETE.

**product_costs**
Columns: id, user_id, sku, cost, currency, label, created_at, updated_at.
RLS: Users full CRUD own rows.

**marketplace_fee_observations**
Columns: id, user_id, marketplace_code, settlement_id, fee_type (enum), fee_category, observed_rate, observed_amount, base_amount, observation_method (enum), period_start, period_end, currency, created_at.
RLS: Users SELECT/INSERT/DELETE own. No UPDATE.

**marketplace_fee_alerts**
Columns: id, user_id, marketplace_code, settlement_id, fee_type (enum), expected_rate, observed_rate, deviation_pct, status, created_at.
RLS: Users SELECT/UPDATE own. Admins SELECT all. No DELETE.

**marketplace_fingerprints** (self-learning detection patterns)
Columns: id, user_id (nullable), marketplace_code, field, pattern, confidence, match_count, source, created_at.
RLS: Authenticated SELECT global + own. INSERT/UPDATE own. No DELETE.

**marketplace_file_fingerprints** (per-user file column signatures)
Columns: id, user_id, marketplace_code, column_signature (jsonb), column_mapping (jsonb), file_pattern, created_at.
RLS: ALL own rows.

**marketplace_ad_spend**
Columns: id, user_id, marketplace_code, period_start, period_end, spend_amount, source, notes, currency, created_at, updated_at.
RLS: Users full CRUD own rows.

**marketplace_shipping_costs**
Columns: id, user_id, marketplace_code, cost_per_order, currency, notes, created_at, updated_at.
RLS: Users full CRUD own rows.

**DB Functions:**
- `has_role(_role app_role)` — SECURITY DEFINER, checks user_roles for auth.uid()
- `update_updated_at_column()` — trigger function for auto-updating updated_at

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 2. EDGE FUNCTIONS

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

| Function | Purpose | Key calls |
|----------|---------|-----------|
| `xero-auth` | OAuth2 flow for Xero (exchange code for tokens, store in xero_tokens) | Xero identity API |
| `sync-settlement-to-xero` | Push settlement as Xero invoice (create) or void invoice (rollback). Accepts line items, reference, contact, description. | Xero Invoices API |
| `sync-xero-status` | Sync-back: dual-query Xero for invoices with `Xettle-` prefix (new) and `Settlement` keyword (legacy). Updates local settlement records with invoice number + status. | Xero Invoices API, settlements table |
| `auto-push-xero` | Auto-push settlements to Xero (for paid-tier automation) | sync-settlement-to-xero pattern |
| `amazon-auth` | Amazon SP-API OAuth flow | Amazon LWA token endpoint |
| `fetch-amazon-settlements` | Fetch settlement reports from Amazon SP-API | Amazon SP-API Reports endpoint |
| `sync-amazon-journal` | Sync Amazon settlement data as Xero journal entries | Xero API |
| `ai-file-interpreter` | AI-powered file detection and column mapping. Two modes: `detect_marketplace` and `map_columns`. Uses Lovable AI (gemini). | Lovable AI proxy |
| `admin-list-users` | List all users for admin dashboard | Supabase Admin API (auth.admin.listUsers) |
| `admin-manage-users` | Manage users (reset password, delete, toggle roles) | Supabase Admin API |

**Config registration (supabase/config.toml):**
- `ai-file-interpreter`: verify_jwt = false
- `sync-xero-status`: verify_jwt = false

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 3. PARSERS / UTILITIES

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

| File | Purpose | Key exports |
|------|---------|-------------|
| `settlement-parser.ts` (715 lines) | Amazon TSV parser. 5 parser rules. Split-month detection. LVGT international order detection. Category mapping → Xero accounts. | `parseSettlementTSV()`, `PARSER_VERSION`, `XERO_ACCOUNT_MAP`, `ParsedSettlement`, `SplitMonthInfo` |
| `settlement-engine.ts` (421 lines) | Shared types + helpers for all marketplaces. Save to DB, push to Xero, rollback, sync-back, formatting. | `StandardSettlement`, `saveSettlement()`, `syncSettlementToXero()`, `rollbackSettlementFromXero()`, `syncXeroStatus()`, `deleteSettlement()`, `buildSimpleInvoiceLines()`, `buildInvoiceReference()`, `buildInvoiceDescription()`, `formatAUD()` |
| `bunnings-summary-parser.ts` (316 lines) | Bunnings Mirakl PDF parser. Extracts line items from summary table using regex patterns (payable orders, commission, refunds, shipping, subscription, manual credits/debits). | `parseBunningsSummaryPdf()`, `BunningsParseResult` |
| `woolworths-marketplus-parser.ts` (481 lines) | Woolworths MarketPlus CSV parser. Splits by Order Source (BigW, EverydayMarket, MyDeal). Builds $0 clearing invoices. | `parseWoolworthsMarketPlusCSV()`, `buildWoolworthsInvoiceLines()`, `isWoolworthsMarketPlusCSV()` |
| `shopify-orders-parser.ts` (679 lines) | Shopify Orders CSV parser. Registry-based marketplace detection (Note Attributes → Tags → Payment Method). Deduplicates line-item rows. Multi-line CSV handling. Per-marketplace clearing invoices. | `parseShopifyOrdersCSV()`, `normaliseSku()`, `ShopifyOrdersResult`, `MarketplaceGroup` |
| `shopify-payments-parser.ts` (648 lines) | Shopify Payments CSV parser. Auto-detects payout-level vs transaction-level format. Groups by Payout ID. | `parseShopifyPayoutCSV()`, `ShopifyParseResult`, `ShopifyPayoutGroup` |
| `generic-csv-parser.ts` (343 lines) | Mapping-driven CSV/XLSX parser. Converts any file into StandardSettlement[] using ColumnMapping. Handles grouping, GST models. | `parseGenericCSV()`, `GenericParseOptions` |
| `file-fingerprint-engine.ts` (556 lines) | 3-level detection: L1 instant fingerprint, L2 heuristic column mapping, L3 AI fallback. Confidence scoring. | `detectFileType()`, `FileDetectionResult`, `ColumnMapping` |
| `fingerprint-library.ts` (166 lines) | Level 2 detection — learned patterns from `marketplace_fingerprints` table. In-memory cache. Save new patterns. | `lookupFingerprint()`, `saveFingerprint()`, `FingerprintMatch` |
| `file-marketplace-detector.ts` (89 lines) | Simple filename + content-based marketplace detection. Legacy detector. | `detectFileMarketplace()` |
| `marketplace-registry.ts` (319 lines) | Central registry for all marketplaces. Detection patterns (Note Attributes, Tags, Payment Method). Xero account codes. | `MARKETPLACE_REGISTRY`, `detectMarketplaceFromRow()`, `getRegistryEntry()` |
| `fee-observation-engine.ts` (281 lines) | Extracts fee observations from settlements. Detects anomalies. Fire-and-forget after save. | `extractFeeObservations()`, `extractAmazonFeeObservations()` |
| `reconciliation-engine.ts` (189 lines) | Amazon-specific reconciliation checks (fee rate, return ratio, unmapped rows, split-month). | `runReconciliation()`, `ReconciliationResult` |
| `universal-reconciliation.ts` (209 lines) | All-marketplace reconciliation (net payout check, GST ratio, fee rate). | `runUniversalReconciliation()`, `UniversalReconciliationResult` |
| `profit-engine.ts` (135 lines) | COGS + profit calculator per marketplace from SKU costs. | `calculateMarketplaceProfit()`, `MarketplaceProfitSummary` |
| `xero-csv-export.ts` (620 lines) | Generates Xero Bill Import CSV format. Amazon-specific with multi-currency Bunnings order export. | `generateXeroBillCSV()`, `XeroBillRow` |
| `input-sanitization.ts` (50 lines) | Basic text/email/URL sanitization. | `sanitizeText()`, `sanitizeEmail()`, `sanitizeUrl()` |

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 4. COMPONENTS (src/components/admin/accounting/)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

| Component | Purpose |
|-----------|---------|
| `AccountingDashboard.tsx` | Amazon AU-specific dashboard. Full settlement lifecycle: upload TSV, parse, view summary, split-month handling, push to Xero (multi-line invoices), rollback, bank verification, auto-import tab. |
| `GenericMarketplaceDashboard.tsx` (837 lines) | Universal marketplace dashboard. Settlement list with rich status badges (Ready to push / In Xero / Push failed), push/retry/rollback buttons, bank verification, bulk delete, Xero sync-back ("Refresh from Xero"), duplicate prevention, drill-down. |
| `MonthlyReconciliationStatus.tsx` (290 lines) | Monthly period selector with overlap-filtered settlement query. Missing marketplace detection (compares marketplace_connections vs settlements). Push All Ready button with progress. |
| `MarketplaceSwitcher.tsx` | Tab bar for switching between connected marketplaces. MARKETPLACE_CATALOG definition. Add marketplace flow. |
| `SmartUploadFlow.tsx` | 3-level intelligent file upload: fingerprint match → heuristic → AI fallback. Routes to correct parser. Confidence gates. |
| `InsightsDashboard.tsx` | Analytics: fee trend charts, anomaly alerts, marketplace comparison. |
| `BunningsDashboard.tsx` | Bunnings-specific PDF upload + parse + review flow. |
| `ShopifyOrdersDashboard.tsx` | Shopify Orders CSV upload. Shows marketplace groups, skipped/unknown groups, per-group push-to-Xero. |
| `ShopifyPaymentsDashboard.tsx` | Shopify Payments CSV upload. Shows payout groups, per-payout push-to-Xero. |
| `AmazonConnectionPanel.tsx` | Amazon SP-API connection management. OAuth flow, auto-fetch settlements, sync status. |
| `AutoImportedTab.tsx` | Shows auto-imported Amazon settlements (source = 'api'). |
| `AutomationSettingsPanel.tsx` | Settings for auto-push-to-Xero (paid tier). |
| `OnboardingChecklist.tsx` | Step-by-step onboarding guide. |
| `SellerCentralGuide.tsx` | Guide for downloading Amazon Seller Central statements. |
| `ShopifyOnboarding.tsx` | Guide for exporting Shopify CSV files. |
| `SkuCostManager.tsx` | CRUD for product_costs table (SKU → cost mapping for profit engine). |
| `SyncComponents.tsx` | Xero sync UI components (push button, status, progress). |
| `UpgradePlanComponents.tsx` | Upgrade nudge UI for paid-tier features. |
| `MarketplaceReturnRatio.tsx` | Return ratio analytics per marketplace. |

**Other key components:**
- `src/components/admin/LoginForm.tsx` — Email/password login form with honeypot
- `src/components/admin/XeroConnectionStatus.tsx` — Xero connection badge + OAuth trigger
- `src/components/admin/marketplace/MarketplaceConfigTab.tsx` — Admin marketplace configuration
- `src/components/PinGate.tsx` — Site-wide PIN gate (hardcoded: `1941`, sessionStorage)
- `src/components/PublicDemoUpload.tsx` — Public landing page demo upload
- `src/components/MarketplaceAlertsBanner.tsx` — Fee alert banners
- `src/components/MarketplaceInfoPanel.tsx` — Marketplace info display
- `src/components/ErrorBoundary.tsx` — React error boundary

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 5. PAGES

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

| Page | Route | Purpose |
|------|-------|---------|
| `Landing.tsx` | `/` | Marketing landing page. Feature list, marketplace logos, demo upload, CTA to sign up. |
| `Dashboard.tsx` | `/dashboard` | Main app. Protected (redirects to /auth). Three views: settlements, insights, smart_upload. Mounts MonthlyReconciliationStatus, MarketplaceSwitcher, AccountingDashboard (Amazon), GenericMarketplaceDashboard (others), ShopifyOrdersDashboard. |
| `Admin.tsx` | `/admin` | Admin panel. User management (list, delete, reset password, toggle roles). Marketplace config. Protected (requires admin role). |
| `Auth.tsx` | `/auth` | Login/signup page. |
| `Pricing.tsx` | `/pricing` | 3-tier pricing page: Free ($0), Starter ($14.99/mo or $129/yr), Pro ($24.99/mo or $249/yr). UI only — no Stripe integration. |
| `XeroCallback.tsx` | `/xero/callback` | OAuth callback handler for Xero. |
| `AmazonCallback.tsx` | `/amazon/callback` | OAuth callback handler for Amazon SP-API. |
| `ResetPassword.tsx` | `/reset-password` | Password reset page. |
| `Privacy.tsx` | `/privacy` | Privacy policy. |
| `Terms.tsx` | `/terms` | Terms of service. |
| `NotFound.tsx` | `*` | 404 page. |

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 6. MARKETPLACE REGISTRY

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

File: `src/utils/marketplace-registry.ts`

| Key | Display Name | Detection Patterns | Xero Accounts (Sales/Shipping/Clearing/Fees) | Skip? |
|-----|-------------|-------------------|----------------------------------------------|-------|
| `mydeal` | MyDeal | Notes: MyDealOrderID, mydeal_order. Tags: mydeal. Payment: mydeal | 200/206/613/405 | No |
| `bunnings` | Bunnings Marketplace | Notes: Order placed from: Bunnings, mirakl. Tags: bunnings, mirakl. Payment: mirakl, bunnings | 200/206/613/405 | No |
| `kogan` | Kogan | Notes: KoganOrderID, Tenant_id: Kogan. Tags: kogan, cedcommerce. Payment: commercium, constacloud | 200/206/613/405 | No |
| `bigw` | Big W Marketplace | Notes: Order placed from: Big W. Tags: big w, bigw | 200/206/613/405 | No |
| `everyday_market` | Everyday Market | Notes: Everyday Market, woolworths. Tags: everyday market, woolworths | 200/206/613/405 | No |
| `catch` | Catch | Notes: Order placed from: Catch, CatchOrderID. Tags: catch | 200/206/613/405 | No |
| `ebay` | eBay | Notes: eBayOrderID. Tags: ebay. Payment: ebay | 200/206/613/405 | No |
| `paypal` | PayPal | Payment: paypal express checkout, paypal | 201/206/613/405 | No |
| `afterpay` | Afterpay | Payment: afterpay, afterpay_v2 | 201/206/613/405 | No |
| `stripe` | Stripe | Payment: stripe | 201/206/613/405 | No |
| `manual_order` | Manual Orders | Payment: manual | 201/206/613/405 | No |
| `shopify_payments` | Shopify Payments | Payment: shopify_payments, shopify | 201/206/613/405 | **Yes** (handled by payout CSV) |

Detection priority: Note Attributes → Tags → Payment Method.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 7. STRIPE / BILLING

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**No Stripe integration exists.** No Stripe keys configured. No billing API calls.

The Pricing page (`/pricing`) defines 3 tiers as UI-only:
- **Free** ($0): Manual upload, full parsing, manual Xero push
- **Starter** ($14.99/mo or $129/yr): Amazon SP-API, auto-fetch
- **Pro** ($24.99/mo or $249/yr): Auto-push to Xero, priority support

Role gating exists (`paid` role in user_roles) for Amazon auto-fetch. The `UpgradePlanComponents.tsx` shows upgrade nudges. But **no checkout, no payment processing, no subscription management** is implemented.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 8. AUTHENTICATION

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

- **Auth provider:** Supabase Auth (email/password)
- **Auth hook:** `useAdminAuth()` — `onAuthStateChange`, `signIn`, `handleSignOut`
- **Protected routes:** `/dashboard` redirects to `/auth` if not authenticated
- **Admin check:** `Dashboard.tsx` calls `supabase.rpc('has_role', { _role: 'admin' })` — shows Admin link if true
- **Admin page:** `/admin` — checks admin role, shows user management
- **Paid role:** `paid` role gates Amazon SP-API auto-fetch
- **PinGate:** Site-wide PIN gate (hardcoded `1941`) using sessionStorage. Wraps entire app in `App.tsx`.
- **Email verification:** Not explicitly disabled (default requires verification)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 9. KNOWN GAPS / TODOs

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**TODO comments:**
- `AccountingDashboard.tsx` line 1397: `// TODO: Implement sync-to-Xero from auto-imported` — clicking sync on auto-imported Amazon settlements shows "coming soon" toast

**Hardcoded values:**
- `PinGate.tsx` line 7: `const SITE_PIN = '1941'` — hardcoded PIN for site access

**console.log statements that should be cleaned up:**
- `settlement-parser.ts`: 8+ `console.log`/`console.info` debug statements (parser diagnostics)
- `xero-csv-export.ts`: 2 `console.log` statements (adjustment ratio logging)
- `AmazonConnectionPanel.tsx`: 1 `console.log` (sync details)
- `LoginForm.tsx`: 1 `console.log` (spam detection — acceptable)

**"INV-XXXX" placeholder text:**
- `Landing.tsx` line 115 and `PublicDemoUpload.tsx` line 445 — cosmetic mock data for landing page previews (intentional)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

## 10. WHAT IS NOT YET BUILT

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. **Stripe payment processing** — Pricing page exists with 3 tiers but no checkout, subscription management, or webhook handling. The `paid` role is manually assigned.

2. **Auto-push to Xero from auto-imported Amazon settlements** — TODO in code. Auto-fetch works but auto-push shows "coming soon".

3. **Email digest / notifications** — `RESEND_API_KEY` secret is configured but no email-sending edge function exists. No settlement reminder emails, no weekly digest.

4. **Kogan, Catch, MyDeal, eBay dedicated parsers** — These marketplaces exist in the registry for Shopify Orders detection, and the generic CSV parser can handle them, but no marketplace-specific settlement file parsers exist. They rely on the generic parser or manual upload.

5. **Scheduled/cron functions** — No scheduled edge functions for periodic Amazon settlement fetching or Xero sync-back. These are triggered manually or on-mount.

6. **Storage buckets** — No file storage configured. Settlement files are parsed in-memory and not persisted.

7. **Multi-currency support** — Parser infrastructure supports currency fields but Xero push assumes AUD throughout.

8. **User profile / settings page** — No dedicated user profile page. Settings are stored in `app_settings` but no UI for managing them beyond automation toggles.

9. **Webhook receivers** — No inbound webhooks for Xero, Shopify, or Amazon event notifications.

10. **Mobile-responsive testing** — Components use Tailwind responsive classes but no dedicated mobile optimization has been verified.

