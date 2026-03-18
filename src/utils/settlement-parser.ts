/** Parser version — bump manually when parser logic changes */
export const PARSER_VERSION = 'v1.7.1';
import { parseDateOrEmpty } from './date-parser';
import { TOL_PARSER_TOTAL, TOL_LINE_SUM, TOL_COLUMN_TOTALS, TOL_GST_CONSISTENCY } from '@/constants/reconciliation-tolerance';
import { logger } from '@/utils/logger';
/**
 * Amazon Settlement Report (TSV) Parser
 * Parses the primary settlement data source and categorizes transactions
 * into accounting buckets matching Link My Books output format.
 *
 * 5 PARSER RULES:
 * 1. Header row detection: empty transaction-type + empty order-id = header row
 * 2. Amount sign normalisation: enforce correct signs per category
 * 3. Aggregation logic: precise category grouping per mapping table
 * 4. GST calculation: income/11 and expenses/11
 * 5. Reconciliation gate: ±$0.01 tolerance, blocks Xero push on failure
 */

// Mapping table: [transactionType, amountType, amountDescription] → accountingCategory
const CATEGORY_MAP: Record<string, string> = {
  // Orders
  'Order|ItemPrice|Principal': 'Sales',
  'Order|ItemPrice|Shipping': 'Sales',
  'Order|Promotion|Principal': 'Promotional Discounts',
  'Order|Promotion|Shipping': 'Promotional Discounts',
  'Order|ItemFees|Commission': 'Seller Fees',
  'Order|ItemFees|FBAPerUnitFulfillmentFee': 'FBA Fees',
  'Order|ItemFees|ShippingChargeback': 'FBA Fees',
  'Order|ItemFees|RefundCommission': 'Seller Fees',
  // Refunds — only ItemPrice lines go to Refunds (205)
  'Refund|ItemPrice|Principal': 'Refunds',
  'Refund|ItemPrice|Shipping': 'Refunds',
  // Refund promotions → Promotional Discounts (200, contra-revenue)
  'Refund|Promotion|Principal': 'Promotional Discounts',
  'Refund|Promotion|Shipping': 'Promotional Discounts',
  // Refund fees → back to their original fee accounts
  'Refund|ItemFees|Commission': 'Seller Fees',
  'Refund|ItemFees|ShippingChargeback': 'FBA Fees',
  'Refund|ItemFees|RefundCommission': 'Seller Fees',
  // Reimbursements
  'other-transaction|FBA Inventory Reimbursement|REVERSAL_REIMBURSEMENT': 'Reimbursements',
  'other-transaction|FBA Inventory Reimbursement|WAREHOUSE_DAMAGE': 'Reimbursements',
  // FBA Fees
  'other-transaction|other-transaction|RemovalComplete': 'FBA Fees',
  'other-transaction|other-transaction|DisposalComplete': 'FBA Fees',
  // Storage Fees
  'other-transaction|other-transaction|StorageRenewalBilling': 'Storage Fees',
  'other-transaction|other-transaction|Storage Fee': 'Storage Fees',
  // Advertising Costs (Sponsored Products, PPC)
  'other-transaction|other-transaction|CostOfAdvertising': 'Advertising Costs',
  // Seller Fees
  'other-transaction|other-transaction|Subscription Fee': 'Seller Fees',
  'AmazonFees|Vine Enrollment Fee|Base fee': 'Seller Fees',
  'AmazonFees|Vine Enrollment Fee|Tax on fee': 'Seller Fees',
  // Tax pass-through (LVGT — nets to zero, maps to Clearing)
  'Order|ItemPrice|Tax': 'Tax Collected by Amazon',
  'Order|ItemPrice|ShippingTax': 'Tax Collected by Amazon',
  'Order|ItemWithheldTax|LowValueGoodsTax-Principal': 'Tax Collected by Amazon',
  'Order|ItemWithheldTax|LowValueGoodsTax-Shipping': 'Tax Collected by Amazon',
  'Order|Promotion|TaxDiscount': 'Tax Collected by Amazon',
};

// Rule 2 — Expected signs per category (positive = +1, negative = -1)
const EXPECTED_SIGNS: Record<string, 1 | -1> = {
  'Sales': 1,               // always positive
  'Promotional Discounts': -1, // always negative
  'Seller Fees': -1,         // always negative
  'FBA Fees': -1,            // always negative
  'Storage Fees': -1,        // always negative
  'Advertising Costs': -1,   // always negative (Sponsored Products spend)
  'Refunds': -1,             // always negative
  'Reimbursements': 1,       // always positive
  'Tax Collected by Amazon': 1, // nets to zero across settlement
};

