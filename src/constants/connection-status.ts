/**
 * Canonical marketplace connection statuses.
 *
 * The DB default is 'active'. Some legacy code paths wrote 'connected'.
 * All queries filtering for "live" connections MUST use this constant
 * to avoid silently missing rows.
 *
 * When normalizing later, collapse to 'active' only and migrate data.
 */
export const ACTIVE_CONNECTION_STATUSES = ['active', 'connected'] as const;

export type ActiveConnectionStatus = typeof ACTIVE_CONNECTION_STATUSES[number];

/**
 * Connection types that represent a live API integration
 * (the marketplace has its own token and data is fetched automatically).
 *
 * Sub-channels flowing through another API (e.g. Kogan via Shopify)
 * use 'shopify_sub_channel' and are NOT considered API connections.
 */
export const API_CONNECTION_TYPES = [
  'api',           // legacy / generic
  'sp_api',        // Amazon SP-API
  'ebay_api',      // eBay OAuth
  'shopify_api',   // Shopify Admin API
  'mirakl_api',    // Mirakl marketplace API
] as const;

/** Check whether a connection_type represents a direct API integration */
export const isApiConnectionType = (type: string | null | undefined): boolean =>
  !!type && (API_CONNECTION_TYPES as readonly string[]).includes(type);
