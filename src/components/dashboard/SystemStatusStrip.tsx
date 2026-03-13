/**
 * SystemStatusStrip — A single compact system health summary.
 * Shows "All systems healthy" or actionable issues. Expands on click.
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, Settings, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConnectionStatus {
  label: string;
  connected: boolean;
  synced?: boolean;
  detail?: string;
  lastSync?: string;
}

interface Props {
  showAiMapper?: boolean;
  showBankMappingNudge?: boolean;
  xeroConnected?: boolean;
  onReviewMapping?: () => void;
  onMapBankAccounts?: () => void;
  onConnect?: () => void;
}

async function fetchStatuses(): Promise<ConnectionStatus[]> {
  const [xeroRes, amazonRes, shopifyRes, flagsRes] = await Promise.all([
    supabase.from('xero_tokens').select('tenant_name, updated_at').limit(1),
    supabase.from('amazon_tokens').select('selling_partner_id, updated_at').limit(1),
    supabase.from('shopify_tokens').select('shop_domain, updated_at').limit(1),
    supabase.from('app_settings').select('key, value, updated_at').in('key', [
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

  const syncTime = (tokenDate: string | undefined, scanFlagKey: string): string | undefined => {
    const scanFlag = flags.get(scanFlagKey);
    if (scanFlag?.value === 'true' && scanFlag.updated_at) return scanFlag.updated_at;
    if (scanFlag?.value === 'true' && tokenDate) return tokenDate;
    return undefined;
  };

  return [
    {
      label: 'Xero',
      connected: !!xero,
      synced: flags.get('xero_scan_completed')?.value === 'true',
      detail: xero?.tenant_name || undefined,
      lastSync: timeAgo(syncTime(xero?.updated_at, 'xero_scan_completed')),
    },
    {
      label: 'Amazon',
      connected: !!amazon,
      synced: flags.get('amazon_scan_completed')?.value === 'true',
      detail: amazon?.selling_partner_id || undefined,
      lastSync: timeAgo(syncTime(amazon?.updated_at, 'amazon_scan_completed')),
    },
    {
      label: 'Shopify',
      connected: !!shopify,
      synced: flags.get('shopify_scan_completed')?.value === 'true',
      detail: shopify?.shop_domain || undefined,
      lastSync: timeAgo(syncTime(shopify?.updated_at, 'shopify_scan_completed')),
    },
  ];
}

export default function SystemStatusStrip({
  showAiMapper,
  showBankMappingNudge,
  xeroConnected,
  onReviewMapping,
  onMapBankAccounts,
  onConnect,
}: Props) {
  const [expanded, setExpanded] = useState(false);

  const { data: connections = [] } = useQuery({
    queryKey: ['system-status-strip'],
    queryFn: fetchStatuses,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  if (connections.length === 0) return null;

  const allConnected = connections.every(c => c.connected);
  const allSynced = connections.filter(c => c.connected).every(c => c.synced);
  const disconnected = connections.filter(c => !c.connected);
  const hasActions = showAiMapper || (showBankMappingNudge && xeroConnected) || disconnected.length > 0;

  // Determine headline
  let headline: string;
  let headlineColor: string;
  let headlineIcon: React.ReactNode;

  if (allConnected && allSynced && !hasActions) {
    headline = 'All systems healthy';
    headlineColor = 'text-emerald-600 dark:text-emerald-400';
    headlineIcon = <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  } else if (hasActions) {
    const actionCount = (showAiMapper ? 1 : 0) + (showBankMappingNudge && xeroConnected ? 1 : 0) + disconnected.length;
    headline = `${actionCount} action${actionCount > 1 ? 's' : ''} needed`;
    headlineColor = 'text-amber-600 dark:text-amber-400';
    headlineIcon = <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
  } else {
    headline = allConnected ? 'All connected — syncing' : 'Connections active';
    headlineColor = 'text-foreground';
    headlineIcon = <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
  }

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Collapsed: single line */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-2.5 flex items-center justify-between text-sm hover:bg-muted/30 transition-colors"
      >
        <div className="flex items-center gap-2">
          {headlineIcon}
          <span className={cn('font-medium', headlineColor)}>{headline}</span>
          {/* Mini connection indicators */}
          <div className="flex items-center gap-1.5 ml-2">
            {connections.map(c => (
              <span
                key={c.label}
                className={cn(
                  'h-2 w-2 rounded-full',
                  c.connected && c.synced ? 'bg-emerald-500' :
                  c.connected ? 'bg-amber-400' :
                  'bg-muted-foreground/30'
                )}
                title={`${c.label}: ${c.connected ? (c.synced ? 'synced' : 'connected') : 'not connected'}`}
              />
            ))}
          </div>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>

      {/* Expanded: detail rows */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-2.5">
          {/* Connection statuses */}
          <div className="flex items-center gap-1 flex-wrap text-sm">
            {connections.map((conn, i) => (
              <React.Fragment key={conn.label}>
                {i > 0 && <span className="text-muted-foreground mx-1">·</span>}
                {conn.connected ? (
                  <span className="text-foreground">
                    <span className={conn.synced ? 'text-emerald-500' : 'text-amber-400'}>
                      {conn.synced ? '🟢' : '🟡'}
                    </span>{' '}
                    <span className="font-medium">{conn.label}</span>
                    {conn.synced && conn.lastSync ? (
                      <span className="text-muted-foreground"> synced {conn.lastSync}</span>
                    ) : conn.synced ? (
                      <span className="text-muted-foreground"> synced</span>
                    ) : (
                      <span className="text-muted-foreground"> connected — syncing…</span>
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
            {disconnected.length > 0 && onConnect && (
              <>
                <span className="text-muted-foreground mx-1">—</span>
                <button onClick={onConnect} className="text-primary hover:underline font-medium text-sm">
                  Connect →
                </button>
              </>
            )}
          </div>

          {/* Action items */}
          {showAiMapper && onReviewMapping && (
            <div className="flex items-center justify-between rounded-lg border border-primary/20 bg-primary/5 px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                <span className="text-foreground">Xero accounts auto-mapped — review and confirm</span>
              </div>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onReviewMapping}>
                Review mapping
              </Button>
            </div>
          )}

          {showBankMappingNudge && xeroConnected && onMapBankAccounts && (
            <div className="flex items-center justify-between rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2">
              <div className="flex items-center gap-2 text-sm">
                <Settings className="h-3.5 w-3.5 text-amber-600" />
                <span className="text-foreground">Map bank accounts for deposit matching</span>
              </div>
              <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onMapBankAccounts}>
                Map accounts
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
