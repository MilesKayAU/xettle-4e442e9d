/**
 * ══════════════════════════════════════════════════════════════
 * UTILITY CAPABILITY INDEX
 * ══════════════════════════════════════════════════════════════
 * Before writing ANY new utility logic in a component or new file,
 * search this index first. If a capability exists here, USE IT.
 * ══════════════════════════════════════════════════════════════
 */

// ─── COA Intelligence (COA scanning, account mapping suggestions, marketplace detection from chart of accounts) ───
export { analyseCoA, XETTLE_COA_RULES } from './coa-intelligence';

// ─── Xero Mapping Readiness (validates account mappings are complete before push) ───
export { checkXeroMappingReadiness } from './xero-mapping-readiness';

// ─── Bookkeeper Readiness (pre-push safety checks, readiness scoring) ───
export { assessBookkeeperReadiness } from './bookkeeper-readiness';

// ─── Settlement Parsing (Amazon TSV → structured 13-category settlement) ───
export { parseSettlementTSV, PARSER_VERSION } from './settlement-parser';

// ─── Settlement Engine (settlement CRUD, save/update, Xero sync orchestration) ───
export { saveSettlement, getSettlementNet } from './settlement-engine';

// ─── Settlement Components (component-level financial breakdown from raw settlement) ───
export { buildSettlementComponents } from './settlement-components';

// ─── File Marketplace Detector (sniff CSV/PDF files to detect which marketplace they belong to) ───
export { detectFileMarketplace, MARKETPLACE_LABELS } from './file-marketplace-detector';

// ─── File Fingerprint Engine (CSV/XLSX header fingerprinting, column signature matching) ───
export { detectFromHeaders, extractFileHeaders } from './file-fingerprint-engine';

// ─── Fingerprint Library (known file format signatures for auto-detection) ───
export { FINGERPRINT_LIBRARY } from './fingerprint-library';

// ─── Fingerprint Lifecycle (create, confirm, retire fingerprint records) ───
export { createFingerprint, confirmFingerprint } from './fingerprint-lifecycle';

// ─── Reconciliation Engine (Amazon-specific recon checks, variance detection) ───
export { runReconciliation } from './reconciliation-engine';

// ─── Universal Reconciliation (marketplace-agnostic recon: settlement vs orders vs bank) ───
export { runUniversalReconciliation } from './universal-reconciliation';

// ─── Marketplace Reconciliation Engine (per-marketplace recon with tolerance) ───
export { reconcileMarketplace } from './marketplace-reconciliation-engine';

// ─── Xero Entries (line-item builders for Xero invoices/journals) ───
export { buildXeroEntries } from './xero-entries';

// ─── Xero Posting Line Items (detailed posting line items with GST, account codes) ───
export { buildXeroPostingLineItems } from './xero-posting-line-items';

// ─── Xero CSV Export (export settlement data as Xero-compatible CSV) ───
export { exportToXeroCsv } from './xero-csv-export';

// ─── Parse Xero Date (normalise Xero's /Date()/ format to JS Date) ───
export { parseXeroDate } from './parse-xero-date';

// ─── Amazon Xero Push (Amazon-specific push-to-Xero orchestration) ───
export { pushAmazonToXero } from './amazon-xero-push';

// ─── Generic CSV Parser (parse any CSV with header detection) ───
export { parseGenericCsv } from './generic-csv-parser';

// ─── Bunnings Summary Parser (Bunnings PDF/CSV statement → structured data) ───
export { parseBunningsSummary } from './bunnings-summary-parser';

// ─── Woolworths MarketPlus Parser (Woolworths CSV → structured settlement) ───
export { parseWoolworthsMarketPlus } from './woolworths-marketplus-parser';

// ─── Shopify Payments Parser (Shopify payout CSV → structured settlement) ───
export { parseShopifyPayments } from './shopify-payments-parser';

// ─── Shopify Orders Parser (Shopify orders CSV → order-level data) ───
export { parseShopifyOrders } from './shopify-orders-parser';

// ─── Shopify Order Detector (detect if a file is Shopify orders vs payments) ───
export { detectShopifyOrderFile } from './shopify-order-detector';

// ─── Shopify API Adapter (typed wrappers around Shopify REST API calls) ───
export { fetchShopifyPayouts } from './shopify-api-adapter';

// ─── Date Parser (flexible AU/US/ISO date parsing for settlement files) ───
export { parseFlexibleDate } from './date-parser';

// ─── Entity Detection (detect marketplace entities from settlement line descriptions) ───
export { detectEntity } from './entity-detection';

// ─── Fee Observation Engine (track and alert on marketplace fee rate changes) ───
export { observeFees } from './fee-observation-engine';

// ─── Multi-Marketplace Splitter (split a multi-marketplace file into per-marketplace chunks) ───
export { splitByMarketplace } from './multi-marketplace-splitter';

// ─── Sub-Channel Detection (detect Shopify sub-channels from order source_name) ───
export { detectSubChannel } from './sub-channel-detection';

// ─── Marketplace Registry (known marketplace definitions, codes, detection patterns) ───
export { MARKETPLACE_REGISTRY } from './marketplace-registry';

// ─── Marketplace Codes (canonical marketplace code constants) ───
export { MARKETPLACE_CODES } from './marketplace-codes';

// ─── Marketplace Connections (connection status helpers) ───
export { getMarketplaceConnections } from './marketplace-connections';

// ─── Marketplace Token Map (map marketplace codes → token table names) ───
export { MARKETPLACE_TOKEN_MAP } from './marketplace-token-map';

// ─── Sync Capabilities (which marketplaces support API sync vs CSV-only) ───
export { SYNC_CAPABILITIES } from './sync-capabilities';

// ─── Profit Engine (calculate per-settlement / per-SKU gross profit) ───
export { calculateProfit } from './profit-engine';

// ─── Input Sanitization (XSS prevention, HTML stripping) ───
export { sanitizeInput } from './input-sanitization';

// ─── Logger (structured logging utility) ───
export { logger } from './logger';
