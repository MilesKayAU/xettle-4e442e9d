/**
 * Fulfilment Settings — shared helper for per-marketplace fulfilment method.
 *
 * Stored in `app_settings` as key = `fulfilment_method:{marketplace_code}`,
 * value = one of the FulfilmentMethod literals.
 */

import { supabase } from '@/integrations/supabase/client';

export type FulfilmentMethod = 'self_ship' | 'third_party_logistics' | 'marketplace_fulfilled' | 'not_sure';

export const FULFILMENT_LABELS: Record<FulfilmentMethod, string> = {
  self_ship: 'Self-fulfilled',
  third_party_logistics: '3PL (third-party logistics)',
  marketplace_fulfilled: 'Marketplace-fulfilled (e.g. FBA)',
  not_sure: 'Not sure yet',
};

/** Amazon marketplace codes default to marketplace_fulfilled */
const AMAZON_PREFIXES = ['amazon'];

export function isAmazonCode(code: string): boolean {
  return AMAZON_PREFIXES.some(p => code.toLowerCase().startsWith(p));
}

/**
 * Return the effective fulfilment method for a marketplace.
 * If a stored value exists, use it; otherwise apply the default.
 */
export function getEffectiveMethod(
  marketplaceCode: string,
  stored?: FulfilmentMethod | null,
): FulfilmentMethod {
  if (stored) return stored;
  return isAmazonCode(marketplaceCode) ? 'marketplace_fulfilled' : 'not_sure';
}

/**
 * Load fulfilment methods for the current user.
 * Returns a map of marketplace_code → FulfilmentMethod.
 */
export async function loadFulfilmentMethods(
  userId: string,
): Promise<Record<string, FulfilmentMethod>> {
  const { data } = await supabase
    .from('app_settings')
    .select('key, value')
    .eq('user_id', userId)
    .like('key', 'fulfilment_method:%');

  const result: Record<string, FulfilmentMethod> = {};
  for (const row of data || []) {
    const code = row.key.replace('fulfilment_method:', '');
    if (code && row.value) {
      result[code] = row.value as FulfilmentMethod;
    }
  }
  return result;
}

/**
 * Save or update a fulfilment method for one marketplace.
 */
export async function saveFulfilmentMethod(
  userId: string,
  marketplaceCode: string,
  method: FulfilmentMethod,
): Promise<void> {
  const key = `fulfilment_method:${marketplaceCode}`;

  // Check if key already exists for this user
  const { data: existing } = await supabase
    .from('app_settings')
    .select('id')
    .eq('user_id', userId)
    .eq('key', key)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('app_settings')
      .update({ value: method })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('app_settings')
      .insert({ user_id: userId, key, value: method });
  }
}
