import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Upload, HelpCircle, ChevronDown, ChevronUp, Package, Zap, RefreshCw } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';

interface ChannelDetectedEmptyStateProps {
  marketplaceCode: string;
  marketplaceName: string;
  onUpload?: () => void;
  isApiConnected?: boolean;
  onSyncNow?: () => void;
}

interface SubChannelInfo {
  order_count: number;
  total_revenue: number;
  settlement_type: string;
  source_name: string;
}

export default function ChannelDetectedEmptyState({ marketplaceCode, marketplaceName, onUpload, isApiConnected, onSyncNow }: ChannelDetectedEmptyStateProps) {
  const [subChannel, setSubChannel] = useState<SubChannelInfo | null>(null);
  const [alertData, setAlertData] = useState<{ order_count: number; total_revenue: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;

        // Check if this marketplace was created via channel detection
        const { data: subChannels } = await supabase
          .from('shopify_sub_channels')
          .select('order_count, total_revenue, settlement_type, source_name')
          .eq('user_id', user.id)
          .eq('marketplace_code', marketplaceCode)
          .eq('settlement_type', 'separate_file')
          .limit(1);

        if (subChannels && subChannels.length > 0) {
          const sc = subChannels[0];
          setSubChannel({
            order_count: sc.order_count || 0,
            total_revenue: sc.total_revenue || 0,
            settlement_type: sc.settlement_type,
            source_name: sc.source_name,
          });

          // Also check channel_alerts for more recent data
          const { data: alerts } = await supabase
            .from('channel_alerts')
            .select('order_count, total_revenue')
            .eq('user_id', user.id)
            .eq('source_name', sc.source_name)
            .order('created_at', { ascending: false })
            .limit(1);

          if (alerts && alerts.length > 0) {
            setAlertData({
              order_count: alerts[0].order_count || sc.order_count || 0,
              total_revenue: alerts[0].total_revenue || sc.total_revenue || 0,
            });
          }
        }
      } catch (err) {
        console.error('[ChannelDetectedEmptyState] load error:', err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [marketplaceCode]);

  if (loading) return null;

  // If no sub-channel record found, fall back to generic empty state
  if (!subChannel) {
    return (
      <Card className="border-border">
        <CardContent className="py-8 text-center">
          <p className="text-sm text-muted-foreground">No settlements saved yet.</p>
          {onUpload && (
            <Button variant="link" size="sm" onClick={onUpload} className="mt-2 gap-1">
              <Upload className="h-3.5 w-3.5" /> Upload files via Smart Upload
            </Button>
          )}
        </CardContent>
      </Card>
    );
  }

  const orderCount = alertData?.order_count || subChannel.order_count;
  const totalRevenue = alertData?.total_revenue || subChannel.total_revenue;
  const formattedRevenue = new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(totalRevenue);

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="py-6 space-y-4">
        {/* Header */}
        <div className="flex items-start gap-3">
          <Package className="h-6 w-6 text-primary mt-0.5 shrink-0" />
          <div className="space-y-1.5">
            <h4 className="text-sm font-semibold text-foreground">
              📦 {marketplaceName} orders found in Shopify — settlements needed
            </h4>
            <p className="text-sm text-muted-foreground">
              We found <strong>{orderCount}</strong> {marketplaceName} order{orderCount !== 1 ? 's' : ''} totalling{' '}
              <strong>{formattedRevenue}</strong> flowing through Shopify.
              To complete your accounting you need to upload your {marketplaceName} settlement files.
            </p>
          </div>
        </div>

        {/* CTAs */}
        <div className="flex items-center gap-3 ml-9">
          {onUpload && (
            <Button size="sm" onClick={onUpload} className="gap-1.5">
              <Upload className="h-3.5 w-3.5" /> Upload {marketplaceName} settlements
            </Button>
          )}

          <Collapsible open={helpOpen} onOpenChange={setHelpOpen}>
            <CollapsibleTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <HelpCircle className="h-3.5 w-3.5" />
                How to find settlements
                {helpOpen ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 ml-0">
              <div className="rounded-md border border-border bg-background p-3 text-xs text-muted-foreground space-y-2">
                <p>
                  Log in to your <strong>{marketplaceName}</strong> seller portal and look for{' '}
                  <strong>Payments</strong>, <strong>Settlements</strong>, or <strong>Remittance reports</strong>.
                </p>
                <p>
                  Download the CSV or Excel file covering the period you want to reconcile, then upload it here.
                </p>
                <p className="text-[11px] italic">
                  Most marketplaces pay sellers via direct bank transfer with a separate settlement report.
                  The settlement file shows the breakdown of sales, fees, and the net amount deposited.
                </p>
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </CardContent>
    </Card>
  );
}
