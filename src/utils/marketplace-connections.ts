/**
 * Single helper for all marketplace_connections writes.
 * All code paths should use this instead of direct inserts/upserts.
 */

import { supabase } from '@/integrations/supabase/client';
import { normalizeMarketplaceCode } from './marketplace-codes';

export interface UpsertMarketplaceConnectionParams {
  userId: string;
  marketplaceCode: string;
  marketplaceName?: string | null;
  connectionType?: string | null;
  connectionStatus?: string | null;
  countryCode?: string | null;
  settings?: any;
  /** If true, never downgrade an 'active' connection to 'suggested' */
  neverDowngrade?: boolean;
}

export async function upsertMarketplaceConnection(
  params: UpsertMarketplaceConnectionParams
): Promise<{ success: boolean; error?: string }> {
  try {
    const normalizedCode = normalizeMarketplaceCode(params.marketplaceCode);

    // If neverDowngrade, check existing status first
    if (params.neverDowngrade && params.connectionStatus === 'suggested') {
      const { data: existing } = await supabase
        .from('marketplace_connections')
        .select('connection_status')
        .eq('user_id', params.userId)
        .eq('marketplace_code', normalizedCode)
        .maybeSingle();

      if (existing?.connection_status === 'active') {
        return { success: true };
      }
    }

    const row: Record<string, any> = {
      user_id: params.userId,
      marketplace_code: normalizedCode,
      marketplace_name: params.marketplaceName || normalizedCode,
      connection_type: params.connectionType || 'manual',
      connection_status: params.connectionStatus || 'active',
    };

    if (params.countryCode) row.country_code = params.countryCode;
    if (params.settings) row.settings = params.settings;

    const { error } = await supabase
      .from('marketplace_connections')
      .upsert(row as any, { onConflict: 'user_id,marketplace_code' });

    if (error) {
      console.warn('[marketplace-connections] upsert error:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    console.warn('[marketplace-connections] unexpected error:', err.message);
    return { success: false, error: err.message };
  }
}
