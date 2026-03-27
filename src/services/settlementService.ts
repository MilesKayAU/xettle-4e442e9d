/**
 * Settlement Service — Pure business logic for settlement processing.
 *
 * This service owns:
 *   - Source priority rules (which source wins)
 *   - Push eligibility (reconciliation-only gating)
 *   - Sign convention validation
 *   - Settlement sanity checks
 *
 * The actions layer (src/actions/settlements.ts) handles DB operations
 * and calls these functions for business rule decisions.
 *
 * Edge functions replicate these rules server-side (Deno can't import src/).
 * This file is the canonical specification.
 *
 * @module services/settlementService
 */

// ─── Pushable Sources ───────────────────────────────────────────────────────

/**
 * Only these sources can create accounting entries in Xero.
 * Everything else is reconciliation-only.
 *
 * IMPORTANT: The server-side mirror at supabase/functions/_shared/settlementSources.ts
 * MUST stay identical.
 */
export const PUSHABLE_SOURCES = [
  'csv_upload',
  'manual',
  'api',
  'ebay_api',
  'mirakl_api',
  'amazon_api',
] as const;

export type PushableSource = typeof PUSHABLE_SOURCES[number];

// ─── Source Priority ────────────────────────────────────────────────────────

/**
 * Source priority ranking (higher index = higher priority).
 * CSV/manual always beats API-derived data.
 */
const SOURCE_PRIORITY: Record<string, number> = {
  api_sync: 0,
  mirakl_api: 1,
  api: 2,
  ebay_api: 2,
  amazon_api: 2,
  csv_upload: 3,
  manual: 3,
};

/**
 * Returns the priority rank for a source. Higher = more authoritative.
 * Unknown sources get -1 (lowest priority).
 */
export function getSourcePriority(source: string): number {
  return SOURCE_PRIORITY[source] ?? -1;
}

/**
 * Determines if newSource should suppress existingSource for the same period.
 */
export function shouldSuppress(newSource: string, existingSource: string): boolean {
  return getSourcePriority(newSource) > getSourcePriority(existingSource);
}

// ─── Push Eligibility ───────────────────────────────────────────────────────

/**
 * Returns true if a settlement source is reconciliation-only (cannot push to Xero).
 *
 * Logic:
 * 1. Source must be in the PUSHABLE_SOURCES allowlist
 * 2. Shopify auto-settlements are always reconciliation-only
 *
 * IMPORTANT: This logic MUST stay in sync with the server-side copy
 * at supabase/functions/_shared/settlementPolicy.ts.
 */
export function isReconciliationOnly(
  source?: string | null,
  marketplace?: string | null,
  settlementId?: string | null,
): boolean {
  if (!source) return false;

  // Allowlist gate: only approved payout sources can push to Xero
  if (!(PUSHABLE_SOURCES as readonly string[]).includes(source as PushableSource)) return true;

  // Secondary safety net: Shopify-derived auto-settlements
  if (settlementId?.startsWith('shopify_auto_')) return true;

  return false;
}

/**
 * Returns a user-facing reason why a settlement is blocked from Xero push,
 * or null if it's pushable.
 */
export function getPushBlockReason(
  source?: string | null,
  marketplace?: string | null,
  settlementId?: string | null,
): string | null {
  if (!source) return null;

  if (!(PUSHABLE_SOURCES as readonly string[]).includes(source as PushableSource)) {
    return 'This settlement contains order-level data only and cannot be pushed to Xero. Upload your payout CSV or export to create a pushable settlement.';
  }

  if (settlementId?.startsWith('shopify_auto_')) {
    return 'This is an order-derived reconciliation record — use the marketplace payout settlement for Xero push.';
  }

  return null;
}

// ─── Sign Convention Validation ─────────────────────────────────────────────

/**
 * Accounting sign conventions for settlement fields.
 * Australian accounting standard.
 */
export const SIGN_CONVENTIONS = {
  /** Must be zero or positive */
  positive: ['sales_principal', 'sales_shipping', 'reimbursements', 'gst_on_income'] as const,
  /** Must be zero or negative */
  negative: ['seller_fees', 'other_fees', 'fba_fees', 'storage_fees', 'advertising_costs', 'refunds', 'gst_on_expenses'] as const,
  /** Can be positive or negative */
  either: ['bank_deposit'] as const,
} as const;

export interface SignViolation {
  field: string;
  value: number;
  expected: 'positive' | 'negative';
  correctedValue: number;
}

/**
 * Check sign conventions on settlement fields and return violations.
 * Pure function — does not mutate input.
 */
export function checkSignConventions(fields: Record<string, number | null | undefined>): SignViolation[] {
  const violations: SignViolation[] = [];

  for (const field of SIGN_CONVENTIONS.positive) {
    const val = fields[field];
    if (val != null && val < 0) {
      violations.push({ field, value: val, expected: 'positive', correctedValue: Math.abs(val) });
    }
  }

  for (const field of SIGN_CONVENTIONS.negative) {
    const val = fields[field];
    if (val != null && val > 0) {
      violations.push({ field, value: val, expected: 'negative', correctedValue: -Math.abs(val) });
    }
  }

  return violations;
}

/**
 * Apply sign corrections to a settlement fields object.
 * Returns a new object with corrected values.
 */
export function applySignCorrections<T extends Record<string, any>>(fields: T): T {
  const corrected = { ...fields };
  const violations = checkSignConventions(fields);
  for (const v of violations) {
    (corrected as any)[v.field] = v.correctedValue;
  }
  return corrected;
}

// ─── Settlement ID Validation ───────────────────────────────────────────────

/**
 * Validates a settlement ID is not junk/placeholder data.
 * Returns null if valid, or an error message if invalid.
 */
export function validateSettlementId(settlementId: string): string | null {
  if (!settlementId || settlementId.trim() === '') {
    return 'Settlement ID is empty';
  }
  if (settlementId.length < 3) {
    return 'Settlement ID is too short (< 3 chars)';
  }
  // Check for common junk patterns
  if (/^(test|dummy|sample|example|xxx)/i.test(settlementId)) {
    return `Settlement ID looks like test data: ${settlementId}`;
  }
  return null;
}

// ─── Date Validation ────────────────────────────────────────────────────────

/**
 * Validates settlement period dates.
 * Returns null if valid, or an error message if invalid.
 */
export function validatePeriodDates(periodStart: string, periodEnd: string): string | null {
  if (!periodStart || !periodEnd) {
    return 'Settlement dates are missing. Cannot save without period_start and period_end.';
  }

  const start = new Date(periodStart);
  const end = new Date(periodEnd);

  if (isNaN(start.getTime())) return `Invalid period_start date: ${periodStart}`;
  if (isNaN(end.getTime())) return `Invalid period_end date: ${periodEnd}`;

  if (end < start) {
    return `period_end (${periodEnd}) is before period_start (${periodStart})`;
  }

  // Sanity check: settlement period shouldn't span more than 90 days
  const daySpan = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
  if (daySpan > 90) {
    return `Settlement period spans ${Math.round(daySpan)} days — this likely indicates a parsing error`;
  }

  return null;
}
