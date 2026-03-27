import { describe, it, expect } from 'vitest';
import {
  PUSHABLE_SOURCES,
  getSourcePriority,
  shouldSuppress,
  isReconciliationOnly,
  getPushBlockReason,
  checkSignConventions,
  applySignCorrections,
  validateSettlementId,
  validatePeriodDates,
} from '../settlementService';

describe('settlementService', () => {
  // ─── Source Priority ────────────────────────────────────────────
  describe('getSourcePriority', () => {
    it('csv_upload > api_sync', () => {
      expect(getSourcePriority('csv_upload')).toBeGreaterThan(getSourcePriority('api_sync'));
    });

    it('manual > mirakl_api', () => {
      expect(getSourcePriority('manual')).toBeGreaterThan(getSourcePriority('mirakl_api'));
    });

    it('unknown source gets -1', () => {
      expect(getSourcePriority('unknown_source')).toBe(-1);
    });
  });

  describe('shouldSuppress', () => {
    it('csv_upload suppresses api_sync', () => {
      expect(shouldSuppress('csv_upload', 'api_sync')).toBe(true);
    });

    it('api_sync does NOT suppress csv_upload', () => {
      expect(shouldSuppress('api_sync', 'csv_upload')).toBe(false);
    });

    it('same priority does NOT suppress', () => {
      expect(shouldSuppress('csv_upload', 'manual')).toBe(false);
    });
  });

  // ─── Push Eligibility ──────────────────────────────────────────
  describe('isReconciliationOnly', () => {
    it('api_sync is reconciliation-only', () => {
      expect(isReconciliationOnly('api_sync')).toBe(true);
    });

    it('csv_upload is pushable', () => {
      expect(isReconciliationOnly('csv_upload')).toBe(false);
    });

    it('shopify_auto_ settlements are reconciliation-only', () => {
      expect(isReconciliationOnly('csv_upload', null, 'shopify_auto_123')).toBe(true);
    });

    it('null source returns false', () => {
      expect(isReconciliationOnly(null)).toBe(false);
    });

    for (const source of PUSHABLE_SOURCES) {
      it(`${source} is pushable`, () => {
        expect(isReconciliationOnly(source)).toBe(false);
      });
    }
  });

  describe('getPushBlockReason', () => {
    it('returns null for pushable source', () => {
      expect(getPushBlockReason('csv_upload')).toBeNull();
    });

    it('returns reason for api_sync', () => {
      expect(getPushBlockReason('api_sync')).toContain('order-level data');
    });

    it('returns reason for shopify_auto_', () => {
      expect(getPushBlockReason('csv_upload', null, 'shopify_auto_123')).toContain('order-derived');
    });
  });

  // ─── Sign Conventions ──────────────────────────────────────────
  describe('checkSignConventions', () => {
    it('detects positive fees (should be negative)', () => {
      const violations = checkSignConventions({ seller_fees: 50 });
      expect(violations).toHaveLength(1);
      expect(violations[0].field).toBe('seller_fees');
      expect(violations[0].correctedValue).toBe(-50);
    });

    it('detects negative sales (should be positive)', () => {
      const violations = checkSignConventions({ sales_principal: -100 });
      expect(violations).toHaveLength(1);
      expect(violations[0].correctedValue).toBe(100);
    });

    it('passes correct values', () => {
      const violations = checkSignConventions({
        sales_principal: 100,
        seller_fees: -10,
        refunds: -5,
        bank_deposit: 85,
      });
      expect(violations).toHaveLength(0);
    });

    it('ignores null/undefined values', () => {
      const violations = checkSignConventions({
        fba_fees: null,
        storage_fees: undefined,
      });
      expect(violations).toHaveLength(0);
    });
  });

  describe('applySignCorrections', () => {
    it('corrects inverted signs', () => {
      const result = applySignCorrections({
        sales_principal: -100,
        seller_fees: 50,
        refunds: 10,
      });
      expect(result.sales_principal).toBe(100);
      expect(result.seller_fees).toBe(-50);
      expect(result.refunds).toBe(-10);
    });
  });

  // ─── Settlement ID Validation ──────────────────────────────────
  describe('validateSettlementId', () => {
    it('rejects empty ID', () => {
      expect(validateSettlementId('')).toContain('empty');
    });

    it('rejects short ID', () => {
      expect(validateSettlementId('ab')).toContain('short');
    });

    it('rejects test data', () => {
      expect(validateSettlementId('test_123')).toContain('test data');
    });

    it('accepts valid ID', () => {
      expect(validateSettlementId('kogan_2024-01-15_2024-01-31')).toBeNull();
    });
  });

  // ─── Date Validation ──────────────────────────────────────────
  describe('validatePeriodDates', () => {
    it('rejects missing dates', () => {
      expect(validatePeriodDates('', '2024-01-31')).toContain('missing');
    });

    it('rejects end before start', () => {
      expect(validatePeriodDates('2024-01-31', '2024-01-01')).toContain('before');
    });

    it('warns on >90 day span', () => {
      expect(validatePeriodDates('2024-01-01', '2024-06-01')).toContain('parsing error');
    });

    it('accepts valid period', () => {
      expect(validatePeriodDates('2024-01-01', '2024-01-31')).toBeNull();
    });
  });
});
