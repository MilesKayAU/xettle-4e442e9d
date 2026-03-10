/**
 * Universal Multi-Marketplace Splitter
 * 
 * Detects if a CSV contains rows from multiple marketplaces by scanning for
 * a "split column" (Order Source, Channel, Platform, etc.) with >1 unique values.
 * Groups rows by marketplace and returns separate settlement-ready groups.
 * 
 * Phase 1: Deterministic — uses a static dictionary for name→code mapping.
 * Phase 2 (future): AI fallback for unmapped names.
 */

import { supabase } from '@/integrations/supabase/client';

// ─── Static marketplace name dictionary ─────────────────────────────────────

const MARKETPLACE_NAME_MAP: Record<string, string> = {
  // BigW
  bigw: 'bigw',
  'big w': 'bigw',
  'big_w': 'bigw',

  // Everyday Market
  everydaymarket: 'everyday_market',
  'everyday market': 'everyday_market',
  'everyday_market': 'everyday_market',

  // MyDeal
  mydeal: 'mydeal',
  'my deal': 'mydeal',
  'my_deal': 'mydeal',

  // Catch
  catch: 'catch',
  'catch.com.au': 'catch',
  'catch.com': 'catch',

  // Kmart
  kmart: 'kmart',

  // Myer
  myer: 'myer',

  // Bunnings
  bunnings: 'bunnings',

  // Target
  target: 'target',

  // eBay
  ebay: 'ebay_au',
  'ebay au': 'ebay_au',
  'ebay_au': 'ebay_au',
  'ebay australia': 'ebay_au',

  // Amazon
  amazon: 'amazon_au',
  'amazon au': 'amazon_au',
  'amazon_au': 'amazon_au',
  'amazon australia': 'amazon_au',

  // Shopify
  shopify: 'shopify_payments',
  'shopify payments': 'shopify_payments',

  // Woolworths
  woolworths: 'woolworths',
  'woolworths marketplace': 'woolworths',

  // THE ICONIC
  theiconic: 'theiconic',
  'the iconic': 'theiconic',

  // Kogan
  kogan: 'kogan',

  // Etsy
  etsy: 'etsy',
};

// Display names for marketplace codes
const MARKETPLACE_DISPLAY_NAMES: Record<string, string> = {
  bigw: 'Big W',
  everyday_market: 'Everyday Market',
  mydeal: 'MyDeal',
  catch: 'Catch',
  kmart: 'Kmart',
  myer: 'Myer',
  bunnings: 'Bunnings',
  target: 'Target',
  ebay_au: 'eBay AU',
  amazon_au: 'Amazon AU',
  shopify_payments: 'Shopify Payments',
  woolworths: 'Woolworths',
  theiconic: 'THE ICONIC',
  kogan: 'Kogan',
  etsy: 'Etsy',
};

// ─── Known split column header patterns ─────────────────────────────────────

const SPLIT_COLUMN_PATTERNS: RegExp[] = [
  /^order\s*source$/i,
  /^channel$/i,
  /^platform$/i,
  /^marketplace$/i,
  /^store$/i,
  /^seller\s*channel$/i,
  /^fulfillment\s*channel$/i,
  /^fulfilment\s*channel$/i,
  /^sales?\s*channel$/i,
  /^source$/i,
  /^storefront$/i,
];

// ─── Types ──────────────────────────────────────────────────────────────────

export interface MarketplaceGroup {
  /** Raw value from the split column (e.g. "BigW") */
  rawValue: string;
  /** Canonical marketplace code (e.g. "bigw") */
  marketplaceCode: string;
  /** Display name (e.g. "Big W") */
  displayName: string;
  /** Row indices (0-based, excluding header) belonging to this group */
  rowIndices: number[];
  /** Count of rows */
  rowCount: number;
  /** Sum of the primary financial column if detected */
  netTotal: number;
}

export interface MultiMarketplaceSplitResult {
  /** Whether the file contains multiple marketplaces */
  isMultiMarketplace: boolean;
  /** The header name used for splitting */
  splitColumn: string | null;
  /** Index of the split column in headers */
  splitColumnIndex: number;
  /** Groups per marketplace */
  groups: MarketplaceGroup[];
  /** Values that couldn't be mapped to a known marketplace code */
  unmappedValues: string[];
  /** Whether this result came from a cached fingerprint */
  fromCache: boolean;
}

