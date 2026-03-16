/**
 * InvoiceRefreshButton — Per-row refresh action for Xero invoices.
 * Uses canonical actions: refreshXeroInvoiceDetails + rescanMatchForInvoice.
 * 
 * Sitewide component — use anywhere invoices are displayed.
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { RefreshCw, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { refreshXeroInvoiceDetails, rescanMatchForInvoice } from '@/actions';
import { toast } from 'sonner';

interface Props {
  xeroInvoiceId: string;
  onRefreshComplete?: (result: { matched: boolean; settlement_id: string | null }) => void;
  size?: 'sm' | 'icon';
  lastFetchedAt?: string | null;
}

export default function InvoiceRefreshButton({ xeroInvoiceId, onRefreshComplete, size = 'icon', lastFetchedAt }: Props) {
  const [refreshing, setRefreshing] = useState(false);
  const [result, setResult] = useState<'success' | 'error' | null>(null);

  const handleRefresh = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setRefreshing(true);
    setResult(null);

    try {
      // Step 1: Refresh invoice details from Xero
      const refreshResult = await refreshXeroInvoiceDetails(xeroInvoiceId);
      if (!refreshResult.success) {
        toast.error(refreshResult.error || 'Failed to refresh invoice');
        setResult('error');
        setRefreshing(false);
        return;
      }

      // Step 2: Rescan match
      const matchResult = await rescanMatchForInvoice(xeroInvoiceId);
      
      setResult('success');
      if (matchResult.matched) {
        toast.success(`Refreshed — matched to ${matchResult.settlement_id}`);
      } else if (refreshResult.cached) {
        toast.info('Invoice recently fetched — using cached data');
      } else {
        toast.success('Invoice refreshed from Xero');
      }

      onRefreshComplete?.({
        matched: matchResult.matched,
        settlement_id: matchResult.settlement_id,
      });
    } catch (err: any) {
      toast.error(err.message || 'Refresh failed');
      setResult('error');
    } finally {
      setRefreshing(false);
      // Clear result icon after 3s
      setTimeout(() => setResult(null), 3000);
    }
  };

  const formatAge = (dt: string | null | undefined) => {
    if (!dt) return null;
    const age = Date.now() - new Date(dt).getTime();
    if (age < 60000) return 'just now';
    if (age < 3600000) return `${Math.floor(age / 60000)}m ago`;
    if (age < 86400000) return `${Math.floor(age / 3600000)}h ago`;
    return `${Math.floor(age / 86400000)}d ago`;
  };

  const ageLabel = formatAge(lastFetchedAt);

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size={size}
          className={size === 'icon' ? 'h-7 w-7' : 'h-7 text-xs gap-1'}
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {refreshing ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : result === 'success' ? (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
          ) : result === 'error' ? (
            <AlertTriangle className="h-3.5 w-3.5 text-destructive" />
          ) : (
            <RefreshCw className="h-3.5 w-3.5" />
          )}
          {size === 'sm' && (refreshing ? 'Refreshing…' : 'Refresh')}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="top" className="text-xs">
        {refreshing ? 'Fetching from Xero…' : ageLabel ? `Last refreshed ${ageLabel}. Click to refresh.` : 'Refresh invoice from Xero'}
      </TooltipContent>
    </Tooltip>
  );
}
