/**
 * Mirakl API Policy & Rules Reference
 * ═══════════════════════════════════════
 * Single source of truth for all Mirakl API constants, endpoints, auth patterns,
 * transaction types, and rate limits used by Xettle edge functions.
 *
 * Every Mirakl-related edge function MUST import from this file instead of
 * hardcoding endpoints, transaction types, or auth URLs.
 *
 * Sources:
 *   - https://developer.mirakl.com/content/product/connect (Connect overview)
 *   - https://developer.mirakl.com/content/product/connect-channel-platform/developer-guide/authentication
 *     (OAuth2 client_credentials via https://auth.mirakl.net/oauth/token)
 *   - https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/invoicing-and-accounting/tl05
 *     (TL05 — transaction logs response schema & official `type` enum)
 *   - https://help.mirakl.net/bundle/connect_sellers/page/topics/Connect/integrating/api_integration_guide.htm
 *     (Seller integration guide for generating OAuth2 credentials)
 *
 * Auth model (TWO separate systems, THREE header variants):
 *   1. Marketplace APIs (TL endpoints: /api/sellerpayment/transactions_logs)
 *      → Direct API key in Authorization header: `Authorization: YOUR_API_KEY`
 *      → API key is generated per-app in Mirakl Connect → Settings → API integrations
 *
 *   2. Connect APIs (channel management, catalog, orders)
 *      → OAuth2 client_credentials via centralized endpoint: https://auth.mirakl.net/oauth/token
 *      → Returns Bearer token valid for ~3599 seconds
 *      → Header: `Authorization: Bearer <access_token>`
 *
 *   Header variants (varies by marketplace — stored as auth_header_type):
 *     - 'bearer'        → Authorization: Bearer <token>   (default for OAuth)
 *     - 'authorization'  → Authorization: <api_key>       (default for API key mode)
 *     - 'x-api-key'      → X-API-KEY: <api_key>           (some legacy Mirakl instances)
 *   When auth_header_type is NULL, the helper infers from auth_mode.
 */

// ═══════════════════════════════════════════════════════════════
// 1. Auth Endpoints
// ═══════════════════════════════════════════════════════════════

/** Centralized OAuth2 token endpoint for Mirakl Connect APIs */
export const MIRAKL_AUTH_URL = "https://auth.mirakl.net/oauth/token";

/** OAuth2 grant type — always client_credentials */
export const MIRAKL_GRANT_TYPE = "client_credentials";

// ═══════════════════════════════════════════════════════════════
// 2. Marketplace API Endpoints (per-instance, base_url varies)
//    Replace {base_url} with the seller's Mirakl instance URL
//    e.g. https://marketplace.bunnings.com.au
// ═══════════════════════════════════════════════════════════════

export const MIRAKL_MARKETPLACE_ENDPOINTS = {
  /** TL02 — List transaction lines (synchronous, paginated) */
  TRANSACTION_LOGS: "/api/sellerpayment/transactions_logs",

  /** TL03 — Export transaction lines asynchronously */
  TRANSACTION_LOGS_ASYNC: "/api/sellerpayment/transactions_logs/async",

  /** TL04 — Poll async export status */
  TRANSACTION_LOGS_ASYNC_STATUS: "/api/sellerpayment/transactions_logs/async/status/{tracking_id}",

  /** TL05 — Retrieve async export file chunks */
  TRANSACTION_LOGS_ASYNC_FILE: "/dynamic-url/from-TL04/TL05",

  /** Invoices listing */
  INVOICES: "/api/invoices",

  /** Accounting document requests */
  DOCUMENT_REQUESTS: "/api/document-request",
  DOCUMENT_REQUEST_LINES: "/api/document-request/{document_request_id}/lines",
} as const;

// ═══════════════════════════════════════════════════════════════
// 3. Transaction Type Enum (Official — from TL05 docs)
//    https://developer.mirakl.com/content/product/mmp/rest/seller/openapi3/invoicing-and-accounting/tl05
// ═══════════════════════════════════════════════════════════════

/**
 * Complete official Mirakl transaction type enum.
 * Used in the `type` field of transaction log entries.
 */
