import { describe, it, expect } from 'vitest';
import {
  computeSupportTier,
  getAutomationEligibility,
  getSupportWarnings,
  type TierInput,
} from './supportPolicy';

describe('computeSupportTier', () => {
  it('AU rail + AU_GST + AUD → SUPPORTED', () => {
    const input: TierInput = { rail: 'amazon_au', taxProfile: 'AU_GST', currency: 'AUD' };
    expect(computeSupportTier(input)).toBe('SUPPORTED');
  });

  it('AU rail + AU_GST + no currency → SUPPORTED', () => {
    expect(computeSupportTier({ rail: 'shopify_payments', taxProfile: 'AU_GST' })).toBe('SUPPORTED');
  });

  it('AU rail + EXPORT_NO_GST → EXPERIMENTAL', () => {
    expect(computeSupportTier({ rail: 'amazon_au', taxProfile: 'EXPORT_NO_GST' })).toBe('EXPERIMENTAL');
  });

  it('AU rail + USD currency → EXPERIMENTAL', () => {
    expect(computeSupportTier({ rail: 'ebay', taxProfile: 'AU_GST', currency: 'USD' })).toBe('EXPERIMENTAL');
  });

  it('non-AU known rail → EXPERIMENTAL', () => {
    expect(computeSupportTier({ rail: 'amazon_us', taxProfile: 'AU_GST', currency: 'USD', knownRail: true })).toBe('EXPERIMENTAL');
  });

  it('unknown rail (knownRail=false) → UNSUPPORTED', () => {
    expect(computeSupportTier({ rail: 'unknown_mp', taxProfile: 'AU_GST', knownRail: false })).toBe('UNSUPPORTED');
  });

  it('very low detection confidence → UNSUPPORTED', () => {
    expect(computeSupportTier({ rail: 'amazon_au', taxProfile: 'AU_GST', detectionConfidence: 0.2 })).toBe('UNSUPPORTED');
  });

  it('low detection confidence on AU rail → EXPERIMENTAL', () => {
    expect(computeSupportTier({ rail: 'amazon_au', taxProfile: 'AU_GST', detectionConfidence: 0.5 })).toBe('EXPERIMENTAL');
  });

  it('normalises aliases (ebay_au → ebay → SUPPORTED)', () => {
    expect(computeSupportTier({ rail: 'ebay_au', taxProfile: 'AU_GST' })).toBe('SUPPORTED');
  });
});

describe('getAutomationEligibility', () => {
  it('SUPPORTED tier allows everything', () => {
    const result = getAutomationEligibility({
      tier: 'SUPPORTED',
      taxMode: 'AU_GST_STANDARD',
      supportAcknowledgedAt: null,
      isAutopost: true,
    });
    expect(result.autopostAllowed).toBe(true);
    expect(result.authorisedAllowed).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('EXPERIMENTAL blocks AUTHORISED', () => {
    const result = getAutomationEligibility({
      tier: 'EXPERIMENTAL',
      taxMode: 'AU_GST_STANDARD',
      supportAcknowledgedAt: '2026-01-01',
      isAutopost: false,
    });
    expect(result.authorisedAllowed).toBe(false);
    expect(result.autopostDraftOnly).toBe(true);
  });

  it('EXPERIMENTAL without acknowledgement blocks autopost', () => {
    const result = getAutomationEligibility({
      tier: 'EXPERIMENTAL',
      taxMode: 'AU_GST_STANDARD',
      supportAcknowledgedAt: null,
      isAutopost: true,
    });
    expect(result.autopostAllowed).toBe(false);
    expect(result.requiresAcknowledgement).toBe(true);
  });

  it('UNSUPPORTED blocks autopost and authorised', () => {
    const result = getAutomationEligibility({
      tier: 'UNSUPPORTED',
      taxMode: 'AU_GST_STANDARD',
      supportAcknowledgedAt: null,
      isAutopost: true,
    });
    expect(result.autopostAllowed).toBe(false);
    expect(result.authorisedAllowed).toBe(false);
  });

  it('REVIEW_EACH_SETTLEMENT blocks autopost even for SUPPORTED', () => {
    const result = getAutomationEligibility({
      tier: 'SUPPORTED',
      taxMode: 'REVIEW_EACH_SETTLEMENT',
      supportAcknowledgedAt: null,
      isAutopost: true,
    });
    expect(result.autopostAllowed).toBe(false);
  });
});

describe('getSupportWarnings', () => {
  it('SUPPORTED tier returns no warnings', () => {
    expect(getSupportWarnings('SUPPORTED')).toEqual([]);
  });

  it('EXPERIMENTAL returns warning', () => {
    const warnings = getSupportWarnings('EXPERIMENTAL', { railLabel: 'Amazon US' });
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].level).toBe('warning');
  });

  it('UNSUPPORTED returns error', () => {
    const warnings = getSupportWarnings('UNSUPPORTED');
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0].level).toBe('error');
  });

  it('EXPERIMENTAL + authorised returns error warning', () => {
    const warnings = getSupportWarnings('EXPERIMENTAL', { isAuthorised: true });
    const authWarning = warnings.find(w => w.title === 'Authorised blocked');
    expect(authWarning).toBeDefined();
    expect(authWarning!.level).toBe('error');
  });
});
