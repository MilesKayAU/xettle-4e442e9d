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

  // Connected = token exists OR phase1 ran (initial connect)
  const xeroConnected = !!xero || flags.get('setup_phase1_xero')?.value === 'true' || flags.get('xero_scan_completed')?.value === 'true';
  const amazonConnected = !!amazon || flags.get('setup_phase1_amazon')?.value === 'true' || flags.get('amazon_scan_completed')?.value === 'true';
  const shopifyConnected = !!shopify || flags.get('setup_phase1_shopify')?.value === 'true' || flags.get('shopify_scan_completed')?.value === 'true';

  // "Synced" = deep scan completed (not just connected). Only use *_scan_completed flags for sync time.
  const xeroSynced = flags.get('xero_scan_completed')?.value === 'true';
  const amazonSynced = flags.get('amazon_scan_completed')?.value === 'true';
  const shopifySynced = flags.get('shopify_scan_completed')?.value === 'true';

  // Sync time only from deep-scan completion or token refresh — NOT from setup_phase1 connect flags
  const syncTime = (tokenDate: string | undefined, scanFlagKey: string): string | undefined => {
    const scanFlag = flags.get(scanFlagKey);
    if (scanFlag?.value === 'true' && scanFlag.updated_at) return scanFlag.updated_at;
    // Only use token date if scan has completed (avoids showing "synced" during initial connect)
    if (scanFlag?.value === 'true' && tokenDate) return tokenDate;
    return undefined;
  };

  return [
    {
      label: 'Xero',
      connected: xeroConnected,
      synced: xeroSynced,
      detail: xero?.tenant_name || undefined,
      lastSync: timeAgo(syncTime(xero?.updated_at, 'xero_scan_completed')),
    },
    {
      label: 'Amazon',
      connected: amazonConnected,
      synced: amazonSynced,
      detail: amazon?.selling_partner_id || undefined,
      lastSync: timeAgo(syncTime(amazon?.updated_at, 'amazon_scan_completed')),
    },
    {
      label: 'Shopify',
      connected: shopifyConnected,
      synced: shopifySynced,
      detail: shopify?.shop_domain || undefined,
      lastSync: timeAgo(syncTime(shopify?.updated_at, 'shopify_scan_completed')),
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
              {conn.detail?.includes('rate limited') ? (
                <span className="text-muted-foreground"> · {conn.detail}</span>
              ) : conn.lastSync ? (
                <span className="text-muted-foreground"> synced {conn.lastSync}</span>
              ) : (
                <span className="text-muted-foreground"> connected</span>
              )}
            </span>
          ) : (
            <span className="text-foreground">
              <span className="text-muted-foreground/60">⚪</span>{' '}
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
            Connect →
          </button>
        </>
      )}
    </div>
  );
}
