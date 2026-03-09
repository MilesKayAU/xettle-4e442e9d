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

    // Extract financial figures
    // Payable orders: 3 AUD amounts
    const ordersSection = rawText.match(/Payable\s+orders?\s*\(?[^)]*\)?\s*(AUD\s*-?[\d,.]+)\s*(AUD\s*-?[\d,.]+)\s*(AUD\s*-?[\d,.]+)/i);
    if (!ordersSection) {
      return { success: false, error: 'Could not find "Payable orders" row in the summary table.', rawText };
    }
    
    const ordersExGst = extractAmount(ordersSection[1]);
    const ordersGst = extractAmount(ordersSection[2]);
    const ordersInclGst = extractAmount(ordersSection[3]);

    if (ordersExGst === null || ordersGst === null || ordersInclGst === null) {
      return { success: false, error: 'Could not parse Payable orders amounts.', rawText };
    }

    // Commission: 3 AUD amounts
    const commissionSection = rawText.match(/Commission\s+on\s+orders?\s*\(?[^)]*\)?\s*(AUD\s*-?[\d,.]+)\s*(AUD\s*-?[\d,.]+)\s*(AUD\s*-?[\d,.]+)/i);
    if (!commissionSection) {
      return { success: false, error: 'Could not find "Commission on orders" row in the summary table.', rawText };
    }

    const commissionExGst = extractAmount(commissionSection[1]);
    const commissionGst = extractAmount(commissionSection[2]);
    const commissionInclGst = extractAmount(commissionSection[3]);

    if (commissionExGst === null || commissionGst === null || commissionInclGst === null) {
      return { success: false, error: 'Could not parse Commission amounts.', rawText };
    }

    // Ensure commission values are negative (they are deductions)
    const negCommissionExGst = commissionExGst > 0 ? -commissionExGst : commissionExGst;
    const negCommissionGst = commissionGst > 0 ? -commissionGst : commissionGst;
    const negCommissionInclGst = commissionInclGst > 0 ? -commissionInclGst : commissionInclGst;

    // Total / net payout — look for "Total" row that has a single AUD amount at the end
    let netPayout: number;
    const totalLineMatch = rawText.match(/\bTotal\b[^\n]*?(AUD\s*-?[\d,.]+)\s*(?:\n|$)/im);
    if (totalLineMatch) {
      netPayout = extractAmount(totalLineMatch[1]) ?? (ordersInclGst + negCommissionInclGst);
    } else {
      netPayout = ordersInclGst + negCommissionInclGst;
    }

    const invoiceNumber = invoiceNumberOverride || extractInvoiceFromFilename(file.name);

    // Reconciliation: ordersIncl + commission (negative) should ≈ netPayout
    const calculated = Math.round((ordersInclGst + negCommissionInclGst) * 100) / 100;
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
      metadata: { shopName, shopId },
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
