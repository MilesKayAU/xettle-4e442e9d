import { describe, it, expect } from 'vitest';
import {
  buildPostingLineItems,
  buildAuditCsvContent,
  toLineItemPreviews,
  createAccountCodeResolver,
  hashCsvContent,
  POSTING_CATEGORIES,
  CANONICAL_VERSION,
  type SettlementForPosting,
} from './xero-posting-line-items';

// ─── Golden Fixture: all 10 categories non-zero ─────────────────────────

const GOLDEN_SETTLEMENT: SettlementForPosting = {
  settlement_id: 'TEST-GOLDEN-001',
  marketplace: 'amazon_au',
  period_start: '2024-01-01',
  period_end: '2024-01-14',
  sales_principal: 5000.00,
  sales_shipping: 250.00,
  promotional_discounts: -75.00,
  refunds: -300.00,
  reimbursements: 45.00,
  seller_fees: -600.00,
  fba_fees: -350.00,
  storage_fees: -80.00,
  advertising_costs: -150.00,
  other_fees: -50.00,
  bank_deposit: 3690.00,
  gst_on_income: 487.50,
  gst_on_expenses: -123.00,
};

describe('xero-posting-line-items', () => {
  describe('CANONICAL_VERSION', () => {
    it('should be v2-10cat', () => {
      expect(CANONICAL_VERSION).toBe('v2-10cat');
    });
  });

  describe('POSTING_CATEGORIES', () => {
    it('should have exactly 10 categories', () => {
      expect(POSTING_CATEGORIES).toHaveLength(10);
    });

    it('category names should be unique', () => {
      const names = POSTING_CATEGORIES.map(c => c.name);
      expect(new Set(names).size).toBe(names.length);
    });
  });

  describe('buildPostingLineItems', () => {
    it('should return exactly 10 lines for the golden fixture', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      expect(lines).toHaveLength(10);
    });

    it('should produce correct tax types per category', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      const taxByDesc: Record<string, string> = {};
      for (const li of lines) taxByDesc[li.Description] = li.TaxType;

      expect(taxByDesc['Sales (Principal)']).toBe('OUTPUT');
      expect(taxByDesc['Shipping Revenue']).toBe('OUTPUT');
      expect(taxByDesc['Promotional Discounts']).toBe('OUTPUT');
      expect(taxByDesc['Refunds']).toBe('OUTPUT');
      expect(taxByDesc['Reimbursements']).toBe('BASEXCLUDED');
      expect(taxByDesc['Seller Fees']).toBe('INPUT');
      expect(taxByDesc['FBA Fees']).toBe('INPUT');
      expect(taxByDesc['Storage Fees']).toBe('INPUT');
      expect(taxByDesc['Advertising']).toBe('INPUT');
      expect(taxByDesc['Other Fees']).toBe('INPUT');
    });

    it('should separate shipping from sales', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      const salesLine = lines.find(l => l.Description === 'Sales (Principal)');
      const shippingLine = lines.find(l => l.Description === 'Shipping Revenue');

      expect(salesLine).toBeDefined();
      expect(shippingLine).toBeDefined();
      expect(salesLine!.UnitAmount).toBe(5000.00);
      expect(shippingLine!.UnitAmount).toBe(250.00);
    });

    it('should negate fee amounts (negate_abs sign)', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      const sellerFees = lines.find(l => l.Description === 'Seller Fees');
      const fbaFees = lines.find(l => l.Description === 'FBA Fees');

      expect(sellerFees!.UnitAmount).toBe(-600.00);
      expect(fbaFees!.UnitAmount).toBe(-350.00);
    });

    it('should keep promotional discounts as-is (negative from DB)', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      const promo = lines.find(l => l.Description === 'Promotional Discounts');
      expect(promo!.UnitAmount).toBe(-75.00);
    });

    it('should filter zero-amount lines', () => {
      const settlement: SettlementForPosting = {
        ...GOLDEN_SETTLEMENT,
        storage_fees: 0,
        advertising_costs: 0,
        reimbursements: 0,
      };
      const lines = buildPostingLineItems(settlement);
      expect(lines).toHaveLength(7);
      expect(lines.find(l => l.Description === 'Storage Fees')).toBeUndefined();
    });

    it('should use default account codes when no resolver provided', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      const salesLine = lines.find(l => l.Description === 'Sales (Principal)');
      expect(salesLine!.AccountCode).toBe('200');
    });

    it('should use custom account codes from resolver', () => {
      const resolver = createAccountCodeResolver({ 'Sales': '210', 'Seller Fees': '450' });
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT, resolver);

      const salesLine = lines.find(l => l.Description === 'Sales (Principal)');
      const feeLine = lines.find(l => l.Description === 'Seller Fees');
      expect(salesLine!.AccountCode).toBe('210');
      expect(feeLine!.AccountCode).toBe('450');
    });

    it('sum of line items should approximate bank_deposit within rounding', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      const lineSum = lines.reduce((sum, li) => sum + li.UnitAmount, 0);
      const bankDeposit = GOLDEN_SETTLEMENT.bank_deposit!;
      // Allow small rounding tolerance
      expect(Math.abs(lineSum - bankDeposit)).toBeLessThan(0.10);
    });
  });

  describe('toLineItemPreviews', () => {
    it('should convert to preview format', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      const previews = toLineItemPreviews(lines);
      expect(previews).toHaveLength(10);
      expect(previews[0].description).toBe('Sales (Principal)');
      expect(previews[0].amount).toBe(5000.00);
    });
  });

  describe('buildAuditCsvContent', () => {
    it('should produce 10 category rows + 1 totals row + header', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      const csv = buildAuditCsvContent(GOLDEN_SETTLEMENT, lines);
      const rows = csv.trim().split('\n');
      // 1 header + 10 category + 1 totals = 12
      expect(rows).toHaveLength(12);
    });

    it('totals row should have category "TOTAL"', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      const csv = buildAuditCsvContent(GOLDEN_SETTLEMENT, lines);
      const rows = csv.trim().split('\n');
      const lastRow = rows[rows.length - 1];
      expect(lastRow).toContain('"TOTAL"');
    });

    it('should include account_code and tax_type columns', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      const csv = buildAuditCsvContent(GOLDEN_SETTLEMENT, lines);
      const header = csv.split('\n')[0];
      expect(header).toContain('account_code');
      expect(header).toContain('tax_type');
    });

    it('CSV sum of amount_ex_gst should match line items sum', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      const csv = buildAuditCsvContent(GOLDEN_SETTLEMENT, lines);
      const rows = csv.trim().split('\n');
      // Parse the TOTAL row amount_ex_gst (6th column, index 5)
      const totalRow = rows[rows.length - 1];
      // Extract amount_ex_gst from CSV: parse quoted fields
      const fields = totalRow.match(/"([^"]*)"/g)?.map(f => f.replace(/"/g, '')) || [];
      const totalExGst = parseFloat(fields[5]);
      const lineSum = lines.reduce((sum, li) => sum + li.UnitAmount, 0);
      expect(Math.abs(totalExGst - lineSum)).toBeLessThan(0.02);
    });
  });

  describe('hashCsvContent', () => {
    it('should produce a consistent hash', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      const csv = buildAuditCsvContent(GOLDEN_SETTLEMENT, lines);
      const hash1 = hashCsvContent(csv);
      const hash2 = hashCsvContent(csv);
      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(8);
    });
  });
});
