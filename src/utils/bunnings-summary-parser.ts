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

export interface BunningsParseExtra {
  shopName: string;
  shopId: string;
  ordersInclGst: number;
  commissionInclGst: number;
  rawText: string;
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

    // ─── Extract financial figures (flexible: handles 1–4 AUD values per row) ───

    // Find the Payable orders row — grab everything up to the next row label or newline
    const ordersMatch = rawText.match(/Payable\s+orders?\s*\(?[^)]*\)?\s*((?:AUD\s*-?[\d,.]+[\s]*)+)/i);
    if (!ordersMatch) {
      return { success: false, error: 'Could not find "Payable orders" row in the summary table.', rawText };
    }
    const orderAmounts = extractAllAudAmounts(ordersMatch[1]);
    if (orderAmounts.length === 0) {
      return { success: false, error: 'Could not parse Payable orders amounts.', rawText };
    }

    // Interpret based on how many values we got:
    // 1 value  → ex GST only (no tax breakdown)
    // 2 values → ex GST, incl GST (or incl, total — treat last as incl)
    // 3 values → ex GST, GST, incl GST
    // 4 values → ex GST, GST, incl GST, total (Mirakl 5-col format)
    let ordersExGst: number;
    let ordersGst: number;
    let ordersInclGst: number;

    if (orderAmounts.length >= 3) {
      ordersExGst = orderAmounts[0];
      ordersGst = orderAmounts[1];
      ordersInclGst = orderAmounts[2];
    } else if (orderAmounts.length === 2) {
      // Two values: assume ex-GST and incl-GST
      ordersExGst = orderAmounts[0];
      ordersInclGst = orderAmounts[1];
      ordersGst = Math.round((ordersInclGst - ordersExGst) * 100) / 100;
    } else {
      // Single value — could be ex-GST or incl-GST
      // If tax columns were blank, this is likely incl-GST (Bunnings often shows incl only)
      ordersInclGst = orderAmounts[0];
      ordersExGst = Math.round(ordersInclGst / 1.1 * 100) / 100;
      ordersGst = Math.round((ordersInclGst - ordersExGst) * 100) / 100;
    }

    // Commission row
    const commMatch = rawText.match(/Commission\s+on\s+orders?\s*\(?[^)]*\)?\s*((?:AUD\s*-?[\d,.]+[\s]*)+)/i);
    if (!commMatch) {
      return { success: false, error: 'Could not find "Commission on orders" row in the summary table.', rawText };
    }
    const commAmounts = extractAllAudAmounts(commMatch[1]);
    if (commAmounts.length === 0) {
      return { success: false, error: 'Could not parse Commission amounts.', rawText };
    }

    let commissionExGst: number;
    let commissionGst: number;
    let commissionInclGst: number;

    if (commAmounts.length >= 3) {
      commissionExGst = commAmounts[0];
      commissionGst = commAmounts[1];
      commissionInclGst = commAmounts[2];
    } else if (commAmounts.length === 2) {
      commissionExGst = commAmounts[0];
      commissionInclGst = commAmounts[1];
      commissionGst = Math.round((commissionInclGst - commissionExGst) * 100) / 100;
    } else {
      commissionInclGst = commAmounts[0];
      commissionExGst = Math.round(commissionInclGst / 1.1 * 100) / 100;
      commissionGst = Math.round((commissionInclGst - commissionExGst) * 100) / 100;
    }

    // Ensure commission values are negative (they are deductions)
    const negCommissionExGst = commissionExGst > 0 ? -commissionExGst : commissionExGst;
    const negCommissionGst = commissionGst > 0 ? -commissionGst : commissionGst;
    const negCommissionInclGst = commissionInclGst > 0 ? -commissionInclGst : commissionInclGst;

    // ─── Subscription amount (optional — some periods include it) ───
    let subscriptionAmount = 0;
    const subMatch = rawText.match(/Subscription\s+amount\s*((?:AUD\s*-?[\d,.]+[\s]*)+)/i);
    if (subMatch) {
      const subAmounts = extractAllAudAmounts(subMatch[1]);
      // Last amount is typically incl-GST / total
      subscriptionAmount = subAmounts.length > 0 ? subAmounts[subAmounts.length - 1] : 0;
      // Ensure negative
      if (subscriptionAmount > 0) subscriptionAmount = -subscriptionAmount;
    }

    // Total / net payout
    let netPayout: number;
    const totalLineMatch = rawText.match(/\bTotal\b[^\n]*?(AUD\s*-?[\d,.]+)\s*(?:\n|$)/im);
    if (totalLineMatch) {
      netPayout = extractAmount(totalLineMatch[1]) ?? (ordersInclGst + negCommissionInclGst + subscriptionAmount);
    } else {
      netPayout = ordersInclGst + negCommissionInclGst + subscriptionAmount;
    }

    const invoiceNumber = invoiceNumberOverride || extractInvoiceFromFilename(file.name);

    // Reconciliation
    const calculated = Math.round((ordersInclGst + negCommissionInclGst + subscriptionAmount) * 100) / 100;
    const reconciles = Math.abs(calculated - netPayout) <= 0.10;

    const settlement: StandardSettlement = {
      marketplace: 'bunnings',
      settlement_id: invoiceNumber,
      period_start: periodStart,
      period_end: periodEnd,
      sales_ex_gst: ordersExGst,
      gst_on_sales: ordersGst,
      fees_ex_gst: negCommissionExGst,
      gst_on_fees: Math.abs(negCommissionGst),
      net_payout: netPayout,
      source: 'manual',
      reconciles,
      metadata: { shopName, shopId, subscriptionAmount: subscriptionAmount !== 0 ? subscriptionAmount : undefined },
    };

    return {
      success: true,
      settlement,
      extra: { shopName, shopId, ordersInclGst, commissionInclGst: negCommissionInclGst, rawText },
    };
  } catch (err: any) {
    return {
      success: false,
      error: `PDF parsing failed: ${err.message || 'Unknown error'}`,
    };
  }
}
