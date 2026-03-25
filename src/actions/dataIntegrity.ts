/**
 * Canonical Data Integrity Scanner — orchestrates critical system scans
 * and tracks last-run timestamps in app_settings.
 */

import { supabase } from '@/integrations/supabase/client';
import { callEdgeFunctionSafe } from '@/utils/sync-capabilities';
import { runXeroSync, runMarketplaceSync } from './sync';

export interface ScanDefinition {
  key: string;
  label: string;
  description: string;
  edgeFunction: string | null; // null = uses canonical action directly
}

export const SCAN_DEFINITIONS: ScanDefinition[] = [
  {
    key: 'last_validation_sweep',
    label: 'Validation Sweep',
    description: 'Recomputes settlement statuses and reconciliation gaps',
    edgeFunction: 'run-validation-sweep',
  },
  {
    key: 'last_bank_match',
    label: 'Bank Deposit Matching',
    description: 'Matches Xero bank transactions to settlements',
    edgeFunction: 'match-bank-deposits',
  },
  {
    key: 'last_xero_sync',
    label: 'Xero Invoice Sync',
    description: 'Refreshes invoice statuses from Xero',
    edgeFunction: null, // uses runXeroSync
  },
  {
    key: 'last_marketplace_sync',
    label: 'API Settlement Fetch',
    description: 'Re-fetches latest settlements from marketplace APIs',
    edgeFunction: null, // uses runMarketplaceSync
  },
  {
    key: 'last_profit_recalc',
    label: 'Profit Recalculation',
    description: 'Rebuilds profit figures from authoritative data',
    edgeFunction: 'recalculate-profit',
  },
];

export interface ScanResult {
  key: string;
  success: boolean;
  error?: string;
}

async function updateTimestamp(key: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return;

  const now = new Date().toISOString();
  const { data: existing } = await supabase
    .from('app_settings')
    .select('id')
    .eq('user_id', session.user.id)
    .eq('key', key)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('app_settings')
      .update({ value: now, updated_at: now })
      .eq('id', existing.id);
  } else {
    await supabase
      .from('app_settings')
      .insert({ user_id: session.user.id, key, value: now });
  }
}

export async function runDataIntegrityScan(scanKey: string): Promise<ScanResult> {
  const def = SCAN_DEFINITIONS.find((d) => d.key === scanKey);
  if (!def) return { key: scanKey, success: false, error: 'Unknown scan key' };

  try {
    if (def.key === 'last_xero_sync') {
      const result = await runXeroSync();
      if (!result.success) return { key: scanKey, success: false, error: result.error };
    } else if (def.key === 'last_marketplace_sync') {
      const result = await runMarketplaceSync();
      if (!result.success) return { key: scanKey, success: false, error: result.error };
    } else if (def.edgeFunction) {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return { key: scanKey, success: false, error: 'Not authenticated' };

      const result = await callEdgeFunctionSafe(
        def.edgeFunction,
        session.access_token,
        {},
      );
      if (!result.ok) {
        return { key: scanKey, success: false, error: result.error || `${def.label} failed` };
      }
    }

    await updateTimestamp(scanKey);
    return { key: scanKey, success: true };
  } catch (err: any) {
    return { key: scanKey, success: false, error: err?.message || 'Unexpected error' };
  }
}

export async function runAllDataIntegrityScans(
  onProgress?: (scanKey: string, index: number) => void,
): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  for (let i = 0; i < SCAN_DEFINITIONS.length; i++) {
    const def = SCAN_DEFINITIONS[i];
    onProgress?.(def.key, i);
    const result = await runDataIntegrityScan(def.key);
    results.push(result);
  }
  return results;
}

export async function getLastScanTimestamps(): Promise<Record<string, string | null>> {
  const keys = SCAN_DEFINITIONS.map((d) => d.key);
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return Object.fromEntries(keys.map((k) => [k, null]));

  const { data } = await supabase
    .from('app_settings')
    .select('key, value')
    .eq('user_id', session.user.id)
    .in('key', keys);

  const map: Record<string, string | null> = {};
  for (const k of keys) {
    const row = data?.find((r) => r.key === k);
    map[k] = row?.value ?? null;
  }
  return map;
}
