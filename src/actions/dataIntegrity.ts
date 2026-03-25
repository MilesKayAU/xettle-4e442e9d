/**
 * Canonical Data Integrity Scanner — orchestrates critical system scans
 * and tracks last-run timestamps in app_settings.
 *
 * Two categories:
 *   MANUAL  — bookkeeper should trigger on login for fresh data
 *   AUTO    — runs via cron; manual trigger available as override
 */

import { supabase } from '@/integrations/supabase/client';
import { callEdgeFunctionSafe } from '@/utils/sync-capabilities';
import { runXeroSync, runMarketplaceSync } from './sync';

export interface ScanDefinition {
  key: string;
  label: string;
  description: string;
  edgeFunction: string | null;
  /** 'manual' = bookkeeper should trigger; 'auto' = cron handles it */
  mode: 'manual' | 'auto';
  /** Cron schedule description for auto scans */
  cronNote?: string;
}

/**
 * Ordered by priority: manual scans first, then auto scans.
 * Only manual scans appear prominently on the dashboard.
 */
export const SCAN_DEFINITIONS: ScanDefinition[] = [
  // ── Manual scans: bookkeeper triggers on login ──
  {
    key: 'last_validation_sweep',
    label: 'Recalculate Gaps',
    description: 'Recomputes all settlement statuses and reconciliation gaps',
    edgeFunction: 'run-validation-sweep',
    mode: 'manual',
    cronNote: 'Also runs daily at 6 AM AEST',
  },
  {
    key: 'last_bank_match',
    label: 'Match Bank Deposits',
    description: 'Matches Xero bank transactions to settlements',
    edgeFunction: 'match-bank-deposits',
    mode: 'manual',
    cronNote: 'Also runs every 6 hours',
  },
  // ── Auto scans: cron-managed, manual override available ──
  {
    key: 'last_xero_sync',
    label: 'Xero Invoice Sync',
    description: 'Refreshes invoice statuses from Xero',
    edgeFunction: null,
    mode: 'auto',
    cronNote: 'Runs every 6 hours',
  },
  {
    key: 'last_marketplace_sync',
    label: 'API Settlement Fetch',
    description: 'Fetches latest data from eBay, Amazon, Mirakl',
    edgeFunction: null,
    mode: 'auto',
    cronNote: 'Runs every 6 hours + daily at 2 AM AEST',
  },
  {
    key: 'last_profit_recalc',
    label: 'Profit Recalculation',
    description: 'Rebuilds profit figures from authoritative data',
    edgeFunction: 'recalculate-profit',
    mode: 'auto',
    cronNote: 'Runs after each Xero push',
  },
];

export const MANUAL_SCANS = SCAN_DEFINITIONS.filter((d) => d.mode === 'manual');
export const AUTO_SCANS = SCAN_DEFINITIONS.filter((d) => d.mode === 'auto');

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

/**
 * Run only the manual scans (the ones the bookkeeper needs on login).
 */
export async function runManualScans(
  onProgress?: (scanKey: string, index: number) => void,
): Promise<ScanResult[]> {
  const results: ScanResult[] = [];
  for (let i = 0; i < MANUAL_SCANS.length; i++) {
    const def = MANUAL_SCANS[i];
    onProgress?.(def.key, i);
    const result = await runDataIntegrityScan(def.key);
    results.push(result);
  }
  return results;
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
