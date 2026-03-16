/**
 * XeroInvoiceCompareDrawer — Compare cached Xero invoice vs Xettle canonical preview.
 * Uses canonical action compareXeroInvoiceToSettlement() — no local logic.
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription,
} from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { AlertTriangle, CheckCircle2, Info, Download, ShieldAlert, RefreshCw } from 'lucide-react';
import { compareXeroInvoiceToSettlement, type CompareResult, type CompareVerdict } from '@/actions';
import { cn } from '@/lib/utils';

interface Props {
  open: boolean;
  onClose: () => void;
  settlementId: string | null;
  xeroInvoiceId: string | null;
}

const formatAUD = (n: number | null | undefined) =>
  n != null ? new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD' }).format(n) : '—';

const verdictConfig: Record<CompareVerdict, { label: string; color: string; icon: React.ReactNode }> = {
  PASS: { label: 'PASS', color: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300', icon: <CheckCircle2 className="h-3.5 w-3.5" /> },
  WARN: { label: 'WARN', color: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300', icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  FAIL: { label: 'FAIL', color: 'bg-destructive/10 text-destructive', icon: <AlertTriangle className="h-3.5 w-3.5" /> },
  BLOCKED: { label: 'BLOCKED', color: 'bg-muted text-muted-foreground', icon: <ShieldAlert className="h-3.5 w-3.5" /> },
};

const severityIcon = (s: string) => {
  if (s === 'error') return <AlertTriangle className="h-3.5 w-3.5 text-destructive" />;
  if (s === 'warning') return <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />;
  return <Info className="h-3.5 w-3.5 text-muted-foreground" />;
};

export default function XeroInvoiceCompareDrawer({ open, onClose, settlementId, xeroInvoiceId }: Props) {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CompareResult | null>(null);

  const runCompare = useCallback(async (forceRefresh = false) => {
    if (!settlementId || !xeroInvoiceId) return;
    setLoading(true);
    try {
      const res = await compareXeroInvoiceToSettlement({ xeroInvoiceId, settlementId, forceRefresh });
      setResult(res);
    } finally {
      setLoading(false);
    }
  }, [settlementId, xeroInvoiceId]);

  useEffect(() => {
    if (!open || !settlementId || !xeroInvoiceId) return;
    runCompare();
  }, [open, settlementId, xeroInvoiceId, runCompare]);

  const handleDownload = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify({
      xero: result.xeroSide,
      xettlePreview: result.xettleSide,
      diff: result.differences,
      verdict: result.verdict,
      recommendation: result.recommendation,
    }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `xero-vs-xettle-${settlementId || 'compare'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const vc = result ? verdictConfig[result.verdict] : null;

  return (
    <Sheet open={open} onOpenChange={() => onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-base">Compare: Xero vs Xettle</SheetTitle>
          <SheetDescription className="text-xs">
            Server-canonical comparison of the current Xero invoice against what Xettle would post.
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="space-y-4 mt-6">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-48 w-full" />
          </div>
        ) : result ? (
          <div className="space-y-5 mt-4">
            {/* Verdict + metadata strip */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                {vc && (
                  <Badge className={cn('gap-1 text-[11px] font-semibold', vc.color)}>
                    {vc.icon} {vc.label}
                  </Badge>
                )}
                {result.xettleSide && (
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {result.xettleSide.canonical_version}
                  </Badge>
                )}
                {result.xettleSide && (
                  <Badge variant="secondary" className="text-[10px]">
                    {result.xettleSide.tier}
                  </Badge>
                )}
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={() => runCompare(true)}>
                  <RefreshCw className="h-3 w-3" /> Refresh
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={handleDownload}>
                  <Download className="h-3 w-3" /> JSON
                </Button>
              </div>
            </div>

            {/* Recommendation */}
            <div className={cn(
              'p-3 rounded-md border text-xs font-medium',
              result.verdict === 'PASS' && 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300',
              result.verdict === 'WARN' && 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300',
              result.verdict === 'FAIL' && 'bg-destructive/5 border-destructive/20 text-destructive',
              result.verdict === 'BLOCKED' && 'bg-muted border-border text-muted-foreground',
            )}>
              {result.recommendation}
            </div>

            {/* Differences */}
            {result.differences.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-xs font-semibold text-foreground">Differences ({result.differences.length})</h4>
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {result.differences.map((d, i) => (
                    <div key={i} className="flex items-start gap-2 p-2 rounded-md bg-muted/50 border border-border text-xs">
                      {severityIcon(d.severity)}
                      <div className="flex-1 min-w-0">
                        <span className="font-medium text-foreground">{d.field}</span>
                        <div className="flex gap-3 mt-0.5 text-muted-foreground">
                          <span className="truncate">Xero: <span className="font-mono text-foreground">{String(d.xero_value)}</span></span>
                          <span className="truncate">Xettle: <span className="font-mono text-foreground">{String(d.xettle_value)}</span></span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {result.differences.length === 0 && result.verdict === 'PASS' && (
              <div className="flex items-center gap-2 p-3 rounded-md bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-800 text-xs">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                <span className="text-emerald-700 dark:text-emerald-300 font-medium">No differences — Xero matches Xettle canonical payload.</span>
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
                {result.xeroSide ? (
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span>{result.xeroSide.status}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Currency</span><span>{result.xeroSide.currency}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Contact</span><span className="truncate max-w-[120px]">{result.xeroSide.contact_name || '—'}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Sub-total</span><span className="font-mono">{formatAUD(result.xeroSide.sub_total)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Tax</span><span className="font-mono">{formatAUD(result.xeroSide.total_tax)}</span></div>
                    <div className="flex justify-between font-semibold"><span>Total</span><span className="font-mono">{formatAUD(result.xeroSide.total)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Reference</span><span className="font-mono text-[10px]">{result.xeroSide.reference || '—'}</span></div>
                    {result.xeroSide.fetched_at && (
                      <div className="text-[10px] text-muted-foreground mt-1">Fetched: {new Date(result.xeroSide.fetched_at).toLocaleString()}</div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">No cached invoice — click Refresh.</p>
                )}
              </div>

              {/* Xettle side */}
              <div>
                <h4 className="text-xs font-semibold text-foreground mb-2 flex items-center gap-1">
                  <Badge variant="secondary" className="text-[10px]">Xettle</Badge>
                  Would Post
                </h4>
                {result.xettleSide ? (
                  <div className="space-y-1 text-xs">
                    <div className="flex justify-between"><span className="text-muted-foreground">Status</span><span>{result.xettleSide.enforced_status}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Currency</span><span>{result.xettleSide.payload.CurrencyCode}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Contact</span><span className="truncate max-w-[120px]">{result.xettleSide.payload.Contact.Name}</span></div>
                    <div className="flex justify-between font-semibold"><span>Total</span><span className="font-mono">{formatAUD(result.xettleSide.total)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Reference</span><span className="font-mono text-[10px]">{result.xettleSide.payload.Reference || '—'}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">Tax mode</span><span className="text-[10px]">{result.xettleSide.tax_mode}</span></div>
                    {result.xettleSide.warnings.length > 0 && (
                      <div className="mt-1 text-[10px] text-amber-600">{result.xettleSide.warnings.join('; ')}</div>
                    )}
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
                {result.xeroSide?.line_items.length ? (
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
                        {result.xeroSide.line_items.map((li, i) => (
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
                {result.xettleSide?.payload.LineItems.length ? (
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
                        {result.xettleSide.payload.LineItems.map((li, i) => (
                          <tr key={i}>
                            <td className="py-1 px-1.5 truncate max-w-[100px]">{li.Description}</td>
                            <td className={cn("py-1 px-1.5 text-right font-mono", li.UnitAmount >= 0 ? 'text-emerald-600' : 'text-red-600')}>{formatAUD(li.UnitAmount)}</td>
                            <td className="py-1 px-1.5 text-center font-mono text-muted-foreground">{li.AccountCode}</td>
                            <td className="py-1 px-1.5 text-center text-muted-foreground">{li.TaxType}</td>
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
