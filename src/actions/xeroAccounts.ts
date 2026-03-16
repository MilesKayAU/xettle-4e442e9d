/**
 * Canonical Actions — Xero Chart of Accounts + Tax Rates
 *
 * All COA refresh and cached reads go through these functions.
 * No component should invoke refresh-xero-coa directly.
 */

import { supabase } from '@/integrations/supabase/client';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CachedXeroAccount {
  xero_account_id: string;
  account_code: string | null;
  account_name: string;
  account_type: string | null;
  tax_type: string | null;
  description: string | null;
  is_active: boolean;
  synced_at: string | null;
}

export interface CachedXeroTaxRate {
  tax_type: string;
  name: string;
  effective_rate: number | null;
  status: string;
  can_apply_to_revenue: boolean;
  can_apply_to_expenses: boolean;
}

export interface RefreshCoaResult {
  success: boolean;
  error?: string;
  accounts_count?: number;
  tax_rates_count?: number;
  fetched_at?: string;
}

// ─── Actions ─────────────────────────────────────────────────────────────────

/**
 * Refresh the Xero Chart of Accounts + Tax Rates cache by calling the
 * refresh-xero-coa edge function.
 */
export async function refreshXeroCOA(): Promise<RefreshCoaResult> {
  const { data, error } = await supabase.functions.invoke('refresh-xero-coa');

  if (error) {
    return { success: false, error: error.message };
  }

  if (!data?.success) {
    return { success: false, error: data?.error || 'COA refresh failed' };
  }

  return {
    success: true,
    accounts_count: data.accounts_count,
    tax_rates_count: data.tax_rates_count,
    fetched_at: data.fetched_at,
  };
}

/**
 * Get the cached Xero Chart of Accounts for the current user.
 * Returns active accounts only by default.
 */
export async function getCachedXeroAccounts(includeInactive = false): Promise<CachedXeroAccount[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  let query = supabase
    .from('xero_chart_of_accounts')
    .select('xero_account_id, account_code, account_name, account_type, tax_type, description, is_active, synced_at')
    .eq('user_id', user.id)
    .order('account_code', { ascending: true });

  if (!includeInactive) {
    query = query.eq('is_active', true);
  }

  const { data, error } = await query;
  if (error) {
    console.error('Failed to fetch cached COA:', error);
    return [];
  }

  return (data || []) as CachedXeroAccount[];
}

/**
 * Get the cached Xero Tax Rates for the current user.
 */
export async function getCachedXeroTaxRates(): Promise<CachedXeroTaxRate[]> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase
    .from('xero_tax_rates' as any)
    .select('tax_type, name, effective_rate, status, can_apply_to_revenue, can_apply_to_expenses')
    .eq('user_id', user.id)
    .eq('status', 'ACTIVE');

  if (error) {
    console.error('Failed to fetch cached tax rates:', error);
    return [];
  }

  return (data || []) as unknown as CachedXeroTaxRate[];
}

// ─── Create Accounts in Xero ─────────────────────────────────────────────────

export interface CreateXeroAccountInput {
  code: string;
  name: string;
  type: string;
  tax_type?: string;
}

export interface CreateXeroAccountsResult {
  success: boolean;
  created?: { code: string; name: string; xero_account_id: string }[];
  errors?: { code: string; error: string }[];
  error?: string;
}

/**
 * Create new accounts in Xero Chart of Accounts (admin-only).
 * Automatically refreshes the COA cache after creation.
 */
export async function createXeroAccounts(accounts: CreateXeroAccountInput[]): Promise<CreateXeroAccountsResult> {
  const { data, error } = await supabase.functions.invoke('create-xero-accounts', {
    body: { accounts },
  });

  if (error) {
    return { success: false, error: error.message };
  }

  if (!data?.success) {
    return { success: false, error: data?.error || 'Account creation failed' };
  }

  return {
    success: true,
    created: data.created,
    errors: data.errors,
  };
}

/**
 * Get the last sync timestamp for the COA cache.
 */
export async function getCoaLastSyncedAt(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('xero_chart_of_accounts')
    .select('synced_at')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('synced_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  return data?.synced_at || null;
}
