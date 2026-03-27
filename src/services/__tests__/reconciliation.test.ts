import { describe, it, expect } from 'vitest';
import {
  computeReconciliation,
  isGstInclusive,
  isPushSafe,
  classifyGap,
  RECONCILIATION_TOLERANCE,
  GST_INCLUSIVE_MARKETPLACES,
} from '@/services/reconciliation';

describe('reconciliation service', () => {
  // ─── GST classification ───────────────────────────────────────────

  it('classifies Shopify as GST-inclusive', () => {
    expect(isGstInclusive('shopify_payments')).toBe(true);
  });

  it('classifies Bunnings as GST-inclusive', () => {
    expect(isGstInclusive('bunnings')).toBe(true);
  });

  it('classifies Amazon AU as GST-exclusive', () => {
    expect(isGstInclusive('amazon_au')).toBe(false);
  });

  it('classifies Kogan as GST-exclusive', () => {
    expect(isGstInclusive('kogan')).toBe(false);
  });

  // ─── Core formula ─────────────────────────────────────────────────

  it('computes correct net for GST-exclusive marketplace (Kogan)', () => {
    // Real data from kogan_360140
    const result = computeReconciliation({
      marketplace: 'kogan',
      sales_principal: 966.76,
      sales_shipping: 0,
      seller_fees: -63.36,
      other_fees: 0,
      refunds: -49.44,
      reimbursements: 0,
      advertising_costs: -100.10,
      gst_on_income: 87.89,    // Should be IGNORED for Kogan
      gst_on_expenses: -5.76,  // Should be IGNORED for Kogan
      bank_deposit: 753.86,
    });

    expect(result.computedNet).toBe(753.86);
    expect(result.gap).toBe(0);
    expect(result.withinTolerance).toBe(true);
    expect(result.gstInclusive).toBe(false);
  });

  it('computes correct net for GST-inclusive marketplace (Bunnings)', () => {
    // Real data from BUN-2301-2026-03-14
    const result = computeReconciliation({
      marketplace: 'bunnings',
      sales_principal: 812.70,
      sales_shipping: 0,
      seller_fees: -120.23,
      other_fees: -235.29,
      refunds: 0,
      reimbursements: 0,
      advertising_costs: 0,
      gst_on_income: 81.27,
      gst_on_expenses: -12.01,
      bank_deposit: 526.44,
    });

    expect(result.computedNet).toBe(526.44);
    expect(result.gap).toBe(0);
    expect(result.withinTolerance).toBe(true);
    expect(result.gstInclusive).toBe(true);
  });

  it('detects gap outside tolerance', () => {
    const result = computeReconciliation({
      marketplace: 'amazon_au',
      sales_principal: 1000,
      sales_shipping: 50,
      seller_fees: -150,
      other_fees: 0,
      refunds: -25,
      reimbursements: 0,
      bank_deposit: 870, // should be 875
    });

    expect(result.withinTolerance).toBe(false);
    expect(result.absGap).toBe(5);
  });

  it('handles zero settlement gracefully', () => {
    const result = computeReconciliation({
      marketplace: 'shopify_payments',
      sales_principal: 0,
      sales_shipping: 0,
      seller_fees: 0,
      other_fees: 0,
      refunds: 0,
      reimbursements: 0,
      bank_deposit: 0,
    });

    expect(result.computedNet).toBe(0);
    expect(result.gap).toBe(0);
    expect(result.withinTolerance).toBe(true);
  });

  // ─── Push safety ──────────────────────────────────────────────────

  it('isPushSafe returns true within tolerance', () => {
    expect(isPushSafe({
      marketplace: 'amazon_au',
      sales_principal: 100,
      sales_shipping: 0,
      seller_fees: -15,
      other_fees: 0,
      refunds: 0,
      reimbursements: 0,
      bank_deposit: 85,
    })).toBe(true);
  });

  it('isPushSafe returns false outside tolerance', () => {
    expect(isPushSafe({
      marketplace: 'amazon_au',
      sales_principal: 100,
      sales_shipping: 0,
      seller_fees: -15,
      other_fees: 0,
      refunds: 0,
      reimbursements: 0,
      bank_deposit: 90, // $5 gap
    })).toBe(false);
  });

  // ─── Gap classification ───────────────────────────────────────────

  it('classifies gaps correctly', () => {
    expect(classifyGap(0.50)).toBe('matched');
    expect(classifyGap(1.00)).toBe('matched');
    expect(classifyGap(5.00)).toBe('rounding');
    expect(classifyGap(10.00)).toBe('rounding');
    expect(classifyGap(25.00)).toBe('warning');
    expect(classifyGap(100.00)).toBe('critical');
  });

  // ─── GST-inclusive marketplace list completeness ──────────────────

  it('includes all confirmed GST-inclusive marketplaces', () => {
    const expected = [
      'shopify_payments',
      'everyday_market',
      'bigw',
      'woolworths_marketplus',
      'woolworths_everyday',
      'woolworths_bigw',
      'bunnings',
    ];
    for (const mp of expected) {
      expect(isGstInclusive(mp)).toBe(true);
    }
  });

  it('excludes confirmed GST-exclusive marketplaces', () => {
    const excluded = ['amazon_au', 'kogan', 'mydeal', 'ebay_au'];
    for (const mp of excluded) {
      expect(isGstInclusive(mp)).toBe(false);
    }
  });
});
