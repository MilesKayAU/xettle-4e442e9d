/**
 * Bunnings (Mirakl) Summary of Transactions PDF Parser
 * 
 * Extracts key financial data from the "Summary of transactions" PDF
 * that Bunnings generates each fortnightly billing cycle.
 * 
 * Expected PDF text structure:
 *   "Summary of transactions for {SHOP_NAME} in the DD/MM/YYYY to DD/MM/YYYY billing period"
 *   Table with: Payable orders | Commission on orders | Total
 *   Each row has: Excl. taxes | Taxes | Incl. taxes columns
 */

import * as pdfjsLib from 'pdfjs-dist';

// Configure worker
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

export interface ParsedBunningsSettlement {
  shopName: string;
  shopId: string; // e.g. "2301" from "MILES KAY AUSTRALIA (2301)"
  periodStart: string; // YYYY-MM-DD
  periodEnd: string;   // YYYY-MM-DD
  invoiceNumber: string; // from filename or document
  ordersExGst: number;
  ordersGst: number;
  ordersInclGst: number;
  commissionExGst: number; // negative
  commissionGst: number;   // negative
  commissionInclGst: number; // negative
  netPayout: number;
  reconciles: boolean; // ordersInclGst + commissionInclGst ≈ netPayout
  orderCount?: number;
  rawText: string;
}

export interface BunningsParseError {
  success: false;
  error: string;
  rawText?: string;
}

export type BunningsParseResult =
  | { success: true; data: ParsedBunningsSettlement }
  | BunningsParseError;

/**
 * Parse a date string like "15/02/2026" to "2026-02-15"
 */
function parseDDMMYYYY(dateStr: string): string {
  const parts = dateStr.trim().split('/');
  if (parts.length !== 3) return dateStr;
  return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

/**
 * Extract a number from text like "AUD 805.41" or "AUD -100.63" or just "805.41"
 */
function extractAmount(text: string): number | null {
  const match = text.match(/-?\d[\d,]*\.?\d*/);
  if (!match) return null;
  return parseFloat(match[0].replace(/,/g, ''));
}

/**
 * Extract the full text content from a PDF file
 */
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

/**
 * Try to extract invoice number from filename pattern:
 * "summary-of-transactions-2301-2026-02-27.pdf"
 * or from invoice PDF filename like "invoice-000000267906.pdf"
 */
function extractInvoiceFromFilename(filename: string): string {
  // Pattern: invoice-NNNNNN.pdf
  const invoiceMatch = filename.match(/invoice[_-](\d+)/i);
  if (invoiceMatch) return invoiceMatch[1];
  
  // Pattern: summary-of-transactions-SHOPID-DATE.pdf — use shopId + date as ID
  const summaryMatch = filename.match(/summary-of-transactions-(\d+)-(\d{4}-\d{2}-\d{2})/i);
  if (summaryMatch) return `BUN-${summaryMatch[1]}-${summaryMatch[2]}`;
  
  // Fallback: use filename without extension
  return filename.replace(/\.pdf$/i, '');
}

/**
 * Main parser: takes a PDF File and optional filename hint, returns parsed settlement
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

    // --- Extract billing period ---
    // "in the 15/02/2026 to 28/02/2026 billing period"
    const periodMatch = rawText.match(/(\d{2}\/\d{2}\/\d{4})\s+to\s+(\d{2}\/\d{2}\/\d{4})\s+billing\s+period/i);
    if (!periodMatch) {
      return { success: false, error: 'Could not find billing period dates in the PDF. Expected format: "DD/MM/YYYY to DD/MM/YYYY billing period".', rawText };
    }
    const periodStart = parseDDMMYYYY(periodMatch[1]);
    const periodEnd = parseDDMMYYYY(periodMatch[2]);

    // --- Extract shop name and ID ---
    // "Summary of transactions for SHOP NAME in the..."
    const shopMatch = rawText.match(/Summary of transactions for\s+(.+?)\s+in the/i);
    const shopName = shopMatch ? shopMatch[1].trim() : 'Unknown';

    // "(2301)" pattern for shop ID
    const shopIdMatch = rawText.match(/\((\d{4,})\)/);
    const shopId = shopIdMatch ? shopIdMatch[1] : '';

    // --- Extract financial figures from the summary table ---
    // We need: Payable orders row and Commission row
    // The text typically flows as: "Payable orders (1) AUD 805.41 AUD 80.58 AUD 885.99"
    
    // Payable orders: extract 3 AUD amounts after "Payable orders"
    const ordersSection = rawText.match(/Payable\s+orders?\s*\(?[^)]*\)?\s*(AUD\s*-?[\d,.]+)\s*(AUD\s*-?[\d,.]+)\s*(AUD\s*-?[\d,.]+)/i);
    if (!ordersSection) {
      return { success: false, error: 'Could not find "Payable orders" row in the PDF summary table.', rawText };
    }
    
    const ordersExGst = extractAmount(ordersSection[1]);
    const ordersGst = extractAmount(ordersSection[2]);
    const ordersInclGst = extractAmount(ordersSection[3]);

    if (ordersExGst === null || ordersGst === null || ordersInclGst === null) {
      return { success: false, error: 'Could not parse Payable orders amounts.', rawText };
    }

    // Commission: extract 3 AUD amounts after "Commission"
    const commissionSection = rawText.match(/Commission\s+on\s+orders?\s*\(?[^)]*\)?\s*(AUD\s*-?[\d,.]+)\s*(AUD\s*-?[\d,.]+)\s*(AUD\s*-?[\d,.]+)/i);
    if (!commissionSection) {
      return { success: false, error: 'Could not find "Commission on orders" row in the PDF summary table.', rawText };
    }

    const commissionExGst = extractAmount(commissionSection[1]);
    const commissionGst = extractAmount(commissionSection[2]);
    const commissionInclGst = extractAmount(commissionSection[3]);

    if (commissionExGst === null || commissionGst === null || commissionInclGst === null) {
      return { success: false, error: 'Could not parse Commission amounts.', rawText };
    }

    // Total / net payout
    const totalMatch = rawText.match(/Total\s+(?:.*?)(AUD\s*-?[\d,.]+)\s*$/im);
    let netPayout: number;
    if (totalMatch) {
      netPayout = extractAmount(totalMatch[1]) ?? 0;
    } else {
      // Fallback: calculate from orders + commission
      netPayout = ordersInclGst + commissionInclGst;
    }

    // Invoice number
    const invoiceNumber = invoiceNumberOverride || extractInvoiceFromFilename(file.name);

    // Reconciliation check: orders incl + commission incl should equal net payout (within ±$0.05)
    const calculated = Math.round((ordersInclGst + commissionInclGst) * 100) / 100;
    const reconciles = Math.abs(calculated - netPayout) <= 0.05;

    return {
      success: true,
      data: {
        shopName,
        shopId,
        periodStart,
        periodEnd,
        invoiceNumber,
        ordersExGst,
        ordersGst,
        ordersInclGst,
        commissionExGst,
        commissionGst,
        commissionInclGst,
        netPayout,
        reconciles,
        rawText,
      }
    };
  } catch (err: any) {
    return {
      success: false,
      error: `PDF parsing failed: ${err.message || 'Unknown error'}`,
    };
  }
}

/**
 * Format a number as AUD currency string
 */
export function formatAUD(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}
