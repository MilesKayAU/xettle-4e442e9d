/**
 * Account Code Policy — Centralized rules for Xero account code generation.
 *
 * All COA code generation MUST go through this module.
 * Never let UI decide codes directly.
 *
 * Rules:
 * - Revenue/Income accounts: 200-399 range
 * - Expense accounts: 400-599 range
 * - Codes must be numeric strings
 * - No duplicates against existing COA
 * - Respect Xero's 10-char code limit
 */

// ─── Range Definitions ──────────────────────────────────────────────────────

export interface CodeRange {
  start: number;
  end: number;
}

const REVENUE_RANGE: CodeRange = { start: 200, end: 399 };
const EXPENSE_RANGE: CodeRange = { start: 400, end: 599 };
const OTHER_INCOME_RANGE: CodeRange = { start: 270, end: 299 };

const REVENUE_TYPES = new Set(['REVENUE', 'SALES', 'OTHERINCOME']);
const EXPENSE_TYPES = new Set(['EXPENSE', 'OVERHEADS', 'DIRECTCOSTS']);

// ─── Category → Account Type Mapping ────────────────────────────────────────

const REVENUE_CATEGORIES = new Set([
  'Sales', 'Shipping', 'Promotional Discounts', 'Refunds', 'Reimbursements',
]);

export function getAccountTypeForCategory(category: string): string {
  if (REVENUE_CATEGORIES.has(category)) return 'REVENUE';
  return 'EXPENSE';
}

export function getRangeForType(accountType: string): CodeRange {
  const upper = accountType.toUpperCase();
  if (upper === 'OTHERINCOME') return OTHER_INCOME_RANGE;
  if (REVENUE_TYPES.has(upper)) return REVENUE_RANGE;
  if (EXPENSE_TYPES.has(upper)) return EXPENSE_RANGE;
  return EXPENSE_RANGE; // safe default
}

// ─── Code Generation ────────────────────────────────────────────────────────

export interface CodeGenerationInput {
  existingCodes: string[];
  accountType: string;
  /** Additional codes already claimed in this batch (avoids intra-batch duplicates) */
  batchClaimed?: Set<string>;
}

/**
 * Generate the next available account code for a given account type.
 * Respects range boundaries, avoids duplicates, and maintains numeric order.
 */
export function generateNextCode(input: CodeGenerationInput): string {
  const range = getRangeForType(input.accountType);
  const existingSet = new Set(input.existingCodes);
  const batchSet = input.batchClaimed || new Set<string>();

  // Parse all numeric codes in range
  const numericCodes = input.existingCodes
    .map(c => parseInt(c, 10))
    .filter(n => !isNaN(n) && n >= range.start && n <= range.end)
    .sort((a, b) => a - b);

  // Start from highest used + 1, or range start if none used
  let candidate = numericCodes.length > 0
    ? Math.max(...numericCodes) + 1
    : range.start;

  // Find first available slot
  while (
    candidate <= range.end &&
    (existingSet.has(String(candidate)) || batchSet.has(String(candidate)))
  ) {
    candidate++;
  }

  if (candidate > range.end) {
    // Overflow: try finding gaps in the range
    for (let i = range.start; i <= range.end; i++) {
      if (!existingSet.has(String(i)) && !batchSet.has(String(i))) {
        return String(i);
      }
    }
    // Last resort: use a decimal code like 599.1
    return `${range.end}.1`;
  }

  return String(candidate);
}

// ─── Validation ─────────────────────────────────────────────────────────────

export interface CodeValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Validate a proposed account code.
 */
export function validateAccountCode(
  code: string,
  existingCodes: string[],
  accountType: string,
): CodeValidationResult {
  if (!code || code.trim() === '') {
    return { valid: false, error: 'Code is required' };
  }

  if (code.length > 10) {
    return { valid: false, error: 'Code must be 10 characters or fewer (Xero limit)' };
  }

  if (existingCodes.includes(code)) {
    return { valid: false, error: `Code ${code} already exists in your COA` };
  }

  // Warn (but don't block) if code is outside expected range
  const range = getRangeForType(accountType);
  const numCode = parseInt(code, 10);
  if (!isNaN(numCode) && (numCode < range.start || numCode > range.end)) {
    // Non-blocking: return valid but could add a warning field
    return { valid: true };
  }

  return { valid: true };
}

// ─── Code Pattern Detection ─────────────────────────────────────────────────

export interface CodePattern {
  /** Base whole-number code per category, e.g. { Sales: '200', Shipping: '206' } */
  baseCodeByCategory: Record<string, string>;
  /** Whether the template uses decimal sub-codes (e.g. 200.1) */
  usesDecimals: boolean;
  /** How decimals are used: 'suffix' means .1, .2 under a base; 'none' means no decimals */
  decimalStrategy: 'suffix' | 'none';
  /** Next available decimal per base code, e.g. { '200': 2 } meaning 200.2 is next */
  nextDecimalByBase: Record<string, number>;
}