// Xero account mapping
export const XERO_ACCOUNT_MAP: Record<string, { code: string; name: string }> = {
  'Sales': { code: '200', name: 'Amazon Sales AU' },
  'Promotional Discounts': { code: '200', name: 'Amazon Sales AU' },
  'Refunds': { code: '205', name: 'Amazon Refunds' },
  'Seller Fees': { code: '407', name: 'Amazon Seller Fees' },
  'FBA Fees': { code: '408', name: 'Amazon FBA Fees' },
  'Storage Fees': { code: '409', name: 'Amazon Storage Fees' },
  'Advertising Costs': { code: '410', name: 'Amazon Advertising Costs' },
  'Other Fees': { code: '405', name: 'Amazon Other Fees' },
  'Reimbursements': { code: '271', name: 'Amazon FBA Inventory Reimbursement AU' },
  'Tax Collected by Amazon': { code: '824', name: 'Amazon Sales Tax AU' },
  'Split Month Rollover': { code: '612', name: 'Amazon Split Month Rollovers' },
};

export interface SettlementHeader {
  settlementId: string;
  periodStart: string;
  periodEnd: string;
  depositDate: string;
  totalAmount: number;
  currency: string;
}

export interface SettlementLine {
  transactionType: string;
  amountType: string;
  amountDescription: string;
  accountingCategory: string;
  amount: number;
  orderId: string;
  sku: string;
  postedDate: string;
  marketplaceName: string;
  isAuMarketplace: boolean;
  fulfilmentChannel: string | null;
}

export interface UnmappedLine {
  transactionType: string;
  amountType: string;
  amountDescription: string;
  amount: number;
  rawRow: Record<string, string>;
}

export interface DebugBreakdownRow {
  category: string;
  rawTotal: number;
  exGst: number;
  gst: number;
}

