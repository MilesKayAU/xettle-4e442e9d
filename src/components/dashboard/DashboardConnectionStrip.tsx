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
  // Fetch tokens AND scan completion flags in parallel for a unified view
  const [xeroRes, amazonRes, shopifyRes, flagsRes] = await Promise.all([
    supabase.from('xero_tokens').select('tenant_name, updated_at').limit(1),
    supabase.from('amazon_tokens').select('selling_partner_id, updated_at').limit(1),
    supabase.from('shopify_tokens').select('shop_domain, updated_at').limit(1),
    supabase.from('app_settings').select('key, value, updated_at').in('key', [
      'setup_phase1_xero', 'setup_phase1_shopify', 'setup_phase1_amazon',
      'xero_scan_completed', 'amazon_scan_completed', 'shopify_scan_completed',
    ]),
  ]);

  const xero = xeroRes.data?.[0];
  const amazon = amazonRes.data?.[0];
  const shopify = shopifyRes.data?.[0];

  const flags = new Map(flagsRes.data?.map(f => [f.key, f]) || []);

  const timeAgo = (d: string | null | undefined) => {
    if (!d) return undefined;
    try { return formatDistanceToNow(new Date(d), { addSuffix: true }); } catch { return undefined; }
  };

  // Connected = token exists OR scan completed successfully (token may have been refreshed/rotated)
  const xeroConnected = !!xero || flags.get('setup_phase1_xero')?.value === 'true' || flags.get('xero_scan_completed')?.value === 'true';
  const amazonConnected = !!amazon || flags.get('setup_phase1_amazon')?.value === 'true' || flags.get('amazon_scan_completed')?.value === 'true';
  const shopifyConnected = !!shopify || flags.get('setup_phase1_shopify')?.value === 'true' || flags.get('shopify_scan_completed')?.value === 'true';

  // Use the most recent timestamp from either the token or the scan flag
  const bestSyncTime = (tokenDate: string | undefined, ...flagKeys: string[]): string | undefined => {
    const dates = [tokenDate, ...flagKeys.map(k => flags.get(k)?.updated_at)].filter(Boolean) as string[];
    if (dates.length === 0) return undefined;
    return dates.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0];
  };

  return [
    {
      label: 'Xero',
      connected: xeroConnected,
      detail: xero?.tenant_name || undefined,
      lastSync: timeAgo(bestSyncTime(xero?.updated_at, 'setup_phase1_xero', 'xero_scan_completed')),
    },
    {
      label: 'Amazon',
      connected: amazonConnected,
      detail: amazon?.selling_partner_id || undefined,
      lastSync: timeAgo(bestSyncTime(amazon?.updated_at, 'setup_phase1_amazon', 'amazon_scan_completed')),
    },
    {
      label: 'Shopify',
      connected: shopifyConnected,
      detail: shopify?.shop_domain || undefined,
      lastSync: timeAgo(bestSyncTime(shopify?.updated_at, 'setup_phase1_shopify', 'shopify_scan_completed')),
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

  const hasDisconnected = connections.some(c => !c.connected);

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
      {hasDisconnected && onSwitchToUpload && (
        <>
          <span className="text-muted-foreground mx-1">—</span>
          <button
            onClick={onSwitchToUpload}
            className="text-primary hover:underline font-medium"
          >
            Go to Upload to connect →
          </button>
        </>
      )}
    </div>
  );
}
