/**
 * RecentSettlements — Dashboard home widget showing real settlement/payout records.
 * 
 * Only shows actual settlement-level data (bank deposits, payouts), NOT order aggregates.
 * Order-based auto-generated records (source='api_sync') are excluded because they represent
 * Shopify order groupings, not real payouts. Real payouts come from:
 *   - Shopify Payments Payouts API (source='api_payout' or marketplace='shopify_payments')
 *   - Amazon settlement CSV uploads (source='manual')
 *   - Kogan/Bunnings/etc. settlement file uploads (source='manual')
 */

import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, ArrowRight, CheckCircle2, Clock, Send, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';

interface SettlementRow {
  id: string;
  settlement_id: string;
  marketplace: string;
  period_start: string;
  period_end: string;
  bank_deposit: number;
  status: string;
  xero_status: string | null;
  source: string;
  created_at: string;
}

const MARKETPLACE_DISPLAY: Record<string, string> = {
  amazon_au: 'Amazon AU',
  shopify_payments: 'Shopify Payments',
  kogan: 'Kogan',
  mydeal: 'MyDeal',
  bunnings: 'Bunnings',
  catch: 'Catch',
  ebay: 'eBay',
  iconic: 'THE ICONIC',
  bigw: 'Big W',
  everyday_market: 'Everyday Market',
  tradesquare: 'TradeSquare',
  tiktok: 'TikTok Shop',
};

function getMarketplaceLabel(code: string | null): string {
  if (!code) return 'Unknown';
  if (MARKETPLACE_DISPLAY[code]) return MARKETPLACE_DISPLAY[code];
  return code.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function formatAUD(amount: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    minimumFractionDigits: 2,
  }).format(amount);
}

function formatDateRange(start: string, end: string): string {
  const s = new Date(start + 'T00:00:00');
  const e = new Date(end + 'T00:00:00');
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const startStr = s.toLocaleDateString('en-AU', opts);
  const endStr = e.toLocaleDateString('en-AU', { ...opts, year: 'numeric' });
  return `${startStr} – ${endStr}`;
}

function StatusBadge({ status, xeroStatus }: { status: string; xeroStatus: string | null }) {
  if (xeroStatus === 'posted' || xeroStatus === 'AUTHORISED') {
    return (
      <Badge variant="outline" className="text-emerald-700 bg-emerald-100 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-900/30 dark:border-emerald-800 text-xs">
        <CheckCircle2 className="h-3 w-3 mr-1" />
        Posted
      </Badge>
    );
  }
  if (status === 'parsed' || status === 'ready_to_push') {
    return (
      <Badge variant="outline" className="text-blue-700 bg-blue-100 border-blue-200 dark:text-blue-400 dark:bg-blue-900/30 dark:border-blue-800 text-xs">
        <Send className="h-3 w-3 mr-1" />
        Ready
      </Badge>
    );
  }
  if (status === 'push_failed' || status === 'push_failed_permanent') {
    return (
      <Badge variant="outline" className="text-red-700 bg-red-100 border-red-200 dark:text-red-400 dark:bg-red-900/30 dark:border-red-800 text-xs">
        <AlertTriangle className="h-3 w-3 mr-1" />
        Failed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-muted-foreground text-xs">
      <Clock className="h-3 w-3 mr-1" />
      {status === 'already_recorded' ? 'Recorded' : 'Pending'}
    </Badge>
  );
}

interface RecentSettlementsProps {
  onViewAll?: () => void;
}

export default function RecentSettlements({ onViewAll }: RecentSettlementsProps) {
  const [rows, setRows] = useState<SettlementRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        // Fetch real settlements only — exclude order-aggregated faux settlements
        const { data, error, count } = await supabase
          .from('settlements')
          .select('id, settlement_id, marketplace, period_start, period_end, bank_deposit, status, xero_status, source, created_at', { count: 'exact' })
          .neq('source', 'api_sync') // Exclude auto-generated order aggregates
          .not('status', 'in', '("duplicate_suppressed")')
          .order('period_end', { ascending: false })
          .limit(5);

        if (error) throw error;
        setRows((data || []) as SettlementRow[]);
        setTotalCount(count || 0);
      } catch (err) {
        console.error('Failed to load recent settlements:', err);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <CardContent className="space-y-3">
          {[1, 2, 3].map(i => <Skeleton key={i} className="h-12 w-full" />)}
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <FileText className="h-8 w-8 mx-auto text-muted-foreground/50 mb-2" />
          <p className="text-sm text-muted-foreground">No settlements yet</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Upload a settlement file or connect your marketplace to get started
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            Recent Settlements
          </CardTitle>
          {totalCount > 5 && onViewAll && (
            <Button variant="ghost" size="sm" onClick={onViewAll} className="text-xs text-muted-foreground hover:text-foreground">
              View all {totalCount}
              <ArrowRight className="h-3 w-3 ml-1" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/50">
                <th className="px-4 py-2 text-left font-medium text-muted-foreground text-xs">Gateway</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground text-xs">Period</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground text-xs">Settlement</th>
                <th className="px-4 py-2 text-center font-medium text-muted-foreground text-xs">Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr
                  key={row.id}
                  className={cn(
                    'border-b border-border/30 last:border-0 transition-colors hover:bg-muted/30',
                    idx % 2 === 1 && 'bg-muted/10'
                  )}
                >
                  <td className="px-4 py-3 font-medium text-foreground">
                    {getMarketplaceLabel(row.marketplace)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {formatDateRange(row.period_start, row.period_end)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-foreground">
                    {formatAUD(row.bank_deposit || 0)}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <StatusBadge status={row.status || ''} xeroStatus={row.xero_status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