export interface PatternAccount {
  code: string;
  category: string;
  type: string;
}

/**
 * Detect the numbering pattern used by a set of template accounts.
 * Returns null if the pattern is too ambiguous to replicate safely.
 */
export function detectCodePattern(templateAccounts: PatternAccount[]): CodePattern | null {
  if (templateAccounts.length === 0) return null;

  const baseCodeByCategory: Record<string, string> = {};
  const decimalsByBase: Record<string, number[]> = {};
  let hasDecimals = false;

  for (const acc of templateAccounts) {
    const code = acc.code;
    if (!code) continue;

    if (code.includes('.')) {
      hasDecimals = true;
      const [base, decStr] = code.split('.');
      const dec = parseInt(decStr, 10);
      if (!isNaN(dec)) {
        if (!decimalsByBase[base]) decimalsByBase[base] = [];
        decimalsByBase[base].push(dec);
      }
    } else {
      // Whole number = base code for this category
      baseCodeByCategory[acc.category] = code;
    }
  }

  // Also map decimal accounts to their parent category if base exists
  // e.g. if 200 = Sales and 200.1 exists, 200.1 is a sub of Sales base
  const nextDecimalByBase: Record<string, number> = {};
  for (const [base, decimals] of Object.entries(decimalsByBase)) {
    nextDecimalByBase[base] = Math.max(...decimals) + 1;
  }

  return {
    baseCodeByCategory,
    usesDecimals: hasDecimals,
    decimalStrategy: hasDecimals ? 'suffix' : 'none',
    nextDecimalByBase,
  };
}

// ─── Pattern-Aware Code Generation ──────────────────────────────────────────

export interface PatternCodeInput {
  pattern: CodePattern;
  category: string;
  accountType: string;
  existingCodes: string[];
  batchClaimed?: Set<string>;
}

/**
 * Generate a code that mirrors the numbering convention of the template.
 *
 * Strategy:
 * - Find the base code for this category in the pattern
 * - Offset it by a marketplace stride (find next free whole number near the base)
 * - If the template uses decimals for sub-categories under this base,
 *   generate {newBase}.{n} using the same decimal strategy
 *
 * Falls back to generateNextCode() if pattern doesn't cover this category.
 */
export function generateCodeFromPattern(input: PatternCodeInput): string {
  const { pattern, category, accountType, existingCodes, batchClaimed } = input;
  const existingSet = new Set(existingCodes);
  const claimed = batchClaimed || new Set<string>();

  const templateBase = pattern.baseCodeByCategory[category];

  if (!templateBase) {
    // Pattern doesn't know this category — fall back to sequential
    return generateNextCode({ existingCodes, accountType, batchClaimed: claimed });
  }

  const baseNum = parseInt(templateBase, 10);
  if (isNaN(baseNum)) {
    return generateNextCode({ existingCodes, accountType, batchClaimed: claimed });
  }

  const range = getRangeForType(accountType);

  // Find next available whole number starting from the template base
  let candidate = baseNum;
  while (
    candidate <= range.end &&
    (existingSet.has(String(candidate)) || claimed.has(String(candidate)))
  ) {
    candidate++;
  }

  if (candidate > range.end) {
    // Fallback: scan from range start
    return generateNextCode({ existingCodes, accountType, batchClaimed: claimed });
  }

  const newCode = String(candidate);

  // Check if template used decimals under this base — if so, generate decimal
  if (pattern.usesDecimals && pattern.nextDecimalByBase[templateBase]) {
    // This category was a decimal sub-code in the template.
    // But we're generating a NEW base for a new marketplace, so use whole number.
    // Decimals will be generated when there are sub-categories under this base.
  }

  return newCode;
}

/**
 * For a clone operation with pattern matching, generate codes for a set of
 * template accounts being cloned to a new marketplace.
 *
 * This groups accounts by their base code in the template, then:
 * - Assigns new whole numbers for each unique base
 * - Mirrors decimal suffixes under the new base
 */
