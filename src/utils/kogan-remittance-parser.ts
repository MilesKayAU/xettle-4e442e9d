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
  /** Period month derived from transfer date or line item dates, e.g. "2026-02" */
  periodMonth?: string;
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
    // Join items with spaces — pdfjs text items represent individual text spans
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
 * Lightweight extraction of AP Invoice doc numbers from a Kogan PDF.
 * Used for pairing CSVs with PDFs without full parsing.
 */
export interface KoganPdfDocInfo {
  docNumbers: string[];
  /** Period month derived from PDF dates, e.g. "2026-02" */
  periodMonth?: string;
}

/**
 * Lightweight extraction of AP Invoice doc numbers + period month from a Kogan PDF.
 * Used for pairing CSVs with PDFs without full parsing.
 */
export async function extractKoganPdfDocNumbers(file: File): Promise<string[]> {
  const info = await extractKoganPdfInfo(file);
  return info.docNumbers;
}

export async function extractKoganPdfInfo(file: File): Promise<KoganPdfDocInfo> {
  try {
    const rawText = await extractPdfText(file);
    const docNumbers: string[] = [];
    const invoiceMatches = rawText.matchAll(/A\/P\s+Invoice\s+(\d+)/gi);
    for (const m of invoiceMatches) {
      if (!docNumbers.includes(m[1])) docNumbers.push(m[1]);
    }

    // Extract period month from Transfer Date (DD/MM/YYYY) or line item dates (M/D/YYYY)
    const norm = rawText.replace(/\s+/g, ' ');
    let periodMonth: string | undefined;

    // Try Transfer Date first (DD/MM/YYYY)
    const transferMatch = norm.match(/Transfer\s+Date:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
    if (transferMatch) {
      periodMonth = `${transferMatch[3]}-${transferMatch[2].padStart(2, '0')}`;
    }

    // Fallback: use first line item date (M/D/YYYY — US format in table)
    if (!periodMonth) {
      const dateMatch = norm.match(/(?:A\/P\s+(?:Invoice|Credit\s+note)|Journal\s+Entry)\s+\d+\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
      if (dateMatch) {
        // In table dates, month is first field (US format)
        periodMonth = `${dateMatch[3]}-${dateMatch[1].padStart(2, '0')}`;
      }
    }

    return { docNumbers, periodMonth };
  } catch {
    return { docNumbers: [] };
  }
}

/**
 * Parse a Kogan Remittance Advice PDF and extract financial summary.
 *
 * pdfjs-dist extracts text as space-separated tokens. The Kogan PDF table
 * has line breaks between columns (reference wraps, amount on next line).
 * We normalise the text first, then use a line-by-line approach to parse
 * the paid documents table.
 */
export async function parseKoganRemittancePdf(file: File): Promise<KoganRemittanceResult> {
  const empty: Omit<KoganRemittanceResult, 'success' | 'error'> = {
    lineItems: [], invoiceTotal: 0, creditNoteTotal: 0,
    advertisingFees: 0, monthlySellerFee: 0, returnsCreditNotes: 0,
  };

  try {
    const rawText = await extractPdfText(file);

    if (!rawText || rawText.trim().length < 30) {
      return { ...empty, success: false, error: 'Could not extract text from PDF.', rawText };
    }

    // Normalise: collapse whitespace (including newlines) to single spaces for regex matching
    const norm = rawText.replace(/\s+/g, ' ');

    // Extract remittance number from title
    const remittanceMatch = norm.match(/Remittance\s+Advice\s*-?\s*#?\s*(\d+)/i);
    const remittanceNumber = remittanceMatch?.[1] || '';

    // Extract dates — Kogan uses DD/MM/YYYY in header
    const transferMatch = norm.match(/Transfer\s+Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    const paymentMatch = norm.match(/Payment\s+Date:\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    // These header dates are DD/MM/YYYY — convert directly
    const transferDate = transferMatch ? (() => {
      const p = transferMatch[1].split('/');
      return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
    })() : '';
    const paymentDate = paymentMatch ? (() => {
      const p = paymentMatch[1].split('/');
      return `${p[2]}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
    })() : '';

    // Extract total paid amount — may or may not have colon
    const totalMatch = norm.match(/Total\s+paid\s+amount:?\s*([\d,]+\.?\d*)\s*AUD/i);
    const totalPaidAmount = totalMatch ? parseAmount(totalMatch[1]) : undefined;

    // ── Parse paid documents table ──
    // Strategy: find each document type marker and capture doc number, date, then
    // scan forward for the amount. The text is normalised to single line.
    const lineItems: KoganRemittanceLineItem[] = [];

    // Match all document entries: Journal Entry, A/P Invoice, A/P Credit note
    // Pattern captures: type, doc number, date, then everything up to the amount
    const docPattern = /(?:(\d+)\s+)?(Journal\s+Entry|A\/P\s+Invoice|A\/P\s+Credit\s+note)\s+(\d+)\s+(\d{1,2}\/\d{1,2}\/\d{4})\s+(.*?)(-?[\d,]+\.?\d*)\s*(?:AUD)?/gi;
    
    // We need to be more careful — the reference field can contain anything.
    // Let's find document entries by splitting on the known markers.
    const markers = [
      ...norm.matchAll(/(?:^|\s)(\d+)\s+(Journal\s+Entry|A\/P\s+Invoice|A\/P\s+Credit\s+note)\s+(\d+)\s+(\d{1,2}\/\d{1,2}\/\d{4})/gi)
    ];

    for (let i = 0; i < markers.length; i++) {
      const m = markers[i];
      const type = m[2].replace(/\s+/g, ' ');
      const docNumber = m[3];
      const date = m[4];
      
      // Get text between this match end and next match start (or Total paid amount)
      const startIdx = m.index! + m[0].length;
      const endIdx = i + 1 < markers.length 
        ? markers[i + 1].index! 
        : norm.indexOf('Total paid amount', startIdx);
      const segment = (endIdx > startIdx ? norm.substring(startIdx, endIdx) : norm.substring(startIdx)).trim();
      
      // Extract amount from the segment — it's the last number (possibly with AUD)
      const amountMatch = segment.match(/(-?[\d,]+\.?\d*)\s*(?:AUD)?\s*$/);
      const rawAmount = amountMatch ? parseAmount(amountMatch[1]) : 0;
      
      // Reference is everything before the amount
      let reference = amountMatch 
        ? segment.substring(0, segment.lastIndexOf(amountMatch[0])).trim()
        : segment.trim();
      
      // Clean up reference
      reference = reference.replace(/\s+/g, ' ').trim();
      
      // Determine sign
      let amount: number;
      if (type.toLowerCase() === 'journal entry') {
        amount = -Math.abs(rawAmount); // Journal entries are deductions
      } else if (type.toLowerCase().includes('credit note')) {
        amount = -Math.abs(rawAmount); // Credit notes are deductions
      } else {
        amount = Math.abs(rawAmount); // Invoices are positive
      }

      lineItems.push({ type, docNumber, date, reference, amount });
    }

    // Categorise amounts
    let invoiceTotal = 0;
    let creditNoteTotal = 0;
    let advertisingFees = 0;
    let monthlySellerFee = 0;
    let returnsCreditNotes = 0;

    for (const item of lineItems) {
      if (item.type.toLowerCase().includes('invoice')) {
        invoiceTotal += item.amount;
      } else if (item.type.toLowerCase().includes('journal')) {
        advertisingFees += item.amount; // negative
      } else if (item.type.toLowerCase().includes('credit note')) {
        creditNoteTotal += item.amount; // negative
        if (item.reference.toLowerCase().includes('monthly seller fee') || 
            item.reference.toLowerCase().includes('monthly fee')) {
          monthlySellerFee += Math.abs(item.amount);
        } else {
          returnsCreditNotes += Math.abs(item.amount);
        }
      }
    }

    console.log('[Kogan PDF] Parsed', lineItems.length, 'line items. Total paid:', totalPaidAmount, 
      'Invoice total:', invoiceTotal, 'Credits:', creditNoteTotal, 'Ad fees:', advertisingFees);

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
      ...empty,
      success: false,
      error: `Kogan PDF parsing failed: ${err.message || 'Unknown error'}`,
    };
  }
}
