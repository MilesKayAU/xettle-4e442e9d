/**
 * ChannelManagement — Settings section for managing Shopify sub-channels.
 * Shows active tracked channels, ignored channels, and scan controls.
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Loader2, RefreshCw, CheckCircle, XCircle, Eye, EyeOff } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface SubChannel {
  id: string;
  source_name: string;
  marketplace_label: string;
  marketplace_code: string | null;
  settlement_type: string;
  ignored: boolean;
  order_count: number;
  total_revenue: number;
  created_at: string;
}

export default function ChannelManagement() {
  const [channels, setChannels] = useState<SubChannel[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [lastScanned, setLastScanned] = useState<string | null>(null);

  const loadChannels = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('shopify_sub_channels' as any)
        .select('*')
        .order('ignored', { ascending: true })
        .order('order_count', { ascending: false });

      if (error) throw error;
      setChannels((data || []) as unknown as SubChannel[]);

      // Get last scan time
      const { data: settings } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'last_channel_scan')
        .maybeSingle();
      if (settings?.value) setLastScanned(settings.value);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadChannels(); }, []);

  const handleScanNow = async () => {
    setScanning(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { data, error } = await supabase.functions.invoke('scan-shopify-channels', {
        body: { userId: user.id },
      });

      if (error) throw error;

      // Update last scan time
      await supabase.from('app_settings').upsert({
        user_id: user.id,
        key: 'last_channel_scan',
        value: new Date().toISOString(),
      } as any, { onConflict: 'user_id,key' } as any);

      setLastScanned(new Date().toISOString());

      if (data?.new_channels > 0) {
        toast.success(`Found ${data.new_channels} new channel${data.new_channels !== 1 ? 's' : ''}! Check the Dashboard for alerts.`);
      } else {
        toast.info(`Scanned ${data?.scanned_sources?.length || 0} source names — no new channels found.`);
      }

      await loadChannels();
    } catch (err: any) {
      toast.error(err.message || 'Failed to scan channels');
    } finally {
      setScanning(false);
    }
  };

  const handleToggleIgnore = async (channel: SubChannel) => {
    try {
      await supabase
        .from('shopify_sub_channels' as any)
        .update({ ignored: !channel.ignored } as any)
        .eq('id', channel.id);

      toast.success(channel.ignored
        ? `${channel.marketplace_label} re-enabled for tracking`
        : `${channel.marketplace_label} ignored`
      );
      await loadChannels();
    } catch {
      toast.error('Failed to update channel');
    }
  };

  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(amount);

  const activeChannels = channels.filter(c => !c.ignored);
  const ignoredChannels = channels.filter(c => c.ignored);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Sales Channels</CardTitle>
            <CardDescription>
              Detected sub-channels from your Shopify orders
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            {lastScanned && (
              <span className="text-xs text-muted-foreground">
                Last scan: {new Date(lastScanned).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
              </span>
            )}
            <Button size="sm" variant="outline" onClick={handleScanNow} disabled={scanning} className="gap-1.5">
              {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              {scanning ? 'Scanning...' : 'Scan now'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : channels.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">
            No sub-channels detected yet. Connect Shopify and sync orders to auto-detect sales channels.
          </p>
        ) : (
          <>
            {activeChannels.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-sm font-medium text-foreground">Active Channels</h4>
                {activeChannels.map(ch => (
                  <div key={ch.id} className="flex items-center justify-between rounded-lg border px-4 py-3">
                    <div className="flex items-center gap-3">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <div>
                        <p className="text-sm font-medium">{ch.marketplace_label}</p>
                        <p className="text-xs text-muted-foreground">
                          source: <code className="bg-muted px-1 rounded">{ch.source_name}</code>
                          {' · '}
                          {ch.order_count} orders · {formatCurrency(ch.total_revenue)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-[10px]">
                        {ch.settlement_type === 'separate_file' ? 'Separate file' : 'Shopify Payments'}
                      </Badge>
                      <Button size="sm" variant="ghost" onClick={() => handleToggleIgnore(ch)} className="gap-1 text-xs">
                        <EyeOff className="h-3.5 w-3.5" /> Ignore
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {ignoredChannels.length > 0 && (
              <>
                {activeChannels.length > 0 && <Separator />}
                <div className="space-y-2">
                  <h4 className="text-sm font-medium text-muted-foreground">Ignored Channels</h4>
                  {ignoredChannels.map(ch => (
                    <div key={ch.id} className="flex items-center justify-between rounded-lg border border-dashed px-4 py-3 opacity-60">
                      <div className="flex items-center gap-3">
                        <XCircle className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-sm font-medium">{ch.marketplace_label}</p>
                          <p className="text-xs text-muted-foreground">
                            source: <code className="bg-muted px-1 rounded">{ch.source_name}</code>
                          </p>
                        </div>
                      </div>
                      <Button size="sm" variant="outline" onClick={() => handleToggleIgnore(ch)} className="gap-1 text-xs">
                        <Eye className="h-3.5 w-3.5" /> Re-enable
                      </Button>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