export const MIRAKL_TRANSACTION_TYPES = [
  // Sales
  "ORDER_AMOUNT",
  "ORDER_AMOUNT_TAX",
  "ORDER_SHIPPING_AMOUNT",
  "ORDER_SHIPPING_AMOUNT_TAX",

  // Commission / Fees
  "COMMISSION_FEE",
  "COMMISSION_VAT",

  // Refunds
  "REFUND_ORDER_AMOUNT",
  "REFUND_ORDER_AMOUNT_TAX",
  "REFUND_ORDER_SHIPPING_AMOUNT",
  "REFUND_ORDER_SHIPPING_AMOUNT_TAX",
  "REFUND_COMMISSION_FEE",
  "REFUND_COMMISSION_VAT",

  // Manual adjustments
  "MANUAL_CREDIT",
  "MANUAL_CREDIT_VAT",
  "MANUAL_INVOICE",
  "MANUAL_INVOICE_VAT",

  // Subscription
  "SUBSCRIPTION_FEE",
  "SUBSCRIPTION_VAT",

  // Operator-remitted taxes (marketplace-collected)
  "OPERATOR_REMITTED_ORDER_AMOUNT_TAX",
  "OPERATOR_REMITTED_ORDER_SHIPPING_AMOUNT_TAX",
  "OPERATOR_REMITTED_REFUND_ORDER_AMOUNT_TAX",
  "OPERATOR_REMITTED_REFUND_ORDER_SHIPPING_AMOUNT_TAX",

  // Operator-paid shipping
  "OPERATOR_PAID_ORDER_SHIPPING_AMOUNT",
  "OPERATOR_PAID_ORDER_SHIPPING_AMOUNT_TAX",
  "OPERATOR_PAID_REFUND_ORDER_SHIPPING_AMOUNT",
  "OPERATOR_PAID_REFUND_ORDER_SHIPPING_AMOUNT_TAX",

  // Payment
  "PAYMENT",

  // Purchase commissions
  "PURCHASE_COMMISSION_FEE",
  "PURCHASE_SHIPPING_COMMISSION_FEE",
  "PURCHASE_ORDER_AMOUNT_TAX",
  "PURCHASE_ORDER_SHIPPING_AMOUNT_TAX",
  "REFUND_PURCHASE_COMMISSION_FEE",
  "REFUND_PURCHASE_SHIPPING_COMMISSION_FEE",
  "REFUND_PURCHASE_ORDER_AMOUNT_TAX",
  "REFUND_PURCHASE_ORDER_SHIPPING_AMOUNT_TAX",

  // Order fees
  "ORDER_FEE_AMOUNT",
  "OPERATOR_REMITTED_ORDER_FEE_AMOUNT",
  "REFUND_ORDER_FEE_AMOUNT",
  "OPERATOR_REMITTED_REFUND_ORDER_FEE_AMOUNT",

  // Purchase fee commissions
  "PURCHASE_FEE_COMMISSION_FEE",
  "REFUND_PURCHASE_FEE_COMMISSION_FEE",

  // Reserve
  "RESERVE_FUNDING",
  "RESERVE_SETTLEMENT",

  // Seller fees & penalties
  "SELLER_FEE_ON_ORDER",
  "SELLER_FEE_ON_ORDER_TAX",
  "SELLER_PENALTY_FEE",
  "SELLER_PENALTY_FEE_TAX",
] as const;

export type MiraklTransactionType = typeof MIRAKL_TRANSACTION_TYPES[number];

// ═══════════════════════════════════════════════════════════════
// 4. Transaction Log Response Fields (TL05 schema)
// ═══════════════════════════════════════════════════════════════

/**
 * Key fields returned in each transaction log entry.
 * Reference: TL05 response 200 schema.
 */
export const MIRAKL_TL_RESPONSE_FIELDS = {
  /** Unique transaction identifier */
  id: "string",
  /** Transaction type — see MIRAKL_TRANSACTION_TYPES */
  type: "string (enum)",
  /** The amount (signed: positive = credit, negative = debit) */
  amount: "number",
  /** Amount credited */
  amount_credited: "number",
  /** Amount debited */
  amount_debited: "number",
  /** Running balance */
  balance: "number",
  /** ISO currency code */
  currency_iso_code: "string",
  /** Creation date of the transaction line */
  date_created: "string (ISO datetime)",
  /** Last update date */
  last_updated: "string (ISO datetime)",
  /** Billing cycle accounting document creation date */
  accounting_document_creation_date: "string",
  /** Billing cycle accounting document number */
  accounting_document_number: "string",
  /** Pay-out PSP code: NOT_SPECIFIED | MANGOPAY | MIRAKL_PAYOUT | OPERATOR */
  pay_out_psp_code: "string (enum)",
  /** Payment state: PENDING | PAYABLE | PAID | NOT_APPLICABLE | RESERVE */
  payment_state: "string (enum)",
  /** Pay-out balance */
  psp_balance: "number",
} as const;

// ═══════════════════════════════════════════════════════════════
// 5. Rate Limits & Best Practices
// ═══════════════════════════════════════════════════════════════

export const MIRAKL_RATE_LIMITS = {
  /** Mirakl does not publish hard rate limits, but best practice is max 1 req/sec */
  recommendedDelayMs: 1000,
  /** Token TTL in seconds (from docs: expires_in = 3599) */
  tokenTtlSeconds: 3599,
  /** Buffer before token expiry to trigger refresh (5 minutes) */
  tokenRefreshBufferMs: 5 * 60 * 1000,
};

// ═══════════════════════════════════════════════════════════════
// 6. Known Mirakl-Powered Marketplaces (Australian)
// ═══════════════════════════════════════════════════════════════

export const MIRAKL_POWERED_MARKETPLACES = [
  { code: "bunnings", name: "Bunnings Marketplace", baseUrl: "https://marketplace.bunnings.com.au", country: "AU" },
  { code: "catch", name: "Catch Marketplace", baseUrl: "https://marketplace.catch.com.au", country: "AU" },
  { code: "mydeal", name: "MyDeal", baseUrl: "https://marketplace.mydeal.com.au", country: "AU" },
  { code: "kogan", name: "Kogan Marketplace", baseUrl: "https://marketplace.kogan.com", country: "AU" },
] as const;

// ═══════════════════════════════════════════════════════════════
// 7. Deprecations & Warnings
// ═══════════════════════════════════════════════════════════════

export const MIRAKL_DEPRECATIONS: Array<{ feature: string; status: string; note: string }> = [
  // No known deprecations as of March 2026
];

export const MIRAKL_API_VERSION = "v1"; // Mirakl does not version their marketplace REST API
