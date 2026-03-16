/**
 * Tests for Trusted Format Lifecycle (Draft → Active) + Drift Detection
 */

import { describe, it, expect, vi } from 'vitest';
import { validateDraftGates, validateFormatGates, type FingerprintRecord } from './fingerprint-lifecycle';
import type { StandardSettlement } from './settlement-engine';

function makeSettlement(overrides: Partial<StandardSettlement> = {}): StandardSettlement {
  return {
    marketplace: 'kogan',
    settlement_id: 'test-123',
    period_start: '2025-01-01',
    period_end: '2025-01-15',
    sales_ex_gst: 1000,
    gst_on_sales: 100,
    fees_ex_gst: -150,
    gst_on_fees: 15,
    net_payout: 850,
    source: 'csv_upload',
    reconciles: true,
    metadata: { fileFormat: 'csv' },
    ...overrides,
  };
}

function makeFingerprint(overrides: Partial<FingerprintRecord> = {}): FingerprintRecord {
  return {
    id: 'fp-001',
    status: 'draft',
    parser_type: 'generic',
    confidence: null,
    marketplace_code: 'kogan',
    column_mapping: { gross_sales: 'Sales', fees: 'Commission', net_payout: 'Net' },
    column_signature: ['Sales', 'Commission', 'Net', 'Date'],
    ...overrides,
  };
}

describe('Trusted Format Lifecycle', () => {
  it('draft fingerprint with generic parser_type passes validation when gates met', () => {
    const fp = makeFingerprint({ status: 'draft', parser_type: 'generic' });
    const settlement = makeSettlement();
    const result = validateDraftGates(settlement, fp, 'csv');
    expect(result.canSave).toBe(true);
    expect(result.canAutoPromote).toBe(true);
    expect(result.missingGates).toHaveLength(0);
  });

  it('blocks save when period_start is missing', () => {
    const fp = makeFingerprint();
    const settlement = makeSettlement({ period_start: '', period_end: '2025-01-15' });
    const result = validateDraftGates(settlement, fp, 'csv');
    expect(result.canSave).toBe(false);
    expect(result.missingGates.some(g => g.includes('dates'))).toBe(true);
  });

  it('blocks save when period_end is missing', () => {
    const fp = makeFingerprint();
    const settlement = makeSettlement({ period_start: '2025-01-01', period_end: '' });
    const result = validateDraftGates(settlement, fp, 'csv');
    expect(result.canSave).toBe(false);
  });

  it('blocks save when reconciliation fails', () => {
    const fp = makeFingerprint();
    const settlement = makeSettlement({ reconciles: false });
    const result = validateDraftGates(settlement, fp, 'csv');
    expect(result.canSave).toBe(false);
    expect(result.missingGates.some(g => g.includes('Reconciliation'))).toBe(true);
  });

  it('allows auto-promote for generic CSV with all gates passing', () => {
    const fp = makeFingerprint({ parser_type: 'generic', confidence: null });
    const settlement = makeSettlement();
    const result = validateDraftGates(settlement, fp, 'csv');
    expect(result.canSave).toBe(true);
    expect(result.canAutoPromote).toBe(true);
  });

  it('does not auto-promote AI draft with confidence < 80', () => {
    const fp = makeFingerprint({ parser_type: 'ai', confidence: 65 });
    const settlement = makeSettlement();
    const result = validateDraftGates(settlement, fp, 'csv');
    expect(result.canSave).toBe(true);
    expect(result.canAutoPromote).toBe(false);
    expect(result.warnings.some(w => w.includes('confidence < 80'))).toBe(true);
  });

  it('auto-promotes AI draft with confidence >= 80', () => {
    const fp = makeFingerprint({ parser_type: 'ai', confidence: 85 });
    const settlement = makeSettlement();
    const result = validateDraftGates(settlement, fp, 'csv');
    expect(result.canSave).toBe(true);
    expect(result.canAutoPromote).toBe(true);
  });

  it('blocks save for rejected fingerprint', () => {
    const fp = makeFingerprint({ status: 'rejected' });
    const settlement = makeSettlement();
    const result = validateDraftGates(settlement, fp, 'csv');
    expect(result.canSave).toBe(false);
    expect(result.missingGates.some(g => g.includes('rejected'))).toBe(true);
  });

  it('active fingerprint skips draft gates entirely', () => {
    const fp = makeFingerprint({ status: 'active' });
    const settlement = makeSettlement({ period_start: '', reconciles: false });
    const result = validateDraftGates(settlement, fp, 'csv');
    expect(result.canSave).toBe(true);
    expect(result.canAutoPromote).toBe(false);
  });

  it('does not auto-promote PDF formats', () => {
    const fp = makeFingerprint({ parser_type: 'generic' });
    const settlement = makeSettlement();
    const result = validateDraftGates(settlement, fp, 'pdf');
    expect(result.canSave).toBe(true);
    expect(result.canAutoPromote).toBe(false);
  });

  it('blocks all-zero settlement', () => {
    const fp = makeFingerprint();
    const settlement = makeSettlement({ sales_ex_gst: 0, fees_ex_gst: 0, net_payout: 0 });
    const result = validateDraftGates(settlement, fp, 'csv');
    expect(result.canSave).toBe(false);
    expect(result.missingGates.some(g => g.includes('$0'))).toBe(true);
  });

  it('blocks save when sanity_failed is set', () => {
    const fp = makeFingerprint();
    const settlement = makeSettlement({ metadata: { sanity_failed: true, fileFormat: 'csv' } });
    const result = validateDraftGates(settlement, fp, 'csv');
    expect(result.canSave).toBe(false);
    expect(result.missingGates.some(g => g.includes('sanity'))).toBe(true);
  });
});

