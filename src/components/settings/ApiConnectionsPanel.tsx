/**
 * ApiConnectionsPanel — Unified section grouping all API integrations
 * in the Settings tab. Wraps existing connection status components
 * under a clear heading with overview badges.
 * 
 * Includes Marketplace Data Sources preference (source priority guard)
 * and per-API daily auto-sync toggles.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Globe, CheckCircle2, XCircle, Info, FileText, ShoppingBag, RefreshCw, Clock } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';
import { setSourcePreference } from '@/actions/settlements';
import { toast } from 'sonner';
import XeroConnectionStatus from '@/components/admin/XeroConnectionStatus';
import ShopifyConnectionStatus from '@/components/admin/ShopifyConnectionStatus';
import EbayConnectionStatus from '@/components/admin/EbayConnectionStatus';
import AmazonConnectionPanel from '@/components/admin/accounting/AmazonConnectionPanel';
import MiraklConnectionPanel from '@/components/admin/accounting/MiraklConnectionPanel';
import ChannelManagement from '@/components/shopify/ChannelManagement';

interface ApiConnectionsPanelProps {
  isPaid?: boolean;
  gstRate?: number;
  syncCutoffDate?: string;
  onSettlementsAutoFetched?: () => void;
  onRequestSettings?: () => void;
  onFetchStateChange?: (fetching: boolean, status: string | null) => void;
}

interface ConnectionSummary {
  xero: boolean;
  amazon: boolean;
  shopify: boolean;
  ebay: boolean;
  mirakl: boolean;
}

interface SubChannelPref {
  code: string;
  name: string;
  preference: 'csv' | 'api';
  apiAvailable: boolean;
}

/** Rails that support daily auto-sync */
const SYNC_RAILS = [
  { key: 'amazon', label: 'Amazon', settingsKey: 'auto_sync_enabled:amazon' },
  { key: 'shopify', label: 'Shopify', settingsKey: 'auto_sync_enabled:shopify' },
  { key: 'ebay', label: 'eBay', settingsKey: 'auto_sync_enabled:ebay' },
  { key: 'mirakl', label: 'Mirakl (Bunnings etc.)', settingsKey: 'auto_sync_enabled:mirakl' },
  { key: 'xero', label: 'Xero', settingsKey: 'auto_sync_enabled:xero' },
] as const;

