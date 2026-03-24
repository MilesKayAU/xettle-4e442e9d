/**
 * Kogan Remittance Advice PDF Parser
 *
 * Extracts financial data from the Kogan "Remittance Advice" PDF.
 * This PDF contains data NOT in the CSV:
 *  - Returns / credit notes
 *  - Monthly seller fees
 *  - Advertising fees
 *  - Actual bank deposit (Total paid amount)
 *
 * Used to augment the Kogan CSV settlement with the correct net payout.
 */

import * as pdfjsLib from 'pdfjs-dist';

// Configure worker (same as bunnings parser)
pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

// ─── Types ──────────────────────────────────────────────────────────

export interface KoganRemittanceLineItem {
  type: string;        // 'Journal Entry', 'A/P Invoice', 'A/P Credit note'
  docNumber: string;   // e.g. '360140', '284452'
  date: string;        // e.g. '2/28/2026'
  reference: string;   // e.g. 'Advertising fees - Feb 2026'
  amount: number;      // signed: positive for invoices, negative for credits/journals
}

export interface KoganRemittanceResult {
  success: boolean;
  remittanceNumber?: string;       // e.g. '3599603'
  transferDate?: string;           // ISO date
  paymentDate?: string;            // ISO date
  lineItems: KoganRemittanceLineItem[];
  totalPaidAmount?: number;        // Bank deposit amount
  /** Breakdown of adjustments */
  invoiceTotal: number;            // Sum of A/P Invoice amounts
  creditNoteTotal: number;         // Sum of A/P Credit note amounts (positive = deduction)
  advertisingFees: number;         // Sum of Journal Entry amounts (usually negative)
  monthlySellerFee: number;        // From "Monthly Seller Fee" credit note
  returnsCreditNotes: number;      // Non-fee credit notes (returns)
  error?: string;
  rawText?: string;
}

async function extractPdfText(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let fullText = '';
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((item: any) => item.str).join(' ');
    fullText += pageText + '\n';
  }
  return fullText;
}

function parseAmount(raw: string): number {
  const cleaned = raw.replace(/[^0-9.\-,]/g, '').replace(/,/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

function parseDateToISO(raw: string): string {
  // Handle M/D/YYYY or MM/DD/YYYY format (Kogan uses US date format in PDF)
  const match = raw.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!match) return '';
  const month = match[1].padStart(2, '0');
  const day = match[2].padStart(2, '0');
  return `${match[3]}-${month}-${day}`;
}

/**
 * Parse a Kogan Remittance Advice PDF and extract financial summary.
 */
/**
 * Lightweight extraction of AP Invoice doc numbers from a Kogan PDF.
 * Used for pairing CSVs with PDFs without full parsing.
 */
export async function extractKoganPdfDocNumbers(file: File): Promise<string[]> {
  try {
    const rawText = await extractPdfText(file);
    const docNumbers: string[] = [];
    const invoiceMatches = rawText.matchAll(/A\/P\s+Invoice\s+(\d+)/gi);
    for (const m of invoiceMatches) {
      if (!docNumbers.includes(m[1])) docNumbers.push(m[1]);
    }
    return docNumbers;
  } catch {
    return [];
  }
}

export async function parseKoganRemittancePdf(file: File): Promise<KoganRemittanceResult> {
  try {
    const rawText = await extractPdfText(file);

    if (!rawText || rawText.trim().length < 30) {
      return { success: false, error: 'Could not extract text from PDF.', rawText, lineItems: [], invoiceTotal: 0, creditNoteTotal: 0, advertisingFees: 0, monthlySellerFee: 0, returnsCreditNotes: 0 };
    }

    // Extract remittance number from title
    const remittanceMatch = rawText.match(/Remittance\s+Advice\s*-?\s*#?\s*(\d+)/i);
    const remittanceNumber = remittanceMatch?.[1] || '';

    // Extract dates
    const transferMatch = rawText.match(/Transfer\s+Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    const paymentMatch = rawText.match(/Payment\s+Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    const transferDate = transferMatch ? parseDateToISO(transferMatch[1]) : '';
    const paymentDate = paymentMatch ? parseDateToISO(paymentMatch[1]) : '';

    // Extract total paid amount
    const totalMatch = rawText.match(/Total\s+paid\s+amount:\s*([\d,]+\.?\d*)\s*AUD/i);
    const totalPaidAmount = totalMatch ? parseAmount(totalMatch[1]) : undefined;

    // Parse line items from the paid documents table
    // Pattern: # | Type | Doc No | Date | Reference | Amount
    const lineItems: KoganRemittanceLineItem[] = [];

    // Match Journal Entry lines (advertising fees etc.)
    const journalMatches = rawText.matchAll(/Journal\s+Entry\s+(\d+)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(.*?)\s+(-?[\d,]+\.?\d*)/gi);
    for (const m of journalMatches) {
      lineItems.push({
        type: 'Journal Entry',
        docNumber: m[1],
        date: m[2],
        reference: m[3].trim(),
        amount: -Math.abs(parseAmount(m[4])), // Journal entries are deductions
      });
    }

    // Match A/P Invoice lines
    const invoiceMatches = rawText.matchAll(/A\/P\s+Invoice\s+(\d+)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(.*?)\s+([\d,]+\.?\d*)\s*AUD/gi);
    for (const m of invoiceMatches) {
      lineItems.push({
        type: 'A/P Invoice',
        docNumber: m[1],
        date: m[2],
        reference: m[3].trim(),
        amount: parseAmount(m[4]), // Invoices are positive
      });
    }

    // Match A/P Credit note lines
    const creditMatches = rawText.matchAll(/A\/P\s+Credit\s+note\s+(\d+)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(.*?)\s+([\d,]+\.?\d*)\s*AUD/gi);
    for (const m of creditMatches) {
      lineItems.push({
        type: 'A/P Credit note',
        docNumber: m[1],
        date: m[2],
        reference: m[3].trim(),
        amount: -Math.abs(parseAmount(m[4])), // Credit notes are deductions
      });
    }

    // Categorise amounts
    let invoiceTotal = 0;
    let creditNoteTotal = 0;
    let advertisingFees = 0;
    let monthlySellerFee = 0;
    let returnsCreditNotes = 0;

    for (const item of lineItems) {
      if (item.type === 'A/P Invoice') {
        invoiceTotal += item.amount;
      } else if (item.type === 'Journal Entry') {
        advertisingFees += item.amount; // negative
      } else if (item.type === 'A/P Credit note') {
        creditNoteTotal += item.amount; // negative
        if (item.reference.toLowerCase().includes('monthly seller fee') || item.reference.toLowerCase().includes('monthly fee')) {
          monthlySellerFee += Math.abs(item.amount);
        } else {
          returnsCreditNotes += Math.abs(item.amount);
        }
      }
    }

    return {
      success: lineItems.length > 0,
      remittanceNumber,
      transferDate,
      paymentDate,
      lineItems,
      totalPaidAmount,
      invoiceTotal,
      creditNoteTotal,
      advertisingFees,
      monthlySellerFee,
      returnsCreditNotes,
      rawText,
    };
  } catch (err: any) {
    return {
      success: false,
      error: `Kogan PDF parsing failed: ${err.message || 'Unknown error'}`,
      lineItems: [],
      invoiceTotal: 0,
      creditNoteTotal: 0,
      advertisingFees: 0,
      monthlySellerFee: 0,
      returnsCreditNotes: 0,
    };
  }
}
