import React, { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Loader2, Trash2 } from 'lucide-react';
import { 
  CreatePurchaseOrderInput, 
  PurchaseOrderLineItem,
  ENTITY_DETAILS 
} from '@/types/purchase-orders';
import { ForecastWithInventory } from '@/types/inventory';

interface ItemOverrides {
  quantity?: number;
  unitPrice?: number;
}

interface CreatePODialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  supplierName: string;
  supplierId: string | null;
  items: ForecastWithInventory[];
  itemOverrides?: Record<string, ItemOverrides>;
  onCreatePO: (input: CreatePurchaseOrderInput) => Promise<any>;
  creating: boolean;
}

const CreatePODialog: React.FC<CreatePODialogProps> = ({
  open,
  onOpenChange,
  supplierName,
  supplierId,
  items,
  itemOverrides = {},
  onCreatePO,
  creating,
}) => {
  const [country, setCountry] = useState<'Australia' | 'UK' | 'USA'>('Australia');
  const [currency, setCurrency] = useState('USD');
  const [notes, setNotes] = useState('');
  const [terms, setTerms] = useState('Payment due within 30 days of invoice. Goods to be shipped FOB.');
  const [lineItems, setLineItems] = useState<PurchaseOrderLineItem[]>([]);

  // Initialize line items from forecast items, using overrides if available
  useEffect(() => {
    if (items.length > 0) {
      const initialItems: PurchaseOrderLineItem[] = items.map(item => {
        const override = itemOverrides[item.id];
        const quantity = override?.quantity ?? (item.reorder_quantity_required || 0);
        const unitPrice = override?.unitPrice ?? (item.cog_per_unit || 0);
        
        return {
          sku: item.inventory.sku,
          title: item.inventory.title || 'No Title',
          quantity,
          unit_price: unitPrice,
          total: quantity * unitPrice,
          urgency_level: item.urgency_level,
          notes: '',
        };
      });
      setLineItems(initialItems);
    }
  }, [items, itemOverrides]);

  // Update currency when country changes
  useEffect(() => {
    setCurrency(ENTITY_DETAILS[country].currency);
  }, [country]);

  const updateLineItem = (index: number, field: keyof PurchaseOrderLineItem, value: any) => {
    setLineItems(prev => {
      const updated = [...prev];
      updated[index] = { ...updated[index], [field]: value };
      
      // Recalculate total if quantity or unit_price changed
      if (field === 'quantity' || field === 'unit_price') {
        updated[index].total = updated[index].quantity * updated[index].unit_price;
      }
      
      return updated;
    });
  };

  const removeLineItem = (index: number) => {
    setLineItems(prev => prev.filter((_, i) => i !== index));
  };

  const totalAmount = lineItems.reduce((sum, item) => sum + item.total, 0);

  const handleCreate = async () => {
    if (lineItems.length === 0) return;

    const input: CreatePurchaseOrderInput = {
      supplier_id: supplierId,
      supplier_name: supplierName,
      country,
      currency,
      notes: notes || undefined,
      terms: terms || undefined,
      line_items: lineItems,
    };

    const result = await onCreatePO(input);
    if (result) {
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Purchase Order for {supplierName}</DialogTitle>
          <DialogDescription>
            Review and customize the purchase order before saving as draft or sending to supplier.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {/* Entity Selection */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="country">Ordering Entity</Label>
              <Select value={country} onValueChange={(v) => setCountry(v as any)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Australia">
                    <span className="flex items-center gap-2">
                      🇦🇺 {ENTITY_DETAILS.Australia.name}
                    </span>
                  </SelectItem>
                  <SelectItem value="UK">
                    <span className="flex items-center gap-2">
                      🇬🇧 {ENTITY_DETAILS.UK.name}
                    </span>
                  </SelectItem>
                  <SelectItem value="USA">
                    <span className="flex items-center gap-2">
                      🇺🇸 {ENTITY_DETAILS.USA.name}
                    </span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="currency">Currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="USD">USD - US Dollar</SelectItem>
                  <SelectItem value="AUD">AUD - Australian Dollar</SelectItem>
                  <SelectItem value="GBP">GBP - British Pound</SelectItem>
                  <SelectItem value="CNY">CNY - Chinese Yuan</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Entity Info */}
          <div className="bg-muted p-4 rounded-lg">
            <p className="font-medium">{ENTITY_DETAILS[country].name}</p>
            <p className="text-sm text-muted-foreground">{ENTITY_DETAILS[country].address}</p>
            <p className="text-sm text-muted-foreground">{ENTITY_DETAILS[country].email}</p>
          </div>

          {/* Line Items */}
          <div className="space-y-2">
            <Label>Line Items ({lineItems.length})</Label>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Product</TableHead>
                    <TableHead className="w-24">Qty</TableHead>
                    <TableHead className="w-28">Unit Price</TableHead>
                    <TableHead className="w-28">Total</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {lineItems.map((item, index) => (
                    <TableRow key={item.sku}>
                      <TableCell className="font-mono text-sm">
                        {item.sku}
                        {item.urgency_level === 'critical' && (
                          <Badge variant="destructive" className="ml-2 text-xs">URGENT</Badge>
                        )}
                      </TableCell>
                      <TableCell className="max-w-xs truncate">{item.title}</TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={item.quantity}
                          onChange={(e) => updateLineItem(index, 'quantity', parseInt(e.target.value) || 0)}
                          className="w-20"
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          step="0.01"
                          value={item.unit_price}
                          onChange={(e) => updateLineItem(index, 'unit_price', parseFloat(e.target.value) || 0)}
                          className="w-24"
                        />
                      </TableCell>
                      <TableCell className="font-medium">
                        {currency} {item.total.toFixed(2)}
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => removeLineItem(index)}
                          className="h-8 w-8 text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <div className="flex justify-end p-4 bg-muted rounded-lg">
              <div className="text-right">
                <p className="text-sm text-muted-foreground">Total Amount</p>
                <p className="text-2xl font-bold">{currency} {totalAmount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
              </div>
            </div>
          </div>

          {/* Notes and Terms */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (Optional)</Label>
              <Textarea
                id="notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Add any special instructions..."
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="terms">Terms & Conditions</Label>
              <Textarea
                id="terms"
                value={terms}
                onChange={(e) => setTerms(e.target.value)}
                rows={3}
              />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleCreate} disabled={creating || lineItems.length === 0}>
            {creating && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Create Draft PO
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

export default CreatePODialog;