export interface SplitDetectionInput {
  /** CSV headers (first row) */
  headers: string[];
  /** All data rows as string arrays */
  rows: string[][];
  /** Original filename for fingerprint caching */
  filename?: string;
}

// ─── Core Detection ─────────────────────────────────────────────────────────

/**
 * Resolves a raw marketplace name to a canonical code.
 * Returns null if not found in the static dictionary.
 */
export function resolveMarketplaceName(raw: string): string | null {
  const normalised = raw.toLowerCase().replace(/[\s_-]+/g, ' ').trim();
  // Exact match first
  if (MARKETPLACE_NAME_MAP[normalised]) return MARKETPLACE_NAME_MAP[normalised];
  // Try without spaces
  const noSpaces = normalised.replace(/\s+/g, '');
  if (MARKETPLACE_NAME_MAP[noSpaces]) return MARKETPLACE_NAME_MAP[noSpaces];
  return null;
}

/**
 * Get display name for a marketplace code.
 */
export function getMarketplaceDisplayName(code: string): string {
  return MARKETPLACE_DISPLAY_NAMES[code] || code;
}

/**
 * Find a split column in headers.
 * Returns the column index or -1 if none found.
 */
export function findSplitColumn(headers: string[]): { index: number; name: string } | null {
  for (const pattern of SPLIT_COLUMN_PATTERNS) {
    const idx = headers.findIndex(h => pattern.test(h.trim()));
    if (idx !== -1) {
      return { index: idx, name: headers[idx].trim() };
    }
  }
  return null;
}

/**
 * Detect a financial/net amount column for group totals.
 */
function findNetColumn(headers: string[]): number {
  const patterns = [
    /^net\s*amount$/i, /^net$/i, /^net\s*payout$/i, /^net\s*total$/i,
    /^total\s*net$/i, /^amount$/i, /^payout$/i,
  ];
  for (const p of patterns) {
    const idx = headers.findIndex(h => p.test(h.trim()));
    if (idx !== -1) return idx;
  }
  return -1;
}

