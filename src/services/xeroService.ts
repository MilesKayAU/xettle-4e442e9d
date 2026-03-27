/**
 * Xero Service — Pure business logic for Xero push eligibility and readiness.
 *
 * This service owns:
 *   - COA category coverage checks (pre-push gate)
 *   - Push safety evaluation (combining reconciliation + policy)
 *   - Required categories specification
 *
 * The actions layer (src/actions/xeroPush.ts) handles edge function calls
 * and DB writes. This file provides the decision logic.
 *
 * @module services/xeroService
 */

import { computeReconciliation, RECONCILIATION_TOLERANCE, type ReconciliationInput } from './reconciliation';
import { isReconciliationOnly } from './settlementService';

// ─── Required COA Categories ────────────────────────────────────────────────

/**
 * The minimum categories required for a safe push to Xero.
 *
 * CANONICAL SOURCE: This is the single source of truth.
 * The server-side copy in sync-settlement-to-xero/index.ts MUST match.
 * See: src/actions/__tests__/required-categories-sync.test.ts
 */
export const REQUIRED_CATEGORIES = ['Sales', 'Seller Fees', 'Refunds', 'Other Fees', 'Shipping'] as const;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface PushEligibility {
  eligible: boolean;
  missingCategories: string[];
  errorCode?: string;
}

export type PushSafetyResult = {
  safe: boolean;
  reason?: string;
  errorCode?: 'RECON_GAP' | 'RECON_ONLY' | 'MAPPING_REQUIRED' | 'NO_DATA';
  reconGap?: number;
  reconTolerance?: number;
};

// ─── COA Coverage Check ─────────────────────────────────────────────────────

/**
 * Check if a marketplace has sufficient COA coverage to allow a push.
 * This is the canonical pre-push gate.
 *
 * Invariant: if required categories are unmapped, push is blocked regardless
 * of what the UI shows.
 */
export function checkPushCategoryCoverage(
  marketplace: string,
  mappedCategories: string[],
): PushEligibility {
  const mappedSet = new Set(mappedCategories.map(c => c.toLowerCase()));
  const missing = REQUIRED_CATEGORIES.filter(
    cat => !mappedSet.has(cat.toLowerCase()),
  );

  if (missing.length > 0) {
    return {
      eligible: false,
      missingCategories: missing,
      errorCode: 'MAPPING_REQUIRED',
    };
  }

  return { eligible: true, missingCategories: [] };
}

// ─── Push Safety Evaluation ─────────────────────────────────────────────────

/**
 * Comprehensive push safety check combining all gates:
 * 1. Source must be pushable (not reconciliation-only)
 * 2. Reconciliation gap must be within tolerance
 * 3. COA categories must be mapped (checked separately)
 *
 * This is pure business logic — no DB calls.
 */
export function evaluatePushSafety(opts: {
  source?: string | null;
  marketplace: string;
  settlementId?: string | null;
  reconciliationInput?: ReconciliationInput;
}): PushSafetyResult {
  // Gate 1: Source eligibility
  if (isReconciliationOnly(opts.source, opts.marketplace, opts.settlementId)) {
    return {
      safe: false,
      reason: 'This settlement source is reconciliation-only and cannot be pushed to Xero.',
      errorCode: 'RECON_ONLY',
    };
  }

  // Gate 2: Reconciliation gap
  if (opts.reconciliationInput) {
    const recon = computeReconciliation(opts.reconciliationInput);
    if (!recon.withinTolerance) {
      return {
        safe: false,
        reason: `Reconciliation gap of $${recon.absGap.toFixed(2)} exceeds $${RECONCILIATION_TOLERANCE.toFixed(2)} tolerance. Edit figures to resolve before pushing.`,
        errorCode: 'RECON_GAP',
        reconGap: recon.absGap,
        reconTolerance: RECONCILIATION_TOLERANCE,
      };
    }
  }

  return { safe: true };
}
