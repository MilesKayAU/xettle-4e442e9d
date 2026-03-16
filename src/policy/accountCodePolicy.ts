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
