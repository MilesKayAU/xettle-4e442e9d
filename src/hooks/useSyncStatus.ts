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
  {
    rail: 'xero',
    name: 'Xero',
    tokenTable: 'xero_tokens' as const,
    historyTypes: ['xero'],
    eventTypes: ['xero_api_call', 'xero_audit_complete', 'xero_scan_completed', 'xero_invoice_refreshed', 'xero_sync_complete', 'xero_sync_error', 'xero_push_complete', 'xero_coa_refreshed'],
    marketplaceAliases: [] as const,
  },
  {
    rail: 'amazon',
    name: 'Amazon',
    tokenTable: 'amazon_tokens' as const,
    historyTypes: ['amazon'],
    eventTypes: ['amazon_settlement_synced', 'amazon_fetch_complete'],
    marketplaceAliases: ['amazon_au', 'amazon_us', 'amazon_uk', 'amazon_ca', 'amazon_de', 'amazon_jp', 'amazon_sg', 'amazon_nl', 'amazon_fr'] as const,
  },
  {
    rail: 'shopify',
    name: 'Shopify',
    tokenTable: 'shopify_tokens' as const,
    historyTypes: ['shopify'],
    eventTypes: ['shopify_payout_synced', 'shopify_fetch_complete'],
    marketplaceAliases: ['shopify', 'shopify_payments'] as const,
  },
  {
    rail: 'ebay_au',
    name: 'eBay AU',
    tokenTable: 'ebay_tokens' as const,
    historyTypes: ['ebay'],
    eventTypes: ['ebay_settlement_imported', 'ebay_sync_debug', 'ebay_fetch_complete'],
    marketplaceAliases: ['ebay', 'ebay_au'] as const,
  },
  {
    rail: 'bunnings',
    name: 'Bunnings',
    tokenTable: 'mirakl_tokens' as const,
    historyTypes: ['mirakl'],
    eventTypes: ['mirakl_reconciliation_mismatch', 'mirakl_fetch_complete', 'settlement_saved'],
    marketplaceAliases: ['bunnings'] as const,
  },
] as const;

type SyncHistoryRow = {
  event_type: string;
  status: string;
  created_at: string;
  error_message: string | null;
  details: unknown;
};

type SystemEventRow = {
  event_type: string;
  severity: string | null;
  created_at: string | null;
  marketplace_code: string | null;
  details: unknown;
};

function buildHistoryFilter(historyTypes: readonly string[]) {
  return historyTypes.map(type => `event_type.ilike.%${type}%`).join(',');
}

function matchesMarketplaceAlias(
  marketplaceCode: string | null,
  aliases: readonly string[],
) {
  if (aliases.length === 0) return true;
  if (!marketplaceCode) return false;

  const normalizedCode = marketplaceCode.toLowerCase();
  return aliases.some(alias => normalizedCode === alias || normalizedCode.startsWith(alias));
}

async function fetchSyncStatus(): Promise<Omit<SyncStatusResult, 'loading'>> {
  const [tokenResults, historyResults, eventResults] = await Promise.all([
    Promise.all([
      supabase.from('xero_tokens').select('id').limit(1),
      supabase.from('amazon_tokens').select('id').limit(1),
      supabase.from('shopify_tokens').select('id').limit(1),
      supabase.from('ebay_tokens').select('id').limit(1),
      supabase.from('mirakl_tokens').select('id').limit(1),
    ]),
    Promise.all(
      API_INTEGRATIONS.map(async integration => {
        const { data } = await supabase
          .from('sync_history')
          .select('event_type, status, created_at, error_message, details')
          .or(buildHistoryFilter(integration.historyTypes))
          .order('created_at', { ascending: false })
          .limit(20);

        return (data ?? []) as SyncHistoryRow[];
      }),
    ),
    Promise.all(
      API_INTEGRATIONS.map(async integration => {
        const { data } = await supabase
          .from('system_events')
          .select('event_type, severity, created_at, marketplace_code, details')
          .in('event_type', [...integration.eventTypes])
          .order('created_at', { ascending: false })
          .limit(30);

        return (data ?? []) as SystemEventRow[];
      }),
    ),
  ]);

  const [xeroRes, amazonRes, shopifyRes, ebayRes] = tokenResults;

  const connectedSet = new Set<string>();
  if (xeroRes.data?.length) connectedSet.add('xero');
  if (amazonRes.data?.length) connectedSet.add('amazon_au');
  if (shopifyRes.data?.length) connectedSet.add('shopify');
  if (ebayRes.data?.length) connectedSet.add('ebay_au');

  function deriveStatus(
    historyRows: SyncHistoryRow[],
    systemRows: SystemEventRow[],
    marketplaceAliases: readonly string[],
  ): { status: SyncStatusValue; lastRun: Date | null; message?: string } {
    const candidates: { date: Date; status: SyncStatusValue; message?: string }[] = [];

    historyRows.forEach(row => {
      candidates.push({
        date: new Date(row.created_at),
        status: row.status === 'running'
          ? 'running'
          : row.status === 'error'
            ? 'error'
            : 'success',
        message: row.error_message || undefined,
      });
    });

    systemRows
      .filter(row => matchesMarketplaceAlias(row.marketplace_code, marketplaceAliases))
      .forEach(row => {
        if (!row.created_at) return;

        candidates.push({
          date: new Date(row.created_at),
          status: row.severity === 'error' || row.event_type.includes('error') ? 'error' : 'success',
          message: typeof row.details === 'object' && row.details
            ? (row.details as { message?: string }).message
            : undefined,
        });
      });

    if (candidates.length === 0) {
      return { status: 'never', lastRun: null };
    }

    candidates.sort((a, b) => b.date.getTime() - a.date.getTime());
    const latest = candidates[0];

    return {
      status: latest.status,
      lastRun: latest.date,
      message: latest.message,
    };
  }

  const xero = connectedSet.has('xero')
    ? deriveStatus(historyResults[0], eventResults[0], API_INTEGRATIONS[0].marketplaceAliases)
    : { status: 'never' as SyncStatusValue, lastRun: null };

  const marketplaces: SyncEntry[] = API_INTEGRATIONS
    .slice(1)
    .filter(integration => connectedSet.has(integration.rail))
    .map(integration => {
      const integrationIndex = API_INTEGRATIONS.findIndex(item => item.rail === integration.rail);
      const result = deriveStatus(
        historyResults[integrationIndex],
        eventResults[integrationIndex],
        integration.marketplaceAliases,
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
