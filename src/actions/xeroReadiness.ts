/**
 * Canonical Xero Readiness Checks
 * 
 * Re-exports from xero-mapping-readiness.ts and adds the canonical
 * REQUIRED_CATEGORIES constant that must stay in sync with the server-side
 * copy in sync-settlement-to-xero.
 * 
 * Server-side edge functions cannot import from src/, so they duplicate
 * REQUIRED_CATEGORIES. The sync test in this file's companion test ensures
 * they don't drift.
 */

// Re-export the canonical readiness check
export { 
  checkXeroReadinessForMarketplace,
  type XeroReadinessResult,
  type XeroReadinessCheck,
} from '@/utils/xero-mapping-readiness';

/**
 * The minimum categories required for a safe push.
 * 
 * CANONICAL SOURCE: This is the single source of truth.
 * The server-side copy in sync-settlement-to-xero/index.ts MUST match.
 * See: src/actions/__tests__/required-categories-sync.test.ts
 */
export const REQUIRED_CATEGORIES = ['Sales', 'Seller Fees', 'Refunds', 'Other Fees', 'Shipping'] as const;
