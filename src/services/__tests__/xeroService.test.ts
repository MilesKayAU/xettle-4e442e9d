import { describe, it, expect } from 'vitest';
import {
  REQUIRED_CATEGORIES,
  checkPushCategoryCoverage,
  evaluatePushSafety,
} from '../xeroService';

describe('xeroService', () => {
  describe('checkPushCategoryCoverage', () => {
    it('all categories mapped → eligible', () => {
      const result = checkPushCategoryCoverage('amazon_au', [
        'Sales', 'Seller Fees', 'Refunds', 'Other Fees', 'Shipping',
      ]);
      expect(result.eligible).toBe(true);
      expect(result.missingCategories).toHaveLength(0);
    });

    it('case-insensitive matching', () => {
      const result = checkPushCategoryCoverage('amazon_au', [
        'sales', 'seller fees', 'refunds', 'other fees', 'shipping',
      ]);
      expect(result.eligible).toBe(true);
    });

    it('missing categories → not eligible', () => {
      const result = checkPushCategoryCoverage('amazon_au', ['Sales', 'Shipping']);
      expect(result.eligible).toBe(false);
      expect(result.missingCategories).toContain('Seller Fees');
      expect(result.missingCategories).toContain('Refunds');
      expect(result.errorCode).toBe('MAPPING_REQUIRED');
    });

    it('empty categories → all missing', () => {
      const result = checkPushCategoryCoverage('amazon_au', []);
      expect(result.eligible).toBe(false);
      expect(result.missingCategories).toHaveLength(REQUIRED_CATEGORIES.length);
    });
  });

  describe('evaluatePushSafety', () => {
    it('blocks reconciliation-only sources', () => {
      const result = evaluatePushSafety({
        source: 'api_sync',
        marketplace: 'kogan',
      });
      expect(result.safe).toBe(false);
      expect(result.errorCode).toBe('RECON_ONLY');
    });

    it('blocks large reconciliation gaps', () => {
      const result = evaluatePushSafety({
        source: 'csv_upload',
        marketplace: 'kogan',
        reconciliationInput: {
          marketplace: 'kogan',
          sales_principal: 1000,
          sales_shipping: 0,
          seller_fees: -100,
          other_fees: 0,
          refunds: 0,
          reimbursements: 0,
          bank_deposit: 500, // Gap of $400
        },
      });
      expect(result.safe).toBe(false);
      expect(result.errorCode).toBe('RECON_GAP');
      expect(result.reconGap).toBeGreaterThan(1);
    });

    it('allows push within tolerance', () => {
      const result = evaluatePushSafety({
        source: 'csv_upload',
        marketplace: 'kogan',
        reconciliationInput: {
          marketplace: 'kogan',
          sales_principal: 1000,
          sales_shipping: 50,
          seller_fees: -150,
          other_fees: -10,
          refunds: -20,
          reimbursements: 0,
          bank_deposit: 870.50, // Gap = 0.50 (within $1 tolerance)
        },
      });
      expect(result.safe).toBe(true);
    });

    it('allows push without reconciliation data', () => {
      const result = evaluatePushSafety({
        source: 'csv_upload',
        marketplace: 'kogan',
      });
      expect(result.safe).toBe(true);
    });
  });
});
