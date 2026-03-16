/**
 * Support Policy — Single source of truth for AU-validated scope enforcement.
 *
 * Xettle is AU-validated (Australian GST + AU marketplace formats).
 * International rails are allowed but gated by tier.
 *
 * Edge functions cannot import this file; they duplicate minimal tier rules.
 * See: supabase/functions/auto-post-settlement/index.ts
 *      supabase/functions/sync-settlement-to-xero/index.ts
 */

import { PHASE_1_RAILS, toRailCode } from '@/constants/settlement-rails';

// ─── Tax Profiles (org-level) ────────────────────────────────────────────────

export const SUPPORTED_TAX_PROFILES = ['AU_GST', 'EXPORT_NO_GST'] as const;
export type TaxProfile = typeof SUPPORTED_TAX_PROFILES[number];

// ─── Tax Modes (per rail) ────────────────────────────────────────────────────

export const TAX_MODES = [
  'AU_GST_STANDARD',
  'EXPORT_NO_GST',
  'REVIEW_EACH_SETTLEMENT',
] as const;
export type TaxMode = typeof TAX_MODES[number];

// ─── Support Tiers ───────────────────────────────────────────────────────────

export type SupportTier = 'SUPPORTED' | 'EXPERIMENTAL' | 'UNSUPPORTED';

/** AU-validated rails (known formats, tested parsers, validated GST) */
const AU_VALIDATED_RAIL_CODES: Set<string> = new Set(
  PHASE_1_RAILS.map(r => r.code as string)
);

/** Currencies we've validated GST handling for */
const SUPPORTED_CURRENCIES = new Set(['AUD']);

// ─── Tier Computation ────────────────────────────────────────────────────────

export interface TierInput {
  /** Raw marketplace/rail code (will be normalised) */
  rail: string;
  /** Org-level tax profile */
  taxProfile: TaxProfile;
  /** Settlement currency (if known) */
  currency?: string;
  /** Parser detection confidence (0-1) */
  detectionConfidence?: number;
  /** Whether the rail is in the known registry */
  knownRail?: boolean;
}

export function computeSupportTier(input: TierInput): SupportTier {
  const normalised = toRailCode(input.rail);

  // Unknown rail with no registry entry → UNSUPPORTED
  if (input.knownRail === false) return 'UNSUPPORTED';

  // Very low detection confidence → UNSUPPORTED
  if (input.detectionConfidence !== undefined && input.detectionConfidence < 0.3) {
    return 'UNSUPPORTED';
  }

  // AU-validated rail + AU GST profile + AUD currency → SUPPORTED
  const isAuRail = AU_VALIDATED_RAIL_CODES.has(normalised);
  const isAuTax = input.taxProfile === 'AU_GST';
  const isAudCurrency = !input.currency || SUPPORTED_CURRENCIES.has(input.currency.toUpperCase());

  if (isAuRail && isAuTax && isAudCurrency) {
    // Low confidence degrades to EXPERIMENTAL even for AU rails
    if (input.detectionConfidence !== undefined && input.detectionConfidence < 0.6) {
      return 'EXPERIMENTAL';
    }
    return 'SUPPORTED';
  }

  // Known AU rail but non-AU tax profile or non-AUD → EXPERIMENTAL
  if (isAuRail) return 'EXPERIMENTAL';

  // Non-AU rail but known in registry → EXPERIMENTAL
  if (input.knownRail === undefined || input.knownRail === true) return 'EXPERIMENTAL';

  return 'UNSUPPORTED';
}

// ─── Warning Messages ────────────────────────────────────────────────────────

export interface SupportWarning {
  level: 'info' | 'warning' | 'error';
  title: string;
  description: string;
}

export function getSupportWarnings(tier: SupportTier, context?: {
  railLabel?: string;
  isAutopost?: boolean;
  isAuthorised?: boolean;
}): SupportWarning[] {
  const warnings: SupportWarning[] = [];
  const label = context?.railLabel || 'this marketplace';

  if (tier === 'EXPERIMENTAL') {
    warnings.push({
      level: 'warning',
      title: 'Experimental rail',
      description: `${label} is not fully validated for Australian GST. Settlements will be accepted but require manual review before posting.`,
    });

    if (context?.isAutopost) {
      warnings.push({
        level: 'warning',
        title: 'Auto-post restricted',
        description: `Auto-post for experimental rails creates DRAFT invoices only. Authorised mode is not available.`,
      });
    }

    if (context?.isAuthorised) {
      warnings.push({
        level: 'error',
        title: 'Authorised blocked',
        description: `Authorised invoice status is only available for fully supported (AU-validated) rails.`,
      });
    }
  }

  if (tier === 'UNSUPPORTED') {
    warnings.push({
      level: 'error',
      title: 'Unsupported rail',
      description: `${label} is not recognised. You can upload settlements for review, but automation is blocked.`,
    });

    if (context?.isAutopost) {
      warnings.push({
        level: 'error',
        title: 'Auto-post blocked',
        description: `Auto-post is not available for unsupported rails.`,
      });
    }
  }

  return warnings;
}

// ─── Automation Gating Rules ─────────────────────────────────────────────────

export interface AutomationEligibility {
  autopostAllowed: boolean;
  autopostDraftOnly: boolean;
  authorisedAllowed: boolean;
  requiresAcknowledgement: boolean;
  blockers: string[];
  warnings: string[];
}

export function getAutomationEligibility(opts: {
  tier: SupportTier;
  taxMode: TaxMode;
  supportAcknowledgedAt: string | null;
  isAutopost: boolean;
}): AutomationEligibility {
  const result: AutomationEligibility = {
    autopostAllowed: true,
    autopostDraftOnly: false,
    authorisedAllowed: true,
    requiresAcknowledgement: false,
    blockers: [],
    warnings: [],
  };

  // REVIEW_EACH_SETTLEMENT blocks autopost for all tiers
  if (opts.taxMode === 'REVIEW_EACH_SETTLEMENT' && opts.isAutopost) {
    result.autopostAllowed = false;
    result.blockers.push('Tax mode requires manual review of each settlement before posting.');
  }

  if (opts.tier === 'SUPPORTED') {
    // Full access
    return result;
  }

  if (opts.tier === 'EXPERIMENTAL') {
    result.authorisedAllowed = false;
    result.autopostDraftOnly = true;
    result.requiresAcknowledgement = !opts.supportAcknowledgedAt;

    if (!opts.supportAcknowledgedAt) {
      result.autopostAllowed = false;
      result.blockers.push('Experimental rail requires acknowledgement before automation.');
    }

    result.warnings.push('Experimental rail — auto-post creates DRAFT invoices only.');
    return result;
  }

  // UNSUPPORTED
  result.autopostAllowed = false;
  result.authorisedAllowed = false;
  result.blockers.push('Unsupported rail — auto-post is blocked.');
  result.warnings.push('Manual push allowed as DRAFT only after acknowledgement.');
  result.requiresAcknowledgement = !opts.supportAcknowledgedAt;

  return result;
}

// ─── Scope Consent ───────────────────────────────────────────────────────────

export const SCOPE_VERSION = 'scope-v1-au-validated';

export interface ScopeConsent {
  acknowledged: boolean;
  acknowledgedAt: string | null;
  version: string | null;
}
