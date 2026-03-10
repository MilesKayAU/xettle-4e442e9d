/**
 * SettlementStatusBadge — Consistent status badge for all marketplace dashboards.
 * Part of the BaseMarketplaceDashboard architecture pattern.
 *
 * Status Matrix:
 * ready_to_push              → 🟡 Amber  "Ready for Xero"
 * already_recorded           → ⚫ Secondary "Pre-accounting boundary"
 * push_failed                → 🔴 Red "Push failed"
 * synced_external            → ⚪ Outline "Already in Xero (legacy)"
 * pushed_to_xero DRAFT       → 🟠 Orange "In Xero — Draft"
 * pushed_to_xero AUTHORISED  → 🔵 Blue "In Xero — Awaiting Payment"
 * pushed_to_xero PAID        → 🟢 Green "Fully Reconciled ✓"
 * pushed_to_xero (no status) → 🔵 Blue "In Xero ✓"
 */

import React from 'react';
import { Badge } from '@/components/ui/badge';

interface SettlementStatusBadgeProps {
  status: string | null;
  xeroInvoiceNumber?: string | null;
  xeroType?: string | null;
  xeroStatus?: string | null;
}

export default function SettlementStatusBadge({ status, xeroInvoiceNumber, xeroType, xeroStatus }: SettlementStatusBadgeProps) {
  const typeLabel = xeroType === 'bill' ? 'Bill' : 'Inv';
  const refSuffix = xeroInvoiceNumber ? ` (${typeLabel}: ${xeroInvoiceNumber})` : '';

  switch (status) {
    case 'synced':
    case 'pushed_to_xero': {
      // Granular Xero status
      const xs = (xeroStatus || '').toUpperCase();
      if (xs === 'DRAFT') {
        return (
          <Badge className="bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800 text-[10px]">
            In Xero — Draft{refSuffix}
          </Badge>
        );
      }
      if (xs === 'AUTHORISED') {
        return (
          <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">
            In Xero — Awaiting Payment{refSuffix}
          </Badge>
        );
      }
      if (xs === 'PAID') {
        return (
          <Badge className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 text-[10px]">
            Fully Reconciled{refSuffix} ✓
          </Badge>
        );
      }
      // Fallback — pushed but no granular status
      return (
        <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">
          In Xero{refSuffix} ✓
        </Badge>
      );
    }

    case 'synced_external':
      return (
        <Badge variant="outline" className="border-muted-foreground/40 text-[10px]">
          Already in Xero (legacy){refSuffix}
        </Badge>
      );

    case 'push_failed':
      return <Badge variant="destructive" className="text-[10px]">Push failed</Badge>;

    case 'ready_to_push':
      return (
        <Badge className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800 text-[10px]">
          Ready for Xero
        </Badge>
      );

    case 'saved':
    case 'parsed':
      return (
        <Badge className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800 text-[10px]">
          Ready to push
        </Badge>
      );

    case 'already_recorded':
      return (
        <Badge variant="secondary" className="text-[10px] text-muted-foreground">
          Pre-accounting boundary
        </Badge>
      );

    default:
      return <Badge variant="outline" className="text-[10px]">{status || 'Saved'}</Badge>;
  }
}
