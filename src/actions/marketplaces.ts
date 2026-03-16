/**
 * Canonical Marketplace Provisioning Actions
 * 
 * ALL marketplace_connections writes from client code MUST go through these functions.
 * Edge functions (oauth callbacks) may write directly since they can't import src/.
 * 
 * Invariants enforced:
 * - marketplace_code normalised before write
 * - upsert on (user_id, marketplace_code) to prevent duplicates
 * - consistent connection_type and country_code defaults
 */

import { supabase } from '@/integrations/supabase/client';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ProvisionResult {
  success: boolean;
  action: 'created' | 'already_exists' | 'error';
  error?: string;
  connectionId?: string;
}

export interface RemoveResult {
  success: boolean;
  error?: string;
  settlementsDeleted?: number;
}

// ─── Normalisation ───────────────────────────────────────────────────────────

/** Canonical marketplace code normalisation — lowercase, trimmed */
function normalizeMarketplaceCode(code: string): string {
  return code.toLowerCase().trim();
}

// ─── Provision (upsert) ──────────────────────────────────────────────────────

/**
 * Provision a marketplace connection for the current user.
 * Idempotent: if the connection already exists, returns `already_exists`.
 */
export async function provisionMarketplace(opts: {
  marketplaceCode: string;
  marketplaceName: string;
  connectionType?: string;
  countryCode?: string;
  settings?: Record<string, unknown>;
}): Promise<ProvisionResult> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, action: 'error', error: 'Not authenticated' };

  const code = normalizeMarketplaceCode(opts.marketplaceCode);

  // Check existence first to distinguish create vs noop
  const { data: existing } = await supabase
    .from('marketplace_connections')
    .select('id')
    .eq('user_id', user.id)
    .eq('marketplace_code', code)
    .maybeSingle();

  if (existing) {
    return { success: true, action: 'already_exists', connectionId: existing.id };
  }

  const row = {
    user_id: user.id,
    marketplace_code: code,
    marketplace_name: opts.marketplaceName,
    connection_type: opts.connectionType || 'manual',
    connection_status: 'active',
    country_code: opts.countryCode || 'AU',
    settings: (opts.settings || {}) as any,
  };

  const { data, error } = await supabase
    .from('marketplace_connections')
    .insert(row)
    .select('id')
    .single();

  if (error) {
    // Handle race condition: another tab/request created it
    if (error.code === '23505') {
      return { success: true, action: 'already_exists' };
    }
    return { success: false, action: 'error', error: error.message };
  }

  return { success: true, action: 'created', connectionId: data.id };
}

// ─── Batch provision ─────────────────────────────────────────────────────────

/**
 * Provision multiple marketplaces at once. Skips any that already exist.
 * Returns results keyed by marketplace code.
 */
export async function provisionMarketplaces(
  items: Array<{ marketplaceCode: string; marketplaceName: string; connectionType?: string }>
): Promise<Record<string, ProvisionResult>> {
  const results: Record<string, ProvisionResult> = {};
  for (const item of items) {
    results[item.marketplaceCode] = await provisionMarketplace(item);
  }
  return results;
}

// ─── Remove marketplace + cascade ────────────────────────────────────────────

/**
 * Remove a marketplace connection and cascade-delete related settlements + lines.
 * This is destructive — only called from explicit user action (MarketplaceSwitcher).
 */
export async function removeMarketplace(marketplaceCode: string): Promise<RemoveResult> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const code = normalizeMarketplaceCode(marketplaceCode);

  // Get settlement IDs for cascade
  const { data: settlements } = await supabase
    .from('settlements')
    .select('id, settlement_id')
    .eq('marketplace', code)
    .eq('user_id', user.id);

  const settlementIds = settlements?.map(s => s.settlement_id) || [];

  // Cascade delete: lines → unmapped → components → settlements → connection
  if (settlementIds.length > 0) {
    // Batch in chunks of 100 to avoid URL length limits
    for (let i = 0; i < settlementIds.length; i += 100) {
      const chunk = settlementIds.slice(i, i + 100);
      await Promise.all([
        supabase.from('settlement_lines').delete().eq('user_id', user.id).in('settlement_id', chunk),
        supabase.from('settlement_unmapped').delete().eq('user_id', user.id).in('settlement_id', chunk),
      ]);
    }
  }

  if (settlements && settlements.length > 0) {
    const dbIds = settlements.map(s => s.id);
    for (let i = 0; i < dbIds.length; i += 100) {
      await supabase.from('settlements').delete().in('id', dbIds.slice(i, i + 100));
    }
  }

  // Delete connection
  const { error } = await supabase
    .from('marketplace_connections')
    .delete()
    .eq('marketplace_code', code)
    .eq('user_id', user.id);

  if (error) return { success: false, error: error.message };

  return { success: true, settlementsDeleted: settlements?.length || 0 };
}
