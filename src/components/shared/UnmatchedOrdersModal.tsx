/**
 * UnmatchedOrdersModal — Shows Shopify orders not found in a settlement.
 */

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle } from 'lucide-react';

export interface UnmatchedOrder {
  order_number: string;
  date: string;
  amount: number;
  customer: string;
  status: string;
}

interface UnmatchedOrdersModalProps {
  open: boolean;
  periodLabel: string;
  marketplaceName: string;
  orders: UnmatchedOrder[];
  onClose: () => void;
}

function formatAUD(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-AU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount < 0 ? `-$${formatted}` : `$${formatted}`;
}

export default function UnmatchedOrdersModal({ open, periodLabel, marketplaceName, orders, onClose }: UnmatchedOrdersModalProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            Unmatched Orders — {periodLabel} {marketplaceName}
          </DialogTitle>
          <DialogDescription className="text-xs">
            These {orders.length} Shopify order{orders.length !== 1 ? 's were' : ' was'} not found in the settlement file for this period.
          </DialogDescription>
        </DialogHeader>

        {orders.length > 0 ? (
          <div className="border border-border rounded-md overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="text-xs">Order #</TableHead>
                  <TableHead className="text-xs">Date</TableHead>
                  <TableHead className="text-xs text-right">Amount</TableHead>
                  <TableHead className="text-xs">Customer</TableHead>
                  <TableHead className="text-xs">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orders.map((order, idx) => (
                  <TableRow key={idx}>
                    <TableCell className="text-xs font-mono font-medium text-foreground">{order.order_number}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{order.date}</TableCell>
                    <TableCell className="text-xs text-right font-medium text-foreground">{formatAUD(order.amount)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{order.customer}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">{order.status}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground py-4 text-center">No unmatched order details available.</p>
        )}

        <div className="bg-muted/30 rounded-md p-3 border border-border">
          <p className="text-[11px] font-medium text-foreground mb-1.5">Why are orders missing from settlement?</p>
          <ul className="text-[11px] text-muted-foreground space-y-1 list-disc list-inside">
            <li>Orders placed near period end may appear in next settlement</li>
            <li>Returned/cancelled orders may be excluded</li>
            <li>Settlement file may cover a different date range</li>
            <li>Contact {marketplaceName} if gap exceeds $50</li>
          </ul>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
