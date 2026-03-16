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
