/**
 * Marketplace Registry — Central definition for all marketplace and gateway sources.
 * 
 * All detection logic and invoice generation reads from this registry.
 * Nothing is hardcoded elsewhere.
 */

export interface MarketplaceRegistryEntry {
  display_name: string;
  contact_name: string;
  payment_type: 'direct_bank_transfer' | 'gateway_clearing';
  default_sales_account: string;
  default_shipping_account: string;
  default_clearing_account: string;
  gst_on_sales: boolean;
  /** Patterns to match in Note Attributes (case insensitive contains) */
  note_attributes_patterns?: string[];
  /** Patterns to match in Tags column (case insensitive, comma-separated tags) */
  tags_patterns?: string[];
  /** Patterns to match in Payment Method column (case insensitive) */
  payment_method_patterns?: string[];
  /** If true, skip invoice creation for this source */
  skip?: boolean;
  /** Reason for skipping */
  reason?: string;
  /** Source of this entry */
  source?: 'built_in' | 'ai_detected' | 'user_created';
  /** AI confidence if ai_detected */
  confidence?: number;
}

export const MARKETPLACE_REGISTRY: Record<string, MarketplaceRegistryEntry> = {
  mydeal: {
    display_name: 'MyDeal',
    contact_name: 'MyDeal',
    payment_type: 'direct_bank_transfer',
    default_sales_account: '200',
    default_shipping_account: '206',
    default_clearing_account: '613',
    gst_on_sales: true,
    note_attributes_patterns: ['MyDealOrderID'],
    tags_patterns: ['mydeal', 'my deal'],
    payment_method_patterns: ['mydeal'],
    source: 'built_in',
  },
  bunnings: {
    display_name: 'Bunnings Marketplace',
    contact_name: 'Bunnings Marketplace',
    payment_type: 'direct_bank_transfer',
    default_sales_account: '200',
    default_shipping_account: '206',
    default_clearing_account: '613',
    gst_on_sales: true,
    note_attributes_patterns: [
      'Order placed from: Bunnings',
      'Tenant_id: Bunnings',
    ],
    tags_patterns: ['bunnings', 'mirakl'],
    source: 'built_in',
  },
  kogan: {
    display_name: 'Kogan',
    contact_name: 'Kogan',
    payment_type: 'direct_bank_transfer',
    default_sales_account: '200',
    default_shipping_account: '206',
    default_clearing_account: '613',
    gst_on_sales: true,
    note_attributes_patterns: [
      'Order placed from: Kogan',
      'KoganOrderID',
    ],
    tags_patterns: [
      'kogan',
      'cedcommerce mcf connector, kogan',
    ],
    source: 'built_in',
  },
  bigw: {
    display_name: 'Big W Marketplace',
    contact_name: 'Big W',
    payment_type: 'direct_bank_transfer',
    default_sales_account: '200',
    default_shipping_account: '206',
    default_clearing_account: '613',
    gst_on_sales: true,
    note_attributes_patterns: [
      'Order placed from: Big W',
      'bigw',
    ],
    tags_patterns: ['big w', 'bigw', 'big-w'],
    source: 'built_in',
  },
  everyday_market: {
    display_name: 'Everyday Market',
    contact_name: 'Everyday Market',
    payment_type: 'direct_bank_transfer',
    default_sales_account: '200',
    default_shipping_account: '206',
    default_clearing_account: '613',
    gst_on_sales: true,
    note_attributes_patterns: [
      'Everyday Market',
      'woolworths',
    ],
    tags_patterns: [
      'everyday market',
      'woolworths',
      'everyday_market',
    ],
    source: 'built_in',
  },
  catch: {
    display_name: 'Catch',
    contact_name: 'Catch',
    payment_type: 'direct_bank_transfer',
    default_sales_account: '200',
    default_shipping_account: '206',
    default_clearing_account: '613',
    gst_on_sales: true,
    note_attributes_patterns: [
      'Order placed from: Catch',
      'CatchOrderID',
    ],
    tags_patterns: ['catch'],
    source: 'built_in',
  },
  ebay: {
    display_name: 'eBay',
    contact_name: 'eBay',
    payment_type: 'direct_bank_transfer',
    default_sales_account: '200',
    default_shipping_account: '206',
    default_clearing_account: '613',
    gst_on_sales: true,
    note_attributes_patterns: [
      'Order placed from: eBay',
      'eBayOrderID',
    ],
    tags_patterns: ['ebay', 'EBAY'],
    source: 'built_in',
  },
  paypal: {
    display_name: 'PayPal',
    contact_name: 'PayPal',
    payment_type: 'gateway_clearing',
    default_sales_account: '201',
    default_shipping_account: '206',
    default_clearing_account: '613',
    gst_on_sales: true,
    payment_method_patterns: [
      'paypal express checkout',
      'paypal',
    ],
    source: 'built_in',
  },
  afterpay: {
    display_name: 'Afterpay',
    contact_name: 'Afterpay',
    payment_type: 'gateway_clearing',
    default_sales_account: '201',
    default_shipping_account: '206',
    default_clearing_account: '613',
    gst_on_sales: true,
    payment_method_patterns: [
      'afterpay',
      'afterpay_v2',
    ],
    source: 'built_in',
  },
  stripe: {
    display_name: 'Stripe',
    contact_name: 'Stripe',
    payment_type: 'gateway_clearing',
    default_sales_account: '201',
    default_shipping_account: '206',
    default_clearing_account: '613',
    gst_on_sales: true,
    payment_method_patterns: ['stripe'],
    source: 'built_in',
  },
  manual_order: {
    display_name: 'Manual Orders',
    contact_name: 'Manual Orders',
    payment_type: 'gateway_clearing',
    default_sales_account: '201',
    default_shipping_account: '206',
    default_clearing_account: '613',
    gst_on_sales: true,
    payment_method_patterns: ['manual'],
    source: 'built_in',
  },
  shopify_payments: {
    display_name: 'Shopify Payments',
    contact_name: 'Shopify Payments',
    payment_type: 'gateway_clearing',
    default_sales_account: '201',
    default_shipping_account: '206',
    default_clearing_account: '613',
    gst_on_sales: true,
    skip: true,
    reason: 'Handled by Shopify Payments payout CSV',
    payment_method_patterns: [
      'shopify_payments',
      'shopify payments',
      'shopify',
    ],
    source: 'built_in',
  },
};

