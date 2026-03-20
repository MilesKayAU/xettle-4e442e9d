/**
 * Canonical marketplace label resolver — SINGLE SOURCE OF TRUTH.
 *
 * All files that need human-readable marketplace names MUST import from here.
 * Do NOT define local MARKETPLACE_LABELS maps in components.
 *
 * The static map below is a seed. `getMarketplaceLabel()` also checks the
 * `marketplace_registry` table (via async helper) for dynamic entries.
 */

/** Static seed labels — covers common codes and aliases */
export const MARKETPLACE_LABELS: Record<string, string> = {
  amazon_au: 'Amazon AU',
  amazon_us: 'Amazon US',
  amazon_uk: 'Amazon UK',
  amazon_ca: 'Amazon CA',
  amazon_de: 'Amazon DE',
  amazon_jp: 'Amazon JP',
  AU: 'Amazon AU',       // legacy alias from SP-API region
  bunnings: 'Bunnings',
  bigw: 'Big W',
  shopify_payments: 'Shopify Payments',
  shopify_orders: 'Shopify Orders',
  catch: 'Catch',
  mydeal: 'MyDeal',
  kogan: 'Kogan',
  woolworths: 'Everyday Market',
  woolworths_marketplus: 'Woolworths MarketPlus',
  everyday_market: 'Everyday Market',
  ebay_au: 'eBay AU',
  ebay: 'eBay AU',       // alias — canonical is ebay_au
  etsy: 'Etsy',
  paypal: 'PayPal',
  manual_orders: 'Manual Orders',
  theiconic: 'The Iconic',
  tiktok_shop: 'TikTok Shop',
  temu: 'Temu',
  shein: 'Shein',
  // Composite codes from Woolworths MarketPlus parser
  woolworths_marketplus_bigw: 'Big W',
  woolworths_marketplus_woolworths: 'Everyday Market',
  woolworths_marketplus_mydeal: 'MyDeal',
  woolworths_marketplus_everyday_market: 'Everyday Market',
  unknown: 'Unknown Marketplace',
};

/**
 * Get a human-readable label for a marketplace code.
 * Falls back to titlecase of the code if not found.
 */
export function getMarketplaceLabel(code: string | null | undefined): string {
  if (!code) return 'Unknown';
  const label = MARKETPLACE_LABELS[code];
  if (label) return label;
  // Fallback: "temu_shop" → "Temu Shop"
  return code.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}
