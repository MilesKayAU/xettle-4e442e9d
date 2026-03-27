/**
 * SettlementCard — Simplified card view for a single settlement row.
 * Shows period, amount, status, and actions in a scannable format.
 * Replaces the dense 9-column audit grid as the default view.
 */

import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Send, Eye, Trash2, Loader2, RefreshCw, ChevronDown, ChevronUp,
  CheckCircle2, AlertTriangle, ShieldCheck, SkipForward, CheckSquare, Square,
} from 'lucide-react';
import SettlementStatusBadge from './SettlementStatusBadge';
import { formatSettlementDate, formatAUD } from '@/utils/settlement-engine';

interface SettlementCardProps {
  settlement: {
    id: string;
    settlement_id: string;
    marketplace: string;
    period_start: string;
    period_end: string;
    sales_principal: number | null;
    seller_fees: number | null;
    bank_deposit: number | null;
    status: string | null;
    xero_journal_id: string | null;
    xero_invoice_number: string | null;
    xero_status: string | null;
    bank_verified: boolean | null;
    bank_verified_amount: number | null;
    source: string | null;
    refunds: number | null;
    other_fees: number | null;
    reimbursements: number | null;
  };
  isSelected: boolean;
  isSyncable: boolean;
  isSynced: boolean;
  isPushFailed: boolean;
  isPreBoundary: boolean;
  isReconBlocked: boolean;
  pushing: string | null;
  deleting: string | null;
  rollingBack: string | null;
  onSelect: () => void;
  onPush: () => void;
  onMarkSynced: () => void;
  onRollback: () => void;
  onViewDetail: () => void;
  onDelete: () => void;
  onExpandLines: () => void;
  isExpanded: boolean;
  children?: React.ReactNode; // Line items content
}

export default function SettlementCard({
  settlement: s,
  isSelected, isSyncable, isSynced, isPushFailed, isPreBoundary, isReconBlocked,
  pushing, deleting, rollingBack,
  onSelect, onPush, onMarkSynced, onRollback, onViewDetail, onDelete, onExpandLines,
  isExpanded, children,
}: SettlementCardProps) {
  const net = s.bank_deposit || 0;
  const sales = s.sales_principal || 0;
  const fees = s.seller_fees || 0;

  return (
    <div className={`border border-border rounded-lg transition-colors ${
      isPreBoundary ? 'opacity-40 bg-muted/20' :
      isSynced ? 'bg-emerald-50/30 dark:bg-emerald-950/10' :
      isPushFailed ? 'bg-red-50/30 dark:bg-red-950/10' :
      'bg-background hover:bg-muted/20'
    } ${isSelected ? 'ring-2 ring-primary/30' : ''}`}>
      <div className="p-3">
        {/* Top row: checkbox + period + amount + status */}
        <div className="flex items-start gap-3">
          <button className="shrink-0 mt-0.5 text-muted-foreground hover:text-foreground" onClick={onSelect}>
            {isSelected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4" />}
          </button>

          <div className="flex-1 min-w-0">
            {/* Period and amount */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div>
                <p className="text-sm font-medium text-foreground">
                  {formatSettlementDate(s.period_start)} → {formatSettlementDate(s.period_end)}
                </p>
                <p className="text-xs text-muted-foreground font-mono mt-0.5">{s.settlement_id}</p>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-foreground tabular-nums">{formatAUD(net)}</p>
                {sales !== 0 && (
                  <p className="text-[10px] text-muted-foreground">
                    Sales {formatAUD(sales)} · Fees {formatAUD(fees)}
                  </p>
                )}
              </div>
            </div>

            {/* Status + verification row */}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <SettlementStatusBadge
                status={s.status}
                xeroInvoiceNumber={s.xero_invoice_number}
                xeroType={(s as any).xero_type}
                xeroStatus={s.xero_status}
                marketplace={s.marketplace}
              />
              {s.bank_verified && (
                <Badge className="bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800 text-[10px]">
                  <CheckCircle2 className="h-2.5 w-2.5 mr-0.5" /> Bank matched
                </Badge>
              )}
              {isReconBlocked && !isPreBoundary && (
                <Badge className="bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800 text-[10px]">
                  <AlertTriangle className="h-2.5 w-2.5 mr-0.5" /> Needs review
                </Badge>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1.5 mt-3">
              {isSyncable && !isPreBoundary && (
                <>
                  <Button size="sm" className="h-7 px-3 text-xs gap-1" disabled={pushing === s.id} onClick={onPush}>
                    {pushing === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Send className="h-3 w-3" />}
                    Push to Xero
                  </Button>
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground" onClick={onMarkSynced}>
                          <ShieldCheck className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent className="text-xs">Already in Xero — skip</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                </>
              )}
              {isPushFailed && (
                <Button size="sm" variant="outline" className="h-7 px-2 text-xs text-amber-600 border-amber-300 gap-1" disabled={pushing === s.id} onClick={onPush}>
                  <RefreshCw className="h-3 w-3" /> Retry
                </Button>
              )}
              {isSynced && s.xero_journal_id && (
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive" disabled={rollingBack === s.id} onClick={onRollback}>
                        {rollingBack === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent className="text-xs">Void invoice & reset</TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              )}

              <div className="ml-auto flex items-center gap-1">
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground gap-1" onClick={onExpandLines}>
                  {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                  Transactions
                </Button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground" onClick={onViewDetail}>
                  <Eye className="h-3.5 w-3.5" />
                </Button>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive" disabled={deleting === s.id} onClick={onDelete}>
                  {deleting === s.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Expandable children (transaction drill-down) */}
      {isExpanded && children && (
        <div className="border-t border-border px-3 py-2 bg-muted/30">
          {children}
        </div>
      )}
    </div>
  );
}
