/**
 * File Fingerprint Engine — 3-level intelligent file detection
 * 
 * Level 1: Instant fingerprint matching against known column patterns
 * Level 2: Heuristic column mapping with confidence scoring
 * Level 3: AI fallback (calls edge function — handled by SmartUploadFlow)
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export interface ColumnMapping {
  gross_sales?: string;
  fees?: string;
  refunds?: string;
  net_payout?: string;
  settlement_id?: string;
  period_start?: string;
  period_end?: string;
  gst?: string;
  order_id?: string;
  currency?: string;
}

export interface FileDetectionResult {
  marketplace: string;           // 'amazon_au', 'shopify_payments', 'bunnings', 'kogan', etc.
  marketplaceLabel: string;      // Human-readable name
  confidence: number;            // 0-100
  confidenceReason?: string;     // Human-readable explanation of confidence score
  isSettlementFile: boolean;     // false = wrong file type
  wrongFileMessage?: string;     // "This is a Shopify Orders export..."
  correctReportPath?: string;    // "Shopify Admin → Finances → Payouts → Export"
  columnMapping?: ColumnMapping; // mapped columns if detected
  detectionLevel: 1 | 2 | 3;    // which level detected it
  recordCount?: number;          // estimated number of data rows
  fileFormat?: string;           // 'csv' | 'tsv' | 'xlsx' | 'pdf'
}

// ─── Known Format Fingerprints ──────────────────────────────────────────────

interface Fingerprint {
  marketplace: string;
  marketplaceLabel: string;
  isSettlementFile: boolean;
  /** All of these columns must be present (case-insensitive) */
  requiredColumns: string[];
  /** At least one of these must be present */
  anyOfColumns?: string[];
  /** If wrong file, provide guidance */
  wrongFileMessage?: string;
  correctReportPath?: string;
  /** Column mapping for correct settlement files */
  columnMapping?: ColumnMapping;
  /** Higher priority wins when multiple fingerprints match */
  priority: number;
}

