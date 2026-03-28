/**
 * Canonical Account Mappings Actions
 * 
 * SINGLE SOURCE OF TRUTH for reading/writing account code mappings.
 * All mapping data lives in `app_settings` under key `accounting_xero_account_codes`.
 * Draft mappings use key `accounting_xero_account_codes_draft`.
 * 
 * The `marketplace_account_mapping` table is DEPRECATED for new writes.
 * Legacy reads from that table are being migrated to this module.
 * 
 * Resolution order for getEffectiveMapping():
 *   1. Confirmed: `accounting_xero_account_codes` → `{category}:{marketplace}` key
 *   2. Confirmed: `accounting_xero_account_codes` → `{category}` key (global fallback)
 *   3. null (blocks push)
 */

import { supabase } from '@/integrations/supabase/client';
import { normalizeKeyLabel } from '@/utils/marketplace-codes';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface AccountMappings {
  /** Raw flat map: category → code, or "category:marketplace" → code */
  codes: Record<string, string>;
  /** Whether this was loaded from draft (not yet confirmed) */
  isDraft: boolean;
}

function getMarketplaceKeyCandidates(marketplace?: string): string[] {
  if (!marketplace) return [];

  const trimmed = marketplace.trim();
  if (!trimmed) return [];

  const normalized = normalizeKeyLabel(trimmed);
  return [...new Set([normalized, trimmed].filter(Boolean))];
}

// ─── Read ────────────────────────────────────────────────────────────────────

/**
 * Load the current confirmed mappings for the authenticated user.
 * Falls back to draft if no confirmed mapping exists.
 */
export async function getMappings(): Promise<AccountMappings> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { codes: {}, isDraft: false };

  const [confirmedRes, draftRes] = await Promise.all([
    supabase
      .from('app_settings')
      .select('value')
      .eq('user_id', user.id)
      .eq('key', 'accounting_xero_account_codes')
      .maybeSingle(),
    supabase
      .from('app_settings')
      .select('value')
      .eq('user_id', user.id)
      .eq('key', 'accounting_xero_account_codes_draft')
      .maybeSingle(),
  ]);

  if (confirmedRes.data?.value) {
    try {
      return { codes: JSON.parse(confirmedRes.data.value), isDraft: false };
    } catch (e) { console.warn('Failed to parse confirmed account mappings JSON', e); }
  }

  if (draftRes.data?.value) {
    try {
      return { codes: JSON.parse(draftRes.data.value), isDraft: true };
    } catch (e) { console.warn('Failed to parse draft account mappings JSON', e); }
  }

  return { codes: {}, isDraft: false };
}

/**
 * Load raw confirmed mappings as a flat Record<string, string>.
 * Used by posting builders and readiness gates.
 * Returns null if no mappings exist.
 */
export async function getMappingsRaw(): Promise<Record<string, string> | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('user_id', user.id)
    .eq('key', 'accounting_xero_account_codes')
    .maybeSingle();

  if (data?.value) {
    try { return JSON.parse(data.value); } catch { /* */ }
  }
  return null;
}

/**
 * Resolve the effective account code for a given category + marketplace.
 * Resolution: marketplace-specific → global → null.
 */
export function getEffectiveMapping(
  codes: Record<string, string>,
  category: string,
  marketplace?: string,
): string | null {
  for (const candidate of getMarketplaceKeyCandidates(marketplace)) {
    const mpKey = `${category}:${candidate}`;
    if (codes[mpKey]) return codes[mpKey];
  }

  if (codes[category]) return codes[category];
  return null;
}

// ─── Write ───────────────────────────────────────────────────────────────────

/**
 * Save draft mappings (no PIN required).
 */
export async function saveDraftMappings(
  codes: Record<string, string>,
): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase.from('app_settings').upsert(
    {
      user_id: user.id,
      key: 'accounting_xero_account_codes_draft',
      value: JSON.stringify(codes),
    },
    { onConflict: 'user_id,key' },
  );

  if (error) return { success: false, error: error.message };
  return { success: true };
}

/**
 * Confirm mappings (caller must have verified PIN before calling).
 * Writes to confirmed key and cleans up draft.
 */
export async function confirmMappings(
  codes: Record<string, string>,
): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase.from('app_settings').upsert(
    {
      user_id: user.id,
      key: 'accounting_xero_account_codes',
      value: JSON.stringify(codes),
    },
    { onConflict: 'user_id,key' },
  );
  if (error) return { success: false, error: error.message };

  // Clean up draft
  await supabase
    .from('app_settings')
    .delete()
    .eq('user_id', user.id)
    .eq('key', 'accounting_xero_account_codes_draft');

  // Mark mapper status
  await supabase.from('app_settings').upsert(
    {
      user_id: user.id,
      key: 'ai_mapper_status',
      value: 'confirmed',
    },
    { onConflict: 'user_id,key' },
  );

  return { success: true };
}

/**
 * Merge new codes into existing confirmed mappings.
 * Used by CoaBlockerCta after clone completes.
 */
export async function mergeIntoConfirmedMappings(
  newCodes: Record<string, string>,
): Promise<{ success: boolean; error?: string }> {
  const existing = await getMappingsRaw();
  const merged = { ...(existing || {}), ...newCodes };
  return confirmMappings(merged);
}
