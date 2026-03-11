/**
 * DashboardConnectionStrip — A single compact line showing connection health.
 * e.g. "🟢 Xero connected · 🟢 Amazon synced 2h ago · ⚠️ Shopify not connected — Connect →"
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';

interface ConnectionStatus {
  label: string;
  connected: boolean;
  detail?: string;
  lastSync?: string;
}

interface Props {
  onConnectXero?: () => void;
  onConnectAmazon?: () => void;
  onConnectShopify?: () => void;
  onSwitchToUpload?: () => void;
}

async function fetchStatuses(): Promise<ConnectionStatus[]> {
  const [xeroRes, amazonRes, shopifyRes] = await Promise.all([
    supabase.from('xero_tokens').select('tenant_name, updated_at').limit(1),
    supabase.from('amazon_tokens').select('selling_partner_id, updated_at').limit(1),
    supabase.from('shopify_tokens').select('shop_domain, updated_at').limit(1),
  ]);

  const xero = xeroRes.data?.[0];
  const amazon = amazonRes.data?.[0];
  const shopify = shopifyRes.data?.[0];

  const timeAgo = (d: string | null | undefined) => {
    if (!d) return undefined;
    try { return formatDistanceToNow(new Date(d), { addSuffix: true }); } catch { return undefined; }
  };

  return [
    {
      label: 'Xero',
      connected: !!xero,
      detail: xero?.tenant_name || undefined,
      lastSync: timeAgo(xero?.updated_at),
    },
    {
      label: 'Amazon',
      connected: !!amazon,
      detail: amazon?.selling_partner_id || undefined,
      lastSync: timeAgo(amazon?.updated_at),
    },
    {
      label: 'Shopify',
      connected: !!shopify,
      detail: shopify?.shop_domain || undefined,
      lastSync: timeAgo(shopify?.updated_at),
    },
  ];
}

export default function DashboardConnectionStrip({ onSwitchToUpload }: Props) {
  const { data: connections = [] } = useQuery({
    queryKey: ['dashboard-connection-strip'],
    queryFn: fetchStatuses,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  if (connections.length === 0) return null;

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-2.5 flex items-center gap-1 flex-wrap text-sm">
      {connections.map((conn, i) => (
        <React.Fragment key={conn.label}>
          {i > 0 && <span className="text-muted-foreground mx-1">·</span>}
          {conn.connected ? (
            <span className="text-foreground">
              <span className="text-emerald-500">🟢</span>{' '}
              <span className="font-medium">{conn.label}</span>
              {conn.lastSync && (
                <span className="text-muted-foreground"> synced {conn.lastSync}</span>
              )}
            </span>
          ) : (
            <span className="text-foreground">
              <span className="text-amber-500">⚠️</span>{' '}
              <span className="font-medium">{conn.label}</span>{' '}
              <span className="text-muted-foreground">not connected</span>
            </span>
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
