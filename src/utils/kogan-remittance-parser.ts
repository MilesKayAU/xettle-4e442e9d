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

// Configure worker for pdfjs-dist v4
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString();

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
  /** Period month derived from A/P Invoice reference, e.g. "2026-02" */
  periodMonth?: string;
  /** Exact A/P Invoice date from reference code, e.g. "2026-02-28" */
  invoiceDate?: string;
  lineItems: KoganRemittanceLineItem[];
  totalPaidAmount?: number;        // Bank deposit amount (THIS IS THE AUTHORITATIVE BANK DEPOSIT)
  /** Breakdown of adjustments */
  invoiceTotal: number;            // Sum of A/P Invoice amounts (gross pre-deduction)
  creditNoteTotal: number;         // Sum of A/P Credit note amounts (positive = deduction)
  advertisingFees: number;         // Sum of Journal Entry amounts (usually negative)
  monthlySellerFee: number;        // From "Monthly Seller Fee" credit note
  monthlyFeePerOrder: number;      // From "Monthly Fee per Order" credit notes
  returnsCreditNotes: number;      // Non-fee credit notes (returns)
  /** AP Invoice doc number — used to link CSV ↔ PDF */
  apInvoiceRef?: string;
  error?: string;
  rawText?: string;
}

async function extractPdfText(file: File): Promise<string> {
  console.log('[Kogan PDF] extractPdfText called', { name: file.name, size: file.size, type: file.type });
  try {
    const arrayBuffer = await file.arrayBuffer();
    console.log('[Kogan PDF] arrayBuffer obtained, byteLength:', arrayBuffer.byteLength);
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    console.log('[Kogan PDF] getDocument resolved, numPages:', pdf.numPages);

    let fullText = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      const pageText = content.items.map((item: any) => item.str).join(' ');
      fullText += pageText + '\n';
    }
    console.log('[Kogan PDF] extracted text length:', fullText.length);
    return fullText;
  } catch (e: any) {
    console.error('[Kogan PDF] extractPdfText FAILED:', e?.message, e?.stack);
    throw e;
  }
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

    // Extract period month — use A/P Invoice reference (AUMKA:KOG:AU:YYYYMMDD) as primary
    // source, NOT the Transfer Date (which is the payment date and may fall in a different month)
    const norm = rawText.replace(/\s+/g, ' ');
    let periodMonth: string | undefined;

    // Priority 1: A/P Invoice reference code (e.g. AUMKA:KOG:AU:20260228 → 2026-02)
    const refMatch = norm.match(/AUMKA:KOG:AU:(\d{4})(\d{2})\d{2}/i);
    if (refMatch) {
      periodMonth = `${refMatch[1]}-${refMatch[2]}`;
    }

    // Priority 2: A/P Invoice date (M/D/YYYY — US format in table)
    if (!periodMonth) {
      const invoiceDateMatch = norm.match(/A\/P\s+Invoice\s+\d+\s+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
      if (invoiceDateMatch) {
        periodMonth = `${invoiceDateMatch[3]}-${invoiceDateMatch[1].padStart(2, '0')}`;
      }
    }

    // Priority 3: Transfer Date (DD/MM/YYYY) as last resort
    if (!periodMonth) {
      const transferMatch = norm.match(/Transfer\s+Date:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
      if (transferMatch) {
        periodMonth = `${transferMatch[3]}-${transferMatch[2].padStart(2, '0')}`;
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
// ─── Kogan CSV Parser ─────────────────────────────────────────────

interface KoganCsvParseResult {
  success: boolean;
  settlements: import('@/utils/settlement-engine').StandardSettlement[];
  error?: string;
}

/**
 * Parse a Kogan payout CSV into StandardSettlement objects.
 *
 * The CSV has columns like: APInvoice, InvoiceDate, DateManifested, DateRemitted,
 * OrderID, Total (AUD), Commission (Inc GST), Remitted, etc.
 *
 * Rows are grouped by APInvoice number. Non-data rows (separators, headers,
 * credit note labels, monthly fee lines) are filtered out.
 */
export function parseKoganPayoutCSV(csvText: string): KoganCsvParseResult {
  const lines = csvText.split(/\r?\n/);
  if (lines.length < 2) return { success: false, settlements: [], error: 'Empty CSV' };

  // ── Split CSV into Section 1 (order rows) and Section 2 (fee rows) ──
  // Section 2 starts after a "Claim details below" marker or dashed separator
  let section1Lines: string[] = [];
  let section2Lines: string[] = [];
  let inSection2 = false;
  for (const line of lines) {
    if (!inSection2 && /claim\s+details\s+below/i.test(line)) {
      inSection2 = true;
      continue;
    }
    if (inSection2) {
      section2Lines.push(line);
    } else {
      section1Lines.push(line);
    }
  }

  // ── Section 1: Order rows ──
  let headerIdx = -1;
  for (let i = 0; i < Math.min(30, section1Lines.length); i++) {
    const lower = section1Lines[i].toLowerCase();
    if (lower.includes('apinvoice') || lower.includes('ap invoice') || lower.includes('invoicedate')) {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) return { success: false, settlements: [], error: 'Could not find Kogan CSV header row' };

  const headers = parseCSVLine(section1Lines[headerIdx]);
  const colIdx = (name: string) => headers.findIndex(h => h.trim().toLowerCase().replace(/\s+/g, '') === name.toLowerCase().replace(/\s+/g, ''));

  const iAPInvoice = colIdx('APInvoice');
  const iInvoiceDate = colIdx('InvoiceDate');
  const iDateManifested = colIdx('DateManifested');
  const iDateRemitted = colIdx('DateRemitted');
  const iTotal = headers.findIndex(h => /^total(\s*\(.*\))?$/i.test(h.trim()) || /total.*aud/i.test(h.trim()));
  const iCommission = headers.findIndex(h => /commission.*inc.*gst/i.test(h.trim()));
  const iRemitted = colIdx('Remitted');
  const iGST = headers.findIndex(h => /gst/i.test(h.trim()) && !/commission/i.test(h.trim()));

  if (iAPInvoice < 0) return { success: false, settlements: [], error: 'APInvoice column not found' };

  interface KoganRow {
    apInvoice: string;
    invoiceDate: string;
    dateManifested: string;
    dateRemitted: string;
    total: number;
    commission: number;
    remitted: number;
    gst: number;
  }

  const JUNK_PATTERNS = [/^-{3,}/, /^apcreditnote$/i, /^monthly\s+marketplace/i, /^monthly\s+seller/i, /^ungrouped$/i, /^$/];

  const rows: KoganRow[] = [];
  for (let i = headerIdx + 1; i < section1Lines.length; i++) {
    const line = section1Lines[i].trim();
    if (!line) continue;
    // Stop at dashed separator (boundary before section 2 if no "Claim details" marker)
    if (/^-{3,}/.test(line)) break;

    const cols = parseCSVLine(line);
    const apVal = (cols[iAPInvoice] || '').trim();

    if (JUNK_PATTERNS.some(p => p.test(apVal))) continue;
    if (!/^\d{3,}$/.test(apVal)) continue;

    const getNum = (idx: number) => {
      if (idx < 0 || idx >= cols.length) return 0;
      const v = parseFloat(cols[idx].replace(/[^0-9.\-]/g, ''));
      return isNaN(v) ? 0 : v;
    };
    const getStr = (idx: number) => (idx >= 0 && idx < cols.length) ? cols[idx].trim() : '';

    rows.push({
      apInvoice: apVal,
      invoiceDate: getStr(iInvoiceDate),
      dateManifested: getStr(iDateManifested),
      dateRemitted: getStr(iDateRemitted),
      total: getNum(iTotal),
      commission: getNum(iCommission),
      remitted: getNum(iRemitted),
      gst: getNum(iGST),
    });
  }

  if (rows.length === 0) return { success: false, settlements: [], error: 'No valid Kogan data rows found' };

  // ── Section 2: Transaction fee rows (APCreditNote) ──
  let totalTransactionFees = 0;
  let transactionFeeCount = 0;
  let creditNoteNumber = '';
  if (section2Lines.length > 0) {
    // Find header row in section 2
    let feeHeaderIdx = -1;
    for (let i = 0; i < Math.min(10, section2Lines.length); i++) {
      const lower = section2Lines[i].toLowerCase();
      if (lower.includes('apcreditnote') || lower.includes('creditnoteref') || lower.includes('price')) {
        feeHeaderIdx = i;
        break;
      }
    }
    if (feeHeaderIdx >= 0) {
      const feeHeaders = parseCSVLine(section2Lines[feeHeaderIdx]);
      const feeColIdx = (name: string) => feeHeaders.findIndex(h =>
        h.trim().toLowerCase().replace(/\s+/g, '') === name.toLowerCase().replace(/\s+/g, ''));

      const iCreditNote = feeColIdx('APCreditNote');
      const iSku = feeColIdx('SKU');
      const iPrice = feeHeaders.findIndex(h => /^price$/i.test(h.trim()));
      const iGstAmount = feeHeaders.findIndex(h => /gst\s*amount/i.test(h.trim()));
      const iFeeTotal = feeHeaders.findIndex(h => /^total$/i.test(h.trim()));

      for (let i = feeHeaderIdx + 1; i < section2Lines.length; i++) {
        const line = section2Lines[i].trim();
        if (!line) continue;
        if (/^-{3,}/.test(line)) continue;

        const cols = parseCSVLine(line);
        // Capture credit note number
        if (iCreditNote >= 0 && !creditNoteNumber) {
          const cn = (cols[iCreditNote] || '').trim();
          if (/^\d{3,}$/.test(cn)) creditNoteNumber = cn;
        }

        // CRITICAL: Only sum rows with SKU = "MKT_FEE" (transaction fees).
        // Section 2 can also contain return credit notes and commission refunds
        // which are NOT transaction fees and must be excluded.
        const sku = iSku >= 0 ? (cols[iSku] || '').trim() : '';
        if (sku && !/^MKT_FEE$/i.test(sku)) continue;

        // Sum fee amounts — prefer Total column, fallback to Price + GST Amount
        let feeAmount = 0;
        if (iFeeTotal >= 0 && cols[iFeeTotal]) {
          const v = parseFloat((cols[iFeeTotal] || '').replace(/[^0-9.\-]/g, ''));
          if (!isNaN(v)) feeAmount = Math.abs(v);
        } else {
          const price = iPrice >= 0 ? parseFloat((cols[iPrice] || '').replace(/[^0-9.\-]/g, '')) : 0;
          const gst = iGstAmount >= 0 ? parseFloat((cols[iGstAmount] || '').replace(/[^0-9.\-]/g, '')) : 0;
          feeAmount = Math.abs(isNaN(price) ? 0 : price) + Math.abs(isNaN(gst) ? 0 : gst);
        }
        if (feeAmount > 0) {
          totalTransactionFees += feeAmount;
          transactionFeeCount++;
        }
      }
    }
  }
  totalTransactionFees = round2(totalTransactionFees);

  console.log(`[Kogan CSV] Parsed ${rows.length} order rows, ${transactionFeeCount} fee rows. Transaction fees: $${totalTransactionFees}`);

  // ── Group order rows by APInvoice ──
  const groups = new Map<string, KoganRow[]>();
  for (const r of rows) {
    const existing = groups.get(r.apInvoice) || [];
    existing.push(r);
    groups.set(r.apInvoice, existing);
  }

  const settlements: import('@/utils/settlement-engine').StandardSettlement[] = [];

  // Distribute transaction fees proportionally across AP Invoice groups
  let grandTotalRemitted = 0;
  for (const gRows of groups.values()) {
    for (const r of gRows) grandTotalRemitted += r.remitted;
  }

  for (const [apInvoice, gRows] of groups) {
    let periodDate: Date | null = null;
    for (const r of gRows) {
      for (const dateStr of [r.invoiceDate, r.dateManifested, r.dateRemitted]) {
        if (!dateStr) continue;
        const d = tryParseDate(dateStr);
        if (d) { periodDate = d; break; }
      }
      if (periodDate) break;
    }

    if (!periodDate) {
      console.warn(`[Kogan CSV] Skipping APInvoice ${apInvoice} — no parseable date`);
      continue;
    }

    const year = periodDate.getFullYear();
    const month = periodDate.getMonth();
    const periodStart = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month + 1, 0).getDate();
    const periodEnd = `${year}-${String(month + 1).padStart(2, '0')}-${lastDay}`;
    const periodLabel = `Kogan ${new Date(year, month).toLocaleString('en-AU', { month: 'short', year: 'numeric' })}`;

    // Sum financials — ALL GST-inclusive to match bank deposit
    let totalSalesInclGst = 0;
    let totalCommissionInclGst = 0;
    let totalRemitted = 0;
    let totalGstOnSales = 0;
    for (const r of gRows) {
      totalSalesInclGst += r.total;
      totalCommissionInclGst += Math.abs(r.commission);
      totalRemitted += r.remitted;
      totalGstOnSales += r.gst;
    }

    // Proportional share of transaction fees for this AP Invoice group
    const feeShare = grandTotalRemitted > 0
      ? round2(totalTransactionFees * (totalRemitted / grandTotalRemitted))
      : 0;

    // bank_deposit = Remitted - proportional transaction fees
    const bankDeposit = round2(totalRemitted - feeShare);

    // Store GST-inclusive values so reconciliation formula works:
    // sales_principal(incl GST) - abs(seller_fees incl GST) - abs(other_fees) = bank_deposit
    // 784.10 - 103.37 - 17.58 = 663.15 ✅
    const salesPrincipal = round2(totalSalesInclGst);
    const sellerFees = round2(totalCommissionInclGst);

    // GST breakdown for BAS (informational, not in reconciliation formula)
    const gstOnSales = round2(totalGstOnSales);
    const commissionGst = round2(totalCommissionInclGst - (totalCommissionInclGst / 1.1));

    settlements.push({
      marketplace: 'kogan',
      settlement_id: `kogan_${apInvoice}`,
      period_start: periodStart,
      period_end: periodEnd,
      // sales_ex_gst maps to sales_principal in DB — store GST-inclusive
      // so reconciliation formula (sales_principal - fees - other_fees) = bank_deposit
      sales_ex_gst: salesPrincipal,
      gst_on_sales: gstOnSales,
      fees_ex_gst: -sellerFees,
      gst_on_fees: commissionGst,
      net_payout: bankDeposit,
      source: 'csv_upload',
      reconciles: Math.abs((salesPrincipal - sellerFees - feeShare) - bankDeposit) <= 1,
      metadata: {
        apInvoiceNumber: apInvoice,
        orderCount: gRows.length,
        periodMonth: `${year}-${String(month + 1).padStart(2, '0')}`,
        periodLabel,
        currency: 'AUD',
        // Transaction fees stored here for settlement engine to pick up as other_fees
        otherChargesInclGst: feeShare,
        transactionFeeTotal: totalTransactionFees,
        transactionFeeCount,
        creditNoteNumber: creditNoteNumber || undefined,
        // GST note: sales_principal is GST-inclusive for Kogan reconciliation
        gstModel: 'inclusive',
      },
    });
  }

  return { success: settlements.length > 0, settlements, error: settlements.length === 0 ? 'No valid settlement groups parsed' : undefined };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Parse a single CSV line handling quoted fields */
function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

/** Try parsing date in DD/MM/YYYY, YYYY-MM-DD, YYYYMMDD, or M/D/YYYY formats */
function tryParseDate(s: string): Date | null {
  if (!s) return null;
  const trimmed = s.trim();
  // YYYYMMDD (compact — Kogan CSVs use this, e.g. 20260315)
  let m = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) {
    const d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    if (!isNaN(d.getTime())) return d;
  }
  // DD/MM/YYYY
  m = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) {
    const d = new Date(parseInt(m[3]), parseInt(m[2]) - 1, parseInt(m[1]));
    if (!isNaN(d.getTime())) return d;
  }
  // YYYY-MM-DD
  m = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const d = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]));
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

export async function parseKoganRemittancePdf(file: File): Promise<KoganRemittanceResult> {
  const empty: Omit<KoganRemittanceResult, 'success' | 'error'> = {
    lineItems: [], invoiceTotal: 0, creditNoteTotal: 0,
    advertisingFees: 0, monthlySellerFee: 0, monthlyFeePerOrder: 0, returnsCreditNotes: 0,
  };

  try {
    const rawText = await extractPdfText(file);

    console.log('[Kogan PDF] Raw text length:', rawText?.length, 'First 500 chars:', rawText?.substring(0, 500));

    if (!rawText || rawText.trim().length < 30) {
      return { ...empty, success: false, error: 'Could not extract text from PDF.', rawText };
    }

    // Normalise: collapse whitespace (including newlines) to single spaces for regex matching
    const norm = rawText.replace(/\s+/g, ' ');
    console.log('[Kogan PDF] Normalised text (first 800):', norm.substring(0, 800));

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

    // Extract total paid amount — try "Total paid amount ... AUD" first,
    // then fallback to "NNN AUD Total paid amount" (amount appears before the label)
    let totalMatch = norm.match(/Total\s+paid\s+amount:?\s*([\d,]+\.?\d*)\s*AUD/i);
    if (!totalMatch) {
      // Fallback: amount appears BEFORE the phrase
      totalMatch = norm.match(/([\d,]+\.?\d*)\s*AUD\s*Total\s+paid\s+amount/i);
    }
    const totalPaidAmount = totalMatch ? parseAmount(totalMatch[1]) : undefined;
    console.log('[Kogan PDF] Total paid amount match:', totalMatch?.[0], '→', totalPaidAmount);

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
    console.log('[Kogan PDF] Found', markers.length, 'document markers');

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
      
      // Extract amount from the segment — it's the FIRST "number AUD" pattern
      // (not the last number, which could be a reference like AUMKA:KOG:AU:20260315)
      const amountMatch = segment.match(/([\d,]+\.?\d*)\s*AUD/i);
      const rawAmount = amountMatch ? parseAmount(amountMatch[1]) : 0;
      
      // Reference is everything after the amount match up to the end (or next marker)
      let reference = amountMatch 
        ? segment.substring(segment.indexOf(amountMatch[0]) + amountMatch[0].length).trim()
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
    let monthlyFeePerOrder = 0;
    let returnsCreditNotes = 0;
    let apInvoiceRef: string | undefined;

    for (const item of lineItems) {
      if (item.type.toLowerCase().includes('invoice')) {
        invoiceTotal += item.amount;
        if (!apInvoiceRef) apInvoiceRef = item.docNumber; // First A/P Invoice doc number
      } else if (item.type.toLowerCase().includes('journal')) {
        advertisingFees += item.amount; // negative
      } else if (item.type.toLowerCase().includes('credit note')) {
        creditNoteTotal += item.amount; // negative
        const ref = item.reference.toLowerCase();
        if (ref.includes('monthly seller fee')) {
          monthlySellerFee += Math.abs(item.amount);
        } else if (ref.includes('monthly fee per order')) {
          monthlyFeePerOrder += Math.abs(item.amount);
        } else {
          returnsCreditNotes += Math.abs(item.amount);
        }
      }
    }

    // ── Residual-based advertising fee derivation ──
    // If journal entry regex didn't match but we have totalPaidAmount and invoiceTotal,
    // derive advertising fees from the residual: invoiceTotal - monthlyFees - returns - totalPaid = adFees
    if (advertisingFees === 0 && totalPaidAmount !== undefined && invoiceTotal > 0) {
      const totalMonthlyFees = monthlySellerFee + monthlyFeePerOrder;
      const residual = invoiceTotal - totalMonthlyFees - returnsCreditNotes - totalPaidAmount;
      if (residual > 0.01) {
        advertisingFees = -residual; // negative = deduction
        console.log('[Kogan PDF] Derived advertising fees from residual:', advertisingFees);
      }
    }

    console.log('[Kogan PDF] Parsed', lineItems.length, 'line items. Total paid:', totalPaidAmount, 
      'Invoice total:', invoiceTotal, 'Credits:', creditNoteTotal, 'Ad fees:', advertisingFees,
      'Monthly seller fee:', monthlySellerFee, 'Monthly fee/order:', monthlyFeePerOrder,
      'Returns:', returnsCreditNotes, 'AP Invoice ref:', apInvoiceRef);

    // Derive periodMonth from A/P Invoice reference (AUMKA:KOG:AU:YYYYMMDD) — this is the
    // canonical period identifier, NOT the Transfer Date (which is the payment date and may
    // fall in a different month than the actual settlement period).
    let periodMonth: string | undefined;

    // Priority 1: Extract from A/P Invoice reference code (e.g. AUMKA:KOG:AU:20260228 → 2026-02)
    let invoiceDate: string | undefined;
    for (const item of lineItems) {
      if (item.type.toLowerCase().includes('invoice') && item.reference) {
        const refDateMatch = item.reference.match(/(\d{4})(\d{2})(\d{2})/);
        if (refDateMatch) {
          periodMonth = `${refDateMatch[1]}-${refDateMatch[2]}`;
          invoiceDate = `${refDateMatch[1]}-${refDateMatch[2]}-${refDateMatch[3]}`;
          break;
        }
      }
    }

    // Priority 2: Use the A/P Invoice's own date field (M/D/YYYY in PDF table)
    if (!periodMonth) {
      for (const item of lineItems) {
        if (item.type.toLowerCase().includes('invoice') && item.date) {
          const isoDate = parseDateToISO(item.date);
          if (isoDate) {
            periodMonth = isoDate.substring(0, 7);
            invoiceDate = isoDate;
            break;
          }
        }
      }
    }

    // Priority 3: Fall back to transferDate only if nothing else available
    if (!periodMonth && transferDate) {
      periodMonth = transferDate.substring(0, 7);
    } else if (!periodMonth && lineItems.length > 0 && lineItems[0].date) {
      const isoDate = parseDateToISO(lineItems[0].date);
      if (isoDate) periodMonth = isoDate.substring(0, 7);
    }

    return {
      success: lineItems.length > 0,
      remittanceNumber,
      transferDate,
      paymentDate,
      periodMonth,
      invoiceDate,
      lineItems,
      totalPaidAmount,
      invoiceTotal,
      creditNoteTotal,
      advertisingFees,
      monthlySellerFee,
      monthlyFeePerOrder,
      returnsCreditNotes,
      apInvoiceRef,
      rawText,
    };
  } catch (err: any) {
    console.error('[Kogan PDF] Parse exception:', err);
    return {
      ...empty,
      success: false,
      error: `Kogan PDF parsing failed: ${err.message || 'Unknown error'}`,
    };
  }
}