export default function ApiConnectionsPanel({
  isPaid = false,
  gstRate = 10,
  syncCutoffDate,
  onSettlementsAutoFetched,
  onRequestSettings,
  onFetchStateChange,
}: ApiConnectionsPanelProps) {
  const [summary, setSummary] = useState<ConnectionSummary>({
    xero: false,
    amazon: false,
    shopify: false,
    ebay: false,
    mirakl: false,
  });
  const [subChannels, setSubChannels] = useState<SubChannelPref[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [autoSyncFlags, setAutoSyncFlags] = useState<Record<string, boolean>>({});
  const [lastSyncRun, setLastSyncRun] = useState<Date | null>(null);
  const [syncFrequencyHours, setSyncFrequencyHours] = useState<number | null>(null);

  useEffect(() => {
    checkConnections();
  }, []);

  async function checkConnections() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      setUserId(user.id);

      const [xeroRes, amazonRes, shopifyRes, ebayRes, miraklRes] = await Promise.all([
        supabase.from('app_settings').select('value').eq('user_id', user.id).eq('key', 'xero_tenant_id').maybeSingle(),
        supabase.from('amazon_tokens').select('id').eq('user_id', user.id).limit(1),
        supabase.from('shopify_tokens').select('id').eq('user_id', user.id).limit(1),
        supabase.from('ebay_tokens').select('id').eq('user_id', user.id).limit(1),
        supabase.from('mirakl_tokens').select('id').eq('user_id', user.id).limit(1),
      ]);

      setSummary({
        xero: !!(xeroRes.data?.value),
        amazon: !!(amazonRes.data && amazonRes.data.length > 0),
        shopify: !!(shopifyRes.data && shopifyRes.data.length > 0),
        ebay: !!(ebayRes.data && ebayRes.data.length > 0),
        mirakl: !!(miraklRes.data && miraklRes.data.length > 0),
      });

      // Load auto-sync flags
      const syncKeys = SYNC_RAILS.map(r => r.settingsKey);
      const { data: syncSettings } = await supabase
        .from('app_settings')
        .select('key, value')
        .eq('user_id', user.id)
        .in('key', syncKeys);

      const flags: Record<string, boolean> = {};
      for (const r of SYNC_RAILS) {
        const setting = syncSettings?.find(s => s.key === r.settingsKey);
        // Default: true if no setting exists (opt-out model)
        flags[r.key] = setting ? setting.value === 'true' : true;
      }
      setAutoSyncFlags(flags);

      // Load sync schedule info
      const { data: syncRuns } = await supabase
        .from('sync_history')
        .select('created_at')
        .eq('event_type', 'scheduled_sync')
        .order('created_at', { ascending: false })
        .limit(3);

      if (syncRuns && syncRuns.length > 0) {
        setLastSyncRun(new Date(syncRuns[0].created_at));
        if (syncRuns.length >= 2) {
          const diff = new Date(syncRuns[0].created_at).getTime() - new Date(syncRuns[1].created_at).getTime();
          const hours = Math.round(diff / (1000 * 60 * 60));
          if (hours > 0) setSyncFrequencyHours(hours);
        }
      }

      // Load sub-channels for source preference
      const { data: channels } = await supabase
        .from('shopify_sub_channels')
        .select('source_name, marketplace_label, marketplace_code')
        .eq('user_id', user.id)
        .eq('ignored', false);

      if (channels && channels.length > 0) {
        const codes = channels.map(c => c.marketplace_code || c.source_name).filter(Boolean);
        const prefKeys = codes.map(c => `source_preference:${c}`);
        const apiEnabledKeys = codes.map(c => `api_enabled:${c}`);
        const allKeys = [...prefKeys, ...apiEnabledKeys];
        const { data: prefs } = await supabase
          .from('app_settings')
          .select('key, value')
          .eq('user_id', user.id)
          .in('key', allKeys);

        const prefMap = new Map((prefs || []).map(p => [p.key, p.value]));

        setSubChannels(channels.map(c => {
          const code = c.marketplace_code || c.source_name;
          const pref = prefMap.get(`source_preference:${code}`);
          const apiEnabled = prefMap.get(`api_enabled:${code}`) === 'true';
          return {
            code,
            name: c.marketplace_label,
            preference: pref === 'api' ? 'api' : 'csv',
            apiAvailable: apiEnabled,
          };
        }));
      }
    } catch {
      // silent
    }
  }

  const handlePreferenceChange = useCallback(async (code: string, useApi: boolean) => {
    if (!userId) return;
    const pref = useApi ? 'api' : 'csv';
    setSubChannels(prev => prev.map(c => c.code === code ? { ...c, preference: pref } : c));
    const result = await setSourcePreference(userId, code, pref);
    if (!result.success) {
      toast.error('Failed to save preference');
      setSubChannels(prev => prev.map(c => c.code === code ? { ...c, preference: useApi ? 'csv' : 'api' } : c));
    } else {
      toast.success(`${code} source set to ${pref === 'csv' ? 'CSV uploads' : 'Shopify Orders API'}`);
    }
  }, [userId]);

  const handleAutoSyncToggle = useCallback(async (railKey: string, enabled: boolean) => {
    if (!userId) return;
    const settingsKey = SYNC_RAILS.find(r => r.key === railKey)?.settingsKey;
    if (!settingsKey) return;

    setAutoSyncFlags(prev => ({ ...prev, [railKey]: enabled }));

    const { error } = await supabase.from('app_settings').upsert(
      { user_id: userId, key: settingsKey, value: String(enabled) },
      { onConflict: 'user_id,key' }
    );

    if (error) {
      setAutoSyncFlags(prev => ({ ...prev, [railKey]: !enabled }));
      toast.error('Failed to save sync preference');
    } else {
      toast.success(`${SYNC_RAILS.find(r => r.key === railKey)?.label} daily sync ${enabled ? 'enabled' : 'disabled'}`);
    }
  }, [userId]);

  const connectedCount = Object.values(summary).filter(Boolean).length;
  const totalCount = Object.keys(summary).length;

  // Only show auto-sync toggles for connected APIs
  const connectedSyncRails = SYNC_RAILS.filter(r => summary[r.key as keyof ConnectionSummary]);

  return (
    <div className="space-y-4">
      <Card className="border-border">
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base flex items-center gap-2">
                <Globe className="h-4 w-4 text-primary" />
                API Connections
              </CardTitle>
              <CardDescription className="text-xs mt-1">
                Connect your marketplaces and accounting software. Manage credentials, sync status, and connection details.
              </CardDescription>
            </div>
            <div className="flex items-center gap-1.5">
              <Badge
                variant={connectedCount === totalCount ? 'default' : connectedCount > 0 ? 'secondary' : 'outline'}
                className="text-[10px]"
              >
                {connectedCount}/{totalCount} connected
              </Badge>
            </div>
          </div>

          {/* Quick status strip */}
          <div className="flex flex-wrap gap-2 mt-3">
            {([
              { key: 'xero', label: 'Xero' },
              { key: 'amazon', label: 'Amazon' },
              { key: 'shopify', label: 'Shopify' },
              { key: 'ebay', label: 'eBay' },
              { key: 'mirakl', label: 'Bunnings' },
            ] as const).map(({ key, label }) => (
              <div key={key} className="flex items-center gap-1 text-xs">
                {summary[key] ? (
                  <CheckCircle2 className="h-3 w-3 text-emerald-500" />
                ) : (
                  <XCircle className="h-3 w-3 text-muted-foreground/50" />
                )}
                <span className={summary[key] ? 'text-foreground' : 'text-muted-foreground'}>{label}</span>
              </div>
            ))}
          </div>
        </CardHeader>

        <CardContent className="space-y-4 pt-0">
          {/* Xero */}
          <XeroConnectionStatus />

          {/* Amazon */}
          <AmazonConnectionPanel
            isPaid={isPaid}
            gstRate={gstRate}
            syncCutoffDate={syncCutoffDate}
            onSettlementsAutoFetched={onSettlementsAutoFetched ? async () => { onSettlementsAutoFetched(); checkConnections(); } : undefined}
            onRequestSettings={onRequestSettings}
            onFetchStateChange={onFetchStateChange}
          />

          {/* Shopify */}
          <ShopifyConnectionStatus />

          {/* eBay */}
          <EbayConnectionStatus />

          {/* Bunnings Marketplace */}
          <MiraklConnectionPanel />

          {/* Shopify Channel Management */}
          <ChannelManagement />
        </CardContent>
      </Card>

      {/* Daily Auto-Sync — per-API toggles */}
      {connectedSyncRails.length > 0 && (
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-primary" />
              Daily Auto-Sync
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              Control which connected APIs automatically fetch new settlements every day at 2:00 AM AEST. 
              Disable to use manual sync or CSV uploads only.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="space-y-3">
              {connectedSyncRails.map(rail => (
                <div key={rail.key} className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{rail.label}</span>
                    {autoSyncFlags[rail.key] ? (
                      <Badge variant="default" className="text-[9px] bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
                        Auto
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] text-muted-foreground">
                        Manual only
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`sync-${rail.key}`} className="text-xs text-muted-foreground">
                      Daily sync
                    </Label>
                    <Switch
                      id={`sync-${rail.key}`}
                      checked={autoSyncFlags[rail.key] ?? true}
                      onCheckedChange={(checked) => handleAutoSyncToggle(rail.key, checked)}
                    />
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-start gap-2 mt-4 p-3 rounded-lg bg-muted/50 border border-border">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                When enabled, Xettle will automatically fetch the latest settlements from each API during the nightly sync run. 
                You can always trigger a manual sync from the dashboard regardless of this setting.
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Marketplace Data Sources — source priority preferences */}
      {subChannels.length > 0 && (
        <Card className="border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <ShoppingBag className="h-4 w-4 text-primary" />
              Marketplace Data Sources
            </CardTitle>
            <CardDescription className="text-xs mt-1">
              Choose whether each marketplace uses CSV uploads or the Shopify Orders API for settlement data.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="flex items-start gap-2 mb-4 p-3 rounded-lg bg-muted/50 border border-border">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <p className="text-xs text-muted-foreground">
                <strong>CSV uploads (recommended)</strong> contain full fee breakdowns (commission, shipping charges, adjustments) from the marketplace portal.
                The <strong>Shopify Orders API</strong> provides order totals but does not include marketplace-specific fees.
                When a CSV is uploaded, any Shopify-derived record for the same period is automatically suppressed.
              </p>
            </div>
            <div className="space-y-3">
              {subChannels.map(ch => (
                <div key={ch.code} className="flex items-center justify-between py-2 border-b border-border last:border-b-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">{ch.name}</span>
                    <Badge variant="outline" className="text-[9px]">
                      <FileText className="h-2.5 w-2.5 mr-0.5" /> CSV
                    </Badge>
                  </div>
                  {ch.apiAvailable ? (
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`pref-${ch.code}`} className="text-xs text-muted-foreground">
                        Use API
                      </Label>
                      <Switch
                        id={`pref-${ch.code}`}
                        checked={ch.preference === 'api'}
                        onCheckedChange={(checked) => handlePreferenceChange(ch.code, checked)}
                      />
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
