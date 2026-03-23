/**
 * useApiSyncedCodes — Universal hook to determine which marketplace codes are API-synced.
 *
 * Combines two sources:
 * 1. marketplace_connections rows with API connection_types (sp_api, ebay_api, mirakl_api, shopify_api)
 * 2. useSyncStatus integrations with known marketplace aliases (covers Bunnings via Mirakl, etc.)
 *
 * This is the SINGLE SOURCE OF TRUTH for "is this marketplace API-connected?"
 * All components must use this instead of ad-hoc marketplace_connections queries.
 */

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { ACTIVE_CONNECTION_STATUSES, isApiConnectionType } from '@/constants/connection-status';
import { useSyncStatus } from '@/hooks/useSyncStatus';

/** Known aliases from sync integrations → canonical marketplace_code */
const SYNC_RAIL_ALIASES: Record<string, string[]> = {
  amazon: ['amazon_au', 'amazon_us', 'amazon_uk', 'amazon_ca', 'amazon_de', 'amazon_jp', 'amazon_sg', 'amazon_nl', 'amazon_fr'],
  shopify: ['shopify', 'shopify_payments', 'shopify_orders'],
  ebay_au: ['ebay', 'ebay_au'],
  bunnings: ['bunnings'],
};

export interface ApiSyncedResult {
  /** Set of marketplace_codes that are API-synced */
  apiSyncedCodes: Set<string>;
  /** Whether the data is still loading */
  loading: boolean;
}

export function useApiSyncedCodes(): ApiSyncedResult {
  const { marketplaces: syncedIntegrations, loading: syncLoading } = useSyncStatus();

  const { data: connectionCodes, isLoading: connLoading } = useQuery({
    queryKey: ['api-synced-connections'],
    queryFn: async () => {
      const { data } = await supabase
        .from('marketplace_connections')
        .select('marketplace_code, connection_type, connection_status');
      return (data || [])
        .filter((c: any) =>
          isApiConnectionType(c.connection_type) &&
          (ACTIVE_CONNECTION_STATUSES as readonly string[]).includes(c.connection_status)
        )
        .map((c: any) => c.marketplace_code as string);
    },
    staleTime: 60_000,
  });

  const apiSyncedCodes = useMemo(() => {
    const codes = new Set<string>(connectionCodes || []);

    // Merge sync integrations that have actually synced (have token presence)
    for (const integration of syncedIntegrations) {
      if (integration.status !== 'never') {
        // Add the rail itself
        codes.add(integration.rail);
        // Add all known aliases for this rail
        const aliases = SYNC_RAIL_ALIASES[integration.rail];
        if (aliases) {
          for (const alias of aliases) {
            codes.add(alias);
          }
        }
      }
    }

    return codes;
  }, [connectionCodes, syncedIntegrations]);

  return { apiSyncedCodes, loading: syncLoading || connLoading };
}
