/**
 * amazon-xero-push.ts — Amazon-specific Xero invoice line item builder and split-month push logic.
 * Extracted from AccountingDashboard to keep Amazon push logic isolated and testable.
 */

import { round2, formatAUD, XERO_ACCOUNT_MAP, type ParsedSettlement } from '@/utils/settlement-parser';

// ─── Types ──────────────────────────────────────────────────────────

export interface XeroLineItem {
  Description: string;
  AccountCode: string;
  TaxType: string;
  UnitAmount: number;
  Quantity: number;
}

export interface JournalPreviewRow {
  description: string;
  accountCode: string;
  accountName: string;
  taxRate: string;
  netAmount: number;
  taxAmount: number;
  grossAmount: number;
}

// ─── Build Invoice Line Items ───────────────────────────────────────

const INCOME_CATS = new Set([
  'Sales - Principal', 'Sales - Shipping', 'Promotional Discounts', 'Refunds', 'Reimbursements',
]);

const TAX_SUBCAT_MAP: Record<string, string> = {
  'Tax': 'Tax',
  'ShippingTax': 'Shipping Tax',
  'TaxDiscount': 'Tax Discounts',
  'LowValueGoodsTax-Principal': 'Low Value Goods Tax',
  'LowValueGoodsTax-Shipping': 'Low Value Goods Tax',
};

function getTaxType(cat: string, marketplace: 'au' | 'intl'): string {
  if (cat === 'Reimbursements') return 'BASEXCLUDED';
  if (marketplace === 'intl') return 'EXEMPTOUTPUT';
  return 'OUTPUT';
}

/**
 * Build Xero ACCREC invoice line items from Amazon parsed settlement lines.
 * Handles AU vs International marketplace splitting, tax types, rounding adjustments.
 */
