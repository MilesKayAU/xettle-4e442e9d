/**
 * Commission Rate Parity Test
 * 
 * Ensures COMMISSION_ESTIMATES in the frontend utility matches the
 * canonical shared module used by edge functions.
 * 
 * If this test fails, rates have drifted between copies.
 */
import { describe, it, expect } from 'vitest';
import {
  COMMISSION_ESTIMATES,
  DEFAULT_COMMISSION_RATE,
} from '@/utils/insights-fee-attribution';

// The canonical rates that edge functions MUST match.
// Maintained here as the parity fixture — update both this AND
// supabase/functions/_shared/commission-rates.ts when rates change.
const CANONICAL_RATES: Record<string, number> = {
  kogan: 0.12,
  bigw: 0.08,
  everyday_market: 0.10,
  mydeal: 0.10,
  bunnings: 0.10,
  catch: 0.12,
  ebay_au: 0.13,
  iconic: 0.15,
  tradesquare: 0.10,
  tiktok: 0.05,
};
const CANONICAL_DEFAULT = 0.10;

describe('Commission Rate Parity', () => {
  it('frontend COMMISSION_ESTIMATES matches canonical rates', () => {
    // Every canonical key must exist in frontend
    for (const [mp, rate] of Object.entries(CANONICAL_RATES)) {
      expect(COMMISSION_ESTIMATES[mp]).toBe(rate);
    }
    // Frontend must not have extra keys beyond canonical
    for (const [mp, rate] of Object.entries(COMMISSION_ESTIMATES)) {
      expect(CANONICAL_RATES[mp]).toBe(rate);
    }
  });

  it('DEFAULT_COMMISSION_RATE matches canonical default', () => {
    expect(DEFAULT_COMMISSION_RATE).toBe(CANONICAL_DEFAULT);
  });

  it('rate count matches (no missing or extra entries)', () => {
    expect(Object.keys(COMMISSION_ESTIMATES).length).toBe(
      Object.keys(CANONICAL_RATES).length,
    );
  });
});
