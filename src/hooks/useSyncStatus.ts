/**
 * useSyncStatus — Shared hook for dashboard sync activity visibility.
 * Reads from sync_history, system_events, and marketplace_connections.
 * No direct Supabase calls should exist outside this hook for sync status.
 */

import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ACTIVE_CONNECTION_STATUSES } from '@/constants/connection-status';

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

async function fetchSyncStatus(): Promise<Omit<SyncStatusResult, 'loading'>> {
  // 1. Get active marketplace connections
  const { data: connections } = await supabase
    .from('marketplace_connections')
    .select('marketplace_code, marketplace_name, connection_status')
    .in('connection_status', [...ACTIVE_CONNECTION_STATUSES]);

  // 2. Get recent sync_history entries (last 50, covers all event types)
  const { data: syncHistory } = await supabase
    .from('sync_history')
    .select('event_type, status, created_at, error_message, details')
    .order('created_at', { ascending: false })
    .limit(50);

  // 3. Get recent system_events for additional sync signals
  const { data: systemEvents } = await supabase
    .from('system_events')
    .select('event_type, severity, created_at, marketplace_code, details')
    .in('event_type', [
      'xero_sync_complete', 'xero_sync_error', 'xero_push_complete',
      'settlement_imported', 'settlement_parsed', 'sync_complete', 'sync_error',
      'amazon_fetch_complete', 'shopify_fetch_complete', 'ebay_fetch_complete',
    ])
    .order('created_at', { ascending: false })
    .limit(50);

  // Helper: derive status from history
  function deriveStatus(
    historyTypes: string[],
    eventTypes: string[],
    marketplaceCode?: string,
  ): { status: SyncStatusValue; lastRun: Date | null; message?: string } {
    // Check sync_history first
    const historyMatch = syncHistory?.find(h =>
      historyTypes.some(t => h.event_type.includes(t))
    );

    // Check system_events (optionally filtered by marketplace)
    const eventMatch = systemEvents?.find(e =>
      eventTypes.includes(e.event_type) &&
      (!marketplaceCode || e.marketplace_code === marketplaceCode)
    );

    // Pick most recent
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

  // Xero status
  const xero = deriveStatus(
    ['xero_sync', 'xero_push', 'xero_refresh', 'xero_status'],
    ['xero_sync_complete', 'xero_sync_error', 'xero_push_complete'],
  );

  // Marketplace statuses
  const marketplaces: SyncEntry[] = (connections || []).map(conn => {
    const code = conn.marketplace_code.toLowerCase();
    const result = deriveStatus(
      [code, conn.marketplace_code],
      [
        'settlement_imported', 'settlement_parsed', 'sync_complete', 'sync_error',
        'amazon_fetch_complete', 'shopify_fetch_complete', 'ebay_fetch_complete',
      ],
      conn.marketplace_code,
    );

    return {
      rail: conn.marketplace_code,
      name: conn.marketplace_name || conn.marketplace_code,
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
