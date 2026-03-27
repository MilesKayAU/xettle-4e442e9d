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
 * Re-exported from the canonical service layer.
 * @see src/services/xeroService.ts
 */
export { REQUIRED_CATEGORIES } from '@/services/xeroService';

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
