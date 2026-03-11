/**
 * GatewayDepositEvidence — Expandable evidence panel for payment gateway deposits.
 * Shows Shopify orders paid via the gateway, deposit details, and categorization options.
 */

import { useState, useEffect } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Eye, ChevronUp, ChevronDown, Banknote, Calendar, FileText,
  ShoppingCart, CheckCircle2, AlertTriangle, HelpCircle, ArrowRight,
  Loader2, TrendingUp,
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

interface Props {
  alertId: string;
  gatewayName: string;       // e.g. "PayPal"
  depositAmount: number;
  depositDate: string | null;
  depositDescription: string | null;
  matchConfidence: number | null;
  onDismiss: () => void;
  onConfirmIncluded: () => void; // "Yes, this is part of Shopify payout"
  formatCurrency: (amount: number) => string;
}

export default function GatewayDepositEvidence({
  alertId, gatewayName, depositAmount, depositDate,
  depositDescription, matchConfidence, onDismiss, onConfirmIncluded, formatCurrency,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [orders, setOrders] = useState<GatewayOrder[]>([]);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [totalFromOrders, setTotalFromOrders] = useState(0);

  const depositDateShort = depositDate
    ? new Date(depositDate).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })
    : null;
  const depositDateFull = depositDate
    ? new Date(depositDate).toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    : null;

  // Normalise gateway name for DB matching
  const gatewayLower = gatewayName.toLowerCase().replace(/\s+/g, '_');
  const gatewayPatterns = [gatewayLower, gatewayName.toLowerCase()]; // e.g. ['paypal', 'paypal']

  const loadOrders = async () => {
    if (ordersLoaded) return;
    setLoadingOrders(true);
    try {
      // Find orders where gateway matches this payment processor
      // Look at orders in a ±30 day window around the deposit date
      let query = supabase
        .from('shopify_orders')
        .select('order_name, total_price, created_at_shopify, source_name, financial_status, gateway')
        .order('created_at_shopify', { ascending: false })
        .limit(50);

      // Filter by gateway — use ilike for flexible matching
      query = query.or(
        gatewayPatterns.map(p => `gateway.ilike.%${p}%`).join(',')
      );

      // If we have a deposit date, focus on a reasonable window
      if (depositDate) {
        const d = new Date(depositDate);
        const start = new Date(d);
        start.setDate(start.getDate() - 30);
        const end = new Date(d);
        end.setDate(end.getDate() + 3);
        query = query
          .gte('created_at_shopify', start.toISOString())
          .lte('created_at_shopify', end.toISOString());
      }

      const { data, error } = await query;
      if (error) throw error;

      const rows = (data || []) as GatewayOrder[];
      setOrders(rows);
      setTotalFromOrders(rows.reduce((sum, o) => sum + (parseFloat(String(o.total_price)) || 0), 0));
      setOrdersLoaded(true);
    } catch (err) {
      console.error('[GatewayEvidence] Failed to load orders:', err);
    } finally {
      setLoadingOrders(false);
    }
  };

  useEffect(() => {
    if (expanded && !ordersLoaded) {
      loadOrders();
    }
  }, [expanded]);

  const depositDifference = Math.abs(depositAmount - totalFromOrders);
  const isCloseMatch = ordersLoaded && depositDifference < 5;
  const isReasonableMatch = ordersLoaded && depositDifference < depositAmount * 0.15;

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
              Payment gateway deposit detected in your bank feed. Review the linked transactions below.
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
                    <p className="text-xs text-muted-foreground">Orders found via {gatewayName}</p>
                    <p className="font-semibold text-foreground">
                      {orders.length} order{orders.length !== 1 ? 's' : ''} — {formatCurrency(totalFromOrders)}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Reconciliation result */}
            {ordersLoaded && orders.length > 0 && (
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
                      ? `✓ Orders match deposit within ${formatCurrency(depositDifference)}`
                      : isReasonableMatch
                      ? `⚠ Orders are ${formatCurrency(depositDifference)} ${totalFromOrders > depositAmount ? 'over' : 'under'} the deposit — fees or timing differences likely`
                      : `Orders total doesn't closely match deposit — ${formatCurrency(depositDifference)} difference`}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {gatewayName} typically deducts processing fees before settling to your bank. A small difference is normal.
                  </p>
                </div>
              </div>
            )}

            {/* Orders table */}
            {loadingOrders && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-4 justify-center">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading {gatewayName} orders...
              </div>
            )}

            {ordersLoaded && orders.length === 0 && (
              <div className="text-sm text-muted-foreground py-3 text-center">
                <p>No Shopify orders paid via {gatewayName} found in this period.</p>
                <p className="text-xs mt-1">This deposit may be from direct {gatewayName} transactions (eBay, invoices, etc.) outside Shopify.</p>
              </div>
            )}

            {ordersLoaded && orders.length > 0 && (
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
                        <td className="px-3 py-1.5 text-muted-foreground">
                          {order.source_name || 'web'}
                        </td>
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
                    {/* Totals row */}
                    <tr className="border-t-2 border-primary/20 bg-muted/30">
                      <td colSpan={4} className="px-3 py-2 font-semibold text-foreground">
                        Total from {orders.length} order{orders.length !== 1 ? 's' : ''}
                      </td>
                      <td className="px-3 py-2 text-right font-mono font-bold text-foreground">
                        {formatCurrency(totalFromOrders)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}

            {/* Categorisation actions */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-t border-primary/10 pt-3">
              <div className="text-xs text-muted-foreground space-y-0.5">
                <p className="font-medium">How should we categorise this?</p>
                <p>If these orders went through Shopify checkout, they're already in your Shopify Payments payout.</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={onConfirmIncluded}
                  className="gap-1 text-xs"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Included in Shopify payout
                </Button>
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => {/* Future: set up as separate settlement source */}}
                  className="gap-1 text-xs"
                >
                  Track separately <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
