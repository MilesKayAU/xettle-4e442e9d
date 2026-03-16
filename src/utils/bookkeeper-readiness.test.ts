import { describe, it, expect } from 'vitest';
import { validateBookkeeperMinimumData } from './bookkeeper-readiness';
import type { StandardSettlement } from './settlement-engine';

function makeSettlement(overrides: Partial<StandardSettlement> = {}): StandardSettlement {
  return {
    marketplace: 'kogan',
    settlement_id: 'test-001',
    period_start: '2025-01-01',
    period_end: '2025-01-15',
    sales_ex_gst: 1000,
    gst_on_sales: 100,
    fees_ex_gst: -150,
    gst_on_fees: 15,
    net_payout: 965,
    source: 'csv_upload',
    reconciles: true,
    ...overrides,
  };
}

describe('validateBookkeeperMinimumData', () => {
  it('passes with all data present', () => {
    const result = validateBookkeeperMinimumData({
      settlement: makeSettlement(),
      hasLineItems: true,
    });
    expect(result.canSave).toBe(true);
    expect(result.blockingReasons).toHaveLength(0);
  });

  it('blocks when dates are missing', () => {
    const result = validateBookkeeperMinimumData({
      settlement: makeSettlement({ period_start: '', period_end: '' }),
      hasLineItems: true,
    });
    expect(result.canSave).toBe(false);
    expect(result.blockingReasons).toContain('dates_present');
  });

  it('blocks when net payout is NaN', () => {
    const result = validateBookkeeperMinimumData({
      settlement: makeSettlement({ net_payout: NaN }),
      hasLineItems: true,
    });
    expect(result.canSave).toBe(false);
    expect(result.blockingReasons).toContain('net_payout_present');
  });

  it('blocks when all totals are zero', () => {
    const result = validateBookkeeperMinimumData({
      settlement: makeSettlement({ sales_ex_gst: 0, fees_ex_gst: 0, net_payout: 0 }),
      hasLineItems: true,
    });
    expect(result.canSave).toBe(false);
    expect(result.blockingReasons).toContain('meaningful_totals_present');
  });

  it('passes for refund-only settlement', () => {
    const result = validateBookkeeperMinimumData({
      settlement: makeSettlement({
        sales_ex_gst: 0,
        fees_ex_gst: 0,
        net_payout: -500,
        metadata: { refundsExGst: -500 },
      }),
      hasLineItems: true,
    });
    expect(result.canSave).toBe(true);
  });

  it('warns but does not block when line items are missing', () => {
    const result = validateBookkeeperMinimumData({
      settlement: makeSettlement(),
      hasLineItems: false,
    });
    expect(result.canSave).toBe(true);
    const lineCheck = result.checks.find(c => c.key === 'line_items_available');
    expect(lineCheck?.status).toBe('warn');
  });

  it('warns when explicitly no line items', () => {
    const result = validateBookkeeperMinimumData({
      settlement: makeSettlement(),
      hasLineItems: false,
      lineItemsExplicitlyNone: true,
    });
    expect(result.canSave).toBe(true);
    const lineCheck = result.checks.find(c => c.key === 'line_items_available');
    expect(lineCheck?.status).toBe('warn');
    expect(lineCheck?.message).toContain('No transaction drilldown');
  });

  it('warns on reconciliation failure', () => {
    const result = validateBookkeeperMinimumData({
      settlement: makeSettlement(),
      hasLineItems: true,
      reconciles: false,
    });
    expect(result.canSave).toBe(true);
    const reconCheck = result.checks.find(c => c.key === 'reconciliation_sanity');
    expect(reconCheck?.status).toBe('warn');
  });
});
