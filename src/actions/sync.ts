/**
 * Canonical sync actions — manual sync triggers.
 * Must call existing edge functions via callEdgeFunctionSafe.
 * Must respect existing sync locks and guards.
 */

import { callEdgeFunctionSafe } from '@/utils/sync-capabilities';
import { supabase } from '@/integrations/supabase/client';

const ACTIVE_CONNECTION_STATUSES = ['active', 'connected'];

/**
 * Quick check: does this user have at least one active API marketplace connection
 * OR at least one API token (eBay, Amazon, Mirakl)? If not, there's nothing for
 * scheduled-sync to do, so we skip the call entirely to avoid timeouts.
 */
async function hasActiveMarketplaceConnections(userId: string): Promise<boolean> {
  // Check 1: marketplace_connections with API connection type
  const { count: apiConns } = await supabase
    .from('marketplace_connections')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .in('connection_status', ACTIVE_CONNECTION_STATUSES)
    .eq('connection_type', 'api');

  if ((apiConns ?? 0) > 0) return true;

  // Check 2: direct API tokens (eBay, Amazon, Mirakl)
  const [ebay, amazon, mirakl] = await Promise.all([
    supabase.from('ebay_tokens').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('amazon_tokens').select('id', { count: 'exact', head: true }).eq('user_id', userId),
    supabase.from('mirakl_tokens').select('id', { count: 'exact', head: true }).eq('user_id', userId),
  ]);

  return ((ebay.count ?? 0) + (amazon.count ?? 0) + (mirakl.count ?? 0)) > 0;
}

export interface SyncActionResult {
  success: boolean;
  error?: string;
  detail?: string;
}

/**
 * Trigger a Xero status sync (refresh invoice statuses, match settlements).
 * Calls the existing sync-xero-status edge function.
 */
export async function runXeroSync(): Promise<SyncActionResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { success: false, error: 'Not authenticated' };

  const result = await callEdgeFunctionSafe(
    'sync-xero-status',
    session.access_token,
    {},
  );

  if (!result.ok) {
    return { success: false, error: result.error || 'Xero sync failed' };
  }

  return { success: true, detail: result.data?.message };
}

/**
 * Trigger a marketplace data sync (scheduled-sync edge function).
 * Optionally filter by rail (marketplace code).
 */
export async function runMarketplaceSync(rail?: string): Promise<SyncActionResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { success: false, error: 'Not authenticated' };

  // Guard: skip if user has no active marketplace connections
  const hasConnections = await hasActiveMarketplaceConnections(session.user.id);
  if (!hasConnections) {
    return { success: true, detail: 'No marketplace connections configured — skipped sync.' };
  }

  const result = await callEdgeFunctionSafe(
    'scheduled-sync',
    session.access_token,
    rail ? { marketplace: rail } : {},
  );

  if (!result.ok) {
    if (result.rateLimited) {
      return { success: false, error: 'This channel syncs automatically — please wait at least 1 hour between manual syncs.' };
    }
    return { success: false, error: result.error || 'Marketplace sync failed' };
  }

  return { success: true, detail: result.data?.message };
}

/**
 * Trigger a full user sync: calls scheduled-sync with manual flag
 * so it runs immediately (bypasses cron staleness guard).
 */
export async function runFullUserSync(): Promise<SyncActionResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { success: false, error: 'Not authenticated' };

  // Guard: skip if user has no active marketplace connections
  const hasConnections = await hasActiveMarketplaceConnections(session.user.id);
  if (!hasConnections) {
    return { success: true, detail: 'No marketplace connections configured — skipped sync.' };
  }

  const result = await callEdgeFunctionSafe(
    'scheduled-sync',
    session.access_token,
    { manual: true },
  );

  if (!result.ok) {
    if (result.rateLimited) {
      return { success: false, error: 'Please wait at least 1 hour between manual syncs.' };
    }
    return { success: false, error: result.error || 'Full sync failed' };
  }

  return { success: true, detail: result.data?.message || 'Full sync complete' };
}

/**
 * Get the timestamp of the user's most recent sync event.
 */
export async function getLastSyncTime(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const { data } = await supabase
    .from('system_events')
    .select('created_at')
    .eq('user_id', session.user.id)
    .in('event_type', ['scheduled_sync_complete', 'validation_sweep_complete'])
    .order('created_at', { ascending: false })
    .limit(1);

  return data?.[0]?.created_at ?? null;
}

/**
 * Marketplace code → dedicated edge function mapping.
 * Only marketplaces with direct API fetch functions are listed.
 */
const DIRECT_FETCH_MAP: Record<string, string> = {
  amazon_au: 'fetch-amazon-settlements',
  ebay_au: 'fetch-ebay-settlements',
  ebay: 'fetch-ebay-settlements',
  shopify_payments: 'fetch-shopify-payouts',
  bunnings: 'fetch-mirakl-settlements',
};

/**
 * Targeted per-marketplace sync: calls the dedicated fetch edge function
 * for the given marketplace, then triggers a validation sweep to update
 * the marketplace_validation table.
 *
 * Falls back to the full scheduled-sync pipeline for marketplaces
 * without a dedicated API fetch function.
 */
export async function runDirectMarketplaceSync(code: string): Promise<SyncActionResult> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return { success: false, error: 'Not authenticated' };

  const normalized = code.trim().toLowerCase();
  const edgeFn = DIRECT_FETCH_MAP[normalized];

  if (!edgeFn) {
    // No dedicated function — fall back to full pipeline
    return runMarketplaceSync(normalized);
  }

  // Calculate a 2-month lookback window
  const syncFrom = new Date();
  syncFrom.setMonth(syncFrom.getMonth() - 2);
  const syncFromStr = syncFrom.toISOString().split('T')[0];

  // Step 1: Call the dedicated fetch function
  const fetchResult = await callEdgeFunctionSafe(
    edgeFn,
    session.access_token,
    { sync_from: syncFromStr },
  );

  if (!fetchResult.ok) {
    if (fetchResult.rateLimited) {
      return { success: false, error: 'This channel syncs automatically — please wait at least 1 hour between manual syncs.' };
    }
    return { success: false, error: fetchResult.error || `${edgeFn} failed` };
  }

  // Step 2: Trigger validation sweep to update marketplace_validation table
  const sweepResult = await callEdgeFunctionSafe(
    'run-validation-sweep',
    session.access_token,
    {},
  );

  if (!sweepResult.ok) {
    // Fetch succeeded but sweep failed — still report partial success
    return {
      success: true,
      detail: `Data fetched but validation sweep failed: ${sweepResult.error}`,
    };
  }

  return { success: true, detail: fetchResult.data?.message || 'Sync complete' };
}
