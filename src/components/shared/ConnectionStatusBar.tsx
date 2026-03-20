/**
 * ConnectionStatusBar — Shows Shopify/Amazon/Xero connection status as pill badges.
 * Hover reveals last sync time + status. Click → Settings.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/use-mobile';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { formatDistanceToNow } from 'date-fns';
import { CheckCircle2, XCircle, Loader2, Minus, Clock } from 'lucide-react';

interface ConnectionInfo {
  key: string;
  label: string;
  icon: string;
  connected: boolean;
  detail?: string;
  connectedAt?: string;
}

interface ConnectionStatusBarProps {
  onNavigateToSettings?: () => void;
}

async function fetchConnectionStatus(): Promise<ConnectionInfo[]> {
  const [shopifyRes, amazonRes, xeroRes, ebayRes] = await Promise.allSettled([
    supabase.functions.invoke('shopify-auth', { method: 'GET', headers: { 'x-action': 'status' } }),
    supabase.functions.invoke('amazon-auth', { headers: { 'x-action': 'status' } }),
    supabase.functions.invoke('xero-auth', { method: 'GET', headers: { 'x-action': 'status' } }),
    supabase.functions.invoke('ebay-auth', { headers: { 'x-action': 'status' } }),
  ]);

  const resolve = (res: PromiseSettledResult<any>) => {
    if (res.status === 'fulfilled' && !res.value.error) return res.value.data;
    return null;
  };

  const shopify = resolve(shopifyRes);
  const amazon = resolve(amazonRes);
  const xero = resolve(xeroRes);
  const ebay = resolve(ebayRes);

  const formatDate = (d: string | null | undefined) => {
    if (!d) return undefined;
    return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return [
    {
      key: 'shopify',
      label: 'Shopify',
      icon: '🛍',
      connected: !!(shopify?.connected),
      detail: shopify?.shops?.[0]?.shop_domain || undefined,
      connectedAt: formatDate(shopify?.shops?.[0]?.installed_at),
    },
    {
      key: 'amazon',
      label: 'Amazon',
      icon: '📦',
      connected: !!(amazon?.connected),
      detail: amazon?.selling_partner_id || undefined,
      connectedAt: formatDate(amazon?.created_at),
    },
    {
      key: 'ebay',
      label: 'eBay',
      icon: '🏷️',
      connected: !!(ebay?.connected),
      detail: ebay?.ebay_username || undefined,
      connectedAt: formatDate(ebay?.created_at),
    },
    {
      key: 'xero',
      label: 'Xero',
      icon: '📊',
      connected: !!(xero?.connected),
      detail: xero?.tenant_name || undefined,
      connectedAt: formatDate(xero?.connected_at),
    },
  ];
}

function formatLastRun(date: Date | null): string {
  if (!date) return '';
  try {
    return formatDistanceToNow(date, { addSuffix: true });
  } catch {
    return '';
  }
}

export default function ConnectionStatusBar({ onNavigateToSettings }: ConnectionStatusBarProps) {
  const isMobile = useIsMobile();

  const { data: connections = [] } = useQuery({
    queryKey: ['connection-status'],
    queryFn: fetchConnectionStatus,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const { xero: xeroSync, marketplaces: mpSyncs } = useSyncStatus();

  // Build a map of rail → sync info for quick lookup
  const syncMap = new Map<string, { lastRun: Date | null; status: string; message?: string }>();
  syncMap.set('xero', xeroSync);
  for (const mp of mpSyncs) {
    // Map rail keys like 'amazon_au' → connection key 'amazon', 'shopify' → 'shopify', etc.
    const connKey = mp.rail.startsWith('amazon') ? 'amazon' : mp.rail.startsWith('ebay') ? 'ebay' : mp.rail;
    syncMap.set(connKey, mp);
  }

  if (connections.length === 0) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center gap-1.5">
        {connections.map(conn => {
          const sync = syncMap.get(conn.key);
          const lastRunText = sync?.lastRun ? formatLastRun(sync.lastRun) : null;
          const syncStatus = sync?.status || 'never';

          return (
            <Tooltip key={conn.key}>
              <TooltipTrigger asChild>
                <button
                  onClick={onNavigateToSettings}
                  className={`
                    inline-flex items-center gap-1 rounded-full transition-colors cursor-pointer
                    ${isMobile ? 'px-1.5 py-1' : 'px-2.5 py-1'}
                    ${conn.connected
                      ? 'bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300'
                      : 'bg-muted text-muted-foreground'
                    }
                  `}
                >
                  <span className="text-xs">{conn.icon}</span>
                  {isMobile ? (
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        conn.connected
                          ? 'bg-emerald-500 dark:bg-emerald-400'
                          : 'bg-muted-foreground/40'
                      }`}
                    />
                  ) : (
                    <>
                      <span className="text-[10px] font-medium">{conn.label}</span>
                      <span className="text-[10px]">{conn.connected ? '✅' : '—'}</span>
                    </>
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs max-w-[220px]">
                {conn.connected ? (
                  <div className="space-y-1">
                    <p className="font-medium flex items-center gap-1">
                      <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                      {conn.label} connected
                    </p>
                    {conn.detail && <p className="text-muted-foreground">{conn.detail}</p>}
                    {lastRunText && (
                      <p className="text-muted-foreground flex items-center gap-1">
                        <Clock className="h-3 w-3 shrink-0" />
                        Last sync {lastRunText}
                      </p>
                    )}
                    {syncStatus === 'error' && sync?.message && (
                      <p className="text-destructive flex items-center gap-1">
                        <XCircle className="h-3 w-3 shrink-0" />
                        {sync.message}
                      </p>
                    )}
                    {syncStatus === 'running' && (
                      <p className="text-primary flex items-center gap-1">
                        <Loader2 className="h-3 w-3 animate-spin shrink-0" />
                        Syncing now…
                      </p>
                    )}
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    <p className="font-medium flex items-center gap-1">
                      <Minus className="h-3 w-3 text-muted-foreground" />
                      {conn.label} not connected
                    </p>
                    <p className="text-muted-foreground">Click to connect →</p>
                  </div>
                )}
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </TooltipProvider>
  );
}