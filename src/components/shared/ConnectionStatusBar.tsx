/**
 * ConnectionStatusBar — Shows Shopify/Amazon/Xero connection status as pill badges.
 * Compact on mobile (icons only with dots). Tooltips with details. Click → Settings.
 */

import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useIsMobile } from '@/hooks/use-mobile';

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
  const [shopifyRes, amazonRes, xeroRes, ebayRes] = await Promise.all([
    supabase.from('shopify_tokens').select('shop_domain, installed_at').limit(1),
    supabase.from('amazon_tokens').select('selling_partner_id, created_at').limit(1),
    supabase.from('xero_tokens').select('tenant_name, created_at').limit(1),
    supabase.from('ebay_tokens').select('ebay_username, created_at').limit(1),
  ]);

  const shopify = shopifyRes.data?.[0];
  const amazon = amazonRes.data?.[0];
  const xero = xeroRes.data?.[0];
  const ebay = ebayRes.data?.[0];

  const formatDate = (d: string | null | undefined) => {
    if (!d) return undefined;
    return new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  return [
    {
      key: 'shopify',
      label: 'Shopify',
      icon: '🛍',
      connected: !!shopify,
      detail: shopify?.shop_domain || undefined,
      connectedAt: formatDate(shopify?.installed_at),
    },
    {
      key: 'amazon',
      label: 'Amazon',
      icon: '📦',
      connected: !!amazon,
      detail: amazon?.selling_partner_id || undefined,
      connectedAt: formatDate(amazon?.created_at),
    },
    {
      key: 'ebay',
      label: 'eBay',
      icon: '🏷️',
      connected: !!ebay,
      detail: ebay?.ebay_username || undefined,
      connectedAt: formatDate(ebay?.created_at),
    },
    {
      key: 'xero',
      label: 'Xero',
      icon: '📊',
      connected: !!xero,
      detail: xero?.tenant_name || undefined,
      connectedAt: formatDate(xero?.created_at),
    },
  ];
}

export default function ConnectionStatusBar({ onNavigateToSettings }: ConnectionStatusBarProps) {
  const isMobile = useIsMobile();

  const { data: connections = [] } = useQuery({
    queryKey: ['connection-status'],
    queryFn: fetchConnectionStatus,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  if (connections.length === 0) return null;

  return (
    <TooltipProvider delayDuration={300}>
      <div className="flex items-center gap-1.5">
        {connections.map(conn => (
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
            <TooltipContent side="bottom" className="text-xs max-w-[200px]">
              {conn.connected ? (
                <div className="space-y-0.5">
                  <p className="font-medium">{conn.label} connected</p>
                  {conn.detail && <p className="text-muted-foreground">{conn.detail}</p>}
                  {conn.connectedAt && <p className="text-muted-foreground">Connected {conn.connectedAt}</p>}
                </div>
              ) : (
                <div className="space-y-0.5">
                  <p className="font-medium">{conn.label} not connected</p>
                  <p className="text-muted-foreground">Click to connect →</p>
                </div>
              )}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </TooltipProvider>
  );
}
