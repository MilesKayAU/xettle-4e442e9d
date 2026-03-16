/**
 * Tests for Trusted Format Lifecycle (Draft → Active)
 */

import { describe, it, expect, vi } from 'vitest';
import { validateDraftGates, type FingerprintRecord } from './fingerprint-lifecycle';
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
  // Test 1: First Contact creates fingerprint with status='draft' and correct parser_type
  it('draft fingerprint with generic parser_type passes validation when gates met', () => {
    const fp = makeFingerprint({ status: 'draft', parser_type: 'generic' });
    const settlement = makeSettlement();
    const result = validateDraftGates(settlement, fp, 'csv');
    expect(result.canSave).toBe(true);
    expect(result.canAutoPromote).toBe(true);
    expect(result.missingGates).toHaveLength(0);
  });

  // Test 2: Draft blocks save when dates missing (no fallback)
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

  // Test 3: Draft blocks save when reconciliation fails
  it('blocks save when reconciliation fails', () => {
    const fp = makeFingerprint();
    const settlement = makeSettlement({ reconciles: false });
    const result = validateDraftGates(settlement, fp, 'csv');
    expect(result.canSave).toBe(false);
    expect(result.missingGates.some(g => g.includes('Reconciliation'))).toBe(true);
  });

  // Test 4: Draft allows save and auto-promotes for low-risk CSV
  it('allows auto-promote for generic CSV with all gates passing', () => {
    const fp = makeFingerprint({ parser_type: 'generic', confidence: null });
    const settlement = makeSettlement();
    const result = validateDraftGates(settlement, fp, 'csv');
    expect(result.canSave).toBe(true);
    expect(result.canAutoPromote).toBe(true);
  });

  // Test 5: AI-created draft with confidence < 80 does NOT auto-promote
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

  // Test 6: Rejected fingerprint blocks save
  it('blocks save for rejected fingerprint', () => {
    const fp = makeFingerprint({ status: 'rejected' });
    const settlement = makeSettlement();
    const result = validateDraftGates(settlement, fp, 'csv');
    expect(result.canSave).toBe(false);
    expect(result.missingGates.some(g => g.includes('rejected'))).toBe(true);
  });

  // Test 7: Active fingerprint always allows save (no draft gates)
  it('active fingerprint skips draft gates entirely', () => {
    const fp = makeFingerprint({ status: 'active' });
    const settlement = makeSettlement({ period_start: '', reconciles: false });
    const result = validateDraftGates(settlement, fp, 'csv');
    expect(result.canSave).toBe(true);
    expect(result.canAutoPromote).toBe(false);
  });

  // Test: PDF formats don't auto-promote
  it('does not auto-promote PDF formats', () => {
    const fp = makeFingerprint({ parser_type: 'generic' });
    const settlement = makeSettlement();
    const result = validateDraftGates(settlement, fp, 'pdf');
    expect(result.canSave).toBe(true);
    expect(result.canAutoPromote).toBe(false);
  });

  // Test: All-zero settlement blocked
  it('blocks all-zero settlement', () => {
    const fp = makeFingerprint();
    const settlement = makeSettlement({ sales_ex_gst: 0, fees_ex_gst: 0, net_payout: 0 });
    const result = validateDraftGates(settlement, fp, 'csv');
    expect(result.canSave).toBe(false);
    expect(result.missingGates.some(g => g.includes('$0'))).toBe(true);
  });

  // Test: Sanity failed blocks save
  it('blocks save when sanity_failed is set', () => {
    const fp = makeFingerprint();
    const settlement = makeSettlement({ metadata: { sanity_failed: true, fileFormat: 'csv' } });
    const result = validateDraftGates(settlement, fp, 'csv');
    expect(result.canSave).toBe(false);
    expect(result.missingGates.some(g => g.includes('sanity'))).toBe(true);
  });
});