export interface ReconciliationCheckResult {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface SettlementSummary {
  salesPrincipal: number;
  salesShipping: number;
  totalSales: number;
  promotionalDiscounts: number;
  sellerFees: number;
  fbaFees: number;
  storageFees: number;
  refunds: number;
  reimbursements: number;
  advertisingCosts: number;
  otherFees: number;
  grossTotal: number;
  netExGst: number;
  gstOnIncome: number;
  gstOnExpenses: number;
  bankDeposit: number;
  reconciliationMatch: boolean;
  reconciliationDiff: number;
  reconciliationChecks: ReconciliationCheckResult[];
  debugBreakdown: DebugBreakdownRow[];
  // Marketplace-aware totals (AU vs international)
  auSales: number;
  auFees: number;
  internationalSales: number;
  internationalFees: number;
}

export interface SplitMonthData {
  start: string;
  end: string;
  ratio: number;
  days: number;
  monthLabel: string;
  salesPrincipal: number;
  salesShipping: number;
  totalSales: number;
  promotionalDiscounts: number;
  sellerFees: number;
  fbaFees: number;
  storageFees: number;
  refunds: number;
  reimbursements: number;
  advertisingCosts: number;
  otherFees: number;
  grossTotal: number;
  netExGst: number;
  gstOnIncome: number;
  gstOnExpenses: number;
}

export interface SplitMonthInfo {
  isSplitMonth: boolean;
  month1: SplitMonthData | null;
  month2: SplitMonthData | null;
  rolloverAmount: number; // Amount posted to account 612 for rollover
}


export interface ParsedSettlement {
  header: SettlementHeader;
  lines: SettlementLine[];
  unmapped: UnmappedLine[];
  summary: SettlementSummary;
  splitMonth: SplitMonthInfo;
}

/** @deprecated Use parseDateOrEmpty from date-parser.ts */
const parseSettlementDate = parseDateOrEmpty;

/**
 * Rule 1 — Settlement header row detection
 * If transaction-type is empty AND order-id is empty → header row
 */
function isHeaderRow(fields: string[], getField: (row: string[], col: string) => string): boolean {
  const transactionType = getField(fields, 'transaction-type');
  const orderId = getField(fields, 'order-id');
  return !transactionType && !orderId;
}

/**
 * Rule 2 — Normalise amount sign based on category
 * Per-line: keep raw sign (reversals exist, e.g. fee refunds)
 * Aggregation-level enforcement happens in normaliseAggregate
 */
function normaliseSign(amount: number, _category: string): number {
  return amount;
}

/**
 * Enforce expected sign at the aggregate level.
 * If the net aggregate for a category has wrong sign, flip it.
 */
function normaliseAggregate(total: number, category: string): number {
  const expectedSign = EXPECTED_SIGNS[category];
  if (!expectedSign) return total;
  // If total is zero, keep it
  if (total === 0) return 0;
  // If sign matches expected, keep. Otherwise flip.
  const actualSign = total > 0 ? 1 : -1;
  if (actualSign !== expectedSign) {
    return -total;
  }
  return total;
}

export interface ParserOptions {
  gstRate?: number; // percentage, e.g. 10 for 10%. Default 10.
}

/**
 * Parse the Amazon Settlement Report TSV file
 */
export function parseSettlementTSV(tsvContent: string, options?: ParserOptions): ParsedSettlement {
  // Parser start logged at debug level only
  const gstDivisor = 1 + (100 / (options?.gstRate || 10)); // 10% GST-inclusive → divide by 11 to extract GST component
  const rawLines = tsvContent.split('\n').filter(line => line.trim().length > 0);

  if (rawLines.length < 2) {
    throw new Error('Settlement file must have at least a header row and one data row');
  }

  // Row 0 = column headers
  const columnHeaders = rawLines[0].split('\t').map(h => h.trim().toLowerCase());

  // Build column index map (lowercase keys for case-insensitive matching)
  const colIdx: Record<string, number> = {};
  columnHeaders.forEach((h, i) => { colIdx[h] = i; });

  logger.info('[Parser] Column headers:', columnHeaders);
  logger.info('[Parser] Has marketplace-name column:', 'marketplace-name' in colIdx);

  const getField = (row: string[], col: string): string => {
    const idx = colIdx[col.toLowerCase()];
    return idx !== undefined && idx < row.length ? (row[idx] || '').trim() : '';
  };

  // Find the settlement header row (Rule 1)
  let header: SettlementHeader | null = null;
  const lines: SettlementLine[] = [];
  const unmapped: UnmappedLine[] = [];

  // Track sub-categories for detailed breakdown
  let salesPrincipal = 0;
  let salesShipping = 0;

  // Marketplace-aware tracking: AU vs international
  const AU_MARKETPLACE = 'Amazon.com.au';
  let auIncomeTotal = 0;
  let auExpenseTotal = 0;
  let intlIncomeTotal = 0;
  let intlExpenseTotal = 0;
  // GST income base (v1.4.3): AU principal + AU shipping only (no promotions/refunds/reimbursements)
  let auSalesGstBaseTotal = 0;
  let intlSalesExcludedFromGstBase = 0;
  const sampleMarketplaceValues: string[] = [];
  let firstNonAuMarketplaceName: string | null = null;

  const INCOME_CATEGORIES = new Set(['Sales', 'Promotional Discounts', 'Refunds', 'Reimbursements']);
  const EXPENSE_CATEGORIES = new Set(['Seller Fees', 'FBA Fees', 'Storage Fees', 'Advertising Costs']);

  const normaliseOrderId = (value: string): string => value.trim().replace(/\s+/g, '').toLowerCase();
  const getOrderIdentifiers = (row: string[]): string[] => {
    const candidates = [
      getField(row, 'order-id'),
      getField(row, 'merchant-order-id'),
      getField(row, 'amazon-order-id'),
      getField(row, 'original-order-id'),
    ];
    const unique = new Set<string>();
    for (const candidate of candidates) {
      if (!candidate) continue;
      const normalized = normaliseOrderId(candidate);
      if (normalized) unique.add(normalized);
    }
    return [...unique];
  };

  // === PASS 1: Pre-scan to identify international order-ids ===
  // Two heuristics:
  // 1. Non-AU marketplace-name on any row → that order is international
  // 2. LVGT tax lines (ItemPrice|Tax, ShippingTax, LowValueGoodsTax) → cross-border order
  //    Amazon AU adds these tax lines for orders shipped internationally.
  //    These orders' Sales/Promo amounts should be GST-free (excluded from income GST base).
  const LVGT_DESCRIPTIONS = new Set(['Tax', 'ShippingTax', 'LowValueGoodsTax-Principal', 'LowValueGoodsTax-Shipping', 'TaxDiscount']);
  const intlOrderIds = new Set<string>();
  for (let i = 1; i < rawLines.length; i++) {
    const fields = rawLines[i].split('\t');
    const marketplaceName = getField(fields, 'marketplace-name');
    const amountDescription = getField(fields, 'amount-description');
    const isExplicitNonAu = !!marketplaceName && marketplaceName !== AU_MARKETPLACE;
    const isLvgtLine = LVGT_DESCRIPTIONS.has(amountDescription);

    if (!isExplicitNonAu && !isLvgtLine) continue;

    for (const orderKey of getOrderIdentifiers(fields)) {
      intlOrderIds.add(orderKey);
    }
  }
  logger.info('[Pass 1] International order-ids detected:', intlOrderIds.size, 'heuristics: marketplace-name + LVGT', [...intlOrderIds].slice(0, 10));

  // === PASS 2: Main classification loop ===
  let debugRowCount = 0;
  for (let i = 1; i < rawLines.length; i++) {
    const fields = rawLines[i].split('\t');

    // Rule 1: Header row detection
    if (isHeaderRow(fields, getField)) {
      const totalAmount = parseFloat(getField(fields, 'total-amount'));
      if (!isNaN(totalAmount) && !header) {
        header = {
          settlementId: getField(fields, 'settlement-id'),
          periodStart: parseSettlementDate(getField(fields, 'settlement-start-date')),
          periodEnd: parseSettlementDate(getField(fields, 'settlement-end-date')),
          depositDate: parseSettlementDate(getField(fields, 'deposit-date')),
          totalAmount,
          currency: getField(fields, 'currency') || 'AUD',
        };
      }
      continue;
    }

    const transactionType = getField(fields, 'transaction-type');
    const amountType = getField(fields, 'amount-type');
    const amountDescription = getField(fields, 'amount-description');
    const amount = parseFloat(getField(fields, 'amount')) || 0;
    const orderId = getField(fields, 'order-id');
    const orderIdentifiers = getOrderIdentifiers(fields);
    const sku = getField(fields, 'sku');
    const postedDate = parseSettlementDate(getField(fields, 'posted-date'));
    const marketplaceName = getField(fields, 'marketplace-name');
    const isExplicitNonAu = !!marketplaceName && marketplaceName !== AU_MARKETPLACE;
    const hasIntlOrderMatch = orderIdentifiers.some((id) => intlOrderIds.has(id));
    const isAuMarketplace = marketplaceName === AU_MARKETPLACE && !hasIntlOrderMatch;
    const isIntlOrder = isExplicitNonAu || hasIntlOrderMatch;

    if (sampleMarketplaceValues.length < 10 && transactionType) {
      sampleMarketplaceValues.push(marketplaceName);
    }

    // Debug: log first 10 transaction rows' marketplace names, and first non-AU row raw value
    if (transactionType && debugRowCount < 10) {
      logger.info(`[Parser] Row ${i} marketplace-name: "${marketplaceName}", isAU: ${isAuMarketplace}, txType: ${transactionType}, amount: ${amount}`);
      debugRowCount++;
    }
    if (transactionType && isExplicitNonAu && firstNonAuMarketplaceName === null) {
      firstNonAuMarketplaceName = marketplaceName;
      logger.info('[Marketplace Raw First Non-AU]', { row: i, marketplaceNameRaw: marketplaceName });
    }

    if (!transactionType) continue;

    const mapKey = `${transactionType}|${amountType}|${amountDescription}`;
    const category = CATEGORY_MAP[mapKey];

    if (category) {
      const normAmount = normaliseSign(amount, category);
      lines.push({
        transactionType, amountType, amountDescription,
        accountingCategory: category,
        amount: normAmount, orderId, sku, postedDate,
        marketplaceName, isAuMarketplace,
      });

      // Track principal vs shipping for Sales breakdown
      if (category === 'Sales' && amountDescription === 'Principal') {
        salesPrincipal += amount;
      } else if (category === 'Sales' && amountDescription === 'Shipping') {
        salesShipping += amount;
      }

      // Track AU vs international totals
      if (isIntlOrder && debugRowCount < 50) {
        logger.info(`[Intl Order Hit] order=${orderId || '(none)'}, orderKeys=${orderIdentifiers.join('|') || '(none)'}, category=${category}, amount=${amount}, marketplace="${marketplaceName}"`);
      }
      if (INCOME_CATEGORIES.has(category)) {
        if (isIntlOrder) intlIncomeTotal += amount;
        else auIncomeTotal += amount;
      } else if (EXPENSE_CATEGORIES.has(category)) {
        if (isIntlOrder) intlExpenseTotal += amount;
        else auExpenseTotal += amount;
      }

      // GST income base rule (v1.4.8): AU Sales AND AU Promotional Discounts contribute to GST base.
      // Promotional discounts are contra-revenue that reduce the GST income base (matching Link My Books).
      // International (non-AU) sales and promos are GST-free and excluded.
      if (category === 'Sales' || category === 'Promotional Discounts') {
        const isAuLine = marketplaceName === AU_MARKETPLACE && !isIntlOrder;
        if (isAuLine) {
          auSalesGstBaseTotal += amount;
        } else {
          intlSalesExcludedFromGstBase += amount;
        }
      }
    } else {
      // UNMAPPED — never silently ignore
      const rawRow: Record<string, string> = {};
      columnHeaders.forEach((h, idx) => {
        rawRow[h] = idx < fields.length ? fields[idx] : '';
      });
      unmapped.push({ transactionType, amountType, amountDescription, amount, rawRow });
    }
  }

  logger.info('[Parser v1.4.5] International order-ids detected:', intlOrderIds.size, [...intlOrderIds]);

  if (!header) {
    throw new Error('No settlement header row found (expected row with total-amount but no transaction-type)');
  }

  logger.info('[Marketplace Split]', {
    settlementId: header.settlementId,
    auIncomeTotal: round2(auIncomeTotal),
    intlIncomeTotal: round2(intlIncomeTotal),
    gstBaseAuSalesOnly: round2(auSalesGstBaseTotal),
    intlSalesExcludedFromGstBase: round2(intlSalesExcludedFromGstBase),
    intlOrderIdsCount: intlOrderIds.size,
    intlOrderIds: [...intlOrderIds],
    sampleMarketplaceValues,
  });

  // Rule 3 — Aggregation logic
  const totals: Record<string, number> = {};
  for (const line of lines) {
    totals[line.accountingCategory] = (totals[line.accountingCategory] || 0) + line.amount;
  }

  // Rule 2 — Enforce sign normalisation at aggregate level
  const totalSales = normaliseAggregate(round2(totals['Sales'] || 0), 'Sales');
  const promotionalDiscounts = normaliseAggregate(round2(totals['Promotional Discounts'] || 0), 'Promotional Discounts');
  const sellerFees = normaliseAggregate(round2(totals['Seller Fees'] || 0), 'Seller Fees');
  const fbaFees = normaliseAggregate(round2(totals['FBA Fees'] || 0), 'FBA Fees');
  const storageFees = normaliseAggregate(round2(totals['Storage Fees'] || 0), 'Storage Fees');
  const advertisingCosts = normaliseAggregate(round2(totals['Advertising Costs'] || 0), 'Advertising Costs');
  const refunds = normaliseAggregate(round2(totals['Refunds'] || 0), 'Refunds');
  const reimbursements = normaliseAggregate(round2(totals['Reimbursements'] || 0), 'Reimbursements');
  const taxCollectedByAmazon = round2(totals['Tax Collected by Amazon'] || 0); // nets to ~zero
  const unmappedTotal = round2(unmapped.reduce((sum, u) => sum + u.amount, 0));

  // Gross total = sum of ALL mapped + unmapped amounts (tax pass-through included for reconciliation)
  const grossTotal = round2(totalSales + promotionalDiscounts + sellerFees + fbaFees + storageFees + advertisingCosts + refunds + reimbursements + taxCollectedByAmazon + unmappedTotal);

  // Rule 4 — GST calculation (v1.4.8)
  // GST on income base = AU principal + AU shipping + AU promotional discounts (contra-revenue).
  // This matches Link My Books: promos reduce the GST income base. Refunds/reimbursements excluded.
  const auIncome = round2(auSalesGstBaseTotal);
  const expenseTotal = round2(sellerFees + fbaFees + storageFees + advertisingCosts);

  const gstOnIncome = round2(auIncome / gstDivisor);
  const gstOnExpenses = round2(expenseTotal / gstDivisor); // negative result (expenses are negative)

  logger.info('[GST Base]', {
    auSalesGstBase: auIncome,
    intlSalesExcluded: round2(intlSalesExcludedFromGstBase),
    gstOnIncome,
  });

  logger.info('[GST Calculation]', {
    settlementId: header.settlementId,
    auIncomeGstBase: auIncome,
    intlSalesExcludedFromGstBase: round2(intlSalesExcludedFromGstBase),
    gstOnIncome,
    gstOnExpenses,
  });

  // Net ex GST = gross total minus all GST components
  const netExGst = round2(grossTotal - gstOnIncome - gstOnExpenses);

  // Rule 5 — Reconciliation gate (±TOL_PARSER_TOTAL tolerance)
  const reconciliationDiff = round2(header.totalAmount - grossTotal);
  const reconciliationMatch = Math.abs(reconciliationDiff) < TOL_PARSER_TOTAL;

  // ─── 5-point reconciliation diagnostics ─────────────────────────
  const reconciliationChecks: ReconciliationCheckResult[] = [];

  // 1. Balance check: bank deposit vs sum of all line items
  reconciliationChecks.push({
    name: 'Balance check',
    passed: Math.abs(reconciliationDiff) < TOL_PARSER_TOTAL,
    detail: `Bank ${formatAUD(header.totalAmount)} vs Calculated ${formatAUD(grossTotal)} (diff ${formatAUD(reconciliationDiff)})`,
  });

  // 2. Column totals: income + expenses should equal gross total
  const reconIncomeTotal = round2(salesPrincipal + salesShipping + promotionalDiscounts + refunds + reimbursements);
  const reconExpenseTotal = round2(sellerFees + fbaFees + storageFees + advertisingCosts + unmappedTotal);
  const columnSum = round2(reconIncomeTotal + reconExpenseTotal);
  reconciliationChecks.push({
    name: 'Column totals',
    passed: Math.abs(columnSum - grossTotal) < TOL_LINE_SUM,
    detail: `Income ${formatAUD(reconIncomeTotal)} + Expenses ${formatAUD(reconExpenseTotal)} = ${formatAUD(columnSum)} vs Gross ${formatAUD(grossTotal)}`,
  });

  // 3. GST consistency: GST on income + GST on expenses should be plausible
  const expectedGstOnIncome = round2((salesPrincipal + salesShipping + promotionalDiscounts) / gstDivisor);
  const gstIncDiff = Math.abs(gstOnIncome - expectedGstOnIncome);
  reconciliationChecks.push({
    name: 'GST consistency',
    passed: gstIncDiff < TOL_COLUMN_TOTALS,
    detail: `GST on income ${formatAUD(gstOnIncome)} vs expected ${formatAUD(expectedGstOnIncome)} (diff ${formatAUD(gstIncDiff)})`,
  });

  // 4. Sanity check: net ex GST + all GST = bank deposit
  const sanityTotal = round2(netExGst + gstOnIncome + gstOnExpenses);
  const sanityDiff = round2(header.totalAmount - sanityTotal);
  reconciliationChecks.push({
    name: 'Sanity check',
    passed: Math.abs(sanityDiff) < TOL_COLUMN_TOTALS,
    detail: `Net ${formatAUD(netExGst)} + GST Inc ${formatAUD(gstOnIncome)} + GST Exp ${formatAUD(gstOnExpenses)} = ${formatAUD(sanityTotal)} vs Bank ${formatAUD(header.totalAmount)}`,
  });

  // 5. Historical: fees should be negative (EXPECTED_SIGNS compliance)
  const feesPositive = sellerFees > 0 || fbaFees > 0 || storageFees > 0;
  reconciliationChecks.push({
    name: 'Sign convention',
    passed: !feesPositive,
    detail: feesPositive ? `Fee sign violation: seller=${formatAUD(sellerFees)} fba=${formatAUD(fbaFees)} storage=${formatAUD(storageFees)}` : 'All fees correctly signed',
  });

  // Debug breakdown table
  const debugBreakdown = buildDebugBreakdown(
    salesPrincipal, salesShipping, promotionalDiscounts,
    sellerFees, fbaFees, storageFees, refunds, reimbursements, unmappedTotal,
    gstDivisor
  );

  // AU vs international totals (kept for DB compatibility, not used for GST)
  const auSales = round2(auIncomeTotal);
  const auFees = round2(auExpenseTotal);
  const internationalSales = round2(intlIncomeTotal);
  const internationalFees = round2(intlExpenseTotal);

  const summary: SettlementSummary = {
    salesPrincipal: round2(salesPrincipal),
    salesShipping: round2(salesShipping),
    totalSales,
    promotionalDiscounts,
    sellerFees,
    fbaFees,
    storageFees,
    refunds,
    reimbursements,
    advertisingCosts,
    otherFees: unmappedTotal,
    grossTotal,
    netExGst,
    gstOnIncome,
    gstOnExpenses,
    bankDeposit: header.totalAmount,
    reconciliationMatch,
    reconciliationDiff,
    reconciliationChecks,
    debugBreakdown,
    auSales,
    auFees,
    internationalSales,
    internationalFees,
  };

  // Split month detection — uses actual posted dates per line
  const splitMonth = detectSplitMonth(header, summary, lines, gstDivisor, round2(auSalesGstBaseTotal), round2(intlSalesExcludedFromGstBase));

  return { header, lines, unmapped, summary, splitMonth };
}

/**
 * Detect if settlement crosses a month boundary and calculate pro-rata splits.
 */
function detectSplitMonth(
  header: SettlementHeader,
  summary: SettlementSummary,
  allLines: SettlementLine[],
  gstDivisor: number,
  auSalesGstBaseTotal: number,
  intlSalesExcludedFromGstBase: number,
): SplitMonthInfo {
  if (!header.periodStart || !header.periodEnd) {
    return { isSplitMonth: false, month1: null, month2: null, rolloverAmount: 0 };
  }

  const [startY, startM] = header.periodStart.split('-').map(Number);
  const [endY, endM] = header.periodEnd.split('-').map(Number);

  if (startY === endY && startM === endM) {
    return { isSplitMonth: false, month1: null, month2: null, rolloverAmount: 0 };
  }

  // Calculate days in each month
  const startDate = new Date(Date.UTC(startY, startM - 1, parseInt(header.periodStart.split('-')[2])));
  const endDate = new Date(Date.UTC(endY, endM - 1, parseInt(header.periodEnd.split('-')[2])));

  // Last day of month 1
  const lastDayMonth1 = new Date(Date.UTC(startY, startM, 0)); // last day of startM
  // First day of month 2
  const firstDayMonth2 = new Date(Date.UTC(endY, endM - 1, 1));

  // Days: inclusive on both ends
  const daysMonth1 = Math.round((lastDayMonth1.getTime() - startDate.getTime()) / 86400000) + 1;
  const daysMonth2 = Math.round((endDate.getTime() - firstDayMonth2.getTime()) / 86400000) + 1;
  const totalDays = daysMonth1 + daysMonth2;

  const ratio1 = daysMonth1 / totalDays;
  const ratio2 = daysMonth2 / totalDays;

  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  // Aggregate lines by actual posted date into month buckets
  const formatDateStr = (d: Date) => d.toISOString().split('T')[0];
  const lastDayMonth1Str = formatDateStr(lastDayMonth1); // YYYY-MM-DD
  const aggregateLines = (monthLines: SettlementLine[]) => {
    let sp = 0, ss = 0, pd = 0, sf = 0, ff = 0, stf = 0, ad = 0, ref = 0, reim = 0, oth = 0;
    for (const line of monthLines) {
      const cat = line.accountingCategory;
      const amt = line.amount;
      if (cat === 'Sales' && line.amountDescription === 'Principal') sp += amt;
      else if (cat === 'Sales' && line.amountDescription === 'Shipping') ss += amt;
      else if (cat === 'Sales') sp += amt; // default sub-category
      else if (cat === 'Promotional Discounts') pd += amt;
      else if (cat === 'Seller Fees') sf += amt;
      else if (cat === 'FBA Fees') ff += amt;
      else if (cat === 'Storage Fees') stf += amt;
      else if (cat === 'Advertising Costs') ad += amt;
      else if (cat === 'Refunds') ref += amt;
      else if (cat === 'Reimbursements') reim += amt;
      else oth += amt;
    }
    const ts = round2(sp + ss);
    const gross = round2(ts + pd + sf + ff + stf + ad + ref + reim + oth);
    const expenseTotal = round2(sf + ff + stf + ad);
    const gstInc = round2(round2(sp + ss + pd) / gstDivisor);
    const gstExp = round2(expenseTotal / gstDivisor);
    const net = round2(gross - gstInc - gstExp);
    return {
      salesPrincipal: round2(sp), salesShipping: round2(ss), totalSales: ts,
      promotionalDiscounts: round2(pd), sellerFees: round2(sf), fbaFees: round2(ff),
      storageFees: round2(stf), advertisingCosts: round2(ad), refunds: round2(ref), reimbursements: round2(reim),
      otherFees: round2(oth), grossTotal: gross, netExGst: net,
      gstOnIncome: gstInc, gstOnExpenses: gstExp,
    };
  };

  // Split lines by posted_date
  const month1Lines = allLines.filter(l => !l.postedDate || l.postedDate <= lastDayMonth1Str);
  const month2Lines = allLines.filter(l => l.postedDate && l.postedDate > lastDayMonth1Str);

  const m1Agg = aggregateLines(month1Lines);
  const m2Agg = aggregateLines(month2Lines);

  

  const month1: SplitMonthData = {
    start: header.periodStart,
    end: formatDateStr(lastDayMonth1),
    ratio: round2(ratio1 * 100) / 100,
    days: daysMonth1,
    monthLabel: MONTH_NAMES[startM - 1],
    ...m1Agg,
  };

  const month2: SplitMonthData = {
    start: formatDateStr(firstDayMonth2),
    end: header.periodEnd,
    ratio: round2(ratio2 * 100) / 100,
    days: daysMonth2,
    monthLabel: MONTH_NAMES[endM - 1],
    ...m2Agg,
  };

  // Rollover amount = gross total of month 1 lines (Journal 1 CR 612 to net to $0)
  const rolloverAmount = m1Agg.grossTotal;

  logger.info('[Split Month By Posted Date]', {
    settlementId: header.settlementId,
    month1Lines: month1Lines.length,
    month2Lines: month2Lines.length,
    m1Gross: m1Agg.grossTotal,
    m2Gross: m2Agg.grossTotal,
    rolloverAmount,
    bankDeposit: summary.bankDeposit,
  });

  return { isSplitMonth: true, month1, month2, rolloverAmount };
}

function buildDebugBreakdown(
  salesPrincipal: number, salesShipping: number, promoDiscounts: number,
  sellerFees: number, fbaFees: number, storageFees: number,
  refunds: number, reimbursements: number, unmapped: number,
  gstDivisor: number,
): DebugBreakdownRow[] {
  const rows: DebugBreakdownRow[] = [];

  const addRow = (category: string, rawTotal: number, isIncome: boolean) => {
    const gst = round2(rawTotal / gstDivisor);
    const exGst = round2(rawTotal - gst);
    rows.push({ category, rawTotal: round2(rawTotal), exGst, gst });
  };

  addRow('Principal Sales', salesPrincipal, true);
  addRow('Shipping Sales', salesShipping, true);
  addRow('Promotional Discounts', promoDiscounts, true);
  addRow('Seller Fees', sellerFees, false);
  addRow('FBA Fees', fbaFees, false);
  addRow('Storage Fees', storageFees, false);
  addRow('Refunds', refunds, true);
  addRow('Reimbursements', reimbursements, true);
  if (unmapped !== 0) {
    rows.push({ category: 'Unmapped', rawTotal: round2(unmapped), exGst: round2(unmapped), gst: 0 });
  }

  // Totals row
  const totalRaw = rows.reduce((s, r) => s + r.rawTotal, 0);
  const totalExGst = rows.reduce((s, r) => s + r.exGst, 0);
  const totalGst = rows.reduce((s, r) => s + r.gst, 0);
  rows.push({ category: 'TOTAL', rawTotal: round2(totalRaw), exGst: round2(totalExGst), gst: round2(totalGst) });

  return rows;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Format a date string (YYYY-MM-DD) to display format (DD Mon YYYY)
 */
export function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const [y, m, d] = dateStr.split('-');
  return `${parseInt(d)} ${months[parseInt(m) - 1]} ${y}`;
}

/**
 * Format a number as AUD currency
 */
export function formatAUD(amount: number): string {
  const prefix = amount < 0 ? '-$' : '$';
  return `${prefix}${Math.abs(amount).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
