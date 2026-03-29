import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { Store, Calendar, Receipt, Clock, TrendingUp } from 'lucide-react';

interface MarketplaceInfo {
  name: string;
  settlement_frequency: string;
  gst_model: string;
  payment_delay_days: number;
  currency: string;
}

interface FeeAverage {
  fee_type: string;
  avg_rate: number;
  sample_count: number;
}

interface MarketplaceInfoPanelProps {
  marketplaceCode: string;
}

const GST_LABELS: Record<string, string> = {
  seller: 'Seller responsible',
  marketplace: 'Marketplace collects',
  mixed: 'Mixed model',
};

const FEE_LABELS: Record<string, string> = {
  commission: 'Commission',
  referral: 'Referral',
  fba_fulfilment: 'FBA Fulfilment',
  storage: 'Storage',
  refund_rate: 'Refund Rate',
  shipping_fee: 'Shipping Fee',
  transaction_fee: 'Transaction Fee',
};

export default function MarketplaceInfoPanel({ marketplaceCode }: MarketplaceInfoPanelProps) {
  const [info, setInfo] = useState<MarketplaceInfo | null>(null);
  const [averages, setAverages] = useState<FeeAverage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        // Parallel fetch: marketplace profile + fee observations
        const [mpRes, obsRes] = await Promise.all([
          supabase
            .from('marketplaces')
            .select('name, settlement_frequency, gst_model, payment_delay_days, currency')
            .eq('marketplace_code', marketplaceCode)
            .eq('is_active', true)
            .maybeSingle(),
          supabase
            .from('marketplace_fee_observations')
            .select('fee_type, observed_rate')
            .eq('marketplace_code', marketplaceCode)
            .not('observed_rate', 'is', null),
        ]);

        if (mpRes.data) setInfo(mpRes.data);

        const obs = obsRes.data;
        if (obs && obs.length > 0) {
          const grouped: Record<string, number[]> = {};
          for (const o of obs) {
            if (o.observed_rate === null) continue;
            if (!grouped[o.fee_type]) grouped[o.fee_type] = [];
            grouped[o.fee_type].push(o.observed_rate as number);
          }
          const avgs = Object.entries(grouped).map(([fee_type, rates]) => ({
            fee_type,
            avg_rate: rates.reduce((s, r) => s + r, 0) / rates.length,
            sample_count: rates.length,
          }));
          setAverages(avgs);
        }
      } catch {
        // silent
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [marketplaceCode]);

  if (loading || !info) return null;

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Store className="h-4 w-4 text-primary" />
          {info.name}
          <Badge variant="outline" className="text-[10px] ml-auto">{info.currency}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs">
          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Calendar className="h-3 w-3" /> Settlement cycle
          </span>
          <span className="text-right capitalize">{info.settlement_frequency}</span>

          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Receipt className="h-3 w-3" /> GST
          </span>
          <span className="text-right">{GST_LABELS[info.gst_model] || info.gst_model}</span>

          <span className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="h-3 w-3" /> Payment delay
          </span>
          <span className="text-right">~{info.payment_delay_days} days</span>
        </div>

        {averages.length > 0 && (
          <div className="border-t border-border pt-2 mt-2 space-y-1">
            {averages.map((a) => (
              <div key={a.fee_type} className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 text-muted-foreground">
                  <TrendingUp className="h-3 w-3" />
                  {FEE_LABELS[a.fee_type] || a.fee_type}
                </span>
                <span>
                  {(a.avg_rate * 100).toFixed(1)}%
                  <span className="text-muted-foreground ml-1">({a.sample_count})</span>
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
