import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { MARKETPLACE_LABELS } from '@/utils/settlement-engine';

interface Props {
  onNext: () => void;
}

interface MarketplaceSummary {
  marketplace_code: string;
  count: number;
  totalRevenue: number;
  hasMissing: boolean;
}

export default function SetupStepResults({ onNext }: Props) {
  const [loading, setLoading] = useState(true);
  const [summaries, setSummaries] = useState<MarketplaceSummary[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        // Try marketplace_validation first
        const { data: valRows } = await supabase
          .from('marketplace_validation')
          .select('marketplace_code, overall_status, settlement_net, settlement_uploaded');

        if (valRows && valRows.length > 0) {
          const grouped: Record<string, MarketplaceSummary> = {};
          for (const row of valRows) {
            const code = row.marketplace_code;
            if (!grouped[code]) {
              grouped[code] = { marketplace_code: code, count: 0, totalRevenue: 0, hasMissing: false };
            }
            if (row.settlement_uploaded) {
              grouped[code].count++;
              grouped[code].totalRevenue += Number(row.settlement_net) || 0;
            }
            if (row.overall_status === 'settlement_needed' || row.overall_status === 'missing' || row.overall_status === 'gap_detected') {
              grouped[code].hasMissing = true;
            }
          }
          setSummaries(Object.values(grouped));
        } else {
          // Fallback to settlements table
          const { data: settlements } = await supabase
            .from('settlements')
            .select('marketplace, bank_deposit');

          if (settlements && settlements.length > 0) {
            const grouped: Record<string, MarketplaceSummary> = {};
            for (const s of settlements) {
              const code = s.marketplace || 'unknown';
              if (!grouped[code]) {
                grouped[code] = { marketplace_code: code, count: 0, totalRevenue: 0, hasMissing: false };
              }
              grouped[code].count++;
              grouped[code].totalRevenue += Math.abs(Number(s.bank_deposit) || 0);
            }
            setSummaries(Object.values(grouped));
          }
        }
      } catch {
        // silently fail
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const getLabel = (code: string) =>
    (MARKETPLACE_LABELS as Record<string, string>)[code] || code.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  const formatCurrency = (n: number) =>
    new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 0 }).format(Math.abs(n));

  if (loading) {
    return (
      <div className="space-y-4 py-4">
        <Skeleton className="h-6 w-48 mx-auto" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-bold text-foreground">Here's what we found</h2>
        {summaries.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No data detected yet. You can upload settlements manually from the dashboard.
          </p>
        )}
      </div>

      {summaries.length > 0 && (
        <div className="space-y-2">
          {summaries.map((s) => (
            <Card key={s.marketplace_code} className={`border ${s.hasMissing && s.count === 0 ? 'border-amber-300 dark:border-amber-800' : 'border-border'}`}>
              <CardContent className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {s.count > 0 ? (
                    <CheckCircle2 className="h-5 w-5 text-emerald-500 flex-shrink-0" />
                  ) : s.hasMissing ? (
                    <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0" />
                  ) : (
                    <Clock className="h-5 w-5 text-muted-foreground flex-shrink-0" />
                  )}
                  <div>
                    <p className="font-medium text-foreground text-sm">{getLabel(s.marketplace_code)}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.count > 0
                        ? `${s.count} settlement${s.count > 1 ? 's' : ''}`
                        : 'Settlements missing'}
                      {s.totalRevenue > 0 && ` · ${formatCurrency(s.totalRevenue)} revenue detected`}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Button onClick={onNext} className="w-full">
        Continue
      </Button>
    </div>
  );
}
