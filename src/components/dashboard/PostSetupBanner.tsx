import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, CheckCircle2, Upload, X } from 'lucide-react';

interface Props {
  onSwitchToUpload: () => void;
  hasXero: boolean;
  hasAmazon: boolean;
  hasShopify: boolean;
}

export default function PostSetupBanner({ onSwitchToUpload, hasXero, hasAmazon, hasShopify }: Props) {
  const [visible, setVisible] = useState(false);
  const [marketplacesFound, setMarketplacesFound] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const check = async () => {
      try {
        // Check if wizard was completed recently (within 5 minutes)
        const { data: setting } = await supabase
          .from('app_settings')
          .select('value, updated_at')
          .eq('key', 'onboarding_wizard_complete')
          .maybeSingle();

        if (!setting || setting.value !== 'true') return;

        const completedAt = new Date(setting.updated_at || setting.value);
        const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);

        // Also show if no marketplace_validation data yet (fresh account)
        const { count } = await supabase
          .from('marketplace_validation')
          .select('id', { count: 'exact', head: true });

        if (completedAt > fiveMinAgo || (count !== null && count === 0)) {
          setVisible(true);
        }

        // Check for auto-detected marketplaces
        const { data: connections } = await supabase
          .from('marketplace_connections')
          .select('id')
          .eq('connection_type', 'auto_detected');
        
        if (connections) {
          setMarketplacesFound(connections.length);
        }
      } catch {}
    };
    check();
  }, []);

  if (!visible || dismissed) return null;

  const hasAnyConnection = hasXero || hasAmazon || hasShopify;

  return (
    <Card className="border-primary/20 bg-primary/5 relative">
      <button
        onClick={() => setDismissed(true)}
        className="absolute top-3 right-3 text-muted-foreground hover:text-foreground"
      >
        <X className="h-4 w-4" />
      </button>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start gap-3">
          {hasAnyConnection ? (
            <Loader2 className="h-5 w-5 text-primary animate-spin flex-shrink-0 mt-0.5" />
          ) : (
            <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0 mt-0.5" />
          )}
          <div className="space-y-1">
            {hasXero && (
              <p className="text-sm font-medium text-foreground">
                Xettle is scanning your Xero history for existing marketplace invoices
              </p>
            )}
            {hasAmazon && (
              <p className="text-sm text-muted-foreground">
                Amazon settlements are being fetched — they'll appear in your Settlements tab shortly.
              </p>
            )}
            {hasShopify && (
              <p className="text-sm text-muted-foreground">
                Shopify payouts are syncing — sub-channels will be detected automatically.
              </p>
            )}
            {!hasAnyConnection && (
              <p className="text-sm font-medium text-foreground">
                Setup complete! Upload your first settlement file to get started.
              </p>
            )}
            {marketplacesFound > 0 && (
              <p className="text-sm text-emerald-600 dark:text-emerald-400 font-medium">
                ✨ We found {marketplacesFound} marketplace{marketplacesFound > 1 ? 's' : ''} in your history
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              {hasAnyConnection
                ? "This runs in the background — we'll surface what we find on your dashboard."
                : "You can connect Xero, Amazon, or Shopify anytime from Settings."}
            </p>
          </div>
        </div>
        {!hasAnyConnection && (
          <Button size="sm" onClick={onSwitchToUpload} className="ml-8">
            <Upload className="h-4 w-4 mr-1" />
            Upload First File
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
