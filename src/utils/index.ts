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
export { checkXeroReadinessForMarketplace } from './xero-mapping-readiness';

// ─── Bookkeeper Readiness (pre-push safety checks, readiness scoring) ───
export { validateBookkeeperMinimumData } from './bookkeeper-readiness';

// ─── Settlement Parsing (Amazon TSV → structured 13-category settlement) ───
export { parseSettlementTSV, PARSER_VERSION } from './settlement-parser';

// ─── Settlement Engine (settlement CRUD, save/update, Xero sync orchestration) ───
export { saveSettlement } from './settlement-engine';

// ─── Settlement Components (component-level financial breakdown from raw settlement) ───
export { upsertSettlementComponents } from './settlement-components';

// ─── File Marketplace Detector (sniff CSV/PDF files to detect which marketplace they belong to) ───
export { detectFileMarketplace, MARKETPLACE_LABELS } from './file-marketplace-detector';

// ─── File Fingerprint Engine (CSV/XLSX header fingerprinting, column signature matching) ───
export { detectFromHeaders, extractFileHeaders } from './file-fingerprint-engine';

// ─── Fingerprint Library (known file format signatures, session-cached DB load) ───
export { loadFingerprints, detectFromFingerprints, saveFingerprint, invalidateFingerprintCache } from './fingerprint-library';

// ─── Fingerprint Lifecycle (create, confirm, retire fingerprint records) ───
export { createDraftFingerprint } from './fingerprint-lifecycle';

// ─── Reconciliation Engine (Amazon-specific recon checks, variance detection) ───
export { runReconciliation } from './reconciliation-engine';

// ─── Universal Reconciliation (marketplace-agnostic recon: settlement vs orders vs bank) ───
export { runUniversalReconciliation } from './universal-reconciliation';

// ─── Marketplace Reconciliation Engine (per-marketplace recon with tolerance) ───
export { calculateReconciliation, saveReconciliationResult, autoReconcileSettlement } from './marketplace-reconciliation-engine';

// ─── Xero Entries (read/build xero_entries JSON array on settlement rows) ───
export { readXeroEntries, hasXeroEntries, buildSingleEntry, buildSplitEntries, buildClearedEntries } from './xero-entries';

// ─── Xero Posting Line Items (detailed posting line items with GST, account codes) ───
export { buildPostingLineItems } from './xero-posting-line-items';

// ─── Xero CSV Export (export orders as Xero-compatible bill CSV) ───
export { downloadXeroCSV, ordersToXeroCSV, orderToXeroRows } from './xero-csv-export';

// ─── Parse Xero Date (normalise Xero's /Date()/ format to ISO string) ───
export { parseXeroDate } from './parse-xero-date';

// ─── Amazon Xero Push (Amazon invoice line-item builders, split-month rollover) ───
export { buildAmazonInvoiceLineItems, computeXeroInclusiveTotal, buildJournalPreviewRows, computeSplitMonthRollover } from './amazon-xero-push';

// ─── Generic CSV Parser (parse any CSV with header detection) ───
export { parseGenericCSV } from './generic-csv-parser';

// ─── Bunnings Summary Parser (Bunnings PDF/CSV statement → structured data) ───
export { parseBunningsSummaryPdf } from './bunnings-summary-parser';

// ─── Woolworths MarketPlus Parser (Woolworths CSV → structured settlement) ───
export { parseWoolworthsMarketPlusCSV } from './woolworths-marketplus-parser';

// ─── Shopify Payments Parser (Shopify payout CSV → structured settlement) ───
export { parseShopifyPayoutCSV } from './shopify-payments-parser';

// ─── Shopify Orders Parser (Shopify orders CSV → order-level data) ───
export { parseShopifyOrdersCSV } from './shopify-orders-parser';

// ─── Shopify Order Detector (detect marketplace from Shopify orders, 6-priority pipeline) ───
export { detectMarketplaceFromOrder, detectMarketplaceFromOrderAsync, detectAllMarketplaces } from './shopify-order-detector';

// ─── Shopify API Adapter (convert API orders to parsed rows, fetch+parse pipeline) ───
export { convertApiOrdersToRows, fetchAndParseShopifyOrders } from './shopify-api-adapter';

// ─── Date Parser (flexible AU/US/ISO date parsing for settlement files) ───
export { parseDate, parseDateOrEmpty, detectDateColumn } from './date-parser';

// ─── Entity Detection (detect marketplace entities from settlement line descriptions) ───
export type { DetectedEntity } from './entity-detection';

// ─── Fee Observation Engine (track and alert on marketplace fee rate changes) ───
export { extractFeeObservations, extractAmazonFeeObservations } from './fee-observation-engine';

// ─── Multi-Marketplace Splitter (split a multi-marketplace file into per-marketplace chunks) ───
export { detectMultiMarketplace, findSplitColumn, resolveMarketplaceName, checkCachedSplitPattern, saveSplitFingerprint } from './multi-marketplace-splitter';

// ─── Sub-Channel Detection (detect Shopify sub-channels from order source_name) ───
export type { DetectedSubChannel } from './sub-channel-detection';

// ─── Marketplace Registry (known marketplace definitions, codes, detection patterns) ───
export { MARKETPLACE_REGISTRY } from './marketplace-registry';

// ─── Marketplace Codes (canonical code normalisation, alias resolution) ───
export { normalizeMarketplaceCode, isMarketplaceAlias, MARKETPLACE_ALIASES } from './marketplace-codes';

// ─── Marketplace Connections (connection upsert/status helpers) ───
export { upsertMarketplaceConnection } from './marketplace-connections';

// ─── Marketplace Token Map (payment processor registry, non-marketplace gateways) ───
export { PAYMENT_PROCESSORS } from './marketplace-token-map';

// ─── Sync Capabilities (which marketplaces support API sync vs CSV-only) ───
export type { SyncCapabilities } from './sync-capabilities';

// ─── Profit Engine (calculate per-settlement / per-SKU gross profit) ───
export { calculateProfit } from './profit-engine';

// ─── Input Sanitization (XSS prevention, text/email/phone sanitizers) ───
export { sanitizeText, sanitizeEmail } from './input-sanitization';

// ─── Logger (structured logging utility) ───
export { logger } from './logger';
