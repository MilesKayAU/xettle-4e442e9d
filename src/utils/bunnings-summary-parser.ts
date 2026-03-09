/**
 * Bunnings (Mirakl) Summary of Transactions PDF Parser
 * 
 * Extracts key financial data from the "Summary of transactions" PDF
 * that Bunnings generates each fortnightly billing cycle.
 * 
 * Returns a StandardSettlement for use with the shared settlement engine.
 */

import * as pdfjsLib from 'pdfjs-dist';
import type { StandardSettlement } from './settlement-engine';

// Configure worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// ─── Parsed line item from the summary table ────────────────────────

export interface BunningsLineItem {
  label: string;           // e.g. "Payable orders", "Refund on orders"
  exGst: number;
  gst: number;
  inclGst: number;
}

export interface BunningsParseExtra {
  shopName: string;
  shopId: string;
  ordersInclGst: number;
  commissionInclGst: number;
  rawText: string;
  /** Full breakdown of every row parsed from the summary table */
  lineItems: BunningsLineItem[];
}

export type BunningsParseResult =
  | { success: true; settlement: StandardSettlement; extra: BunningsParseExtra }
  | { success: false; error: string; rawText?: string };

function parseDDMMYYYY(dateStr: string): string {
  const parts = dateStr.trim().split('/');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function extractAmount(text: string): number | null {
  const match = text.match(/-?\d[\d,]*\.?\d*/);
  if (!match) return null;
  return parseFloat(match[0].replace(/,/g, ''));
}

async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  
  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: any) => item.str)
      .join(' ');
    fullText += pageText + '\n';
  }
  
  return fullText;
}

/** Extract all AUD amounts from a text snippet */
function extractAllAudAmounts(text: string): number[] {
  const matches = text.match(/AUD\s*-?[\d,]+\.?\d*/gi) || [];
  return matches.map(m => {
    const num = m.replace(/AUD\s*/i, '').replace(/,/g, '');
    return parseFloat(num);
  }).filter(n => !isNaN(n));
}

function extractInvoiceFromFilename(filename: string): string {
  const invoiceMatch = filename.match(/invoice[_-](\d+)/i);
  if (invoiceMatch) return invoiceMatch[1];
  
  const summaryMatch = filename.match(/summary-of-transactions-(\d+)-(\d{4}-\d{2}-\d{2})/i);
  if (summaryMatch) return `BUN-${summaryMatch[1]}-${summaryMatch[2]}`;
  
  return filename.replace(/\.pdf$/i, '');
}

/**
 * Interpret 1–4 AUD amounts into { exGst, gst, inclGst }
 */
function interpretAmounts(amounts: number[]): { exGst: number; gst: number; inclGst: number } {
  if (amounts.length >= 3) {
    return { exGst: amounts[0], gst: amounts[1], inclGst: amounts[2] };
  } else if (amounts.length === 2) {
    const exGst = amounts[0];
    const inclGst = amounts[1];
    return { exGst, gst: Math.round((inclGst - exGst) * 100) / 100, inclGst };
  } else if (amounts.length === 1) {
    const inclGst = amounts[0];
    const exGst = Math.round(inclGst / 1.1 * 100) / 100;
    return { exGst, gst: Math.round((inclGst - exGst) * 100) / 100, inclGst };
  }
  return { exGst: 0, gst: 0, inclGst: 0 };
}

