/**
 * SystemStatusStrip — A single compact system health summary.
 * Green/Amber/Red severity with contextual "Fix now" CTA.
 */

import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { ChevronDown, ChevronUp, CheckCircle2, AlertTriangle, AlertOctagon, Settings, Sparkles, Clock3, X } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ConnectionStatus {
  label: string;
  connected: boolean;
  synced?: boolean;
  detail?: string;
  lastSync?: string;
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

  if (showAiMapper && onReviewMapping) {
    // If bank mapping is also missing, elevate to amber (mapping blocks payout verification)
    const mapperSeverity: 'amber' | 'info' = showBankMappingNudge ? 'amber' : 'info';
    actions.push({
      id: 'ai-mapper',
      severity: mapperSeverity,
      label: showBankMappingNudge
        ? 'Account mapping incomplete — blocking payout verification'
        : 'Xero accounts auto-mapped — review and confirm',
      actionLabel: showBankMappingNudge ? 'Fix mapping' : 'Review mapping',
      onAction: onReviewMapping,
    });
  }

  if (showBankMappingNudge && xeroConnected && onMapBankAccounts) {
    actions.push({
      id: 'bank-mapping',
      severity: 'amber',
      label: 'Map destination accounts for payout matching',
      actionLabel: 'Map accounts',
      onAction: onMapBankAccounts,
    });
  }

  const hasActions = actions.length > 0;
  const hasRedAction = actions.some(a => a.severity === 'red');
  const hasAmberAction = actions.some(a => a.severity === 'amber');

  // Determine severity-based headline
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
          {/* Compact last sync times */}
          <span className="text-[10px] text-muted-foreground ml-2 hidden sm:inline flex-shrink-0">
            {connections.filter(c => c.connected && c.lastSync).map(c => `${c.label} ${c.lastSync}`).join(' · ')}
          </span>
          {expanded ? <ChevronUp className="h-4 w-4 text-muted-foreground ml-1 flex-shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground ml-1 flex-shrink-0" />}
        </button>

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
          </div>

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