export function generatePatternBatchCodes(
  templateAccounts: PatternAccount[],
  existingCodes: string[],
  pattern: CodePattern,
): Map<string, string> {
  const result = new Map<string, string>(); // templateCode → newCode
  const existingSet = new Set(existingCodes);
  const claimed = new Set<string>();

  // Group template accounts: whole-number bases first, then decimals
  const bases: PatternAccount[] = [];
  const decimals: (PatternAccount & { base: string; dec: number })[] = [];

  for (const acc of templateAccounts) {
    if (acc.code.includes('.')) {
      const [base, decStr] = acc.code.split('.');
      decimals.push({ ...acc, base, dec: parseInt(decStr, 10) || 1 });
    } else {
      bases.push(acc);
    }
  }

  // ── Proximity-based grouping: infer range from template codes ──
  // Group bases by their numeric "neighbourhood" so the algorithm works
  // for ANY COA structure (200s, 4000s, custom ranges, etc.)
  const neighbourhoodOf = (code: string): number => {
    const num = parseInt(code, 10);
    if (isNaN(num)) return 0;
    return num >= 1000 ? Math.floor(num / 1000) * 1000 : Math.floor(num / 100) * 100;
  };

  const neighbourhoodGroups = new Map<number, PatternAccount[]>();
  for (const b of bases) {
    const nh = neighbourhoodOf(b.code);
    if (!neighbourhoodGroups.has(nh)) neighbourhoodGroups.set(nh, []);
    neighbourhoodGroups.get(nh)!.push(b);
  }

  const baseMapping = new Map<string, string>();

  const findContiguousBlock = (
    group: PatternAccount[],
    rangeStart: number,
    rangeEnd: number,
  ): boolean => {
    if (group.length === 0) return true;
    group.sort((a, b) => parseInt(a.code, 10) - parseInt(b.code, 10));

    const needed = group.length;
    let blockStart = rangeStart;

    while (blockStart + needed - 1 <= rangeEnd) {
      let blockOk = true;
      for (let offset = 0; offset < needed; offset++) {
        const candidate = String(blockStart + offset);
        if (existingSet.has(candidate) || claimed.has(candidate)) {
          blockStart = blockStart + offset + 1;
          blockOk = false;
          break;
        }
      }
      if (blockOk) break;
    }

    if (blockStart + needed - 1 <= rangeEnd) {
      for (let i = 0; i < group.length; i++) {
        const newCode = String(blockStart + i);
        claimed.add(newCode);
        result.set(group[i].code, newCode);
        baseMapping.set(group[i].code, newCode);
      }
      return true;
    }
    return false;
  };

  for (const [nh, group] of neighbourhoodGroups) {
    const blockSize = nh >= 1000 ? 1000 : 100;
    const nhStart = nh;
    const nhEnd = nh + blockSize - 1;

    // Try exact neighbourhood first
    if (findContiguousBlock(group, nhStart, nhEnd)) continue;
    // Widen: ±1 block
    if (findContiguousBlock(group, Math.max(0, nhStart - blockSize), nhEnd + blockSize)) continue;
    // Fallback to type-based range
    const fallbackType = group[0]?.type?.toUpperCase() || 'EXPENSE';
    const fallbackRange = getRangeForType(REVENUE_TYPES.has(fallbackType) ? fallbackType : 'EXPENSE');
    if (findContiguousBlock(group, fallbackRange.start, fallbackRange.end)) continue;

    // Absolute last resort: assign individually
    for (const acc of group) {
      let candidate = nhStart;
      while (existingSet.has(String(candidate)) || claimed.has(String(candidate))) candidate++;
      const newCode = String(candidate);
      claimed.add(newCode);
      result.set(acc.code, newCode);
      baseMapping.set(acc.code, newCode);
    }
  }

  // Now assign decimal codes under their new bases
  for (const decAcc of decimals) {
    const newBase = baseMapping.get(decAcc.base);
    if (!newBase) {
      // Base wasn't mapped — generate sequentially
      const code = generateNextCode({
        existingCodes: [...existingCodes, ...claimed],
        accountType: decAcc.type,
        batchClaimed: claimed,
      });
      claimed.add(code);
      result.set(decAcc.code, code);
      continue;
    }

    // Mirror the decimal: newBase.{same decimal}
    let decCandidate = decAcc.dec;
    let newCode = `${newBase}.${decCandidate}`;
    while (existingSet.has(newCode) || claimed.has(newCode)) {
      decCandidate++;
      newCode = `${newBase}.${decCandidate}`;
    }

    // Validate length (Xero 10-char limit)
    if (newCode.length > 10) {
      const fallback = generateNextCode({
        existingCodes: [...existingCodes, ...claimed],
        accountType: decAcc.type,
        batchClaimed: claimed,
      });
      claimed.add(fallback);
      result.set(decAcc.code, fallback);
    } else {
      claimed.add(newCode);
      result.set(decAcc.code, newCode);
    }
  }

  return result;
}

// ─── Batch Code Generation ──────────────────────────────────────────────────

export interface BatchCodeRequest {
  category: string;
  accountType: string;
}

/**
 * Generate codes for multiple accounts at once, avoiding intra-batch duplicates.
 */
export function generateBatchCodes(
  requests: BatchCodeRequest[],
  existingCodes: string[],
): string[] {
  const claimed = new Set<string>();
  const results: string[] = [];

  for (const req of requests) {
    const code = generateNextCode({
      existingCodes,
      accountType: req.accountType,
      batchClaimed: claimed,
    });
    claimed.add(code);
    results.push(code);
  }

  return results;
}