// ─── Known Mirakl billing row patterns ──────────────────────────────
// Each pattern: [regex, label, sign] — sign: 1 = positive, -1 = negative (fees/refunds)
const ROW_PATTERNS: Array<{ regex: RegExp; label: string; category: 'sales' | 'commission' | 'refund' | 'refund_commission' | 'shipping' | 'subscription' | 'manual_credit' | 'manual_debit' | 'other' }> = [
  { regex: /Payable\s+orders?\s*(?:\([^)]*\)\s*)*((?:AUD\s*-?[\d,.]+[\s]*)+)/i, label: 'Payable orders', category: 'sales' },
  { regex: /Commission\s+on\s+orders?\s*(?:\([^)]*\)\s*)*((?:AUD\s*-?[\d,.]+[\s]*)+)/i, label: 'Commission on orders', category: 'commission' },
  // Matches both "Refunded orders" and "Refund on orders"
  { regex: /Refund(?:ed|s?(?:\s+on)?)\s+orders?\s*(?:\([^)]*\)\s*)*((?:AUD\s*-?[\d,.]+[\s]*)+)/i, label: 'Refunded orders', category: 'refund' },
  // Matches both "Commission on refunded orders" and "Refund on commission"
  { regex: /(?:Commission\s+on\s+refunded\s+orders?|Refunds?\s+on\s+commission)\s*(?:\([^)]*\)\s*)*((?:AUD\s*-?[\d,.]+[\s]*)+)/i, label: 'Commission on refunded orders', category: 'refund_commission' },
  { regex: /(?:Payable\s+)?shipping\s+charges?\s*(?:\([^)]*\)\s*)*((?:AUD\s*-?[\d,.]+[\s]*)+)/i, label: 'Shipping charges', category: 'shipping' },
  { regex: /Subscription\s+amount\s*((?:AUD\s*-?[\d,.]+[\s]*)+)/i, label: 'Subscription amount', category: 'subscription' },
  { regex: /Manual\s+credit\s*(?:\([^)]*\)\s*)*((?:AUD\s*-?[\d,.]+[\s]*)+)/i, label: 'Manual credit', category: 'manual_credit' },
  { regex: /Manual\s+debit\s*(?:\([^)]*\)\s*)*((?:AUD\s*-?[\d,.]+[\s]*)+)/i, label: 'Manual debit', category: 'manual_debit' },
  { regex: /(?:Other|Miscellaneous)\s+(?:charges?|fees?|credits?)\s*(?:\([^)]*\)\s*)*((?:AUD\s*-?[\d,.]+[\s]*)+)/i, label: 'Other charges', category: 'other' },
  { regex: /(?:Late\s+)?delivery\s+(?:charges?|penalties?)\s*(?:\([^)]*\)\s*)*((?:AUD\s*-?[\d,.]+[\s]*)+)/i, label: 'Delivery charges', category: 'other' },
];

/**
 * Parse Bunnings Summary of Transactions PDF → StandardSettlement
 */
