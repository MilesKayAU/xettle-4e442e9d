/**
 * Canonical Data Integrity Scanner — orchestrates critical system scans
 * and tracks completion via backend system_events (not client-side app_settings).
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
  /** system_events event_type to look up last completion */
  completionEventType: string;
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
    completionEventType: 'validation_sweep_complete',
    mode: 'manual',
    cronNote: 'Also runs daily at 6 AM AEST',
  },
  {
    key: 'last_bank_match',
    label: 'Match Bank Deposits',
    description: 'Matches Xero bank transactions to settlements',
    edgeFunction: 'match-bank-deposits',
    completionEventType: 'bank_match_complete',
    mode: 'manual',
    cronNote: 'Also runs every 6 hours',
  },
  // ── Auto scans: cron-managed, manual override available ──
  {
    key: 'last_xero_sync',
    label: 'Xero Invoice Sync',
    description: 'Refreshes invoice statuses from Xero',
    edgeFunction: null,
    completionEventType: 'xero_sync_complete',
    mode: 'auto',
    cronNote: 'Runs every 6 hours',
  },
  {
    key: 'last_marketplace_sync',
    label: 'API Settlement Fetch',
    description: 'Fetches latest data from eBay, Amazon, Shopify, Mirakl',
    edgeFunction: null,
    completionEventType: 'scheduled_sync_complete',
    mode: 'auto',
    cronNote: 'Runs every 6 hours + daily at 2 AM AEST',
  },
  {
    key: 'last_profit_recalc',
    label: 'Profit Recalculation',
    description: 'Rebuilds profit figures from authoritative data',
    edgeFunction: 'recalculate-profit',
    completionEventType: 'profit_recalc_complete',
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

/**
 * Reads last successful completion timestamps from system_events (backend truth),
 * NOT from client-side app_settings.
 */
export async function getLastScanTimestamps(): Promise<Record<string, string | null>> {
  const { data: { session } } = await supabase.auth.getSession();
  const map: Record<string, string | null> = {};
  for (const def of SCAN_DEFINITIONS) {
    map[def.key] = null;
  }

  if (!session) return map;

  // Query system_events for the latest occurrence of each completion event type
  const eventTypes = SCAN_DEFINITIONS.map((d) => d.completionEventType);

  const { data } = await supabase
    .from('system_events')
    .select('event_type, created_at')
    .eq('user_id', session.user.id)
    .in('event_type', eventTypes)
    .order('created_at', { ascending: false })
    .limit(100);

  if (data) {
    // For each event type, find the most recent occurrence
    for (const def of SCAN_DEFINITIONS) {
      const event = data.find((e) => e.event_type === def.completionEventType);
      map[def.key] = event?.created_at ?? null;
    }
  }

  return map;
}
