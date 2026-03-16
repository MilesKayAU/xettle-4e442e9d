/**
 * XeroInvoiceCompareDrawer — Compare cached Xero invoice vs Xettle computed payload.
 * Uses canonical action getXeroVsXettlePayloadDiff() — no local logic.
 */

import React, { useEffect, useState } from 'react';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { getXeroVsXettlePayloadDiff, type PayloadDiffResult } from '@/actions';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  settlementId: string | null;
  xeroInvoiceId: string | null;
}

const formatAUD = (n: number | null) =>
  n != null ? new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n) : '—';

const severityIcon = (s: string) => {
  if (s === 'error') return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
  if (s === 'warning') return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
  return <Info className="h-3.5 w-3.5 text-muted-foreground" />;
};

export default function XeroInvoiceCompareDrawer({ open, onClose, settlementId, xeroInvoiceId }: Props) {
  const [loading, setLoading] = useState(false);
  const [diff, setDiff] = useState<PayloadDiffResult | null>(null);

  useEffect(() => {
    if (!open || !settlementId || !xeroInvoiceId) return;
    setLoading(true);
    getXeroVsXettlePayloadDiff(settlementId, xeroInvoiceId).then(result => {
      setDiff(result);
      setLoading(false);
    });
  }, [open, settlementId, xeroInvoiceId]);

  return (
    <Sheet open={open} onOpenChange={() => onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-base">Compare: Xero vs Xettle</SheetTitle>
          <SheetDescription className="text-xs">
            Comparison of the current Xero invoice against what Xettle would post.
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="space-y-4 mt-6">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : diff ? (
          <div className="space-y-5 mt-4">
            {/* Differences summary */}
            {diff.differences.length === 0 ? (
              <div className="flex items-center gap-2 p-3 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-xs">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span className="text-emerald-700 dark:text-emerald-300 font-medium">No differences detected — Xero matches Xettle payload.</span>
              </div>
            ) : (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-foreground">Differences ({diff.differences.length})</h4>
                <div className="space-y-1">
                  {diff.differences.map((d, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded-md bg-muted/50 border border-border text-xs">
                      {severityIcon(d.severity)}
                      <div className="flex-1">
                        <span className="font-medium text-foreground">{d.field}</span>
                        <div className="flex gap-3 mt-0.5 text-muted-foreground">
                          <span>Xero: <span className="font-mono text-foreground">{String(d.xero_value)}</span></span>
                          <span>Xettle: <span className="font-mono text-foreground">{String(d.xettle_value)}</span></span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Separator />

            {/* Side-by-side totals */}
            <div className="grid grid-cols-2 gap-4">
              {/* Xero side */}
              <div>
                <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1">
                  <Badge variant="outline" className="text-[10px]">Xero</Badge>
                  Current Invoice
                </h4>
                {diff.xeroSide ? (
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span>{diff.xeroSide.status}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Currency</span><span>{diff.xeroSide.currency}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Sub-total</span><span className="font-mono">{formatAUD(diff.xeroSide.sub_total)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span className="font-mono">{formatAUD(diff.xeroSide.total_tax)}</span></div>
                    <div className="flex justify-between font-semibold"><span>Total</span><span className="font-mono">{formatAUD(diff.xeroSide.total)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Reference</span><span className="font-mono text-[10px]">{diff.xeroSide.reference || '—'}</span></div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No cached invoice — click Refresh first.</p>
                )}
              </div>

              {/* Xettle side */}
              <div>
                <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1">
                  <Badge variant="secondary" className="text-[10px]">Xettle</Badge>
                  Would Post
                </h4>
                {diff.xettleSide ? (
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span>{diff.xettleSide.status}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Currency</span><span>{diff.xettleSide.currency}</span></div>
                    <div className="flex justify-between font-semibold"><span>Total</span><span className="font-mono">{formatAUD(diff.xettleSide.total)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Reference</span><span className="font-mono text-[10px]">{diff.xettleSide.reference || '—'}</span></div>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No matching settlement found.</p>
                )}
              </div>
            </div>

            <Separator />

            {/* Line items comparison */}
            <div className="grid grid-cols-2 gap-4">
              {/* Xero line items */}
              <div>
                <h4 className="text-xs font-semibold text-foreground mb-2">Xero Line Items</h4>
                {diff.xeroSide?.line_items.length ? (
                  <div className="border border-border rounded-md overflow-hidden">
                    <table className="w-full text-[11px]">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left py-1 px-1.5 font-medium text-muted-foreground">Desc</th>
                          <th className="text-right py-1 px-1.5 font-medium text-muted-foreground">Amt</th>
                          <th className="text-center py-1 px-1.5 font-medium text-muted-foreground">Acct</th>
                          <th className="text-center py-1 px-1.5 font-medium text-muted-foreground">Tax</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {diff.xeroSide.line_items.map((li, i) => (
                          <tr key={i}>
                            <td className="py-1 px-1.5 truncate max-w-[100px]">{li.description}</td>
                            <td className={cn("py-1 px-1.5 text-right font-mono", li.line_amount >= 0 ? 'text-emerald-600' : 'text-red-600')}>{formatAUD(li.line_amount)}</td>
                            <td className="py-1 px-1.5 text-center font-mono text-muted-foreground">{li.account_code}</td>
                            <td className="py-1 px-1.5 text-center text-muted-foreground">{li.tax_type}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="text-xs text-muted-foreground">No line items</p>}
              </div>

              {/* Xettle line items */}
              <div>
                <h4 className="text-xs font-semibold text-foreground mb-2">Xettle Line Items</h4>
                {diff.xettleSide?.line_items.length ? (
                  <div className="border border-border rounded-md overflow-hidden">
                    <table className="w-full text-[11px]">
                      <thead className="bg-muted/50">
                        <tr>
                          <th className="text-left py-1 px-1.5 font-medium text-muted-foreground">Desc</th>
                          <th className="text-right py-1 px-1.5 font-medium text-muted-foreground">Amt</th>
                          <th className="text-center py-1 px-1.5 font-medium text-muted-foreground">Acct</th>
                          <th className="text-center py-1 px-1.5 font-medium text-muted-foreground">Tax</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/50">
                        {diff.xettleSide.line_items.map((li, i) => (
                          <tr key={i}>
                            <td className="py-1 px-1.5 truncate max-w-[100px]">{li.description}</td>
                            <td className={cn("py-1 px-1.5 text-right font-mono", li.amount >= 0 ? 'text-emerald-600' : 'text-red-600')}>{formatAUD(li.amount)}</td>
                            <td className="py-1 px-1.5 text-center font-mono text-muted-foreground">{li.account_code}</td>
                            <td className="py-1 px-1.5 text-center text-muted-foreground">{li.tax_type}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : <p className="text-xs text-muted-foreground">No line items</p>}
              </div>
            </div>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground mt-4">Select a settlement and invoice to compare.</p>
        )}
      </SheetContent>
    </Sheet>
  );
}