describe('Format Drift Detection (validateFormatGates)', () => {
  it('active fingerprint + passing gates => passes', () => {
    const fp = makeFingerprint({ status: 'active' });
    const settlement = makeSettlement();
    const result = validateFormatGates(settlement, fp);
    expect(result.passed).toBe(true);
    expect(result.failedGates).toHaveLength(0);
    expect(result.hardFailure).toBe(false);
  });

  it('active fingerprint + missing dates => hard failure', () => {
    const fp = makeFingerprint({ status: 'active' });
    const settlement = makeSettlement({ period_start: '', period_end: '' });
    const result = validateFormatGates(settlement, fp);
    expect(result.passed).toBe(false);
    expect(result.hardFailure).toBe(true);
    expect(result.failedGates).toContain('missing_dates');
  });

  it('active fingerprint + sanity_failed => hard failure', () => {
    const fp = makeFingerprint({ status: 'active' });
    const settlement = makeSettlement({ metadata: { sanity_failed: true, fileFormat: 'csv' } });
    const result = validateFormatGates(settlement, fp);
    expect(result.passed).toBe(false);
    expect(result.hardFailure).toBe(true);
    expect(result.failedGates).toContain('sanity_failed');
  });

  it('active fingerprint + payout mismatch => hard failure', () => {
    const fp = makeFingerprint({ status: 'active' });
    const settlement = makeSettlement({ net_payout: 0, sales_ex_gst: 5000 });
    const result = validateFormatGates(settlement, fp);
    expect(result.passed).toBe(false);
    expect(result.hardFailure).toBe(true);
    expect(result.failedGates).toContain('payout_mismatch');
  });

  it('active fingerprint + reconciliation failure only => soft failure (no hardFailure)', () => {
    const fp = makeFingerprint({ status: 'active' });
    const settlement = makeSettlement({ reconciles: false });
    const result = validateFormatGates(settlement, fp);
    expect(result.passed).toBe(false);
    expect(result.hardFailure).toBe(false);
    expect(result.failedGates).toContain('reconciliation_failed');
  });

  it('active fingerprint + incomplete mapping => soft failure', () => {
    const fp = makeFingerprint({ status: 'active', column_mapping: { gross_sales: 'Sales' } });
    const settlement = makeSettlement();
    const result = validateFormatGates(settlement, fp);
    expect(result.passed).toBe(false);
    expect(result.hardFailure).toBe(false);
    expect(result.failedGates).toContain('incomplete_mapping');
  });

  it('multiple failures accumulate correctly', () => {
    const fp = makeFingerprint({ status: 'active' });
    const settlement = makeSettlement({
      period_start: '',
      reconciles: false,
      metadata: { sanity_failed: true, fileFormat: 'csv' },
    });
    const result = validateFormatGates(settlement, fp);
    expect(result.passed).toBe(false);
    expect(result.hardFailure).toBe(true);
    expect(result.failedGates).toContain('missing_dates');
    expect(result.failedGates).toContain('sanity_failed');
    expect(result.failedGates).toContain('reconciliation_failed');
    expect(result.failedGates.length).toBeGreaterThanOrEqual(3);
  });
});
