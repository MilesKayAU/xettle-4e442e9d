import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { 
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FileText, MoreHorizontal, Send, Trash2, Eye, CheckCircle } from 'lucide-react';
import { PurchaseOrderWithSupplier } from '@/types/purchase-orders';
import POStatusBadge from './POStatusBadge';
import POCountryBadge from './POCountryBadge';
import { format } from 'date-fns';

interface SavedPOListProps {
  purchaseOrders: PurchaseOrderWithSupplier[];
  onSendPO: (po: PurchaseOrderWithSupplier) => void;
  onViewPO: (po: PurchaseOrderWithSupplier) => void;
  onDeletePO: (poId: string) => void;
  onMarkComplete: (poId: string) => void;
}

const SavedPOList: React.FC<SavedPOListProps> = ({
  purchaseOrders,
  onSendPO,
  onViewPO,
  onDeletePO,
  onMarkComplete,
}) => {
  if (purchaseOrders.length === 0) {
    return (
      <Card>
        <CardContent className="text-center py-8">
          <FileText className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
          <h3 className="text-lg font-semibold mb-2">No Saved Purchase Orders</h3>
          <p className="text-muted-foreground">
            Create a purchase order from the supplier groups above.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Saved Purchase Orders ({purchaseOrders.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>PO Number</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Entity</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-10"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {purchaseOrders.map((po) => (
              <TableRow key={po.id}>
                <TableCell className="font-mono font-medium">
                  {po.po_number}
                </TableCell>
                <TableCell>
                  {po.supplier?.name || po.supplier?.company_name || 'Unknown'}
                </TableCell>
                <TableCell>
                  <POCountryBadge country={po.country} />
                </TableCell>
                <TableCell>
                  <POStatusBadge status={po.status} />
                </TableCell>
                <TableCell className="text-right font-medium">
                  {po.currency} {(po.total_amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {format(new Date(po.created_at), 'MMM d, yyyy')}
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => onViewPO(po)}>
                        <Eye className="mr-2 h-4 w-4" />
                        View Details
                      </DropdownMenuItem>
                      {po.status === 'draft' && (
                        <DropdownMenuItem onClick={() => onSendPO(po)}>
                          <Send className="mr-2 h-4 w-4" />
                          Send to Supplier
                        </DropdownMenuItem>
                      )}
                      {po.status === 'approved' && (
                        <DropdownMenuItem onClick={() => onMarkComplete(po.id)}>
                          <CheckCircle className="mr-2 h-4 w-4" />
                          Mark as Completed
                        </DropdownMenuItem>
                      )}
                      {po.status === 'draft' && (
                        <DropdownMenuItem 
                          onClick={() => onDeletePO(po.id)}
                          className="text-destructive"
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
};

export default SavedPOList;
