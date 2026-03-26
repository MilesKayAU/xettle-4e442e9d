/**
 * Canonical marketplace contact names for Xero invoices.
 * 
 * ══════════════════════════════════════════════════════════════
 * SINGLE SOURCE OF TRUTH — used by:
 *   - settlement-engine.ts (client-side, re-exports this)
 *   - PushSafetyPreview (client-side, via settlement-engine)
 *   - sync-settlement-to-xero edge function (must be kept in sync manually;
 *     see drift-detection test in marketplace-contacts.test.ts)
 * 
 * When adding a new marketplace, update BOTH:
 *   1. This file (canonical source)
 *   2. supabase/functions/sync-settlement-to-xero/index.ts SERVER_MARKETPLACE_CONTACTS
 * 
 * A test enforces that the two maps stay in sync.
 * ══════════════════════════════════════════════════════════════
 */

export const MARKETPLACE_CONTACTS: Record<string, string> = {
  amazon_au: 'Amazon.com.au',
  amazon_us: 'Amazon.com',
  amazon_uk: 'Amazon.co.uk',
  amazon_ca: 'Amazon.ca',
  shopify_payments: 'Shopify Payments',
  shopify_orders: 'Shopify',
  bunnings: 'Bunnings Marketplace',
  bigw: 'Big W Marketplace',
  catch: 'Catch Marketplace',
  mydeal: 'MyDeal Marketplace',
  kogan: 'Kogan Australia Pty Ltd',
  woolworths: 'Woolworths Marketplace',
  woolworths_marketplus: 'Woolworths MarketPlus',
  ebay_au: 'eBay Australia',
  everyday_market: 'Everyday Market',
  theiconic: 'THE ICONIC',
  etsy: 'Etsy',
};

/**
 * Snapshot of the SERVER_MARKETPLACE_CONTACTS keys in sync-settlement-to-xero.
 * Used by the drift-detection test to ensure server and client stay in sync.
 * 
 * When you add a key to the edge function, add it here too (and to MARKETPLACE_CONTACTS above).
 */
export const SERVER_CONTACT_KEYS_SNAPSHOT: string[] = Object.keys(MARKETPLACE_CONTACTS).sort();
