/**
 * SystemStatusStrip — Consolidated system health + API connection status.
 * Shows all connected marketplaces/integrations with sync times and quick actions.
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, AlertOctagon, Settings, Sparkles, Clock3, X, Link2, Unplug } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useSyncStatus } from '@/hooks/useSyncStatus';
import { cn } from '@/lib/utils';

interface ConnectionStatus {
  key: string;
  label: string;
  icon: string;
  connected: boolean;
  synced?: boolean;
  detail?: string;
  lastSync?: string;
  lastSyncRaw?: string;
}

interface ActionItem {
  id: string;
  severity: 'red' | 'amber' | 'info';
  label: string;
  actionLabel?: string;
  onAction?: () => void;
}

interface Props {
  showAiMapper?: boolean;
  showBankMappingNudge?: boolean;
  xeroConnected?: boolean;
  onReviewMapping?: () => void;
  onMapBankAccounts?: () => void;
  onConnect?: () => void;
  onRefreshStatus?: () => void;
  onNavigateToSettings?: () => void;
}

async function fetchStatuses(): Promise<ConnectionStatus[]> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return [];

  const [xeroRes, amazonRes, shopifyRes, ebayRes, miraklRes, flagsRes] = await Promise.all([
    supabase.from('xero_tokens').select('tenant_name, updated_at').limit(1),
    supabase.from('amazon_tokens').select('selling_partner_id, updated_at').limit(1),
    supabase.from('shopify_tokens').select('shop_domain, updated_at').eq('is_active', true).limit(1),
    supabase.from('ebay_tokens').select('ebay_username, updated_at').limit(1),
    supabase.from('mirakl_tokens').select('marketplace_label, updated_at').order('updated_at', { ascending: false }),
    supabase.from('app_settings').select('key, value, updated_at').in('key', [
      'xero_scan_completed', 'amazon_scan_completed', 'shopify_scan_completed',
    ]),
  ]);

  const xero = xeroRes.data?.[0];
  const amazon = amazonRes.data?.[0];
  const shopify = shopifyRes.data?.[0];
  const ebay = ebayRes.data?.[0];
  const miraklConnections = miraklRes.data || [];
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

  const connections: ConnectionStatus[] = [
    {
      key: 'xero',
      label: 'Xero',
      icon: '📊',
      connected: !!xero,
      synced: flags.get('xero_scan_completed')?.value === 'true',
      detail: xero?.tenant_name || undefined,
      lastSync: timeAgo(syncTime(xero?.updated_at, 'xero_scan_completed')),
      lastSyncRaw: syncTime(xero?.updated_at, 'xero_scan_completed'),
    },
    {
      key: 'shopify',
      label: 'Shopify',
      icon: '🛍',
      connected: !!shopify,
      synced: flags.get('shopify_scan_completed')?.value === 'true',
      detail: shopify?.shop_domain || undefined,
      lastSync: timeAgo(syncTime(shopify?.updated_at, 'shopify_scan_completed')),
      lastSyncRaw: syncTime(shopify?.updated_at, 'shopify_scan_completed'),
    },
    {
      key: 'amazon',
      label: 'Amazon',
      icon: '📦',
      connected: !!amazon,
      synced: flags.get('amazon_scan_completed')?.value === 'true',
      detail: amazon?.selling_partner_id || undefined,
      lastSync: timeAgo(syncTime(amazon?.updated_at, 'amazon_scan_completed')),
      lastSyncRaw: syncTime(amazon?.updated_at, 'amazon_scan_completed'),
    },
    {
      key: 'ebay',
      label: 'eBay',
      icon: '🏷️',
      connected: !!ebay,
      synced: !!ebay,
      detail: ebay?.ebay_username || undefined,
      lastSync: timeAgo(ebay?.updated_at),
      lastSyncRaw: ebay?.updated_at,
    },
  ];

  // Add each Mirakl connection as a separate entry
  for (const mk of miraklConnections) {
    connections.push({
      key: `mirakl_${mk.marketplace_label?.toLowerCase().replace(/\s+/g, '_') || 'unknown'}`,
      label: mk.marketplace_label || 'Mirakl',
      icon: '🏠',
      connected: true,
      synced: true,
      detail: undefined,
      lastSync: timeAgo(mk.updated_at),
      lastSyncRaw: mk.updated_at,
    });
  }

  return connections;
}

export default function SystemStatusStrip({
  showAiMapper,
  showBankMappingNudge,
  xeroConnected,
  onReviewMapping,
  onMapBankAccounts,
  onConnect,
  onRefreshStatus,
  onNavigateToSettings,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(() => {
    try { return localStorage.getItem('xettle_mapper_banner_dismissed') === 'true'; } catch { return false; }
  });

  const { data: connections = [] } = useQuery({
    queryKey: ['system-status-strip'],
    queryFn: fetchStatuses,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const { xero: xeroSync, marketplaces: mpSyncs } = useSyncStatus();

  // Build sync map for last-run times from sync status hook
  const syncMap = new Map<string, { lastRun: Date | null; status: string; message?: string }>();
  syncMap.set('xero', xeroSync);
  for (const mp of mpSyncs) {
    const connKey = mp.rail.startsWith('amazon') ? 'amazon' : mp.rail.startsWith('ebay') ? 'ebay' : mp.rail;
    syncMap.set(connKey, mp);
  }

  if (connections.length === 0) return null;

  const connectedOnes = connections.filter(c => c.connected);
  const disconnected = connections.filter(c => !c.connected);
  const allConnected = disconnected.length === 0;
  const allSynced = connectedOnes.every(c => c.synced);

  // Build action items
  const actions: ActionItem[] = [];

  if (disconnected.length > 0) {
    actions.push({
      id: 'disconnected',
      severity: 'amber',
      label: `${disconnected.map(c => c.label).join(', ')} not connected`,
      actionLabel: 'Connect →',
      onAction: onConnect,
    });
  }

  if (showAiMapper && onReviewMapping && !dismissed) {
    actions.push({
      id: 'ai-mapper',
      severity: 'info',
      label: showBankMappingNudge
        ? 'Account mapping incomplete — required before pushing to Xero'
        : 'Xero accounts auto-mapped — review and confirm',
      actionLabel: showBankMappingNudge ? 'Fix mapping' : 'Review mapping',
      onAction: onReviewMapping,
    });
  }

  if (showBankMappingNudge && xeroConnected && onMapBankAccounts) {
    actions.push({
      id: 'bank-mapping',
      severity: 'info',
      label: 'Map destination accounts for optional bank verification',
      actionLabel: 'Map accounts',
      onAction: onMapBankAccounts,
    });
  }

  const hasActions = actions.length > 0;
  const hasRedAction = actions.some(a => a.severity === 'red');
  const hasAmberAction = actions.some(a => a.severity === 'amber');

  let headline: string;
  let headlineColor: string;
  let headlineIcon: React.ReactNode;
  let stripBorderClass: string;
  let primaryAction: ActionItem | undefined;

  if (hasRedAction) {
    headline = actions.find(a => a.severity === 'red')?.label || `${actions.length} issue${actions.length > 1 ? 's' : ''} need attention`;
    headlineColor = 'text-destructive';
    headlineIcon = <AlertOctagon className="h-3.5 w-3.5 text-destructive" />;
    stripBorderClass = 'border-destructive/30 bg-destructive/5';
    primaryAction = actions.find(a => a.severity === 'red');
  } else if (hasAmberAction) {
    const amberActions = actions.filter(a => a.severity === 'amber');
    headline = amberActions.length === 1 ? amberActions[0].label : `${actions.length} action${actions.length > 1 ? 's' : ''} needed`;
    headlineColor = 'text-amber-600 dark:text-amber-400';
    headlineIcon = <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
    stripBorderClass = 'border-amber-300/50 dark:border-amber-700/50 bg-amber-50/50 dark:bg-amber-900/10';
    primaryAction = amberActions[0];
  } else if (allConnected && allSynced && !hasActions) {
    headline = 'All systems healthy';
    headlineColor = 'text-emerald-600 dark:text-emerald-400';
    headlineIcon = <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    stripBorderClass = 'border-border';
  } else if (hasActions) {
    headline = actions[0].label;
    headlineColor = 'text-foreground';
    headlineIcon = <Sparkles className="h-3.5 w-3.5 text-primary" />;
    stripBorderClass = 'border-primary/20 bg-primary/5';
    primaryAction = actions[0];
  } else {
    headline = allConnected ? 'All connected — syncing' : 'Connections active';
    headlineColor = 'text-foreground';
    headlineIcon = <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />;
    stripBorderClass = 'border-border';
  }

  return (
    <div className={cn('rounded-lg border bg-card overflow-hidden', stripBorderClass)}>
      {/* Collapsed: single line */}
      <div className="flex items-center justify-between px-4 py-2.5">
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm flex-1 min-w-0"
        >
          {headlineIcon}
          <span className={cn('font-medium truncate', headlineColor)}>{headline}</span>
          {/* Mini connection indicators */}
          <div className="flex items-center gap-1.5 ml-2 flex-shrink-0">
            {connections.map(c => (
              <TooltipProvider key={c.key} delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span
                      className={cn(
                        'h-2 w-2 rounded-full',
                        c.connected && c.synced ? 'bg-emerald-500' :
                        c.connected ? 'bg-amber-400' :
                        'bg-muted-foreground/30'
                      )}
                    />
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="text-xs">
                    {c.label}: {c.connected ? (c.synced ? 'synced' : 'connected') : 'not connected'}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            ))}
          </div>
          {/* Compact last sync times */}
          <span className="text-[10px] text-muted-foreground ml-2 hidden sm:inline flex-shrink-0">
            {connectedOnes.filter(c => c.lastSync).map(c => `${c.label} ${c.lastSync}`).join(' · ')}
          </span>
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground ml-1 flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground ml-1 flex-shrink-0" />}
        </button>

        {/* Dismiss info-only banners */}
        {!hasRedAction && !hasAmberAction && hasActions && !dismissed && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground ml-1 flex-shrink-0"
            onClick={() => {
              setDismissed(true);
              try { localStorage.setItem('xettle_mapper_banner_dismissed', 'true'); } catch {}
            }}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        )}

        {/* Primary CTA button */}
        {primaryAction?.onAction && (
          <Button
            size="sm"
            variant={hasRedAction ? 'destructive' : 'outline'}
            className="h-7 text-xs ml-3 flex-shrink-0"
            onClick={primaryAction.onAction}
          >
            {primaryAction.actionLabel || 'Fix now'}
          </Button>
        )}
      </div>

      {/* Expanded: connection cards + actions */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-3">
          {/* Connection grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
            {connections.map(conn => {
              const sync = syncMap.get(conn.key);
              const syncLastRun = sync?.lastRun
                ? formatDistanceToNow(sync.lastRun, { addSuffix: true })
                : conn.lastSync;

              return (
                <div
                  key={conn.key}
                  className={cn(
                    'rounded-lg border px-3 py-2 text-xs space-y-1 transition-colors',
                    conn.connected
                      ? 'border-emerald-200 dark:border-emerald-800/50 bg-emerald-50/50 dark:bg-emerald-950/20'
                      : 'border-border bg-muted/30'
                  )}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <span>{conn.icon}</span>
                      <span className="font-medium text-foreground">{conn.label}</span>
                    </div>
                    {conn.connected ? (
                      <CheckCircle2 className="h-3 w-3 text-emerald-500 shrink-0" />
                    ) : (
                      <span className="h-3 w-3 rounded-full bg-muted-foreground/20 shrink-0" />
                    )}
                  </div>
                  {conn.connected ? (
                    <div className="space-y-1">
                      {conn.detail && (
                        <p className="text-muted-foreground truncate text-[10px]">{conn.detail}</p>
                      )}
                      {syncLastRun && (
                        <p className="text-muted-foreground text-[10px]">Synced {syncLastRun}</p>
                      )}
                    </div>
                  ) : (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-5 px-0 text-[10px] text-primary"
                      onClick={(e) => {
                        e.stopPropagation();
                        onNavigateToSettings?.();
                      }}
                    >
                      <Link2 className="h-2.5 w-2.5 mr-0.5" />
                      Connect
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          {/* Refresh status button */}
          {onRefreshStatus && (
            <div className="flex items-center justify-end">
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5 text-muted-foreground" onClick={onRefreshStatus}>
                <RefreshCw className="h-3 w-3" />
                Refresh status
              </Button>
            </div>
          )}

          {/* Action items */}
          {actions.map(action => (
            <div
              key={action.id}
              className={cn(
                'flex items-center justify-between rounded-lg border px-3 py-2',
                action.severity === 'red' ? 'border-destructive/20 bg-destructive/5' :
                action.severity === 'amber' ? 'border-amber-500/20 bg-amber-500/5' :
                'border-primary/20 bg-primary/5'
              )}
            >
              <div className="flex items-center gap-2 text-sm">
                {action.severity === 'red' ? <AlertOctagon className="h-3.5 w-3.5 text-destructive" /> :
                 action.severity === 'amber' ? <Clock3 className="h-3.5 w-3.5 text-amber-600" /> :
                 <Sparkles className="h-3.5 w-3.5 text-primary" />}
                <span className="text-foreground">{action.label}</span>
              </div>
              {action.onAction && (
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={action.onAction}>
                  {action.actionLabel || 'Fix now'}
                </Button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
