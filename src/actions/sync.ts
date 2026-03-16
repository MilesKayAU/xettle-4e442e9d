/**
 * Canonical sync actions — manual sync triggers.
 * Must call existing edge functions via callEdgeFunctionSafe.
 * Must respect existing sync locks and guards.
 */

import { callEdgeFunctionSafe } from '@/utils/sync-capabilities';
import { supabase } from '@/integrations/supabase/client';

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

  const result = await callEdgeFunctionSafe(
    'scheduled-sync',
    session.access_token,
    rail ? { marketplace: rail } : {},
  );

  if (!result.ok) {
    if (result.rateLimited) {
      return { success: false, error: 'Sync rate limited — try again shortly' };
    }
    return { success: false, error: result.error || 'Marketplace sync failed' };
  }

  return { success: true, detail: result.data?.message };
}
