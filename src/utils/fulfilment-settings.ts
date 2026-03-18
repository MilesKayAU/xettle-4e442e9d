/**
 * Fulfilment Settings — shared helper for per-marketplace fulfilment method.
 *
 * Stored in `app_settings` as key = `fulfilment_method:{marketplace_code}`,
 * value = one of the FulfilmentMethod literals.
 */

import { supabase } from '@/integrations/supabase/client';

export type FulfilmentMethod = 'self_ship' | 'third_party_logistics' | 'marketplace_fulfilled' | 'mixed_fba_fbm' | 'not_sure';

export const FULFILMENT_LABELS: Record<FulfilmentMethod, string> = {
  self_ship: 'Self-fulfilled',
  third_party_logistics: '3PL (third-party logistics)',
  marketplace_fulfilled: 'Marketplace-fulfilled (e.g. FBA)',
  mixed_fba_fbm: 'Mixed (FBA + FBM)',
  not_sure: 'Not sure yet',
};

/** Fulfilment channel values stored per settlement line */
export type FulfilmentChannel = 'AFN' | 'MFN' | 'MCF' | null;

/**
 * Canonical postage deduction function.
 * This is the ONLY function that should determine postage cost for an order.
 * No other code may multiply postage cost directly.
 *
 * @param fulfilmentMethod - The marketplace-level fulfilment setting
 * @param lineChannel - The line-level fulfilment channel (AFN/MFN/MCF/null)
 * @param postageCostPerOrder - The configured cost per order
 * @returns The postage amount to deduct for this order/line
 */
export function getPostageDeductionForOrder(
  fulfilmentMethod: string | null | undefined,
  lineChannel: FulfilmentChannel | string | null | undefined,
  postageCostPerOrder: number,
  orderCount: number = 1,
): number {
  // Zero-cost guard
  if (!postageCostPerOrder || postageCostPerOrder <= 0) return 0;

  const ch = (lineChannel || '').toUpperCase().trim();

  // Line-level channel takes priority when in mixed mode
  if (fulfilmentMethod === 'mixed_fba_fbm') {
    // Only MFN (merchant-fulfilled) lines get postage deducted
    if (ch === 'MFN') return postageCostPerOrder;
    // AFN, MCF, or unknown/null → no deduction
    return 0;
  }

  // For explicit line channels regardless of marketplace setting
  if (ch === 'AFN' || ch === 'MCF') return 0;
  if (ch === 'MFN') return postageCostPerOrder;

  // Fall back to marketplace-level method
  switch (fulfilmentMethod) {
    case 'self_ship':
    case 'third_party_logistics':
      return postageCostPerOrder;
    case 'marketplace_fulfilled':
    case 'not_sure':
    case null:
    case undefined:
    default:
      return 0;
  }
}

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

/**
 * Load postage costs for the current user.
 * Returns a map of marketplace_code → cost per order (number).
 */
export async function loadPostageCosts(
  userId: string,
): Promise<Record<string, number>> {
  const { data } = await supabase
    .from('app_settings')
    .select('key, value')
    .eq('user_id', userId)
    .like('key', 'postage_cost:%');

  const result: Record<string, number> = {};
  for (const row of data || []) {
    const code = row.key.replace('postage_cost:', '');
    const num = parseFloat(row.value || '');
    if (code && !isNaN(num) && num >= 0) {
      result[code] = num;
    }
  }
  return result;
}

/**
 * Save or update a postage cost for one marketplace.
 */
export async function savePostageCost(
  userId: string,
  marketplaceCode: string,
  amount: number,
): Promise<void> {
  const key = `postage_cost:${marketplaceCode}`;

  const { data: existing } = await supabase
    .from('app_settings')
    .select('id')
    .eq('user_id', userId)
    .eq('key', key)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('app_settings')
      .update({ value: String(amount) })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('app_settings')
      .insert({ user_id: userId, key, value: String(amount) });
  }
}
