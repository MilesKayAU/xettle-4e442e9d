import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase
const mockSelect = vi.fn();
const mockEq = vi.fn();
const mockMaybeSingle = vi.fn();
const mockInsert = vi.fn();
const mockHead = vi.fn();

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: vi.fn(() => ({
      select: vi.fn((_sel?: string, opts?: any) => {
        if (opts?.head) {
          return {
            eq: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue(mockHead()),
            }),
          };
        }
        return {
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: mockMaybeSingle,
            }),
          }),
        };
      }),
      insert: mockInsert.mockResolvedValue({ error: null }),
    })),
  },
}));

import { checkXeroReadinessForMarketplace } from './xero-mapping-readiness';

describe('checkXeroReadinessForMarketplace', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockResolvedValue({ error: null });
  });

  it('returns xeroConnected=false when no tenant', async () => {
    mockMaybeSingle.mockResolvedValueOnce({ data: null }); // xero_tenant_id
    const result = await checkXeroReadinessForMarketplace({
      marketplaceCode: 'kogan',
      userId: 'user-1',
    });
    expect(result.xeroConnected).toBe(false);
    expect(result.checks).toHaveLength(0);
  });

  it('returns fail for unknown marketplace contact', async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { value: 'tenant-123' } }) // xero_tenant_id
      .mockResolvedValueOnce({ data: null }); // account codes
    mockHead.mockResolvedValueOnce({ count: 1 }); // COA cache

    const result = await checkXeroReadinessForMarketplace({
      marketplaceCode: 'some_unknown_marketplace',
      userId: 'user-1',
    });
    expect(result.xeroConnected).toBe(true);
    const contactCheck = result.checks.find(c => c.key === 'contact_mapping');
    expect(contactCheck?.status).toBe('fail');
  });

  it('returns fail for missing account codes', async () => {
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { value: 'tenant-123' } }) // xero_tenant_id
      .mockResolvedValueOnce({ data: null }); // no account codes
    mockHead.mockResolvedValueOnce({ count: 1 }); // COA cache

    const result = await checkXeroReadinessForMarketplace({
      marketplaceCode: 'amazon_au',
      userId: 'user-1',
    });
    expect(result.xeroConnected).toBe(true);
    const mappingCheck = result.checks.find(c => c.key === 'account_mapping');
    expect(mappingCheck?.status).toBe('fail');
    expect(result.missingCategories).toBeDefined();
    expect(result.missingCategories!.length).toBeGreaterThan(0);
  });

  it('returns warn for base-only mappings', async () => {
    const codes = JSON.stringify({
      Sales: '200',
      'Seller Fees': '407',
      Refunds: '205',
      'Other Fees': '405',
      Shipping: '206',
    });
    mockMaybeSingle
      .mockResolvedValueOnce({ data: { value: 'tenant-123' } }) // xero_tenant_id
      .mockResolvedValueOnce({ data: { value: codes } }); // account codes (base only)
    mockHead.mockResolvedValueOnce({ count: 1 }); // COA cache

    const result = await checkXeroReadinessForMarketplace({
      marketplaceCode: 'amazon_au',
      userId: 'user-1',
    });
    expect(result.xeroConnected).toBe(true);
    const mappingCheck = result.checks.find(c => c.key === 'account_mapping');
    expect(mappingCheck?.status).toBe('warn');
  });
});