const FINGERPRINTS: Fingerprint[] = [
  // ── Correct settlement files ──────────────────────────────────────

  // Amazon AU Settlement (TSV)
  {
    marketplace: 'amazon_au',
    marketplaceLabel: 'Amazon AU',
    isSettlementFile: true,
    requiredColumns: ['settlement-id', 'settlement-start-date'],
    anyOfColumns: ['amount-type', 'total-amount', 'transaction-type'],
    priority: 100,
  },

  // Shopify Payments — Transaction-level CSV
  {
    marketplace: 'shopify_payments',
    marketplaceLabel: 'Shopify Payments',
    isSettlementFile: true,
    requiredColumns: ['payout id'],
    anyOfColumns: ['amount', 'fee', 'net', 'card brand'],
    columnMapping: {
      settlement_id: 'Payout ID',
      gross_sales: 'Amount',
      fees: 'Fee',
      net_payout: 'Net',
      period_start: 'Transaction Date',
    },
    priority: 100,
  },

  // Shopify Payments — Payout-level CSV
  {
    marketplace: 'shopify_payments',
    marketplaceLabel: 'Shopify Payments',
    isSettlementFile: true,
    requiredColumns: ['charges', 'total'],
    anyOfColumns: ['bank reference', 'payout date', 'fees'],
    columnMapping: {
      gross_sales: 'Charges',
      fees: 'Fees',
      refunds: 'Refunds',
      net_payout: 'Total',
      period_start: 'Payout Date',
      settlement_id: 'Bank Reference',
    },
    priority: 95,
  },

  // Woolworths MarketPlus (Big W + Everyday Market + MyDeal combined)
  {
    marketplace: 'woolworths_marketplus',
    marketplaceLabel: 'Woolworths MarketPlus',
    isSettlementFile: true,
    requiredColumns: ['order source', 'bank payment ref'],
    anyOfColumns: ['total sale price', 'commission fee', 'net amount'],
    columnMapping: {
      order_id: 'Order ID',
      gross_sales: 'Total Sale Price',
      fees: 'Commission Fee',
      net_payout: 'Net Amount',
      gst: 'GST on Net Amount',
      settlement_id: 'Bank Payment Ref',
    },
    priority: 105,  // Higher than individual BigW/MyDeal fingerprints
  },

  // Kogan
  {
    marketplace: 'kogan',
    marketplaceLabel: 'Kogan',
    isSettlementFile: true,
    requiredColumns: ['kogan order id'],
    anyOfColumns: ['commission', 'total', 'payout'],
    columnMapping: {
      order_id: 'Kogan Order ID',
      fees: 'Commission',
    },
    priority: 90,
  },

  // BigW (Mirakl-based, like Bunnings)
  {
    marketplace: 'bigw',
    marketplaceLabel: 'Big W',
    isSettlementFile: true,
    requiredColumns: ['mirakl'],
    anyOfColumns: ['big w', 'bigw'],
    priority: 85,
  },

  // Catch
  {
    marketplace: 'catch',
    marketplaceLabel: 'Catch',
    isSettlementFile: true,
    requiredColumns: ['catch order id'],
    anyOfColumns: ['commission', 'total', 'payout'],
    columnMapping: {
      order_id: 'Catch Order ID',
      fees: 'Commission',
    },
    priority: 90,
  },

  // MyDeal
  {
    marketplace: 'mydeal',
    marketplaceLabel: 'MyDeal',
    isSettlementFile: true,
    requiredColumns: ['mydeal order id'],
    anyOfColumns: ['commission', 'total'],
    columnMapping: {
      order_id: 'MyDeal Order ID',
      fees: 'Commission',
    },
    priority: 90,
  },

  // ── Wrong file types ──────────────────────────────────────────────

  // Amazon Orders (WRONG)
  {
    marketplace: 'amazon_au',
    marketplaceLabel: 'Amazon AU',
    isSettlementFile: false,
    requiredColumns: ['amazon-order-id'],
    anyOfColumns: ['purchase-date', 'buyer-name', 'ship-service-level'],
    wrongFileMessage: 'This is an Amazon Orders report, not a Settlement report. Orders reports don\'t contain fee breakdowns needed for accounting.',
    correctReportPath: 'Seller Central → Reports → Payments → All Statements → Download TSV',
    priority: 80,
  },

  // Shopify Orders CSV — gateway/marketplace clearing invoices (VALID file)
  // Broad matching: 'financial status' + at least one Shopify order signal
  {
    marketplace: 'shopify_orders',
    marketplaceLabel: 'Shopify Orders',
    isSettlementFile: true,
    requiredColumns: ['financial status'],
    anyOfColumns: ['payment method', 'paid at', 'note attributes', 'tags', 'lineitem quantity', 'lineitem sku'],
    columnMapping: {
      gross_sales: 'Subtotal',
      net_payout: 'Total',
    },
    priority: 95,
  },

  // Amazon Inventory (WRONG)
  {
    marketplace: 'amazon_au',
    marketplaceLabel: 'Amazon AU',
    isSettlementFile: false,
    requiredColumns: ['asin'],
    anyOfColumns: ['fnsku', 'your price', 'afn-fulfillable-quantity'],
    wrongFileMessage: 'This is an Amazon Inventory report, not a Settlement report.',
    correctReportPath: 'Seller Central → Reports → Payments → All Statements → Download TSV',
    priority: 75,
  },

  // Amazon Advertising (WRONG)
  {
    marketplace: 'amazon_au',
    marketplaceLabel: 'Amazon AU',
    isSettlementFile: false,
    requiredColumns: ['campaign name'],
    anyOfColumns: ['impressions', 'clicks', 'spend', 'acos'],
    wrongFileMessage: 'This is an Amazon Advertising report, not a Settlement report.',
    correctReportPath: 'Seller Central → Reports → Payments → All Statements → Download TSV',
    priority: 75,
  },
];

// ─── Level 1: Fingerprint Detection ─────────────────────────────────────────

function normaliseHeader(h: string): string {
  return h.toLowerCase().trim().replace(/[_\s]+/g, ' ');
}

/**
 * Level 1 — Match file headers against known fingerprints.
 * Returns the best match or null.
 */
export function detectByFingerprint(headers: string[]): FileDetectionResult | null {
  const normHeaders = headers.map(normaliseHeader);

  let bestMatch: { fingerprint: Fingerprint; score: number } | null = null;

  for (const fp of FINGERPRINTS) {
    // Check required columns
    const requiredMatches = fp.requiredColumns.every(col =>
      normHeaders.some(h => h.includes(normaliseHeader(col)))
    );
    if (!requiredMatches) continue;

    // Check anyOf columns (at least one must match)
    let anyOfMatch = !fp.anyOfColumns || fp.anyOfColumns.length === 0;
    if (fp.anyOfColumns) {
      anyOfMatch = fp.anyOfColumns.some(col =>
        normHeaders.some(h => h.includes(normaliseHeader(col)))
      );
    }

    const score = fp.priority + (anyOfMatch ? 10 : 0);
    if (!bestMatch || score > bestMatch.score) {
      bestMatch = { fingerprint: fp, score };
    }
  }

  if (!bestMatch) return null;

  const fp = bestMatch.fingerprint;
  return {
    marketplace: fp.marketplace,
    marketplaceLabel: fp.marketplaceLabel,
    confidence: Math.min(bestMatch.score, 100),
    isSettlementFile: fp.isSettlementFile,
    wrongFileMessage: fp.wrongFileMessage,
    correctReportPath: fp.correctReportPath,
    columnMapping: fp.columnMapping,
    detectionLevel: 1,
  };
}

