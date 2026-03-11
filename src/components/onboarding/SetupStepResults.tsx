import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { CheckCircle2, AlertTriangle, Clock, PartyPopper, Send, Upload, ArrowRight, Loader2 } from 'lucide-react';
import { MARKETPLACE_LABELS } from '@/utils/settlement-engine';

interface Props {
  onNext: () => void;
  hasXero?: boolean;
  hasAmazon?: boolean;
  hasShopify?: boolean;
}

interface MarketplaceSummary {
  marketplace_code: string;
  count: number;
  totalRevenue: number;
  hasMissing: boolean;
  externalCount: number;
}

export default function SetupStepResults({ onNext, hasXero, hasAmazon, hasShopify }: Props) {
  const [loading, setLoading] = useState(true);
  const [summaries, setSummaries] = useState<MarketplaceSummary[]>([]);
  const [readyToPush, setReadyToPush] = useState(0);

  useEffect(() => {
    const load = async () => {
      try {
        const { data: valRows } = await supabase
          .from('marketplace_validation')
          .select('marketplace_code, overall_status, settlement_net, settlement_uploaded');

        if (valRows && valRows.length > 0) {
          const grouped: Record<string, MarketplaceSummary> = {};
          let pushReady = 0;
          for (const row of valRows) {
            const code = row.marketplace_code;
            if (!grouped[code]) {
              grouped[code] = { marketplace_code: code, count: 0, totalRevenue: 0, hasMissing: false, externalCount: 0 };
            }
            if (row.settlement_uploaded) {
              grouped[code].count++;
              grouped[code].totalRevenue += Number(row.settlement_net) || 0;
            }
            if (row.overall_status === 'ready_to_push') pushReady++;
            if (row.overall_status === 'already_recorded') grouped[code].externalCount++;
            if (row.overall_status === 'settlement_needed' || row.overall_status === 'missing' || row.overall_status === 'gap_detected') {
              grouped[code].hasMissing = true;
            }
          }
          setSummaries(Object.values(grouped));
          setReadyToPush(pushReady);
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
                grouped[code] = { marketplace_code: code, count: 0, totalRevenue: 0, hasMissing: false, externalCount: 0 };
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

  const totalSettlements = summaries.reduce((sum, s) => sum + s.count, 0);
  const totalExternal = summaries.reduce((sum, s) => sum + s.externalCount, 0);
  const anyGaps = summaries.some(s => s.hasMissing);
  const isEmpty = summaries.length === 0;

  // Build adaptive message based on connection path
  const getAdaptiveMessage = () => {
    const hasAny = hasXero || hasAmazon || hasShopify;
    if (!hasAny) {
      return "Upload settlement CSVs from your dashboard — you can connect APIs anytime from Settings.";
    }
    if (hasXero && hasAmazon && hasShopify) {
      return "You're fully connected! Settlements will flow in automatically and sync to Xero.";
    }
    if (hasXero && hasAmazon) {
      return "Amazon settlements will sync automatically. We're scanning Xero for existing records.";
    }
    if (hasXero && hasShopify) {
      return "Shopify payouts will sync automatically. We're scanning Xero for sub-channels.";
    }
    if (hasXero) {
      return "Xettle is scanning your Xero for existing marketplace records. Upload a settlement file to get started.";
    }
    if (hasAmazon) {
      return "Amazon settlements will sync automatically. Connect Xero anytime to push journals.";
    }
    if (hasShopify) {
      return "Shopify payouts will sync automatically. Connect Xero anytime to push journals.";
    }
    return "You're all set up!";
  };

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
        {isEmpty ? (
          <>
            <h2 className="text-xl font-bold text-foreground">You're all set up!</h2>
            <p className="text-sm text-muted-foreground">
              {getAdaptiveMessage()}
            </p>
            {(hasXero || hasAmazon || hasShopify) && (
              <div className="flex items-center justify-center gap-2 mt-2 text-xs text-primary">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>Background sync in progress — data will appear shortly</span>
              </div>
            )}
          </>
        ) : (
          <>
            <PartyPopper className="h-8 w-8 text-emerald-500 mx-auto" />
            <h2 className="text-xl font-bold text-foreground">Here's what we found</h2>
            <p className="text-sm text-muted-foreground">{getAdaptiveMessage()}</p>
          </>
        )}
      </div>

      {/* Summary stats */}
      {!isEmpty && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <Card className="border-border">
            <CardContent className="p-3">
              <p className="text-2xl font-bold text-foreground">{totalSettlements}</p>
              <p className="text-[10px] text-muted-foreground">Settlements ready</p>
            </CardContent>
          </Card>
          {totalExternal > 0 && (
            <Card className="border-border">
              <CardContent className="p-3">
                <p className="text-2xl font-bold text-foreground">{totalExternal}</p>
                <p className="text-[10px] text-muted-foreground">Already in Xero</p>
              </CardContent>
            </Card>
          )}
          {anyGaps && (
            <Card className="border-amber-200 dark:border-amber-800">
              <CardContent className="p-3">
                <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                  {summaries.filter(s => s.hasMissing).length}
                </p>
                <p className="text-[10px] text-muted-foreground">Gaps detected</p>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* Per-marketplace breakdown */}
      {summaries.length > 0 && (
        <div className="space-y-2">
          {summaries.map((s) => (
            <Card key={s.marketplace_code} className={`border ${s.hasMissing && s.count === 0 ? 'border-amber-300 dark:border-amber-800' : 'border-border'}`}>
              <CardContent className="p-3 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {s.count > 0 ? (
                    <CheckCircle2 className="h-4 w-4 text-emerald-500 flex-shrink-0" />
                  ) : s.hasMissing ? (
                    <AlertTriangle className="h-4 w-4 text-amber-500 flex-shrink-0" />
                  ) : (
                    <Clock className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  )}
                  <div>
                    <p className="font-medium text-foreground text-sm">{getLabel(s.marketplace_code)}</p>
                    <p className="text-xs text-muted-foreground">
                      {s.count > 0
                        ? `${s.count} settlement${s.count > 1 ? 's' : ''}`
                        : 'Settlements missing'}
                      {s.totalRevenue > 0 && ` · ${formatCurrency(s.totalRevenue)}`}
                      {s.externalCount > 0 && ` · ${s.externalCount} already in Xero`}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Suggested action */}
      {hasXero && readyToPush > 0 && (
        <Card className="border-primary/30 bg-primary/5 cursor-pointer hover:border-primary/50 transition-colors" onClick={onNext}>
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-primary/10 flex items-center justify-center">
                <Send className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="font-medium text-foreground text-sm">Push {readyToPush} settlement{readyToPush > 1 ? 's' : ''} to Xero</p>
                <p className="text-xs text-muted-foreground">Your recommended first action</p>
              </div>
            </div>
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          </CardContent>
        </Card>
      )}

      <Button onClick={onNext} className="w-full">
        Go to Dashboard
      </Button>
    </div>
  );
}
