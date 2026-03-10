/**
 * SettlementStatusBadge — Consistent status badge for all marketplace dashboards.
 * Part of the BaseMarketplaceDashboard architecture pattern.
 */

import React from 'react';
import { Badge } from '@/components/ui/badge';

interface SettlementStatusBadgeProps {
  status: string | null;
  xeroInvoiceNumber?: string | null;
  xeroType?: string | null;
}

export default function SettlementStatusBadge({ status, xeroInvoiceNumber, xeroType }: SettlementStatusBadgeProps) {
  const typeLabel = xeroType === 'bill' ? 'Bill' : 'Invoice';

  switch (status) {
    case 'synced':
    case 'pushed_to_xero':
      return xeroInvoiceNumber
        ? <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">In Xero ({typeLabel}: {xeroInvoiceNumber}) ✓</Badge>
        : <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">Pushed to Xero ({typeLabel}) ✓</Badge>;
    case 'synced_external':
      return <Badge variant="outline" className="border-muted-foreground/40 text-[10px]">Already in Xero</Badge>;
    case 'push_failed':
      return <Badge variant="destructive" className="text-[10px]">Push failed</Badge>;
    case 'saved':
    case 'parsed':
      return <Badge className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800 text-[10px]">Ready to push</Badge>;
    default:
      return <Badge variant="outline" className="text-[10px]">{status || 'Saved'}</Badge>;
  }
}
