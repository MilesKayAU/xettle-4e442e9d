/**
 * TOKEN_TABLE_MAP — Single source of truth mapping token tables to marketplace connections.
 * When adding a new marketplace API (eBay, TikTok, etc.), add one line here.
 * The provisioning step will automatically pick it up.
 */

import { supabase } from '@/integrations/supabase/client';

export interface TokenMarketplaceEntry {
  table: 'amazon_tokens' | 'shopify_tokens';
  code: string;
  type: string;
  name: string;
  /** Column to select to confirm a row exists */
  checkColumn: string;
}

export const TOKEN_TABLE_MAP: TokenMarketplaceEntry[] = [
  { table: 'amazon_tokens', code: 'amazon_au', type: 'sp_api', name: 'Amazon AU', checkColumn: 'selling_partner_id' },
  { table: 'shopify_tokens', code: 'shopify_payments', type: 'shopify_api', name: 'Shopify Payments', checkColumn: 'shop_domain' },
  // Future: { table: 'ebay_tokens', code: 'ebay_au', type: 'ebay_api', name: 'eBay AU', checkColumn: 'ebay_user_id' },
];

/**
 * Queries all token tables and returns which marketplaces are connected for a user.
 */
export async function getConnectedTokenMarketplaces(): Promise<TokenMarketplaceEntry[]> {
  const results = await Promise.allSettled(
    TOKEN_TABLE_MAP.map(async (entry) => {
      const { data } = await supabase
        .from(entry.table)
        .select(entry.checkColumn)
        .limit(1);
      return data && data.length > 0 ? entry : null;
    })
  );

  return results
    .filter((r): r is PromiseFulfilledResult<TokenMarketplaceEntry | null> => r.status === 'fulfilled')
    .map(r => r.value)
    .filter((v): v is TokenMarketplaceEntry => v !== null);
}

/**
 * Provisions marketplace_connections for all connected token tables,
 * plus any detected Shopify sub-channels.
 * Also cleans up ghost records (connections with no tokens, settlements, or alerts).
 */
export async function provisionAllMarketplaceConnections(userId: string): Promise<void> {
  // 1. Provision from token tables
  const connected = await getConnectedTokenMarketplaces();
  for (const entry of connected) {
    await supabase.from('marketplace_connections').upsert({
      user_id: userId,
      marketplace_code: entry.code,
      connection_type: entry.type,
      marketplace_name: entry.name,
      connection_status: 'active',
    }, { onConflict: 'user_id,marketplace_code' });
  }

  // 2. Provision from Shopify sub-channels
  const { data: channels } = await supabase
    .from('shopify_sub_channels')
    .select('marketplace_code, marketplace_label')
    .eq('user_id', userId)
    .eq('ignored', false)
    .not('marketplace_code', 'is', null);

  if (channels) {
    for (const ch of channels) {
      if (!ch.marketplace_code) continue;
      await supabase.from('marketplace_connections').upsert({
        user_id: userId,
        marketplace_code: ch.marketplace_code,
        marketplace_name: ch.marketplace_label,
        connection_type: 'shopify_sub_channel',
        connection_status: 'active',
      }, { onConflict: 'user_id,marketplace_code' });
    }
  }

  // 3. Clean up ghost records — connections with no backing data
  const connectedCodes = new Set([
    ...connected.map(c => c.code),
    ...(channels?.map(c => c.marketplace_code).filter(Boolean) || []),
  ]);

  const { data: allConnections } = await supabase
    .from('marketplace_connections')
    .select('id, marketplace_code')
    .eq('user_id', userId);

  if (allConnections) {
    for (const conn of allConnections) {
      if (connectedCodes.has(conn.marketplace_code)) continue;

      // Check if there are any settlements for this marketplace
      const { count: settlementCount } = await supabase
        .from('settlements')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('marketplace', conn.marketplace_code);

      if (settlementCount && settlementCount > 0) continue;

      // Check channel_alerts
      const { count: alertCount } = await supabase
        .from('channel_alerts')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('source_name', conn.marketplace_code);

      if (alertCount && alertCount > 0) continue;

      // No backing data — delete ghost
      await supabase
        .from('marketplace_connections')
        .delete()
        .eq('id', conn.id);
    }
  }
}