export function buildAmazonInvoiceLineItems(
  parsedLines: ParsedSettlement['lines'],
  periodLabel: string,
  settlementId: string,
  getAccountCode: (category: string) => string,
  ratio?: number,
  bankDeposit?: number,
): XeroLineItem[] {
  const auBuckets: Record<string, number> = {};
  const intlBuckets: Record<string, number> = {};
  const expenseBuckets: Record<string, number> = {};
  const otherBuckets: Record<string, number> = {};
  const taxSubBuckets: Record<string, number> = {};

  for (const line of parsedLines) {
    let cat = line.accountingCategory;
    if (cat === 'Sales') {
      cat = line.amountDescription === 'Shipping' ? 'Sales - Shipping' : 'Sales - Principal';
    }
    if (cat === 'Tax Collected by Amazon') {
      const subName = TAX_SUBCAT_MAP[line.amountDescription] || line.amountDescription;
      const key = `Amazon Sales Tax - ${subName}`;
      taxSubBuckets[key] = (taxSubBuckets[key] || 0) + line.amount;
      continue;
    }
    if (INCOME_CATS.has(cat)) {
      if (line.isAuMarketplace) {
        auBuckets[cat] = (auBuckets[cat] || 0) + line.amount;
      } else {
        intlBuckets[cat] = (intlBuckets[cat] || 0) + line.amount;
      }
    } else if (['Seller Fees', 'FBA Fees', 'Storage Fees', 'Advertising Costs', 'Other Fees'].includes(cat)) {
      expenseBuckets[cat] = (expenseBuckets[cat] || 0) + line.amount;
    } else {
      otherBuckets[cat] = (otherBuckets[cat] || 0) + line.amount;
    }
  }

  const getAccountCodeForSplit = (cat: string): string => {
    if (cat === 'Sales - Principal' || cat === 'Sales - Shipping') return getAccountCode('Sales');
    return getAccountCode(cat);
  };

  const lineItems: XeroLineItem[] = [];

  // AU income lines
  for (const [category, amount] of Object.entries(auBuckets)) {
    const appliedAmount = ratio ? round2(amount * ratio) : round2(amount);
    if (appliedAmount === 0) continue;
    const taxType = getTaxType(category, 'au');
    const isGstItem = taxType === 'OUTPUT' || taxType === 'INPUT';
    const exGst = isGstItem ? round2(appliedAmount - round2(appliedAmount / 11)) : appliedAmount;
    lineItems.push({
      Description: `Amazon ${category} - Australia ${periodLabel}`,
      AccountCode: getAccountCodeForSplit(category),
      TaxType: taxType,
      UnitAmount: exGst,
      Quantity: 1,
    });
  }

  // International income lines
  for (const [category, amount] of Object.entries(intlBuckets)) {
    const appliedAmount = ratio ? round2(amount * ratio) : round2(amount);
    if (appliedAmount === 0) continue;
    lineItems.push({
      Description: `Amazon ${category} - Rest of the World ${periodLabel}`,
      AccountCode: getAccountCodeForSplit(category),
      TaxType: getTaxType(category, 'intl'),
      UnitAmount: appliedAmount,
      Quantity: 1,
    });
  }

  // Expense lines
  for (const [category, amount] of Object.entries(expenseBuckets)) {
    const appliedAmount = ratio ? round2(amount * ratio) : round2(amount);
    if (appliedAmount === 0) continue;
    const absAmount = Math.abs(appliedAmount);
    const exGst = round2(absAmount - round2(absAmount / 11));
    lineItems.push({
      Description: `Amazon ${category} ${periodLabel}`,
      AccountCode: getAccountCode(category),
      TaxType: 'INPUT',
      UnitAmount: -Math.abs(exGst),
      Quantity: 1,
    });
  }

  // Other lines
  for (const [category, amount] of Object.entries(otherBuckets)) {
    const appliedAmount = ratio ? round2(amount * ratio) : round2(amount);
    if (appliedAmount === 0) continue;
    lineItems.push({
      Description: `Amazon ${category} ${periodLabel}`,
      AccountCode: getAccountCode(category),
      TaxType: 'BASEXCLUDED',
      UnitAmount: appliedAmount,
      Quantity: 1,
    });
  }

  // Tax sub-lines
  for (const [description, amount] of Object.entries(taxSubBuckets)) {
    const appliedAmount = ratio ? round2(amount * ratio) : round2(amount);
    if (appliedAmount === 0) continue;
    lineItems.push({
      Description: `${description} ${periodLabel}`,
      AccountCode: getAccountCode('Tax Collected by Amazon'),
      TaxType: 'BASEXCLUDED',
      UnitAmount: appliedAmount,
      Quantity: 1,
    });
  }

  // Rounding adjustment
  if (bankDeposit !== undefined && !ratio) {
    let xeroTotal = 0;
    for (const item of lineItems) {
      const amt = item.UnitAmount;
      const sign = amt < 0 ? -1 : 1;
      if (item.TaxType === 'OUTPUT' || item.TaxType === 'INPUT') {
        xeroTotal += round2(round2(Math.abs(amt)) * 1.1) * sign;
      } else {
        xeroTotal += round2(amt);
      }
    }
    xeroTotal = round2(xeroTotal);
    const diff = round2(bankDeposit - xeroTotal);
    if (diff !== 0 && Math.abs(diff) <= 0.05) {
      console.info('[Rounding Adjustment]', { bankDeposit, xeroTotal, diff });
      lineItems.push({
        Description: `Rounding adjustment ${periodLabel}`,
        AccountCode: getAccountCode('Sales'),
        TaxType: 'BASEXCLUDED',
        UnitAmount: diff,
        Quantity: 1,
      });
    } else if (diff !== 0 && Math.abs(diff) > 0.05) {
      console.error('[Rounding BLOCKED]', { bankDeposit, xeroTotal, diff });
      throw new Error(
        `Rounding discrepancy of ${formatAUD(Math.abs(diff))} exceeds ±$0.05 tolerance. ` +
        `Bank deposit: ${formatAUD(bankDeposit)}, Calculated total: ${formatAUD(xeroTotal)}. ` +
        `This settlement cannot be pushed to Xero until the discrepancy is resolved.`
      );
    }
  }

  return lineItems;
}

/**
 * Compute the Xero-inclusive total for a set of line items.
 * Used for split-month rollover calculations.
 */
export function computeXeroInclusiveTotal(lineItems: XeroLineItem[]): number {
  let total = 0;
  for (const item of lineItems) {
    const amt = item.UnitAmount;
    const sign = amt < 0 ? -1 : 1;
    if (item.TaxType === 'OUTPUT' || item.TaxType === 'INPUT') {
      total += round2(round2(Math.abs(amt)) * 1.1) * sign;
    } else {
      total += round2(amt);
    }
  }
  return round2(total);
}

