/**
 * SettlementStatusBadge — Consistent status badge for all marketplace dashboards.
 * Part of the BaseMarketplaceDashboard architecture pattern.
 *
 * Status Matrix (full lifecycle):
 * ready_to_push / saved / parsed  → 🟡 Amber  "Ready for Xero"
 * draft_in_xero                   → 🟠 Orange "Draft in Xero — Approve"
 * authorised_in_xero              → 🔵 Blue   "Awaiting Reconciliation"
 * reconciled_in_xero              → 🟢 Green  "Reconciled ✓"
 * pushed_to_xero DRAFT            → 🟠 Orange "Draft in Xero"
 * pushed_to_xero AUTHORISED       → 🔵 Blue   "Awaiting Reconciliation"
 * pushed_to_xero PAID             → 🟢 Green  "Reconciled ✓"
 * synced_external                 → ⚪ Outline "Already in Xero (legacy)"
 * already_recorded                → ⚫ Secondary "Pre-accounting boundary"
 * push_failed                     → 🔴 Red "Push failed"
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
    // ─── New lifecycle statuses ─────────────────────────────────────
    case 'draft_in_xero':
      return (
        <Badge className="bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800 text-[10px]">
          Draft in Xero — Approve{refSuffix}
        </Badge>
      );

    case 'authorised_in_xero':
      return (
        <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">
          Awaiting Reconciliation{refSuffix}
        </Badge>
      );

    case 'reconciled_in_xero':
      return (
        <Badge className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 text-[10px]">
          Reconciled{refSuffix} ✓
        </Badge>
      );

    // ─── Legacy pushed_to_xero with granular xeroStatus ────────────
    case 'synced':
    case 'pushed_to_xero': {
      const xs = (xeroStatus || '').toUpperCase();
      if (xs === 'DRAFT') {
        return (
          <Badge className="bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800 text-[10px]">
            Draft in Xero{refSuffix}
          </Badge>
        );
      }
      if (xs === 'AUTHORISED') {
        return (
          <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">
            Awaiting Reconciliation{refSuffix}
          </Badge>
        );
      }
      if (xs === 'PAID') {
        return (
          <Badge className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 text-[10px]">
            Reconciled{refSuffix} ✓
          </Badge>
        );
      }
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

    case 'push_failed_permanent':
      return <Badge variant="destructive" className="text-[10px]">Push failed (permanent)</Badge>;

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
