/**
 * SettlementDetailDrawer — Immutable audit view of a posted (or pending) settlement.
 * Shows the exact payload snapshot stored at posting time, header metadata, and audit trail.
 */

import React, { useEffect, useState, useCallback } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, Info, Zap } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { formatAUD, MARKETPLACE_LABELS } from '@/utils/settlement-engine';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

interface SettlementDetailDrawerProps {
  settlementId: string | null; // settlement_id (text), not DB uuid
  open: boolean;
  onClose: () => void;
}

interface NormalizedLineItem {
  description: string;
  account_code: string;
  tax_type: string;
  amount: number;
}

interface SnapshotDetails {
  posting_mode?: string;
  xero_request_payload?: any;
  xero_response?: {
    invoice_id?: string;
    invoice_number?: string;
    xero_status?: string;
    xero_type?: string;
  };
  normalized?: {
    net_amount?: number;
    currency?: string;
    contact_name?: string;
    line_items?: NormalizedLineItem[];
    truncated?: boolean;
  };
}

interface AuditEvent {
  id: string;
  event_type: string;
  created_at: string;
  details: any;
  severity: string;
}

export default function SettlementDetailDrawer({ settlementId, open, onClose }: SettlementDetailDrawerProps) {
  const [settlement, setSettlement] = useState<any>(null);
  const [snapshot, setSnapshot] = useState<SnapshotDetails | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSnapshot, setHasSnapshot] = useState(true);
  const [externalCandidate, setExternalCandidate] = useState<any>(null);
  const [dismissingCandidate, setDismissingCandidate] = useState(false);

  useEffect(() => {
    if (!open || !settlementId) return;
    setLoading(true);
    setSnapshot(null);
    setHasSnapshot(true);
    setExternalCandidate(null);

    (async () => {
      const [settRes, eventsRes, candidateRes] = await Promise.all([
        supabase
          .from('settlements')
          .select('*')
          .eq('settlement_id', settlementId)
          .maybeSingle(),
        supabase
          .from('system_events')
          .select('*')
          .eq('settlement_id', settlementId)
          .order('created_at', { ascending: true }),
        supabase
          .from('xero_accounting_matches')
          .select('*')
          .eq('settlement_id', settlementId)
          .eq('match_method', 'external_candidate')
          .maybeSingle(),
      ]);

      if (settRes.data) setSettlement(settRes.data);
      if (candidateRes.data) setExternalCandidate(candidateRes.data);
      if (eventsRes.data) {
        setEvents(eventsRes.data as AuditEvent[]);
        const postEvent = (eventsRes.data as AuditEvent[]).find(
          e => e.event_type === 'xero_push_success' || e.event_type === 'auto_post_success'
        );
        if (postEvent?.details?.normalized?.line_items) {
          setSnapshot(postEvent.details as SnapshotDetails);
          setHasSnapshot(true);
        } else {
          setHasSnapshot(false);
          setSnapshot(null);
        }
      }
      setLoading(false);
    })();
  }, [open, settlementId]);

  const handleDismissCandidate = useCallback(async () => {
    if (!externalCandidate?.id) return;
    setDismissingCandidate(true);
    const { error } = await supabase
      .from('xero_accounting_matches')
      .delete()
      .eq('id', externalCandidate.id);
    if (error) {
      toast.error('Failed to dismiss external match');
    } else {
      setExternalCandidate(null);
      toast.success('External match dismissed');
    }
    setDismissingCandidate(false);
  }, [externalCandidate]);

  // Build reconstructed line items from settlement row (fallback for pre-snapshot settlements)
  const reconstructedLines: NormalizedLineItem[] = settlement ? [
    { description: 'Sales', account_code: '200', tax_type: 'OUTPUT', amount: (settlement.sales_principal || 0) + (settlement.sales_shipping || 0) },
    { description: 'Promotional Discounts', account_code: '200', tax_type: 'OUTPUT', amount: settlement.promotional_discounts || 0 },
    { description: 'Refunds', account_code: '205', tax_type: 'OUTPUT', amount: settlement.refunds || 0 },
    { description: 'Reimbursements', account_code: '271', tax_type: 'BASEXCLUDED', amount: settlement.reimbursements || 0 },
    { description: 'Seller Fees', account_code: '407', tax_type: 'INPUT', amount: -(Math.abs(settlement.seller_fees || 0)) },
    { description: 'FBA Fees', account_code: '408', tax_type: 'INPUT', amount: -(Math.abs(settlement.fba_fees || 0)) },
    { description: 'Storage Fees', account_code: '409', tax_type: 'INPUT', amount: -(Math.abs(settlement.storage_fees || 0)) },
    { description: 'Advertising Costs', account_code: '410', tax_type: 'INPUT', amount: -(Math.abs(settlement.advertising_costs || 0)) },
    { description: 'Other Fees', account_code: '405', tax_type: 'INPUT', amount: -(Math.abs(settlement.other_fees || 0)) },
  ].filter(l => Math.abs(l.amount) > 0.01) : [];

  const lineItems = snapshot?.normalized?.line_items || reconstructedLines;
  const netAmount = snapshot?.normalized?.net_amount ?? settlement?.bank_deposit ?? settlement?.net_ex_gst ?? 0;
  const lineItemsSum = lineItems.reduce((s, l) => s + l.amount, 0);
  const bankDeposit = settlement?.bank_deposit;
  const postingMode = snapshot?.posting_mode || (events.find(e => e.event_type === 'auto_post_success') ? 'auto' : 'manual');
  const isAutoPosted = postingMode === 'auto';
  const marketplace = settlement?.marketplace || '';
  const mpLabel = MARKETPLACE_LABELS[marketplace] || marketplace;

  return (
    <Sheet open={open} onOpenChange={() => onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-base">Settlement Detail</SheetTitle>
          <SheetDescription className="text-xs">
            {loading ? 'Loading...' : `${mpLabel} — ${settlement?.period_start} → ${settlement?.period_end}`}
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="space-y-4 mt-6">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : settlement ? (
          <div className="space-y-5 mt-4">
            {/* Auto-post banner */}
            {isAutoPosted && settlement.status === 'pushed_to_xero' && (
              <div className="flex items-start gap-2 p-3 rounded-md bg-accent/50 border border-accent text-xs">
                <Zap className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-medium text-foreground">
                    Auto-posted{settlement.posted_at ? ` on ${new Date(settlement.posted_at).toLocaleDateString('en-AU')}` : ''}
                  </p>
                  <p className="text-muted-foreground mt-0.5">
                    Rail setting: Auto — change in Settings → Rail Posting Mode
                  </p>
                </div>
              </div>
            )}

            {/* Header metadata */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
              <div>
                <span className="text-muted-foreground">Settlement ID</span>
                <p className="font-mono text-foreground truncate">{settlement.settlement_id}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Rail</span>
                <p className="text-foreground">{mpLabel}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Period</span>
                <p className="text-foreground">{settlement.period_start} → {settlement.period_end}</p>
              </div>
              <div>
                <span className="text-muted-foreground">Status</span>
                <p className="text-foreground">
                  <Badge variant={settlement.status === 'pushed_to_xero' ? 'default' : 'secondary'} className="text-[10px]">
                    {settlement.status || 'unknown'}
                  </Badge>
                </p>
              </div>
              {settlement.posted_at && (
                <div>
                  <span className="text-muted-foreground">Posted at</span>
                  <p className="text-foreground">{new Date(settlement.posted_at).toLocaleString('en-AU')}</p>
                </div>
              )}
              <div>
                <span className="text-muted-foreground">Posting mode</span>
                <p className="text-foreground capitalize">{postingMode}</p>
              </div>
              {(snapshot?.xero_response?.invoice_number || settlement.xero_invoice_number) && (
                <div>
                  <span className="text-muted-foreground">Xero Invoice #</span>
                  <p className="font-mono text-foreground">{snapshot?.xero_response?.invoice_number || settlement.xero_invoice_number}</p>
                </div>
              )}
              {(snapshot?.xero_response?.invoice_id || settlement.xero_journal_id) && (
                <div>
                  <span className="text-muted-foreground">Xero Invoice ID</span>
                  <p className="font-mono text-foreground text-[10px] truncate">{snapshot?.xero_response?.invoice_id || settlement.xero_journal_id}</p>
                </div>
              )}
              {(snapshot?.xero_response?.xero_status || settlement.xero_status) && (
                <div>
                  <span className="text-muted-foreground">Xero Status</span>
                  <p className="text-foreground">{snapshot?.xero_response?.xero_status || settlement.xero_status}</p>
                </div>
              )}
            </div>

            <Separator />

            {/* Source label */}
            {!hasSnapshot && settlement.status === 'pushed_to_xero' && (
              <div className="flex items-center gap-1.5 text-[10px] text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 rounded-md px-2.5 py-1.5">
                <AlertTriangle className="h-3 w-3" />
                Reconstructed — posted before audit snapshots were introduced
              </div>
            )}

            {/* Line items table */}
            <div>
              <h4 className="text-xs font-semibold text-foreground mb-2">
                {hasSnapshot ? 'Posted Payload' : 'Line Items'}
                {snapshot?.normalized?.truncated && <span className="text-muted-foreground font-normal ml-1">(truncated to 200)</span>}
              </h4>
              <div className="border border-border rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left py-1.5 px-2 font-medium text-muted-foreground">Description</th>
                      <th className="text-right py-1.5 px-2 font-medium text-muted-foreground">Amount</th>
                      <th className="text-center py-1.5 px-2 font-medium text-muted-foreground">Account</th>
                      <th className="text-center py-1.5 px-2 font-medium text-muted-foreground">Tax</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50">
                    {lineItems.map((li, i) => (
                      <tr key={i} className="hover:bg-muted/20">
                        <td className="py-1.5 px-2 text-foreground">{li.description}</td>
                        <td className={cn("py-1.5 px-2 text-right font-mono", li.amount >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400')}>
                          {li.amount >= 0 ? '+' : ''}{formatAUD(li.amount)}
                        </td>
                        <td className="py-1.5 px-2 text-center font-mono text-muted-foreground">{li.account_code}</td>
                        <td className="py-1.5 px-2 text-center text-muted-foreground">{li.tax_type}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-muted/30 border-t border-border">
                    <tr>
                      <td className="py-1.5 px-2 font-semibold text-foreground">Net</td>
                      <td className="py-1.5 px-2 text-right font-mono font-semibold text-foreground">{formatAUD(lineItemsSum)}</td>
                      <td colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>

            {/* Bank deposit comparison */}
            {bankDeposit != null && (
              <div className="flex items-center justify-between text-xs p-2.5 rounded-md bg-muted/30 border border-border">
                <span className="text-muted-foreground">Bank deposit</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono font-medium text-foreground">{formatAUD(bankDeposit)}</span>
                  {Math.abs(bankDeposit - lineItemsSum) < 0.02 ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  ) : (
                    <span className="text-amber-500 text-[10px]">Δ {formatAUD(bankDeposit - lineItemsSum)}</span>
                  )}
                </div>
              </div>
            )}

            {/* GST summary */}
            {(settlement.gst_on_income || settlement.gst_on_expenses) && (
              <>
                <Separator />
                <div>
                  <h4 className="text-xs font-semibold text-foreground mb-2">GST Summary</h4>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">GST on income</span>
                      <span className="font-mono text-foreground">+{formatAUD(settlement.gst_on_income || 0)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">GST on expenses</span>
                      <span className="font-mono text-foreground">{formatAUD(settlement.gst_on_expenses || 0)}</span>
                    </div>
                    <div className="flex justify-between col-span-2 pt-1 border-t border-border">
                      <span className="text-muted-foreground font-medium">Net GST liability</span>
                      <span className="font-mono font-medium text-foreground">
                        {formatAUD((settlement.gst_on_income || 0) + (settlement.gst_on_expenses || 0))}
                      </span>
                    </div>
                  </div>
                </div>
              </>
            )}

            {/* Audit trail */}
            {events.length > 0 && (
              <>
                <Separator />
                <div>
                  <h4 className="text-xs font-semibold text-foreground mb-2">Audit Trail</h4>
                  <div className="space-y-1.5">
                    {events.map(e => (
                      <div key={e.id} className="flex items-start gap-2 text-[11px]">
                        <span className={cn(
                          "mt-0.5",
                          e.severity === 'error' ? 'text-destructive' :
                          e.severity === 'warning' ? 'text-amber-500' :
                          'text-emerald-500'
                        )}>
                          {e.severity === 'error' ? <AlertTriangle className="h-3 w-3" /> :
                           e.severity === 'warning' ? <AlertTriangle className="h-3 w-3" /> :
                           <CheckCircle2 className="h-3 w-3" />}
                        </span>
                        <div className="flex-1 min-w-0">
                          <span className="text-foreground">{formatEventType(e.event_type)}</span>
                          {e.details?.posting_mode && (
                            <span className="text-muted-foreground ml-1">({e.details.posting_mode})</span>
                          )}
                        </div>
                        <span className="text-muted-foreground flex-shrink-0">
                          {new Date(e.created_at).toLocaleString('en-AU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="mt-6 text-sm text-muted-foreground text-center py-8">
            Settlement not found.
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

function formatEventType(type: string): string {
  const labels: Record<string, string> = {
    settlement_saved: 'Ingested',
    xero_push_success: 'Pushed to Xero',
    auto_post_success: 'Auto-posted to Xero',
    auto_post_failed: 'Auto-post failed',
    xero_push_failed: 'Xero push failed',
    bank_match_confirmed: 'Bank deposit matched',
    bank_match_failed: 'Bank match not found',
    bank_match_query: 'Bank feed queried',
    reconciliation_run: 'Reconciliation completed',
    reconciliation_mismatch: 'Reconciliation gap detected',
    validation_sweep_complete: 'Validation sweep',
    xero_api_call: 'Xero API call',
  };
  return labels[type] || type.replace(/_/g, ' ');
}