/**
 * Detect marketplace from a single order row using the registry.
 * Priority: Note Attributes → Tags → Payment Method
 * Returns the registry key or 'unknown'.
 */
export function detectMarketplaceFromRow(
  noteAttributes: string,
  tags: string,
  paymentMethod: string,
  registry: Record<string, MarketplaceRegistryEntry> = MARKETPLACE_REGISTRY
): string {
  const noteLower = (noteAttributes || '').toLowerCase();
  const tagList = (tags || '').toLowerCase().split(',').map(t => t.trim()).filter(Boolean);
  const pmLower = (paymentMethod || '').toLowerCase().trim();

  // PRIORITY 1 — Note Attributes
  for (const [key, entry] of Object.entries(registry)) {
    if (!entry.note_attributes_patterns) continue;
    for (const pattern of entry.note_attributes_patterns) {
      if (noteLower.includes(pattern.toLowerCase())) {
        return key;
      }
    }
  }

  // PRIORITY 2 — Tags
  for (const [key, entry] of Object.entries(registry)) {
    if (!entry.tags_patterns) continue;
    for (const pattern of entry.tags_patterns) {
      const patternLower = pattern.toLowerCase();
      // Check if any tag matches the pattern (exact or contains)
      if (tagList.some(tag => tag === patternLower || tag.includes(patternLower))) {
        return key;
      }
      // Also check if the full tags string contains multi-word patterns
      if (patternLower.includes(',') || patternLower.includes(' ')) {
        if ((tags || '').toLowerCase().includes(patternLower)) {
          return key;
        }
      }
    }
  }

  // PRIORITY 3 — Payment Method
  for (const [key, entry] of Object.entries(registry)) {
    if (!entry.payment_method_patterns) continue;
    for (const pattern of entry.payment_method_patterns) {
      if (pmLower === pattern.toLowerCase() || pmLower.includes(pattern.toLowerCase())) {
        return key;
      }
    }
  }

  return 'unknown';
}

/**
 * Get a registry entry, falling back to a generic entry for unknown sources.
 */
export function getRegistryEntry(key: string): MarketplaceRegistryEntry {
  if (MARKETPLACE_REGISTRY[key]) return MARKETPLACE_REGISTRY[key];
  // Generic fallback for unknown sources
  return {
    display_name: key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    contact_name: key.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '),
    payment_type: 'gateway_clearing',
    default_sales_account: '201',
    default_shipping_account: '206',
    default_clearing_account: '613',
    gst_on_sales: true,
    source: 'built_in',
  };
}
