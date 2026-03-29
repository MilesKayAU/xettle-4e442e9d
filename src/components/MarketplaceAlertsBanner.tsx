import { useEffect, useState } from 'react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { AlertTriangle, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

interface FeeAlert {
  id: string;
  fee_type: string;
  expected_rate: number;
  observed_rate: number;
  deviation_pct: number;
  settlement_id: string;
  marketplace_code: string;
}

const FEE_LABELS: Record<string, string> = {
  commission: 'commission',
  referral: 'referral fee',
  fba_fulfilment: 'FBA fulfilment fee',
  storage: 'storage fee',
  refund_rate: 'refund rate',
  shipping_fee: 'shipping fee',
  transaction_fee: 'transaction fee',
};

interface MarketplaceAlertsBannerProps {
  marketplaceCode: string;
}

export default function MarketplaceAlertsBanner({ marketplaceCode }: MarketplaceAlertsBannerProps) {
  const [alerts, setAlerts] = useState<FeeAlert[]>([]);

  useEffect(() => {
    let isMounted = true;
    const load = async () => {
      try {
        const { data, error } = await supabase
          .from('marketplace_fee_alerts')
          .select('id, fee_type, expected_rate, observed_rate, deviation_pct, settlement_id, marketplace_code')
          .eq('marketplace_code', marketplaceCode)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(5);
        if (error) {
          console.warn('[MarketplaceAlertsBanner] fetch failed:', error.message);
          return;
        }
        if (isMounted && data) setAlerts(data as FeeAlert[]);
      } catch (err) {
        console.warn('[MarketplaceAlertsBanner] unexpected error:', err);
      }
    };
    load();
    return () => { isMounted = false; };
  }, [marketplaceCode]);

  const dismiss = async (id: string) => {
    await supabase
      .from('marketplace_fee_alerts')
      .update({ status: 'dismissed' })
      .eq('id', id);
    setAlerts(prev => prev.filter(a => a.id !== id));
  };

  if (alerts.length === 0) return null;

  return (
    <div className="space-y-2">
      {alerts.map((alert) => (
        <Alert key={alert.id} variant="destructive" className="border-destructive/30 bg-destructive/5">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription className="flex items-center justify-between gap-2">
            <span className="text-sm">
              Your {FEE_LABELS[alert.fee_type] || alert.fee_type} is{' '}
              <strong>{(alert.deviation_pct * 100).toFixed(0)}%</strong>{' '}
              {alert.observed_rate > alert.expected_rate ? 'above' : 'below'} your average
              ({(alert.observed_rate * 100).toFixed(1)}% vs {(alert.expected_rate * 100).toFixed(1)}%)
              — Settlement {alert.settlement_id}
            </span>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => dismiss(alert.id)}>
              <X className="h-3 w-3" />
            </Button>
          </AlertDescription>
        </Alert>
      ))}
    </div>
  );
}
