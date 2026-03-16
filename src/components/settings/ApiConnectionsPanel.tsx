/**
 * ApiConnectionsPanel — Unified section grouping all API integrations
 * in the Settings tab. Wraps existing connection status components
 * under a clear heading with overview badges.
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Globe, CheckCircle2, XCircle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import XeroConnectionStatus from '@/components/admin/XeroConnectionStatus';
import ShopifyConnectionStatus from '@/components/admin/ShopifyConnectionStatus';
import EbayConnectionStatus from '@/components/admin/EbayConnectionStatus';
import AmazonConnectionPanel from '@/components/admin/accounting/AmazonConnectionPanel';
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
}

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
  });

  useEffect(() => {
    checkConnections();
  }, []);

  async function checkConnections() {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [xeroRes, amazonRes, shopifyRes, ebayRes] = await Promise.all([
        supabase.from('app_settings').select('value').eq('user_id', user.id).eq('key', 'xero_tenant_id').maybeSingle(),
        supabase.from('amazon_tokens').select('id').eq('user_id', user.id).limit(1),
        supabase.from('shopify_tokens').select('id').eq('user_id', user.id).limit(1),
        supabase.from('ebay_tokens').select('id').eq('user_id', user.id).limit(1),
      ]);

      setSummary({
        xero: !!(xeroRes.data?.value),
        amazon: !!(amazonRes.data && amazonRes.data.length > 0),
        shopify: !!(shopifyRes.data && shopifyRes.data.length > 0),
        ebay: !!(ebayRes.data && ebayRes.data.length > 0),
      });
    } catch {
      // silent
    }
  }

  const connectedCount = Object.values(summary).filter(Boolean).length;
  const totalCount = Object.keys(summary).length;

  return (
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

        {/* Shopify Channel Management */}
        <ChannelManagement />
      </CardContent>
    </Card>
  );
}
