/**
 * Canonical Xero Readiness Checks
 * 
 * Re-exports from xero-mapping-readiness.ts and adds the canonical
 * REQUIRED_CATEGORIES constant that must stay in sync with the server-side
 * copy in sync-settlement-to-xero.
 * 
 * Server-side edge functions cannot import from src/, so they duplicate
 * REQUIRED_CATEGORIES. The sync test in this file's companion test ensures
 * they don't drift.
 */

// Re-export the canonical readiness check
export { 
  checkXeroReadinessForMarketplace,
  type XeroReadinessResult,
  type XeroReadinessCheck,
} from '@/utils/xero-mapping-readiness';

import { computeSupportTier, getAutomationEligibility, getSupportWarnings, type SupportTier, type TaxMode, type TaxProfile, type AutomationEligibility, type SupportWarning } from '@/policy/supportPolicy';

/**
 * The minimum categories required for a safe push.
 * 
 * CANONICAL SOURCE: This is the single source of truth.
 * The server-side copy in sync-settlement-to-xero/index.ts MUST match.
 * See: src/actions/__tests__/required-categories-sync.test.ts
 */
export const REQUIRED_CATEGORIES = ['Sales', 'Seller Fees', 'Refunds', 'Other Fees', 'Shipping'] as const;

// ─── Rail Posting Eligibility ────────────────────────────────────────────────

export interface RailPostingEligibility {
  tier: SupportTier;
  automation: AutomationEligibility;
  warnings: SupportWarning[];
  canPushManually: boolean;
  canPushAuthorised: boolean;
}

/**
 * Compute the posting eligibility for a rail, combining tier, tax mode, and automation rules.
 * Used by RailPostingSettings UI and PushSafetyPreview.
 */
export function getRailPostingEligibility(opts: {
  rail: string;
  taxProfile: TaxProfile;
  taxMode: TaxMode;
  invoiceStatus: 'DRAFT' | 'AUTHORISED';
  supportAcknowledgedAt: string | null;
  currency?: string;
  detectionConfidence?: number;
  knownRail?: boolean;
}): RailPostingEligibility {
  const tier = computeSupportTier({
    rail: opts.rail,
    taxProfile: opts.taxProfile,
    currency: opts.currency,
    detectionConfidence: opts.detectionConfidence,
    knownRail: opts.knownRail,
  });

  const automation = getAutomationEligibility({
    tier,
    taxMode: opts.taxMode,
    supportAcknowledgedAt: opts.supportAcknowledgedAt,
    isAutopost: false, // This is about eligibility, not a specific push
  });

  const warnings = getSupportWarnings(tier, {
    isAuthorised: opts.invoiceStatus === 'AUTHORISED',
    isAutopost: false,
  });

  // Manual push rules
  let canPushManually = true;
  if (tier === 'UNSUPPORTED' && !opts.supportAcknowledgedAt) {
    canPushManually = false;
  }

  const canPushAuthorised = tier === 'SUPPORTED' && opts.taxMode !== 'REVIEW_EACH_SETTLEMENT';

  return {
    tier,
    automation,
    warnings,
    canPushManually,
    canPushAuthorised,
  };
}
