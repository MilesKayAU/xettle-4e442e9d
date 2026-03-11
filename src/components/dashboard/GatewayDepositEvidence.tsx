/**
 * GatewayDepositEvidence — Expandable evidence panel for payment gateway deposits.
 * 
 * Architecture: "Linked evidence card" — PayPal/Stripe/Afterpay/Zip are bank accounts
 * in Xero, NOT marketplaces. No separate settlement tab.
 * 
 * Data sources (Option 2 — Any transaction):
 * 1. shopify_orders where gateway matches (e.g. 'paypal')
 * 2. settlement_lines referencing the gateway in description/type
 * 3. xero_accounting_matches with matching contact
 * 
 * The bookkeeper confirms the sum matches the bank deposit, then dismisses.
 * Unmatched remainder surfaces as a gap to investigate (direct invoices, eBay, etc.).
 */

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Eye, ChevronUp, ChevronDown, Banknote, Calendar, FileText,
  ShoppingCart, CheckCircle2, AlertTriangle, HelpCircle, ArrowRight,
  Loader2, Package, Receipt,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';

interface GatewayOrder {
  order_name: string | null;
  total_price: number | null;
  created_at_shopify: string | null;
  source_name: string | null;
  financial_status: string | null;
  gateway: string | null;
}

interface OtherSourceRow {
  source: 'settlement_line' | 'xero_match';
  label: string;
  amount: number;
  date: string | null;
  reference: string | null;
}

interface Props {
  alertId: string;
  gatewayName: string;       // e.g. "PayPal"
  depositAmount: number;
  depositDate: string | null;
  depositDescription: string | null;
  matchConfidence: number | null;
  onDismiss: () => void;
  onConfirmIncluded: () => void;
  formatCurrency: (amount: number) => string;
}

