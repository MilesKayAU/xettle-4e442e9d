/**
 * useSyncStatus — Shared hook for dashboard sync activity visibility.
 * Reads from sync_history, system_events, and marketplace_connections.
 * No direct Supabase calls should exist outside this hook for sync status.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';


export type SyncStatusValue = 'success' | 'error' | 'running' | 'never';

export interface SyncEntry {
  rail: string;
  name: string;
  lastRun: Date | null;
  status: SyncStatusValue;
  message?: string;
}

export interface SyncStatusResult {
  xero: {
    lastRun: Date | null;
    status: SyncStatusValue;
    message?: string;
  };
  marketplaces: SyncEntry[];
  loading: boolean;
}

// API-synced integrations only — no CSV-only channels
const API_INTEGRATIONS = [
  { rail: 'xero', name: 'Xero', tokenTable: 'xero_tokens' as const, historyTypes: ['xero', 'scheduled_sync'], eventTypes: ['xero_api_call', 'xero_audit_complete', 'xero_scan_completed', 'xero_invoice_refreshed', 'xero_sync_complete', 'xero_sync_error', 'xero_push_complete', 'xero_coa_refreshed'] },
  { rail: 'amazon_au', name: 'Amazon AU', tokenTable: 'amazon_tokens' as const, historyTypes: ['amazon'], eventTypes: ['amazon_settlement_synced', 'amazon_fetch_complete', 'settlement_imported'] },
  { rail: 'shopify', name: 'Shopify', tokenTable: 'shopify_tokens' as const, historyTypes: ['shopify', 'scheduled_sync'], eventTypes: ['shopify_payout_synced', 'shopify_fetch_complete', 'settlement_imported'] },
  { rail: 'ebay_au', name: 'eBay AU', tokenTable: 'ebay_tokens' as const, historyTypes: ['ebay'], eventTypes: ['ebay_settlement_imported', 'ebay_sync_debug', 'ebay_fetch_complete'] },
] as const;

async function fetchSyncStatus(): Promise<Omit<SyncStatusResult, 'loading'>> {
  // 1. Check which API integrations are actually connected (have tokens)
  const [xeroRes, amazonRes, shopifyRes, ebayRes] = await Promise.all([
    supabase.from('xero_tokens').select('id').limit(1),
    supabase.from('amazon_tokens').select('id').limit(1),
    supabase.from('shopify_tokens').select('id').limit(1),
    supabase.from('ebay_tokens').select('id').limit(1),
  ]);

  const connectedSet = new Set<string>();
  if (xeroRes.data?.length) connectedSet.add('xero');
  if (amazonRes.data?.length) connectedSet.add('amazon_au');
  if (shopifyRes.data?.length) connectedSet.add('shopify');
  if (ebayRes.data?.length) connectedSet.add('ebay_au');

  // 2. Get recent sync_history entries (last 50, covers all event types)
  const { data: syncHistory } = await supabase
    .from('sync_history')
    .select('event_type, status, created_at, error_message, details')
    .order('created_at', { ascending: false })
    .limit(50);

  // 3. Get recent system_events for additional sync signals
  const allEventTypes = API_INTEGRATIONS.flatMap(i => i.eventTypes);
  const { data: systemEvents } = await supabase
    .from('system_events')
    .select('event_type, severity, created_at, marketplace_code, details')
    .in('event_type', allEventTypes)
    .order('created_at', { ascending: false })
    .limit(50);

  // Helper: derive status from history
  function deriveStatus(
    historyTypes: readonly string[],
    eventTypes: readonly string[],
    marketplaceCode?: string,
  ): { status: SyncStatusValue; lastRun: Date | null; message?: string } {
    const historyMatch = syncHistory?.find(h =>
      historyTypes.some(t => h.event_type.includes(t))
    );

    const eventMatch = systemEvents?.find(e =>
      eventTypes.includes(e.event_type) &&
      (!marketplaceCode || !e.marketplace_code || e.marketplace_code === marketplaceCode || e.marketplace_code.startsWith(marketplaceCode))
    );

    const candidates: { date: Date; isError: boolean; message?: string }[] = [];

    if (historyMatch) {
      candidates.push({
        date: new Date(historyMatch.created_at),
        isError: historyMatch.status === 'error',
        message: historyMatch.error_message || undefined,
      });
    }

    if (eventMatch) {
      candidates.push({
        date: new Date(eventMatch.created_at!),
        isError: eventMatch.severity === 'error' || eventMatch.event_type.includes('error'),
        message: typeof eventMatch.details === 'object' && eventMatch.details
          ? (eventMatch.details as any).message || undefined
          : undefined,
      });
    }

    if (candidates.length === 0) {
      return { status: 'never', lastRun: null };
    }

    candidates.sort((a, b) => b.date.getTime() - a.date.getTime());
    const latest = candidates[0];

    return {
      status: latest.isError ? 'error' : 'success',
      lastRun: latest.date,
      message: latest.message,
    };
  }

  // Xero status (always the first integration)
  const xeroIntegration = API_INTEGRATIONS[0];
  const xero = connectedSet.has('xero')
    ? deriveStatus(xeroIntegration.historyTypes, xeroIntegration.eventTypes)
    : { status: 'never' as SyncStatusValue, lastRun: null };

  // Marketplace statuses — only show connected API integrations (skip Xero, handled above)
  const marketplaces: SyncEntry[] = API_INTEGRATIONS
    .slice(1) // skip xero
    .filter(integration => connectedSet.has(integration.rail))
    .map(integration => {
      const result = deriveStatus(
        integration.historyTypes,
        integration.eventTypes,
        integration.rail,
      );
      return {
        rail: integration.rail,
        name: integration.name,
        ...result,
      };
    });

  return { xero, marketplaces };
}

export function useSyncStatus(): SyncStatusResult {
  const { data, isLoading } = useQuery({
    queryKey: ['sync-status-dashboard'],
    queryFn: fetchSyncStatus,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
  });

  return {
    xero: data?.xero ?? { lastRun: null, status: 'never' },
    marketplaces: data?.marketplaces ?? [],
    loading: isLoading,
  };
}
