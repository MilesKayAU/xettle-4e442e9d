import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { X, ShoppingCart, Store, Upload, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

interface DetectedChannel {
  id: string;
  marketplace_code: string;
  marketplace_name: string;
  connection_status: string;
  settings: any;
}

interface ConnectChannelsPromptProps {
  onDismiss: () => void;
  onSwitchToUpload: () => void;
}

export default function ConnectChannelsPrompt({ onDismiss, onSwitchToUpload }: ConnectChannelsPromptProps) {
  const [channels, setChannels] = useState<DetectedChannel[]>([]);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const load = async () => {
      // Check if dismissed
      const { data: dismissSetting } = await supabase
        .from('app_settings')
        .select('value')
        .eq('key', 'channels_prompt_dismissed')
        .maybeSingle();

      if (dismissSetting?.value === 'true') {
        setDismissed(true);
        return;
      }

      // Load suggested + active channels that could benefit from API connection
      const { data } = await supabase
        .from('marketplace_connections')
        .select('*')
        .in('connection_status', ['suggested', 'active'])
        .order('created_at');

      if (data) setChannels(data as DetectedChannel[]);
    };
    load();
  }, []);

  const handleDismiss = async () => {
    setDismissed(true);
    onDismiss();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('app_settings').upsert(
        { user_id: user.id, key: 'channels_prompt_dismissed', value: 'true' },
        { onConflict: 'user_id,key' }
      );
    }
  };

  const handleConnectAmazon = async () => {
    setConnecting('amazon');
    try {
      const { data, error } = await supabase.functions.invoke('amazon-auth', {
        headers: { 'x-action': 'authorize' },
        body: {},
      });
      if (error || data?.error) throw new Error(data?.error || 'Failed');
      if (data?.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to start Amazon connection');
      setConnecting(null);
    }
  };

  const handleConnectShopify = async () => {
    setConnecting('shopify');
    try {
      const shopDomain = window.prompt('Enter your Shopify store domain (e.g. mystore.myshopify.com)');
      if (!shopDomain) {
        setConnecting(null);
        return;
      }
      const { data, error } = await supabase.functions.invoke('shopify-auth', {
        headers: { 'x-action': 'authorize' },
        body: { shopDomain },
      });
      if (error || data?.error) throw new Error(data?.error || 'Failed');
      if (data?.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to start Shopify connection');
      setConnecting(null);
    }
  };

  if (dismissed) return null;

  // Determine which channels were detected
  const hasAmazonDetected = channels.some(c => c.marketplace_code.startsWith('amazon'));
  const hasShopifyDetected = channels.some(c =>
    c.marketplace_code.startsWith('shopify') || c.marketplace_code === 'shopify_payments'
  );
  const hasOtherChannels = channels.some(c =>
    !c.marketplace_code.startsWith('amazon') &&
    !c.marketplace_code.startsWith('shopify')
  );

  // Don't show if no channels detected
  if (channels.length === 0) return null;

  // Build contextual message
  const detectedNames = channels
    .map(c => c.marketplace_name)
    .filter((v, i, a) => a.indexOf(v) === i)
    .slice(0, 3);

  return (
    <Card className="border-primary/20 bg-gradient-to-r from-primary/5 to-transparent shadow-sm">
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3 flex-1">
            <div className="flex-shrink-0 h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Sparkles className="h-5 w-5 text-primary" />
            </div>
            <div className="space-y-3 flex-1">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  We detected {detectedNames.join(' & ')} in your Xero account
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Connect your sales channels to automate settlement reconciliation.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                {hasAmazonDetected && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleConnectAmazon}
                    disabled={connecting === 'amazon'}
                    className="gap-2"
                  >
                    <ShoppingCart className="h-3.5 w-3.5" />
                    {connecting === 'amazon' ? 'Connecting…' : 'Connect Amazon'}
                  </Button>
                )}
                {hasShopifyDetected && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleConnectShopify}
                    disabled={connecting === 'shopify'}
                    className="gap-2"
                  >
                    <Store className="h-3.5 w-3.5" />
                    {connecting === 'shopify' ? 'Connecting…' : 'Connect Shopify'}
                  </Button>
                )}
                {hasOtherChannels && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={onSwitchToUpload}
                    className="gap-2 text-muted-foreground"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Upload CSV
                  </Button>
                )}
              </div>
            </div>
          </div>

          <button
            onClick={handleDismiss}
            className="text-muted-foreground hover:text-foreground transition-colors p-1"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </CardContent>
    </Card>
  );
}