// ─── Level 2: Heuristic Column Mapping ──────────────────────────────────────

interface FieldPattern {
  field: keyof ColumnMapping;
  patterns: RegExp[];
  weight: number; // importance for settlement detection
}

const FIELD_PATTERNS: FieldPattern[] = [
  {
    field: 'gross_sales',
    patterns: [/^(gross\s*)?sales$/i, /^(sale\s*)?amount$/i, /^charges$/i, /^order\s*total$/i, /^total\s*sales$/i, /^revenue$/i, /^gross$/i],
    weight: 3,
  },
  {
    field: 'fees',
    patterns: [/^(commission|fees?|marketplace\s*fee|platform\s*fee|service\s*fee|processing\s*fee)$/i],
    weight: 3,
  },
  {
    field: 'refunds',
    patterns: [/^refunds?$/i, /^returns?$/i, /^refund\s*amount$/i],
    weight: 2,
  },
  {
    field: 'net_payout',
    patterns: [/^(net|net\s*payout|transfer|bank\s*deposit|payout|settlement\s*amount|total|net\s*amount)$/i],
    weight: 3,
  },
  {
    field: 'settlement_id',
    patterns: [/^(settlement\s*id|payout\s*id|statement\s*id|invoice\s*id|bank\s*reference|reference|ref)$/i],
    weight: 2,
  },
  {
    field: 'period_start',
    patterns: [/^(start\s*date|period\s*start|from\s*date|payout\s*date|date)$/i],
    weight: 1,
  },
  {
    field: 'period_end',
    patterns: [/^(end\s*date|period\s*end|to\s*date)$/i],
    weight: 1,
  },
  {
    field: 'gst',
    patterns: [/^(gst|tax|vat|sales\s*tax)$/i],
    weight: 1,
  },
  {
    field: 'order_id',
    patterns: [/^(order\s*id|order\s*#|order\s*number|order)$/i],
    weight: 1,
  },
  {
    field: 'currency',
    patterns: [/^currency$/i],
    weight: 0.5,
  },
];

export interface HeuristicResult {
  mapping: ColumnMapping;
  confidence: number; // 0-100
  matchedFields: string[];
  unmatchedHeaders: string[];
}

/**
 * Level 2 — Heuristic column mapping.
 * Scores headers against known field patterns and returns best mapping.
 */
export function detectByHeuristic(headers: string[]): HeuristicResult | null {
  const mapping: ColumnMapping = {};
  const matchedFields: string[] = [];
  const usedIndices = new Set<number>();
  let totalWeight = 0;
  let matchedWeight = 0;

  for (const fp of FIELD_PATTERNS) {
    totalWeight += fp.weight;
    for (let i = 0; i < headers.length; i++) {
      if (usedIndices.has(i)) continue;
      const normHeader = headers[i].trim();
      if (fp.patterns.some(p => p.test(normHeader))) {
        mapping[fp.field] = headers[i].trim();
        matchedFields.push(fp.field);
        matchedWeight += fp.weight;
        usedIndices.add(i);
        break;
      }
    }
  }

  // Need at least gross_sales + fees or net_payout to be useful
  const hasCritical = (mapping.gross_sales && mapping.fees) || (mapping.gross_sales && mapping.net_payout) || (mapping.net_payout && mapping.fees);
  if (!hasCritical) return null;

  const confidence = Math.round((matchedWeight / totalWeight) * 100);
  const unmatchedHeaders = headers.filter((_, i) => !usedIndices.has(i));

  return {
    mapping,
    confidence: Math.min(confidence, 100),
    matchedFields,
    unmatchedHeaders,
  };
}

// ─── Main Detection Pipeline ────────────────────────────────────────────────

/**
 * Detect file format from extracted headers.
 * Returns Level 1 result if fingerprint matches, or Level 2 heuristic result.
 * Returns null if both fail (caller should try Level 3 AI).
 */
export function detectFromHeaders(headers: string[]): FileDetectionResult | null {
  // Level 1: Fingerprint
  const fp = detectByFingerprint(headers);
  if (fp) return fp;

  // Level 2: Heuristic
  const heuristic = detectByHeuristic(headers);
  if (heuristic && heuristic.confidence >= 40) {
    return {
      marketplace: 'unknown',
      marketplaceLabel: 'Unknown Marketplace',
      confidence: heuristic.confidence,
      isSettlementFile: true,
      columnMapping: heuristic.mapping,
      detectionLevel: 2,
    };
  }

  return null;
}

// ─── File Reading Helpers ───────────────────────────────────────────────────

/**
 * Extract headers from a CSV/TSV file.
 */
export async function extractFileHeaders(file: File): Promise<{ headers: string[]; sampleRows: string[][]; rowCount: number; delimiter: string } | null> {
  const name = file.name.toLowerCase();
  
  // Handle XLSX
  if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
    try {
      const XLSX = await import('xlsx');
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: string[][] = XLSX.utils.sheet_to_json(ws, { header: 1 }) as string[][];
      if (rows.length < 1) return null;
      const headers = rows[0].map(h => String(h || '').trim());
      const sampleRows = rows.slice(1, 4).map(r => r.map(c => String(c || '')));
      return { headers, sampleRows, rowCount: rows.length - 1, delimiter: ',' };
    } catch {
      return null;
    }
  }

  // Handle PDF — delegate to existing Bunnings detector
  if (name.endsWith('.pdf')) {
    return null; // PDFs handled separately
  }

  // CSV/TSV
  try {
    const text = await file.text();
    const lines = text.split('\n').filter(l => l.trim());
    if (lines.length < 1) return null;

    // Detect delimiter
    const firstLine = lines[0];
    const tabCount = (firstLine.match(/\t/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;
    const delimiter = tabCount > commaCount ? '\t' : ',';

    // Parse headers
    const headers = parseRow(firstLine, delimiter);

    // Sample rows (first 3 data rows)
    const sampleRows = lines.slice(1, 4).map(l => parseRow(l, delimiter));

    return { headers, sampleRows, rowCount: lines.length - 1, delimiter };
  } catch {
    return null;
  }
}

function parseRow(line: string, delimiter: string): string[] {
  if (delimiter === '\t') {
    return line.split('\t').map(s => s.trim());
  }
  // CSV with quote handling
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  result.push(current.trim());
  return result;
}

/**
 * Full file detection pipeline — extracts headers and runs Level 1+2.
 */
export async function detectFile(file: File): Promise<FileDetectionResult | null> {
  const name = file.name.toLowerCase();

  // PDF: use content-based detection (Bunnings)
  if (name.endsWith('.pdf')) {
    // Check filename first
    if (name.includes('bunnings') || name.includes('summary-of-transactions') || name.includes('mirakl')) {
      return {
        marketplace: 'bunnings',
        marketplaceLabel: 'Bunnings',
        confidence: 90,
        isSettlementFile: true,
        detectionLevel: 1,
        fileFormat: 'pdf',
      };
    }
    // PDF on a marketplace tool = likely Bunnings (Amazon uses TSV)
    return {
      marketplace: 'bunnings',
      marketplaceLabel: 'Bunnings',
      confidence: 60,
      isSettlementFile: true,
      detectionLevel: 2,
      fileFormat: 'pdf',
    };
  }

  const extracted = await extractFileHeaders(file);
  if (!extracted) return null;

  const result = detectFromHeaders(extracted.headers);
  if (result) {
    result.recordCount = extracted.rowCount;
    result.fileFormat = name.endsWith('.tsv') || name.endsWith('.txt') ? 'tsv' : name.endsWith('.xlsx') || name.endsWith('.xls') ? 'xlsx' : 'csv';
  }
  return result;
}

// ─── Marketplace Labels ─────────────────────────────────────────────────────

export const MARKETPLACE_LABELS: Record<string, string> = {
  amazon_au: 'Amazon AU',
  bunnings: 'Bunnings',
  shopify_payments: 'Shopify Payments',
  shopify_orders: 'Shopify Orders',
  kogan: 'Kogan',
  bigw: 'Big W',
  catch: 'Catch',
  mydeal: 'MyDeal',
  woolworths: 'Woolworths',
  woolworths_marketplus: 'Woolworths MarketPlus',
  unknown: 'Unknown Marketplace',
};
