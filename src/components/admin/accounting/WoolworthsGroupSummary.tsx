/**
 * WoolworthsGroupSummary — Shows a grouped summary after Woolworths/MarketPlus files
 * are processed (via zip or combined CSV+PDF uploads).
 * 
 * Groups settlements by marketplace (BigW, Everyday Market, MyDeal) and shows
 * status, amounts, and a combined total matching the Woolworths bank payment.
 */

import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { CheckCircle2, AlertTriangle, XCircle, ArrowRight, Package } from 'lucide-react';

interface WoolworthsSettlementGroup {
  marketplaceCode: string;
  displayName: string;
  bankDeposit: number;
  status: 'saved' | 'error' | 'gap';
  hasPdf: boolean;
  settlementId: string;
  statusLabel: string;
}

interface WoolworthsGroupSummaryProps {
  groups: WoolworthsSettlementGroup[];
  onPushAll?: () => void;
  onViewSettlements?: () => void;
}

function formatAUD(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(amount).toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

const STATUS_CONFIG = {
  saved: { icon: CheckCircle2, label: 'Ready to push', className: 'text-emerald-600 dark:text-emerald-400' },
  gap: { icon: AlertTriangle, label: 'Gap detected', className: 'text-amber-600 dark:text-amber-400' },
  error: { icon: XCircle, label: 'Error', className: 'text-destructive' },
};

export default function WoolworthsGroupSummary({ groups, onPushAll, onViewSettlements }: WoolworthsGroupSummaryProps) {
  if (groups.length === 0) return null;

  const total = groups.reduce((sum, g) => sum + g.bankDeposit, 0);
  const readyCount = groups.filter(g => g.status === 'saved').length;
  const allReady = readyCount === groups.length;

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="py-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Package className="h-5 w-5 text-primary" />
            <div>
              <p className="text-sm font-semibold text-foreground">Woolworths Group Payment</p>
              <p className="text-xs text-muted-foreground">{groups.length} marketplace{groups.length !== 1 ? 's' : ''} detected</p>
            </div>
          </div>
          <span className="text-lg font-bold text-foreground tabular-nums">{formatAUD(total)}</span>
        </div>

        <div className="space-y-2">
          {groups.map(g => {
            const config = STATUS_CONFIG[g.status];
            const Icon = config.icon;
            return (
              <div key={g.marketplaceCode} className="flex items-center justify-between py-2 px-3 rounded-lg bg-background/60 border border-border/50">
                <div className="flex items-center gap-3">
                  <Icon className={`h-4 w-4 ${config.className}`} />
                  <div>
                    <span className="text-sm font-medium text-foreground">{g.displayName}</span>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-xs text-muted-foreground">
                        {g.hasPdf ? 'CSV + PDF' : 'CSV only'}
                      </span>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {g.statusLabel}
                      </Badge>
                    </div>
                  </div>
                </div>
                <span className="text-sm font-semibold text-foreground tabular-nums">{formatAUD(g.bankDeposit)}</span>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between pt-2 border-t border-border/50">
          <span className="text-xs text-muted-foreground">
            {allReady
              ? `All ${groups.length} ready to push`
              : `${readyCount} of ${groups.length} ready`}
          </span>
          <div className="flex items-center gap-2">
            {onViewSettlements && (
              <Button variant="outline" size="sm" onClick={onViewSettlements}>
                View Details
              </Button>
            )}
            {onPushAll && readyCount > 0 && (
              <Button size="sm" className="gap-1.5" onClick={onPushAll}>
                Push {readyCount === groups.length ? 'all' : readyCount} to Xero
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export type { WoolworthsSettlementGroup };
