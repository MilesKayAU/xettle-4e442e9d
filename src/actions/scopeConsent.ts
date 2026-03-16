/**
 * Canonical Scope Consent Actions
 *
 * Handles org-level scope acknowledgement and tax profile management.
 * All reads/writes go through app_settings.
 */

import { supabase } from '@/integrations/supabase/client';
import { SCOPE_VERSION, type TaxProfile, type ScopeConsent, SUPPORTED_TAX_PROFILES } from '@/policy/supportPolicy';

// ─── Scope Consent ───────────────────────────────────────────────────────────

export async function getScopeConsent(): Promise<ScopeConsent> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { acknowledged: false, acknowledgedAt: null, version: null };

  const { data } = await supabase
    .from('app_settings')
    .select('key, value')
    .eq('user_id', user.id)
    .in('key', ['scope_acknowledged_at', 'scope_version']);

  const map = new Map(data?.map(r => [r.key, r.value]) || []);
  const version = map.get('scope_version') || null;
  const acknowledgedAt = map.get('scope_acknowledged_at') || null;

  return {
    acknowledged: version === SCOPE_VERSION && !!acknowledgedAt,
    acknowledgedAt,
    version,
  };
}

export async function acknowledgeScopeConsent(): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const now = new Date().toISOString();
  const upserts = [
    { user_id: user.id, key: 'scope_acknowledged_at', value: now },
    { user_id: user.id, key: 'scope_version', value: SCOPE_VERSION },
  ];

  for (const row of upserts) {
    const { error } = await supabase
      .from('app_settings')
      .upsert(row, { onConflict: 'user_id,key' });
    if (error) return { success: false, error: error.message };
  }

  return { success: true };
}

// ─── Org Tax Profile ─────────────────────────────────────────────────────────

export async function getOrgTaxProfile(): Promise<TaxProfile> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return 'AU_GST';

  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('user_id', user.id)
    .eq('key', 'tax_profile')
    .maybeSingle();

  const val = data?.value as TaxProfile | null;
  if (val && SUPPORTED_TAX_PROFILES.includes(val as any)) return val;
  return 'AU_GST';
}

export async function setOrgTaxProfile(profile: TaxProfile): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const { error } = await supabase
    .from('app_settings')
    .upsert({ user_id: user.id, key: 'tax_profile', value: profile }, { onConflict: 'user_id,key' });

  if (error) return { success: false, error: error.message };
  return { success: true };
}

// ─── Per-Rail Support Acknowledgement ────────────────────────────────────────

export async function acknowledgeRailSupport(rail: string): Promise<{ success: boolean; error?: string }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: 'Not authenticated' };

  const now = new Date().toISOString();

  // Upsert rail_posting_settings with support_acknowledged_at
  const { error } = await supabase
    .from('rail_posting_settings')
    .upsert({
      user_id: user.id,
      rail,
      support_acknowledged_at: now,
      updated_at: now,
    } as any, { onConflict: 'user_id,rail' });

  if (error) return { success: false, error: error.message };

  // Log system event
  await supabase.from('system_events').insert({
    user_id: user.id,
    event_type: 'rail_support_acknowledged',
    severity: 'info',
    marketplace_code: rail,
    details: { acknowledged_at: now },
  });

  return { success: true };
}
