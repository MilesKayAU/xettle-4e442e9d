/**
 * RecentUploads — Shows recently uploaded/processed settlements.
 * Displays on the Upload tab so users can confirm their file was processed.
 */

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { FileText, CheckCircle2, Loader2, Clock, AlertTriangle } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { formatDistanceToNow } from 'date-fns';

interface RecentUpload {
  id: string;
  settlement_id: string;
  marketplace: string | null;
  created_at: string;
  status: string | null;
  bank_deposit: number | null;
  period_start: string;
  period_end: string;
  source: string;
}

const MARKETPLACE_DISPLAY: Record<string, string> = {
  amazon_au: 'Amazon AU',
  shopify_payments: 'Shopify',
  kogan: 'Kogan',
  mydeal: 'MyDeal',
  bunnings: 'Bunnings',
  catch: 'Catch',
  ebay: 'eBay',
  iconic: 'THE ICONIC',
  bigw: 'Big W',
  everyday_market: 'Everyday Market',
  tiktok: 'TikTok Shop',
};

function getLabel(code: string | null): string {
  if (!code) return 'Unknown';
  return MARKETPLACE_DISPLAY[code] || code.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function StatusBadge({ status }: { status: string | null }) {
  switch (status) {
    case 'parsed':
    case 'ready_to_push':
    case 'saved':
      return (
        <Badge variant="outline" className="text-emerald-700 bg-emerald-50 border-emerald-200 dark:text-emerald-400 dark:bg-emerald-900/30 text-xs">
          <CheckCircle2 className="h-3 w-3 mr-1" /> Ready
        </Badge>
      );
    case 'processing':
      return (
        <Badge variant="outline" className="text-sky-700 bg-sky-50 border-sky-200 dark:text-sky-400 dark:bg-sky-900/30 text-xs">
          <Loader2 className="h-3 w-3 mr-1 animate-spin" /> Processing
        </Badge>
      );
    case 'push_failed':
      return (
        <Badge variant="outline" className="text-red-700 bg-red-50 border-red-200 dark:text-red-400 dark:bg-red-900/30 text-xs">
          <AlertTriangle className="h-3 w-3 mr-1" /> Failed
        </Badge>
      );
    default:
      return (
        <Badge variant="outline" className="text-muted-foreground text-xs">
          <Clock className="h-3 w-3 mr-1" /> {status || 'Pending'}
        </Badge>
      );
  }
}

export default function RecentUploads() {
  const [uploads, setUploads] = useState<RecentUpload[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from('settlements')
        .select('id, settlement_id, marketplace, created_at, status, bank_deposit, period_start, period_end, source')
        .in('source', ['manual', 'csv_upload', 'pdf_upload', 'xlsx_upload'])
        .neq('status', 'duplicate_suppressed')
        .neq('status', 'hidden')
        .order('created_at', { ascending: false })
        .limit(8);
      setUploads((data || []) as RecentUpload[]);
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <Card>
        <CardHeader className="pb-3"><Skeleton className="h-5 w-32" /></CardHeader>
        <CardContent><Skeleton className="h-20 w-full" /></CardContent>
      </Card>
    );
  }

  if (uploads.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-semibold flex items-center gap-2 text-foreground">
          <FileText className="h-4 w-4 text-primary" />
          Recent Uploads
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/40 border-y border-border/50">
                <th className="px-4 py-2 text-left font-medium text-muted-foreground text-xs">File / Settlement</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground text-xs">Marketplace</th>
                <th className="px-4 py-2 text-left font-medium text-muted-foreground text-xs">Uploaded</th>
                <th className="px-4 py-2 text-right font-medium text-muted-foreground text-xs">Amount</th>
                <th className="px-4 py-2 text-center font-medium text-muted-foreground text-xs">Status</th>
              </tr>
            </thead>
            <tbody>
              {uploads.map((u) => (
                <tr key={u.id} className="border-b border-border/30 last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-2.5 text-foreground font-mono text-xs truncate max-w-[180px]">
                    {u.settlement_id}
                  </td>
                  <td className="px-4 py-2.5 text-foreground text-xs">
                    {getLabel(u.marketplace)}
                  </td>
                  <td className="px-4 py-2.5 text-muted-foreground text-xs whitespace-nowrap">
                    {formatDistanceToNow(new Date(u.created_at), { addSuffix: true })}
                  </td>
                  <td className="px-4 py-2.5 text-right text-foreground font-semibold text-xs whitespace-nowrap">
                    {u.bank_deposit != null
                      ? new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(u.bank_deposit)
                      : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    <StatusBadge status={u.status} />
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