/**
 * Build journal preview rows for the Xero Invoice Preview table in the Review tab.
 */
export function buildJournalPreviewRows(
  lines: ParsedSettlement['lines'],
): JournalPreviewRow[] {
  const auBuckets: Record<string, number> = {};
  const intlBuckets: Record<string, number> = {};
  const expenseBuckets: Record<string, number> = {};
  const otherBuckets: Record<string, number> = {};
  const taxSubBuckets: Record<string, number> = {};

  for (const line of lines) {
    let cat = line.accountingCategory;
    if (cat === 'Sales') {
      cat = line.amountDescription === 'Shipping' ? 'Sales - Shipping' : 'Sales - Principal';
    }
    if (cat === 'Tax Collected by Amazon') {
      const subName = TAX_SUBCAT_MAP[line.amountDescription] || line.amountDescription;
      const key = `Amazon Sales Tax - ${subName}`;
      taxSubBuckets[key] = (taxSubBuckets[key] || 0) + line.amount;
      continue;
    }
    if (INCOME_CATS.has(cat)) {
      if (line.isAuMarketplace) {
        auBuckets[cat] = (auBuckets[cat] || 0) + line.amount;
      } else {
        intlBuckets[cat] = (intlBuckets[cat] || 0) + line.amount;
      }
    } else if (['Seller Fees', 'FBA Fees', 'Storage Fees', 'Advertising Costs', 'Other Fees'].includes(cat)) {
      expenseBuckets[cat] = (expenseBuckets[cat] || 0) + line.amount;
    } else {
      otherBuckets[cat] = (otherBuckets[cat] || 0) + line.amount;
    }
  }

  const getTaxInfo = (cat: string, marketplace: 'au' | 'intl'): { taxRate: string; hasGst: boolean } => {
    if (cat === 'Reimbursements') return { taxRate: 'BAS Excluded', hasGst: false };
    if (marketplace === 'intl') return { taxRate: 'GST Free Income', hasGst: false };
    if (['Seller Fees', 'FBA Fees', 'Storage Fees', 'Advertising Costs', 'Other Fees'].includes(cat)) {
      return { taxRate: 'GST on Expenses', hasGst: true };
    }
    if (['Sales - Principal', 'Sales - Shipping', 'Refunds', 'Promotional Discounts'].includes(cat)) {
      return { taxRate: 'GST on Income', hasGst: true };
    }
    return { taxRate: 'BAS Excluded', hasGst: false };
  };

  const getMapForCat = (cat: string) => {
    if (cat === 'Sales - Principal' || cat === 'Sales - Shipping') return XERO_ACCOUNT_MAP['Sales'] || { code: '200', name: 'Amazon Sales AU' };
    return XERO_ACCOUNT_MAP[cat] || { code: '000', name: cat };
  };

  const journalRows: JournalPreviewRow[] = [];

  for (const [category, amount] of Object.entries(auBuckets)) {
    const a = round2(amount);
    if (a === 0) continue;
    const map = getMapForCat(category);
    const { taxRate, hasGst } = getTaxInfo(category, 'au');
    const taxAmt = hasGst ? round2(a / 11) : 0;
    const netAmt = round2(a - taxAmt);
    journalRows.push({
      description: `Amazon ${category} - Australia`,
      accountCode: map.code,
      accountName: `${map.code}: ${map.name}`,
      taxRate,
      netAmount: netAmt,
      taxAmount: taxAmt,
      grossAmount: a,
    });
  }

  for (const [category, amount] of Object.entries(intlBuckets)) {
    const a = round2(amount);
    if (a === 0) continue;
    const map = getMapForCat(category);
    const { taxRate } = getTaxInfo(category, 'intl');
    journalRows.push({
      description: `Amazon ${category} - Rest of the World`,
      accountCode: map.code,
      accountName: `${map.code}: ${map.name}`,
      taxRate,
      netAmount: a,
      taxAmount: 0,
      grossAmount: a,
    });
  }

  for (const [category, amount] of Object.entries(expenseBuckets)) {
    const a = round2(amount);
    if (a === 0) continue;
    const map = XERO_ACCOUNT_MAP[category] || { code: '000', name: category };
    const absA = Math.abs(a);
    const taxAmt = round2(absA / 11);
    journalRows.push({
      description: `Amazon ${category}`,
      accountCode: map.code,
      accountName: `${map.code}: ${map.name}`,
      taxRate: 'GST on Expenses',
      netAmount: -round2(absA - taxAmt),
      taxAmount: -taxAmt,
      grossAmount: -absA,
    });
  }

  for (const [category, amount] of Object.entries(otherBuckets)) {
    const a = round2(amount);
    if (a === 0) continue;
    const map = XERO_ACCOUNT_MAP[category] || { code: '000', name: category };
    journalRows.push({
      description: `Amazon ${category}`,
      accountCode: map.code,
      accountName: `${map.code}: ${map.name}`,
      taxRate: 'BAS Excluded',
      netAmount: a,
      taxAmount: 0,
      grossAmount: a,
    });
  }

  const taxMap = XERO_ACCOUNT_MAP['Tax Collected by Amazon'] || { code: '824', name: 'Amazon Sales Tax AU' };
  for (const [description, amount] of Object.entries(taxSubBuckets)) {
    const a = round2(amount);
    if (a === 0) continue;
    journalRows.push({
      description,
      accountCode: taxMap.code,
      accountName: `${taxMap.code}: ${taxMap.name}`,
      taxRate: 'BAS Excluded',
      netAmount: a,
      taxAmount: 0,
      grossAmount: a,
    });
  }

  return journalRows;
}