export default function GatewayDepositEvidence({
  alertId, gatewayName, depositAmount, depositDate,
  depositDescription, matchConfidence, onDismiss, onConfirmIncluded, formatCurrency,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [orders, setOrders] = useState<GatewayOrder[]>([]);
  const [otherSources, setOtherSources] = useState<OtherSourceRow[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [totalFromOrders, setTotalFromOrders] = useState(0);
  const [totalFromOther, setTotalFromOther] = useState(0);

  const depositDateShort = depositDate
    ? new Date(depositDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
    : null;
  const depositDateFull = depositDate
    ? new Date(depositDate).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  // Normalise gateway name for DB matching
  const gatewayLower = gatewayName.toLowerCase().replace(/\s+/g, '_');
  const gatewayPatterns = [gatewayLower, gatewayName.toLowerCase()];

  const loadAllSources = async () => {
    if (ordersLoaded) return;
    setLoadingOrders(true);
    try {
      // Date window for searching
      let startWindow: string | null = null;
      let endWindow: string | null = null;
      if (depositDate) {
        const d = new Date(depositDate);
        const start = new Date(d);
        start.setDate(start.getDate() - 30);
        const end = new Date(d);
        end.setDate(end.getDate() + 3);
        startWindow = start.toISOString();
        endWindow = end.toISOString();
      }

      // ─── Source 1: Shopify orders with gateway match ───
      let orderQuery = supabase
        .from('shopify_orders')
        .select('order_name, total_price, created_at_shopify, source_name, financial_status, gateway')
        .or(gatewayPatterns.map(p => `gateway.ilike.%${p}%`).join(','))
        .order('created_at_shopify', { ascending: false })
        .limit(100);

      if (startWindow && endWindow) {
        orderQuery = orderQuery
          .gte('created_at_shopify', startWindow)
          .lte('created_at_shopify', endWindow);
      }

      // ─── Source 2: Settlement lines referencing this gateway ───
      let linesQuery = supabase
        .from('settlement_lines')
        .select('settlement_id, amount, amount_description, transaction_type, posted_date, order_id')
        .or(
          gatewayPatterns.map(p =>
            `amount_description.ilike.%${p}%,transaction_type.ilike.%${p}%`
          ).join(',')
        )
        .limit(50);

      if (startWindow && endWindow) {
        linesQuery = linesQuery
          .gte('posted_date', startWindow.split('T')[0])
          .lte('posted_date', endWindow.split('T')[0]);
      }

      // ─── Source 3: Xero accounting matches with this contact ───
      let xeroQuery = supabase
        .from('xero_accounting_matches')
        .select('settlement_id, matched_amount, matched_contact, matched_date, matched_reference, xero_invoice_number')
        .or(gatewayPatterns.map(p => `matched_contact.ilike.%${p}%`).join(','))
        .limit(20);

      // Run all three in parallel
      const [orderRes, linesRes, xeroRes] = await Promise.all([
        orderQuery,
        linesQuery,
        xeroQuery,
      ]);

      // Process Shopify orders
      const shopifyOrders = (orderRes.data || []) as GatewayOrder[];
      setOrders(shopifyOrders);
      const shopifyTotal = shopifyOrders.reduce((sum, o) => sum + (parseFloat(String(o.total_price)) || 0), 0);
      setTotalFromOrders(shopifyTotal);

      // Process other sources
      const otherRows: OtherSourceRow[] = [];

      // Settlement lines
      for (const line of (linesRes.data || [])) {
        otherRows.push({
          source: 'settlement_line',
          label: `${line.transaction_type || 'Transaction'}: ${line.amount_description || line.order_id || ''}`.trim(),
          amount: parseFloat(String(line.amount)) || 0,
          date: line.posted_date,
          reference: line.settlement_id,
        });
      }

      // Xero matches
      for (const match of (xeroRes.data || [])) {
        otherRows.push({
          source: 'xero_match',
          label: `Xero: ${match.xero_invoice_number || match.matched_reference || match.matched_contact || ''}`,
          amount: parseFloat(String(match.matched_amount)) || 0,
          date: match.matched_date,
          reference: match.settlement_id,
        });
      }

      setOtherSources(otherRows);
      setTotalFromOther(otherRows.reduce((sum, r) => sum + Math.abs(r.amount), 0));
      setOrdersLoaded(true);
    } catch (err) {
      console.error('[GatewayEvidence] Failed to load sources:', err);
    } finally {
      setLoadingOrders(false);
    }
  };

  useEffect(() => {
    if (expanded && !ordersLoaded) {
      loadAllSources();
    }
  }, [expanded]);

  const grandTotal = totalFromOrders + totalFromOther;
  const depositDifference = Math.abs(depositAmount - grandTotal);
  const isCloseMatch = ordersLoaded && depositDifference < 5;
  const isReasonableMatch = ordersLoaded && depositDifference < depositAmount * 0.15;
  const unmatchedRemainder = ordersLoaded ? depositAmount - grandTotal : 0;

  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardContent className="p-0">
        {/* ─── Header row ─── */}
        <div className="flex items-center gap-3 p-4">
          <span className="text-lg shrink-0">💳</span>
          <div className="flex-1 text-sm">
            <p className="font-medium text-foreground">
              {gatewayName} deposit — {formatCurrency(depositAmount)}{depositDateShort ? ` on ${depositDateShort}` : ''}
            </p>
            <p className="text-muted-foreground mt-0.5">
              Payment gateway deposit detected. Review all {gatewayName} transactions from any source below.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setExpanded(!expanded)}
              className="gap-1 text-xs text-muted-foreground"
            >
              <Eye className="h-3.5 w-3.5" />
              {expanded ? 'Hide' : 'View transactions'}
              {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            </Button>
            <Button size="sm" variant="outline" onClick={onDismiss} className="gap-1 text-xs">
              Not now
            </Button>
          </div>
        </div>

        {/* ─── Expanded evidence panel ─── */}
        {expanded && (
          <div className="border-t border-primary/10 bg-background/50 px-4 py-3 space-y-4">
            {/* Summary grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="flex items-start gap-2 text-sm">
                <Banknote className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                <div>
                  <p className="text-xs text-muted-foreground">Bank deposit</p>
                  <p className="font-semibold text-foreground">{formatCurrency(depositAmount)}</p>
                </div>
              </div>
              {depositDateFull && (
                <div className="flex items-start gap-2 text-sm">
                  <Calendar className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs text-muted-foreground">Deposit date</p>
                    <p className="font-semibold text-foreground">{depositDateFull}</p>
                  </div>
                </div>
              )}
              {depositDescription && (
                <div className="flex items-start gap-2 text-sm">
                  <FileText className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs text-muted-foreground">Bank narration</p>
                    <p className="font-semibold text-foreground break-all">{depositDescription}</p>
                  </div>
                </div>
              )}
              {ordersLoaded && (
                <div className="flex items-start gap-2 text-sm">
                  <ShoppingCart className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs text-muted-foreground">Total identified</p>
                    <p className="font-semibold text-foreground">
                      {formatCurrency(grandTotal)}
                      <span className="text-muted-foreground font-normal ml-1 text-xs">
                        ({orders.length} orders{otherSources.length > 0 ? ` + ${otherSources.length} other` : ''})
                      </span>
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Reconciliation verdict */}
            {ordersLoaded && (orders.length > 0 || otherSources.length > 0) && (
              <div className={`flex items-center gap-2 text-sm p-2 rounded-md ${
                isCloseMatch ? 'bg-green-50 dark:bg-green-950/30' :
                isReasonableMatch ? 'bg-amber-50 dark:bg-amber-950/30' :
                'bg-muted/50'
              }`}>
                {isCloseMatch ? (
                  <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                ) : isReasonableMatch ? (
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                ) : (
                  <HelpCircle className="h-4 w-4 text-muted-foreground shrink-0" />
                )}
                <div>
                  <p className="font-medium">
                    {isCloseMatch
                      ? `✓ Transactions match deposit within ${formatCurrency(depositDifference)}`
                      : isReasonableMatch
                      ? `⚠ ${formatCurrency(depositDifference)} ${grandTotal > depositAmount ? 'over' : 'under'} — processing fees or timing differences likely`
                      : `${formatCurrency(depositDifference)} unmatched — may include direct ${gatewayName} invoices or other-platform payments`}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {gatewayName} deposits aggregate all sources (Shopify, eBay, direct invoices). A gap means there are transactions not yet tracked.
                  </p>
                </div>
              </div>
            )}

            {/* Loading state */}
            {loadingOrders && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
                Searching all {gatewayName} sources...
              </div>
            )}

            {/* No results */}
            {ordersLoaded && orders.length === 0 && otherSources.length === 0 && (
              <div className="text-sm text-muted-foreground py-3 text-center">
                <p>No transactions found via {gatewayName} in this period.</p>
                <p className="text-xs mt-1">This deposit may be from direct {gatewayName} transactions (eBay, invoices, manual payments) not yet tracked in Xettle.</p>
              </div>
            )}

            {/* ─── Shopify Orders section ─── */}
            {ordersLoaded && orders.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <ShoppingCart className="h-3 w-3" />
                  Shopify orders via {gatewayName} ({orders.length})
                </div>
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="text-left font-medium text-muted-foreground px-3 py-2">Order</th>
                        <th className="text-left font-medium text-muted-foreground px-3 py-2">Date</th>
                        <th className="text-left font-medium text-muted-foreground px-3 py-2">Channel</th>
                        <th className="text-left font-medium text-muted-foreground px-3 py-2">Status</th>
                        <th className="text-right font-medium text-muted-foreground px-3 py-2">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((order, i) => (
                        <tr key={i} className="border-t border-muted/30">
                          <td className="px-3 py-1.5 font-medium text-foreground">{order.order_name || '—'}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">
                            {order.created_at_shopify
                              ? new Date(order.created_at_shopify).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: '2-digit' })
                              : '—'}
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">{order.source_name || 'web'}</td>
                          <td className="px-3 py-1.5">
                            <Badge variant={order.financial_status === 'paid' ? 'default' : 'secondary'} className="text-[10px] px-1.5 py-0">
                              {order.financial_status || 'unknown'}
                            </Badge>
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono font-medium text-foreground">
                            {formatCurrency(parseFloat(String(order.total_price)) || 0)}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-primary/20 bg-muted/30">
                        <td colSpan={4} className="px-3 py-2 font-semibold text-foreground">
                          Subtotal — Shopify orders
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-foreground">
                          {formatCurrency(totalFromOrders)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ─── Other sources section ─── */}
            {ordersLoaded && otherSources.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  <Receipt className="h-3 w-3" />
                  Other {gatewayName} transactions ({otherSources.length})
                </div>
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-muted/50">
                        <th className="text-left font-medium text-muted-foreground px-3 py-2">Source</th>
                        <th className="text-left font-medium text-muted-foreground px-3 py-2">Description</th>
                        <th className="text-left font-medium text-muted-foreground px-3 py-2">Date</th>
                        <th className="text-left font-medium text-muted-foreground px-3 py-2">Reference</th>
                        <th className="text-right font-medium text-muted-foreground px-3 py-2">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {otherSources.map((row, i) => (
                        <tr key={i} className="border-t border-muted/30">
                          <td className="px-3 py-1.5">
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              {row.source === 'settlement_line' ? 'Settlement' : 'Xero'}
                            </Badge>
                          </td>
                          <td className="px-3 py-1.5 text-foreground max-w-[200px] truncate">{row.label}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">
                            {row.date ? new Date(row.date).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' }) : '—'}
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground font-mono text-[10px]">{row.reference || '—'}</td>
                          <td className="px-3 py-1.5 text-right font-mono font-medium text-foreground">
                            {formatCurrency(Math.abs(row.amount))}
                          </td>
                        </tr>
                      ))}
                      <tr className="border-t-2 border-primary/20 bg-muted/30">
                        <td colSpan={4} className="px-3 py-2 font-semibold text-foreground">
                          Subtotal — other sources
                        </td>
                        <td className="px-3 py-2 text-right font-mono font-bold text-foreground">
                          {formatCurrency(totalFromOther)}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ─── Grand total & unmatched remainder ─── */}
            {ordersLoaded && (orders.length > 0 || otherSources.length > 0) && (
              <div className="border rounded-md p-3 bg-muted/20 space-y-1.5">
                <div className="flex items-center justify-between text-sm">
                  <span className="font-medium text-foreground">Grand total identified</span>
                  <span className="font-bold font-mono text-foreground">{formatCurrency(grandTotal)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Bank deposit</span>
                  <span className="font-mono text-muted-foreground">{formatCurrency(depositAmount)}</span>
                </div>
                <div className="flex items-center justify-between text-sm border-t border-border pt-1.5">
                  <span className="font-medium text-foreground">
                    {unmatchedRemainder > 0.5 ? 'Unmatched remainder' : unmatchedRemainder < -0.5 ? 'Excess identified' : 'Difference'}
                  </span>
                  <span className={`font-bold font-mono ${
                    Math.abs(unmatchedRemainder) < 5 ? 'text-green-600 dark:text-green-400' :
                    Math.abs(unmatchedRemainder) < depositAmount * 0.15 ? 'text-amber-600 dark:text-amber-400' :
                    'text-destructive'
                  }`}>
                    {unmatchedRemainder > 0 ? '+' : ''}{formatCurrency(unmatchedRemainder)}
                  </span>
                </div>
                {unmatchedRemainder > 5 && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Gap may include direct {gatewayName} invoices, eBay payments, or other-platform transactions not yet in Xettle.
                  </p>
                )}
              </div>
            )}

            {/* Categorisation actions */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-t border-primary/10 pt-3">
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p className="font-medium">Confirm this deposit</p>
                <p>{gatewayName} is a bank account in Xero — confirm the deposit reconciles, or flag the gap for investigation.</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {isCloseMatch && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={onConfirmIncluded}
                    className="gap-1 text-xs"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Confirm & dismiss
                  </Button>
                )}
                {!isCloseMatch && ordersLoaded && (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={onConfirmIncluded}
                      className="gap-1 text-xs"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Accept with gap
                    </Button>
                    <Button
                      size="sm"
                      variant="default"
                      onClick={() => {/* Future: flag for investigation */}}
                      className="gap-1 text-xs"
                    >
                      <AlertTriangle className="h-3.5 w-3.5" />
                      Investigate gap
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
