/**
 * TOKEN_TABLE_MAP — Single source of truth mapping token tables to marketplace connections.
 * When adding a new marketplace API (eBay, TikTok, etc.), add one line here.
 * The provisioning step will automatically pick it up.
 */

import { supabase } from '@/integrations/supabase/client';
import { upsertMarketplaceConnection } from './marketplace-connections';
import { logger } from '@/utils/logger';

/**
 * Payment processors / gateways — NOT marketplaces.
 * These should never become marketplace_connections or settlement tabs.
 */
export const PAYMENT_PROCESSORS = [
  'paypal', 'stripe', 'afterpay', 'zip', 'zippay', 'klarna',
  'laybuy', 'humm', 'openpay', 'latitude', 'commbank', 'anz',
  'westpac', 'nab', 'square', 'tyro', 'braintree',
];

export function isPaymentProcessor(code: string): boolean {
  const lower = (code || '').toLowerCase();
  return PAYMENT_PROCESSORS.some(p => lower.includes(p));
}

export interface TokenMarketplaceEntry {
  table: 'amazon_tokens' | 'shopify_tokens' | 'ebay_tokens';
  code: string;
  type: string;
  name: string;
  /** Column to select to confirm a row exists */
  checkColumn: string;
}

export const TOKEN_TABLE_MAP: TokenMarketplaceEntry[] = [
  { table: 'amazon_tokens', code: 'amazon_au', type: 'sp_api', name: 'Amazon AU', checkColumn: 'selling_partner_id' },
  { table: 'shopify_tokens', code: 'shopify_payments', type: 'shopify_api', name: 'Shopify Payments', checkColumn: 'shop_domain' },
  { table: 'ebay_tokens', code: 'ebay_au', type: 'ebay_api', name: 'eBay AU', checkColumn: 'ebay_username' },
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
    await upsertMarketplaceConnection({
      userId,
      marketplaceCode: entry.code,
      connectionType: entry.type,
      marketplaceName: entry.name,
      connectionStatus: 'active',
    });
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
      await upsertMarketplaceConnection({
        userId,
        marketplaceCode: ch.marketplace_code,
        marketplaceName: ch.marketplace_label,
        connectionType: 'shopify_sub_channel',
        connectionStatus: 'active',
      });
    }
  }

  // 3. Clean up ghost records — connections with no backing data
  const connectedCodes = new Set([
    ...connected.map(c => c.code),
    ...(channels?.map(c => c.marketplace_code).filter(Boolean) || []),
  ]);

  const { data: allConnections } = await supabase
    .from('marketplace_connections')
    .select('id, marketplace_code, connection_type')
    .eq('user_id', userId);

  if (allConnections) {
    for (const conn of allConnections) {
      // Always delete payment processor connections — they are gateways, not marketplaces
      if (isPaymentProcessor(conn.marketplace_code)) {
        logger.debug(`[ghost-cleanup] Removing payment processor connection: ${conn.marketplace_code}`);
        await supabase.from('marketplace_connections').delete().eq('id', conn.id);
        continue;
      }

      if (connectedCodes.has(conn.marketplace_code)) continue;

      // Never delete manually-added or CoA-detected connections
      if (conn.connection_type === 'manual' || conn.connection_type === 'coa_detected') continue;

      // Check if there are any settlements for this marketplace
      const { count: settlementCount } = await supabase
        .from('settlements')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('marketplace', conn.marketplace_code);

      if (settlementCount && settlementCount > 0) continue;

      // For auto_detected connections, settlements are the ONLY valid backing.
      // Channel alerts alone are NOT sufficient — a Xero contact or bank narration
      // doesn't prove the user sells on that platform. Only actual settlement data does.
      if (conn.connection_type === 'auto_detected') {
        logger.debug(`[ghost-cleanup] Removing auto_detected connection with no settlements: ${conn.marketplace_code}`);
        await supabase.from('marketplace_connections').delete().eq('id', conn.id);
        continue;
      }

      // For other connection types (shopify_sub_channel, etc.), check sub-channels
      const { count: subChannelCount } = await supabase
        .from('shopify_sub_channels')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('marketplace_code', conn.marketplace_code);

      if (subChannelCount && subChannelCount > 0) continue;

      // No backing data anywhere — delete ghost
      logger.debug(`[ghost-cleanup] Removing ghost connection: ${conn.marketplace_code}`);
      await supabase
        .from('marketplace_connections')
        .delete()
        .eq('id', conn.id);
    }
  }
}