/**
 * Compute the rollover amount for split-month settlements.
 * Mirrors the Xero-inclusive total computation for month-1 lines.
 */
export function computeSplitMonthRollover(
  lines: ParsedSettlement['lines'],
  month1EndDate: string,
): number {
  const month1Lines = lines.filter(l => {
    if (!l.postedDate) return true;
    return l.postedDate <= month1EndDate;
  });

  const auBuckets: Record<string, number> = {};
  const intlBuckets: Record<string, number> = {};
  const expenseBuckets: Record<string, number> = {};
  const otherBuckets: Record<string, number> = {};
  const taxSubBuckets: Record<string, number> = {};

  for (const line of month1Lines) {
    let cat = line.accountingCategory;
    if (cat === 'Sales') cat = line.amountDescription === 'Shipping' ? 'Sales - Shipping' : 'Sales - Principal';
    if (cat === 'Tax Collected by Amazon') {
      taxSubBuckets[line.amountDescription] = (taxSubBuckets[line.amountDescription] || 0) + line.amount;
      continue;
    }
    if (INCOME_CATS.has(cat)) {
      if (line.isAuMarketplace) auBuckets[cat] = (auBuckets[cat] || 0) + line.amount;
      else intlBuckets[cat] = (intlBuckets[cat] || 0) + line.amount;
    } else if (['Seller Fees', 'FBA Fees', 'Storage Fees', 'Advertising Costs', 'Other Fees'].includes(cat)) {
      expenseBuckets[cat] = (expenseBuckets[cat] || 0) + line.amount;
    } else {
      otherBuckets[cat] = (otherBuckets[cat] || 0) + line.amount;
    }
  }

  let xeroTotal = 0;
  for (const [, amount] of Object.entries(auBuckets)) {
    const a = round2(amount);
    if (a === 0) continue;
    const taxAmt = round2(a / 11);
    const exGst = round2(a - taxAmt);
    xeroTotal += round2(exGst * 1.1);
  }
  for (const [, amount] of Object.entries(intlBuckets)) {
    xeroTotal += round2(amount);
  }
  for (const [, amount] of Object.entries(expenseBuckets)) {
    const a = round2(amount);
    if (a === 0) continue;
    const absA = Math.abs(a);
    const exGst = round2(absA - round2(absA / 11));
    xeroTotal -= round2(exGst * 1.1);
  }
  for (const [, amount] of Object.entries(otherBuckets)) {
    xeroTotal += round2(amount);
  }
  for (const [, amount] of Object.entries(taxSubBuckets)) {
    xeroTotal += round2(amount);
  }

  return round2(xeroTotal);
}
