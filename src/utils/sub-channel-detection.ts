/**
 * Shopify Sub-Channel Detection
 * 
 * Analyzes fetched Shopify API orders for unique source_names that indicate
 * sales channels beyond the direct store (e.g. eBay, TikTok Shop, Facebook, Etsy).
 * 
 * After every Shopify sync, runs a sub-channel audit and prompts the user
 * to set up tracking for any new channels found.
 */

import { supabase } from '@/integrations/supabase/client';
import type { ShopifyApiOrder } from './shopify-api-adapter';

// Source names that are "core" Shopify — not sub-channels
const IGNORED_SOURCE_NAMES = new Set([
  'web', 'shopify', 'pos', 'online_store', 'iphone', 'android',
  'shopify_draft_order', 'draft_orders', '', 'buy_button',
  'checkout', 'subscription_contract_checkout_one',
]);

export interface DetectedSubChannel {
  source_name: string;
  order_count: number;
  total_revenue: number;
  sample_order_names: string[];
  is_new: boolean;
  suggested_label?: string;
  suggested_code?: string;
  is_numeric_id?: boolean;
}

export interface SubChannelAuditResult {
  new_channels: DetectedSubChannel[];
  existing_channels: DetectedSubChannel[];
  total_new_orders: number;
}

/**
 * Audit orders for sub-channels. Call after every Shopify API sync.
 */
export async function auditSubChannels(
  orders: ShopifyApiOrder[]
): Promise<SubChannelAuditResult> {
  // Group by source_name
  const channelMap = new Map<string, { count: number; revenue: number; samples: string[] }>();

  for (const order of orders) {
    const src = (order.source_name || '').toLowerCase().trim();
    if (!src || IGNORED_SOURCE_NAMES.has(src)) continue;

    const existing = channelMap.get(src) || { count: 0, revenue: 0, samples: [] };
    existing.count++;
    existing.revenue += parseFloat(order.total_price || '0') || 0;
    if (existing.samples.length < 5) existing.samples.push(order.name || `#${order.id}`);
    channelMap.set(src, existing);
  }

  if (channelMap.size === 0) {
    return { new_channels: [], existing_channels: [], total_new_orders: 0 };
  }

  // Check which source_names already exist in shopify_sub_channels
  const sourceNames = Array.from(channelMap.keys());
  const { data: existingRows } = await supabase
    .from('shopify_sub_channels' as any)
    .select('source_name, ignored')
    .in('source_name', sourceNames);

  const knownSources = new Map<string, boolean>();
  if (existingRows) {
    for (const row of existingRows as any[]) {
      knownSources.set(row.source_name, row.ignored);
    }
  }

  const new_channels: DetectedSubChannel[] = [];
  const existing_channels: DetectedSubChannel[] = [];

  for (const [src, data] of channelMap) {
    const channel: DetectedSubChannel = {
      source_name: src,
      order_count: data.count,
      total_revenue: Math.round(data.revenue * 100) / 100,
      sample_order_names: data.samples,
      is_new: !knownSources.has(src),
    };

    if (knownSources.has(src)) {
      // Skip ignored channels
      if (!knownSources.get(src)) {
        existing_channels.push(channel);
      }
    } else {
      new_channels.push(channel);
    }
  }

  // Sort by order count descending
  new_channels.sort((a, b) => b.order_count - a.order_count);
  existing_channels.sort((a, b) => b.order_count - a.order_count);

  return {
    new_channels,
    existing_channels,
    total_new_orders: new_channels.reduce((s, c) => s + c.order_count, 0),
  };
}

/**
 * Save a sub-channel setup choice.
 */
export async function saveSubChannel(params: {
  source_name: string;
  marketplace_label: string;
  marketplace_code: string;
  settlement_type: 'separate_file' | 'shopify_payments';
  order_count?: number;
  total_revenue?: number;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false, error: 'Not authenticated' };

    const { error } = await supabase.from('shopify_sub_channels' as any).upsert({
      user_id: user.id,
      source_name: params.source_name,
      marketplace_label: params.marketplace_label,
      marketplace_code: params.marketplace_code,
      settlement_type: params.settlement_type,
      order_count: params.order_count || 0,
      total_revenue: params.total_revenue || 0,
      ignored: false,
    } as any, { onConflict: 'user_id,source_name' } as any);

    if (error) throw error;

    // If separate_file, create a marketplace_connection
    if (params.settlement_type === 'separate_file') {
      await supabase.from('marketplace_connections').upsert({
        user_id: user.id,
        marketplace_code: params.marketplace_code,
        marketplace_name: params.marketplace_label,
        country_code: 'AU',
        connection_type: 'sub_channel',
        connection_status: 'active',
      } as any, { onConflict: 'user_id,marketplace_code' } as any);
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Ignore a sub-channel so it never prompts again.
 */
export async function ignoreSubChannel(source_name: string): Promise<{ success: boolean }> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false };

    await supabase.from('shopify_sub_channels' as any).upsert({
      user_id: user.id,
      source_name,
      marketplace_label: source_name,
      settlement_type: 'shopify_payments',
      ignored: true,
    } as any, { onConflict: 'user_id,source_name' } as any);

    return { success: true };
  } catch {
    return { success: false };
  }
}

/**
 * Format currency for display.
 */
export function formatSubChannelRevenue(amount: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(amount);
}
