/**
 * SettlementStatusBadge — Consistent status badge with plain-language tooltips.
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
 * deposit_matched                 → 🔵 Blue "Deposit Matched"
 * verified_payout                 → 🟢 Green "Verified ✓"
 */

import React from 'react';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { isBankMatchRequired } from '@/constants/settlement-rails';

interface SettlementStatusBadgeProps {
  status: string | null;
  xeroInvoiceNumber?: string | null;
  xeroType?: string | null;
  xeroStatus?: string | null;
  marketplace?: string | null;
}

function StatusWithTooltip({ children, tooltip }: { children: React.ReactNode; tooltip: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <span>{children}</span>
        </TooltipTrigger>
        <TooltipContent className="text-xs max-w-[220px]">
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export default function SettlementStatusBadge({ status, xeroInvoiceNumber, xeroType, xeroStatus, marketplace }: SettlementStatusBadgeProps) {
  const typeLabel = xeroType === 'bill' ? 'Bill' : 'Inv';
  const refSuffix = xeroInvoiceNumber ? ` (${typeLabel}: ${xeroInvoiceNumber})` : '';

  switch (status) {
    case 'draft_in_xero':
      return (
        <StatusWithTooltip tooltip="This settlement has been pushed as a draft invoice in Xero. Log in to Xero to approve it.">
          <Badge className="bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800 text-[10px]">
            Draft in Xero — Approve{refSuffix}
          </Badge>
        </StatusWithTooltip>
      );

    case 'authorised_in_xero':
      if (marketplace && !isBankMatchRequired(marketplace)) {
        return (
          <StatusWithTooltip tooltip="Posted to Xero and approved. No bank matching needed for this marketplace — all done.">
            <Badge className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 text-[10px]">
              Posted{refSuffix} ✓
            </Badge>
          </StatusWithTooltip>
        );
      }
      return (
        <StatusWithTooltip tooltip="Approved in Xero. Waiting for the bank deposit to appear so it can be reconciled against this invoice.">
          <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">
            Awaiting Reconciliation{refSuffix}
          </Badge>
        </StatusWithTooltip>
      );

    case 'reconciled_in_xero':
      return (
        <StatusWithTooltip tooltip="Fully reconciled — the invoice in Xero has been matched to a bank deposit. Nothing more to do.">
          <Badge className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 text-[10px]">
            Reconciled{refSuffix} ✓
          </Badge>
        </StatusWithTooltip>
      );

    case 'synced':
    case 'pushed_to_xero': {
      const xs = (xeroStatus || '').toUpperCase();
      if (xs === 'DRAFT') {
        return (
          <StatusWithTooltip tooltip="Pushed as a draft. Open Xero to review and approve.">
            <Badge className="bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 border-orange-200 dark:border-orange-800 text-[10px]">
              Draft in Xero{refSuffix}
            </Badge>
          </StatusWithTooltip>
        );
      }
      if (xs === 'AUTHORISED') {
        if (marketplace && !isBankMatchRequired(marketplace)) {
          return (
            <StatusWithTooltip tooltip="Posted and approved. No bank matching needed — complete.">
              <Badge className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 text-[10px]">
                Posted{refSuffix} ✓
              </Badge>
            </StatusWithTooltip>
          );
        }
        return (
          <StatusWithTooltip tooltip="Approved in Xero. Waiting for the bank deposit to reconcile.">
            <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">
              Awaiting Reconciliation{refSuffix}
            </Badge>
          </StatusWithTooltip>
        );
      }
      if (xs === 'PAID') {
        return (
          <StatusWithTooltip tooltip="Fully reconciled with a bank deposit in Xero. Complete.">
            <Badge className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 text-[10px]">
              Reconciled{refSuffix} ✓
            </Badge>
          </StatusWithTooltip>
        );
      }
      return (
        <StatusWithTooltip tooltip="This settlement has been synced to Xero.">
          <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">
            In Xero{refSuffix} ✓
          </Badge>
        </StatusWithTooltip>
      );
    }

    case 'synced_external':
      return (
        <StatusWithTooltip tooltip="This was already in Xero before Xettle — imported or created by another tool.">
          <Badge variant="outline" className="border-muted-foreground/40 text-[10px]">
            Already in Xero (legacy){refSuffix}
          </Badge>
        </StatusWithTooltip>
      );

    case 'push_failed':
      return (
        <StatusWithTooltip tooltip="Push to Xero failed. Check your Xero connection and retry.">
          <Badge variant="destructive" className="text-[10px]">Push failed</Badge>
        </StatusWithTooltip>
      );

    case 'push_failed_permanent':
      return (
        <StatusWithTooltip tooltip="Push failed permanently — this may need manual intervention. Check the settlement details.">
          <Badge variant="destructive" className="text-[10px]">Push failed (permanent)</Badge>
        </StatusWithTooltip>
      );

    case 'ready_to_push':
      return (
        <StatusWithTooltip tooltip="Figures reconcile correctly. Ready to create an invoice in Xero — click Push.">
          <Badge className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800 text-[10px]">
            Ready for Xero
          </Badge>
        </StatusWithTooltip>
      );

    case 'saved':
    case 'parsed':
      return (
        <StatusWithTooltip tooltip="Settlement uploaded and saved. Review the details, then push to Xero when ready.">
          <Badge className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800 text-[10px]">
            Ready to push
          </Badge>
        </StatusWithTooltip>
      );

    case 'already_recorded':
      return (
        <StatusWithTooltip tooltip="This settlement is from before your accounting boundary date — no action needed.">
          <Badge variant="secondary" className="text-[10px] text-muted-foreground">
            Pre-accounting boundary
          </Badge>
        </StatusWithTooltip>
      );

    case 'deposit_matched':
      return (
        <StatusWithTooltip tooltip="The bank deposit has been matched to this settlement. Awaiting final verification.">
          <Badge className="bg-primary/10 text-primary border-primary/20 text-[10px]">
            Deposit Matched{refSuffix}
          </Badge>
        </StatusWithTooltip>
      );

    case 'verified_payout':
      return (
        <StatusWithTooltip tooltip="Payout verified against bank statement — confirmed.">
          <Badge className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 text-[10px]">
            Verified{refSuffix} ✓
          </Badge>
        </StatusWithTooltip>
      );

    default:
      return (
        <StatusWithTooltip tooltip="Settlement saved — review and push when ready.">
          <Badge variant="outline" className="text-[10px]">{status || 'Saved'}</Badge>
        </StatusWithTooltip>
      );
  }
}