export async function parseBunningsSummaryPdf(
  file: File,
  invoiceNumberOverride?: string
): Promise<BunningsParseResult> {
  try {
    const rawText = await extractPdfText(file);
    
    if (!rawText || rawText.trim().length < 50) {
      return { success: false, error: 'Could not extract text from PDF. The file may be image-only or corrupted.', rawText };
    }

    // Extract billing period
    const periodMatch = rawText.match(/(\d{2}\/\d{2}\/\d{4})\s+to\s+(\d{2}\/\d{2}\/\d{4})\s+billing\s+period/i);
    if (!periodMatch) {
      return { success: false, error: 'Could not find billing period dates. Expected: "DD/MM/YYYY to DD/MM/YYYY billing period".', rawText };
    }
    const periodStart = parseDDMMYYYY(periodMatch[1]);
    const periodEnd = parseDDMMYYYY(periodMatch[2]);

    // Extract shop name and ID
    const shopMatch = rawText.match(/Summary of transactions for\s+(.+?)\s+in the/i);
    const shopName = shopMatch ? shopMatch[1].trim() : 'Unknown';
    const shopIdMatch = rawText.match(/\((\d{4,})\)/);
    const shopId = shopIdMatch ? shopIdMatch[1] : '';

    // ─── Extract ALL line items from the summary table ──────────────

    const lineItems: BunningsLineItem[] = [];
    const categoryTotals: Record<string, { exGst: number; gst: number; inclGst: number }> = {};

    for (const pattern of ROW_PATTERNS) {
      const match = rawText.match(pattern.regex);
      if (!match) continue;

      const amounts = extractAllAudAmounts(match[1]);
      if (amounts.length === 0) continue;

      const parsed = interpretAmounts(amounts);

      lineItems.push({
        label: pattern.label,
        exGst: parsed.exGst,
        gst: parsed.gst,
        inclGst: parsed.inclGst,
      });

      if (!categoryTotals[pattern.category]) {
        categoryTotals[pattern.category] = { exGst: 0, gst: 0, inclGst: 0 };
      }
      categoryTotals[pattern.category].exGst += parsed.exGst;
      categoryTotals[pattern.category].gst += parsed.gst;
      categoryTotals[pattern.category].inclGst += parsed.inclGst;
    }

    // ─── Require at least Payable orders ────────────────────────────
    if (!categoryTotals.sales) {
      return { success: false, error: 'Could not find "Payable orders" row in the summary table.', rawText };
    }

    const sales = categoryTotals.sales;
    const commission = categoryTotals.commission || { exGst: 0, gst: 0, inclGst: 0 };
    const refunds = categoryTotals.refund || { exGst: 0, gst: 0, inclGst: 0 };
    const refundCommission = categoryTotals.refund_commission || { exGst: 0, gst: 0, inclGst: 0 };
    const shipping = categoryTotals.shipping || { exGst: 0, gst: 0, inclGst: 0 };
    const subscription = categoryTotals.subscription || { exGst: 0, gst: 0, inclGst: 0 };
    const manualCredit = categoryTotals.manual_credit || { exGst: 0, gst: 0, inclGst: 0 };
    const manualDebit = categoryTotals.manual_debit || { exGst: 0, gst: 0, inclGst: 0 };
    const otherCharges = categoryTotals.other || { exGst: 0, gst: 0, inclGst: 0 };

    // Ensure negative signs on deductions
    const ensureNeg = (n: number) => n > 0 ? -n : n;

    const negCommExGst = ensureNeg(commission.exGst);
    const negCommGst = ensureNeg(commission.gst);
    const negCommInclGst = ensureNeg(commission.inclGst);

    // Refunds on orders are negative (money returned to buyer)
    const negRefundExGst = ensureNeg(refunds.exGst);
    const negRefundGst = ensureNeg(refunds.gst);
    const negRefundInclGst = ensureNeg(refunds.inclGst);

    // Refund on commission is positive (commission clawed back to seller)
    const refundCommExGst = Math.abs(refundCommission.exGst);
    const refundCommGst = Math.abs(refundCommission.gst);
    const refundCommInclGst = Math.abs(refundCommission.inclGst);

    // Subscription always negative
    const negSubAmount = subscription.inclGst > 0 ? -subscription.inclGst : subscription.inclGst;

    // Manual credit positive, manual debit negative
    const manualNet = manualCredit.inclGst + ensureNeg(manualDebit.inclGst);

    // ─── Net fees (commission minus refund on commission) ───────────
    const netFeesExGst = negCommExGst + refundCommExGst;
    const netFeesGst = Math.abs(negCommGst) - refundCommGst; // Absolute GST on fees

    // ─── Total / net payout ────────────────────────────────────────
    let netPayout: number;
    const totalLineMatch = rawText.match(/\bTotal\b[^\n]*?(AUD\s*-?[\d,.]+)\s*(?:\n|$)/im);
    if (totalLineMatch) {
      netPayout = extractAmount(totalLineMatch[1]) ?? 0;
    } else {
      // Calculate from components
      netPayout = Math.round((
        sales.inclGst +
        negCommInclGst +
        negRefundInclGst +
        refundCommInclGst +
        shipping.inclGst +
        negSubAmount +
        manualNet +
        otherCharges.inclGst
      ) * 100) / 100;
    }

    const invoiceNumber = invoiceNumberOverride || extractInvoiceFromFilename(file.name);

    // Reconciliation: sum all line items and compare to net payout
    const calculatedTotal = Math.round((
      sales.inclGst +
      negCommInclGst +
      negRefundInclGst +
      refundCommInclGst +
      shipping.inclGst +
      negSubAmount +
      manualNet +
      otherCharges.inclGst
    ) * 100) / 100;
    const reconciles = Math.abs(calculatedTotal - netPayout) <= 0.10;

    // ─── Build metadata with full breakdown for analytics ──────────
    const metadata: Record<string, any> = {
      shopName,
      shopId,
      // Refunds
      refundsExGst: negRefundExGst,
      refundsGst: negRefundGst,
      refundsInclGst: negRefundInclGst,
      // Refund on commission (seller gets back)
      refundCommissionExGst: refundCommExGst,
      refundCommissionGst: refundCommGst,
      refundCommissionInclGst: refundCommInclGst,
      // Shipping
      shippingExGst: shipping.exGst,
      shippingGst: shipping.gst,
      shippingInclGst: shipping.inclGst,
      // Subscription
      subscriptionAmount: negSubAmount !== 0 ? negSubAmount : undefined,
      // Manual adjustments
      manualCreditInclGst: manualCredit.inclGst !== 0 ? manualCredit.inclGst : undefined,
      manualDebitInclGst: manualDebit.inclGst !== 0 ? ensureNeg(manualDebit.inclGst) : undefined,
      // Other
      otherChargesInclGst: otherCharges.inclGst !== 0 ? otherCharges.inclGst : undefined,
      // Reconciliation detail
      calculatedTotal,
      lineItemCount: lineItems.length,
    };

    const settlement: StandardSettlement = {
      marketplace: 'bunnings',
      settlement_id: invoiceNumber,
      period_start: periodStart,
      period_end: periodEnd,
      sales_ex_gst: sales.exGst,
      gst_on_sales: sales.gst,
      fees_ex_gst: netFeesExGst,
      gst_on_fees: Math.abs(netFeesGst),
      net_payout: netPayout,
      source: 'csv_upload' as const,
      reconciles,
      metadata,
    };

    return {
      success: true,
      settlement,
      extra: {
        shopName,
        shopId,
        ordersInclGst: sales.inclGst,
        commissionInclGst: negCommInclGst,
        rawText,
        lineItems,
      },
    };
  } catch (err: any) {
    return {
      success: false,
      error: `PDF parsing failed: ${err.message || 'Unknown error'}`,
    };
  }
}