function parseAmount(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.replace(/[^0-9.\-,]/g, '').replace(/,/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? 0 : val;
}

// ─── Main Detection Function ────────────────────────────────────────────────

/**
 * Detect if a CSV contains multiple marketplaces and group rows accordingly.
 * 
 * Flow:
 * 1. Check cached fingerprints for this file format
 * 2. Scan headers for a known split column
 * 3. If found with >1 unique values → return groups
 * 4. Otherwise → return isMultiMarketplace: false
 */
export function detectMultiMarketplace(input: SplitDetectionInput): MultiMarketplaceSplitResult {
  const { headers, rows } = input;

  // Step 1: Find a split column
  const splitCol = findSplitColumn(headers);
  if (!splitCol) {
    return {
      isMultiMarketplace: false,
      splitColumn: null,
      splitColumnIndex: -1,
      groups: [],
      unmappedValues: [],
      fromCache: false,
    };
  }

  // Step 2: Collect unique values from the split column
  const valueCounts = new Map<string, number[]>(); // value → row indices
  for (let i = 0; i < rows.length; i++) {
    const raw = (rows[i][splitCol.index] || '').trim();
    if (!raw) continue; // Skip empty — will be handled by ambiguous row logic
    if (!valueCounts.has(raw)) valueCounts.set(raw, []);
    valueCounts.get(raw)!.push(i);
  }

  const uniqueValues = Array.from(valueCounts.keys());

  // If only 0-1 unique non-empty values, not multi-marketplace
  if (uniqueValues.length <= 1) {
    return {
      isMultiMarketplace: false,
      splitColumn: splitCol.name,
      splitColumnIndex: splitCol.index,
      groups: [],
      unmappedValues: [],
      fromCache: false,
    };
  }

  // Step 3: Map each value to a marketplace code
  const netColIdx = findNetColumn(headers);
  const groups: MarketplaceGroup[] = [];
  const unmappedValues: string[] = [];

  for (const [rawValue, rowIdxs] of valueCounts) {
    const code = resolveMarketplaceName(rawValue);
    if (!code) {
      unmappedValues.push(rawValue);
    }
    
    let netTotal = 0;
    if (netColIdx >= 0) {
      for (const ri of rowIdxs) {
        netTotal += parseAmount(rows[ri][netColIdx] || '');
      }
    }

    groups.push({
      rawValue,
      marketplaceCode: code || rawValue.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      displayName: code ? getMarketplaceDisplayName(code) : rawValue,
      rowIndices: rowIdxs,
      rowCount: rowIdxs.length,
      netTotal: Math.round(netTotal * 100) / 100,
    });
  }

  // Handle rows with empty split column — try to assign to a group
  const emptyRows: number[] = [];
  for (let i = 0; i < rows.length; i++) {
    const raw = (rows[i][splitCol.index] || '').trim();
    if (!raw) emptyRows.push(i);
  }

  if (emptyRows.length > 0 && groups.length > 0) {
    // For now, assign empty rows to the largest group (most conservative)
    // The Woolworths parser has more specific InvoiceRef-based logic
    const largestGroup = groups.reduce((a, b) => a.rowCount > b.rowCount ? a : b);
    for (const ri of emptyRows) {
      largestGroup.rowIndices.push(ri);
      largestGroup.rowCount++;
      if (netColIdx >= 0) {
        largestGroup.netTotal += parseAmount(rows[ri][netColIdx] || '');
        largestGroup.netTotal = Math.round(largestGroup.netTotal * 100) / 100;
      }
    }
  }

  // Sort by row count descending
  groups.sort((a, b) => b.rowCount - a.rowCount);

  return {
    isMultiMarketplace: true,
    splitColumn: splitCol.name,
    splitColumnIndex: splitCol.index,
    groups,
    unmappedValues,
    fromCache: false,
  };
}

// ─── Cached Fingerprint Check ───────────────────────────────────────────────

/**
 * Check if we have a cached split pattern for this file's column signature.
 */
export async function checkCachedSplitPattern(
  headers: string[]
): Promise<{ splitColumn: string; splitMappings: Record<string, string> } | null> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    const signature = headers.map(h => h.trim().toLowerCase()).sort();

    const { data } = await supabase
      .from('marketplace_file_fingerprints')
      .select('split_column, split_mappings, is_multi_marketplace')
      .eq('user_id', user.id)
      .eq('is_multi_marketplace', true)
      .limit(50);

    if (!data || data.length === 0) return null;

    for (const fp of data) {
      const fpSig = (fp as any).column_signature;
      if (Array.isArray(fpSig)) {
        const fpSorted = fpSig.map((s: string) => s.toLowerCase()).sort();
        if (JSON.stringify(fpSorted) === JSON.stringify(signature)) {
          return {
            splitColumn: (fp as any).split_column || '',
            splitMappings: ((fp as any).split_mappings as Record<string, string>) || {},
          };
        }
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Save a split pattern to the fingerprint cache.
 */
export async function saveSplitFingerprint(
  headers: string[],
  splitColumn: string,
  groups: MarketplaceGroup[]
): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const signature = headers.map(h => h.trim().toLowerCase()).sort();
    const mappings: Record<string, string> = {};
    for (const g of groups) {
      mappings[g.rawValue] = g.marketplaceCode;
    }

    await supabase.from('marketplace_file_fingerprints').upsert({
      user_id: user.id,
      marketplace_code: 'multi_marketplace',
      column_signature: signature as any,
      column_mapping: {} as any,
      split_column: splitColumn,
      split_mappings: mappings as any,
      is_multi_marketplace: true,
    } as any);
  } catch {
    // Silent — caching is best-effort
  }
}

// ─── CSV Parsing Helpers ────────────────────────────────────────────────────

/**
 * Parse a CSV string into headers + rows.
 */
export function parseCSVForSplitDetection(csvContent: string): { headers: string[]; rows: string[][] } | null {
  const content = csvContent.replace(/^\uFEFF/, '');
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return null;

  const parseRow = (line: string): string[] => {
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
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = '';
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  };

  const headers = parseRow(lines[0]);
  const rows = lines.slice(1).map(parseRow).filter(r => r.length >= 2);

  return { headers, rows };
}
