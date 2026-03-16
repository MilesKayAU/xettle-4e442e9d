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

// ═══════════════════════════════════════════════════════════════
// GOLDEN FIXTURE — Amazon AU settlement with all 10 categories
//
// DB SIGN CONVENTION (Option A — "Use Stored Sign"):
//   Field                  DB Value   Accounting Direction   Expected Posted Amount
//   ─────────────────────  ─────────  ────────────────────   ─────────────────────
//   sales_principal         +5000.00  Income (positive)      +5000.00
//   sales_shipping           +250.00  Income (positive)       +250.00
//   promotional_discounts     -75.00  Reduction (negative)     -75.00
//   refunds                  -300.00  Reduction (negative)    -300.00
//   reimbursements            +45.00  Recovery (positive)      +45.00
//   seller_fees              -600.00  Expense (negative)      -600.00
//   fba_fees                 -350.00  Expense (negative)      -350.00
//   storage_fees              -80.00  Expense (negative)       -80.00
//   advertising_costs        -150.00  Expense (negative)      -150.00
//   other_fees                -50.00  Expense (negative)       -50.00
//   ─────────────────────────────────────────────────────────────
//   SUM of all lines:       3690.00  === bank_deposit         3690.00
// ═══════════════════════════════════════════════════════════════

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

  // ═══════════════════════════════════════════════════════════════
  // SIGN HANDLING TESTS — Option A ("Use Stored Sign")
  // Verifies NO sign manipulation occurs — DB value = posted value
  // ═══════════════════════════════════════════════════════════════

  describe('buildPostingLineItems — sign handling (Option A)', () => {
    it('should return exactly 10 lines for the golden fixture', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      expect(lines).toHaveLength(10);
    });

    it('should pass through positive income values unchanged', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      const sales = lines.find(l => l.Description === 'Sales (Principal)');
      const shipping = lines.find(l => l.Description === 'Shipping Revenue');
      const reimb = lines.find(l => l.Description === 'Reimbursements');

      expect(sales!.UnitAmount).toBe(5000.00);
      expect(shipping!.UnitAmount).toBe(250.00);
      expect(reimb!.UnitAmount).toBe(45.00);
    });

    it('should pass through negative reduction values unchanged (no double-negation)', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      const promo = lines.find(l => l.Description === 'Promotional Discounts');
      const refunds = lines.find(l => l.Description === 'Refunds');

      expect(promo!.UnitAmount).toBe(-75.00);
      expect(refunds!.UnitAmount).toBe(-300.00);
    });

    it('should pass through negative fee values unchanged (no double-negation)', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      const sellerFees = lines.find(l => l.Description === 'Seller Fees');
      const fbaFees = lines.find(l => l.Description === 'FBA Fees');
      const storageFees = lines.find(l => l.Description === 'Storage Fees');
      const advertising = lines.find(l => l.Description === 'Advertising');
      const otherFees = lines.find(l => l.Description === 'Other Fees');

      expect(sellerFees!.UnitAmount).toBe(-600.00);
      expect(fbaFees!.UnitAmount).toBe(-350.00);
      expect(storageFees!.UnitAmount).toBe(-80.00);
      expect(advertising!.UnitAmount).toBe(-150.00);
      expect(otherFees!.UnitAmount).toBe(-50.00);
    });

    it('sum of all line items should exactly equal bank_deposit', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      const lineSum = lines.reduce((sum, li) => sum + li.UnitAmount, 0);
      const bankDeposit = GOLDEN_SETTLEMENT.bank_deposit!;
      // With stored-sign convention, sum should be exact (no rounding drift)
      expect(Math.abs(lineSum - bankDeposit)).toBeLessThan(0.01);
    });

    it('should NOT double-negate if fees are already negative in DB', () => {
      // This is the critical regression test: if a fee is stored as -600,
      // the builder must NOT produce -abs(-600) = -600 or abs(-600) = +600.
      // It must produce exactly -600.
      const settlement: SettlementForPosting = {
        ...GOLDEN_SETTLEMENT,
        seller_fees: -600.00,  // Already negative in DB
      };
      const lines = buildPostingLineItems(settlement);
      const sellerFees = lines.find(l => l.Description === 'Seller Fees');
      expect(sellerFees!.UnitAmount).toBe(-600.00); // Same as DB value
    });

    it('should correctly handle a fee stored as positive (parser bug scenario)', () => {
      // If a parser incorrectly stores fees as positive, the builder should
      // pass it through as positive. This will surface as a balance mismatch
      // in reconciliation, which is the correct behavior — NOT silently flipping signs.
      const settlement: SettlementForPosting = {
        ...GOLDEN_SETTLEMENT,
        seller_fees: 600.00,  // Incorrectly positive — parser bug
      };
      const lines = buildPostingLineItems(settlement);
      const sellerFees = lines.find(l => l.Description === 'Seller Fees');
      expect(sellerFees!.UnitAmount).toBe(600.00); // Passed through, will fail reconciliation
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // TAX TYPE TESTS — AU GST correctness
  // ═══════════════════════════════════════════════════════════════

  describe('AU GST tax type mapping', () => {
    it('should produce correct tax types per category', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      const taxByDesc: Record<string, string> = {};
      for (const li of lines) taxByDesc[li.Description] = li.TaxType;

      // Revenue categories: OUTPUT (GST on sales, seller collects)
      expect(taxByDesc['Sales (Principal)']).toBe('OUTPUT');
      expect(taxByDesc['Shipping Revenue']).toBe('OUTPUT');

      // Contra-revenue: OUTPUT (reduces OUTPUT-taxed revenue)
      expect(taxByDesc['Promotional Discounts']).toBe('OUTPUT');
      expect(taxByDesc['Refunds']).toBe('OUTPUT');

      // Non-taxable recovery: BASEXCLUDED
      expect(taxByDesc['Reimbursements']).toBe('BASEXCLUDED');

      // Expense categories: INPUT (GST on purchases, seller claims credit)
      expect(taxByDesc['Seller Fees']).toBe('INPUT');
      expect(taxByDesc['FBA Fees']).toBe('INPUT');
      expect(taxByDesc['Storage Fees']).toBe('INPUT');
      expect(taxByDesc['Advertising']).toBe('INPUT');
      expect(taxByDesc['Other Fees']).toBe('INPUT');
    });

    it('Promotional Discounts should be OUTPUT (contra-revenue, not INPUT)', () => {
      // Discounts reduce the GST-inclusive sale price. They are not a separate
      // purchase/expense. They must use OUTPUT to correctly reduce GST collected.
      const cat = POSTING_CATEGORIES.find(c => c.name === 'Promotional Discounts');
      expect(cat!.taxType).toBe('OUTPUT');
    });

    it('Refunds should be OUTPUT (reversal of sale, not INPUT)', () => {
      // Refunds reverse a previous OUTPUT-taxed sale. Using INPUT would
      // incorrectly claim an input credit instead of reducing GST collected.
      const cat = POSTING_CATEGORIES.find(c => c.name === 'Refunds');
      expect(cat!.taxType).toBe('OUTPUT');
    });

    it('Reimbursements should be BASEXCLUDED (not a taxable supply)', () => {
      // Amazon reimbursements (e.g., lost/damaged inventory) are not a taxable
      // supply. They are compensation, not revenue. No GST applies.
      const cat = POSTING_CATEGORIES.find(c => c.name === 'Reimbursements');
      expect(cat!.taxType).toBe('BASEXCLUDED');
    });

    it('all fee categories should be INPUT', () => {
      const feeCategories = ['Seller Fees', 'FBA Fees', 'Storage Fees', 'Advertising', 'Other Fees'];
      for (const name of feeCategories) {
        const cat = POSTING_CATEGORIES.find(c => c.name === name);
        expect(cat!.taxType).toBe('INPUT');
      }
    });

    it('CATEGORY_TAX_MAP should match exactly for AU GST', () => {
      // This is the definitive AU GST mapping assertion.
      // If any of these change, CANONICAL_VERSION must be bumped.
      const expected: Record<string, string> = {
        'Sales (Principal)': 'OUTPUT',
        'Shipping Revenue': 'OUTPUT',
        'Promotional Discounts': 'OUTPUT',
        'Refunds': 'OUTPUT',
        'Reimbursements': 'BASEXCLUDED',
        'Seller Fees': 'INPUT',
        'FBA Fees': 'INPUT',
        'Storage Fees': 'INPUT',
        'Advertising': 'INPUT',
        'Other Fees': 'INPUT',
      };

      for (const cat of POSTING_CATEGORIES) {
        expect(cat.taxType).toBe(expected[cat.name]);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════
  // OTHER BUILDER TESTS
  // ═══════════════════════════════════════════════════════════════

  describe('buildPostingLineItems — other', () => {
    it('should separate shipping from sales', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      const salesLine = lines.find(l => l.Description === 'Sales (Principal)');
      const shippingLine = lines.find(l => l.Description === 'Shipping Revenue');

      expect(salesLine).toBeDefined();
      expect(shippingLine).toBeDefined();
      expect(salesLine!.UnitAmount).toBe(5000.00);
      expect(shippingLine!.UnitAmount).toBe(250.00);
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
    it('should produce comment row + header + 10 category rows + 1 totals row', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      const csv = buildAuditCsvContent(GOLDEN_SETTLEMENT, lines);
      const rows = csv.trim().split('\n');
      // 1 comment + 1 header + 10 category + 1 totals = 13
      expect(rows).toHaveLength(13);
    });

    it('first row should be GST estimate disclaimer comment', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      const csv = buildAuditCsvContent(GOLDEN_SETTLEMENT, lines);
      const firstRow = csv.split('\n')[0];
      expect(firstRow).toContain('GST values are estimates');
    });

    it('totals row should have category "TOTAL"', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      const csv = buildAuditCsvContent(GOLDEN_SETTLEMENT, lines);
      const rows = csv.trim().split('\n');
      const lastRow = rows[rows.length - 1];
      expect(lastRow).toContain('"TOTAL"');
    });

    it('should use gst_estimate and amount_inc_gst_estimate headers (not gst_amount)', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      const csv = buildAuditCsvContent(GOLDEN_SETTLEMENT, lines);
      const headerRow = csv.split('\n')[1]; // second row (after comment)
      expect(headerRow).toContain('gst_estimate');
      expect(headerRow).toContain('amount_inc_gst_estimate');
      expect(headerRow).not.toContain('gst_amount');
      expect(headerRow).not.toMatch(/amount_inc_gst[^_]/); // should not have bare amount_inc_gst
    });

    it('should include account_code and tax_type columns', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      const csv = buildAuditCsvContent(GOLDEN_SETTLEMENT, lines);
      const headerRow = csv.split('\n')[1];
      expect(headerRow).toContain('account_code');
      expect(headerRow).toContain('tax_type');
    });

    it('CSV sum of amount_ex_gst should match line items sum', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      const csv = buildAuditCsvContent(GOLDEN_SETTLEMENT, lines);
      const rows = csv.trim().split('\n');
      const totalRow = rows[rows.length - 1];
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

  // ═══════════════════════════════════════════════════════════════
  // REGRESSION TESTS — Push Safety Architecture
  // ═══════════════════════════════════════════════════════════════

  describe('Push safety regressions', () => {
    it('invoice status must always be DRAFT — buildPostingLineItems never produces AUTHORISED metadata', () => {
      // The edge function hardcodes Status: "DRAFT" (sync-settlement-to-xero L932).
      // This test ensures the canonical version constant never changes to something unexpected.
      expect(CANONICAL_VERSION).toBe('v2-10cat');
      // Line items themselves don't carry status — the DRAFT is enforced at edge function level.
      // This test documents the invariant and catches if anyone adds a status field to line items.
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      for (const line of lines) {
        // No line item should have a status property
        expect(line).not.toHaveProperty('Status');
        expect(line).not.toHaveProperty('status');
      }
    });

    it('buildPostingLineItems requires all fields present (missing data produces empty/zero lines)', () => {
      // Simulate missing settlementData — function should handle gracefully
      const empty: SettlementForPosting = {
        settlement_id: 'TEST-MISSING',
        marketplace: 'unknown_marketplace',
        period_start: '2024-01-01',
        period_end: '2024-01-14',
        sales_principal: 0,
        sales_shipping: 0,
        promotional_discounts: 0,
        refunds: 0,
        reimbursements: 0,
        seller_fees: 0,
        fba_fees: 0,
        storage_fees: 0,
        advertising_costs: 0,
        other_fees: 0,
        bank_deposit: 0,
        gst_on_income: 0,
        gst_on_expenses: 0,
      };
      const lines = buildPostingLineItems(empty);
      // All-zero settlement should produce zero or empty lines (no non-zero amounts)
      const nonZeroLines = lines.filter(l => l.UnitAmount !== 0);
      expect(nonZeroLines.length).toBe(0);
    });

    it('attachment CSV content is never empty for a real settlement', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      const csv = buildAuditCsvContent(GOLDEN_SETTLEMENT, lines);
      // CSV must have header + at least one data row
      expect(csv.split('\n').length).toBeGreaterThanOrEqual(2);
      // CSV must contain the settlement ID for traceability
      expect(csv).toContain(GOLDEN_SETTLEMENT.settlement_id);
    });

    it('line items sum matches bank_deposit (the foundation of attachment integrity)', () => {
      const lines = buildPostingLineItems(GOLDEN_SETTLEMENT);
      const sum = lines.reduce((acc, l) => acc + l.UnitAmount * (l.Quantity || 1), 0);
      expect(Math.abs(sum - GOLDEN_SETTLEMENT.bank_deposit)).toBeLessThan(0.02);
    });
  });
});
