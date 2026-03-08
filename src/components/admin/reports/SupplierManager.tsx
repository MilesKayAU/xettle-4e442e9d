import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Users, Download, FileText, Building2, Plus } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from '@/integrations/supabase/client';

interface Supplier {
  id: string;
  name: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  address?: string;
  notes?: string;
}

interface InventoryRawData {
  id: string;
  sku: string;
  title?: string;
  supplier_name?: string;
  recommended_quantity_for_reordering?: number;
  fba_fbm_stock: number;
  margin?: number;
  estimated_sales_velocity?: number;
}

interface SupplierOrderSummary {
  supplier: string;
  products: Array<{
    sku: string;
    title: string;
    reorderQty: number;
    currentStock: number;
    unitCost?: number;
    totalCost?: number;
  }>;
  totalItems: number;
  totalUnits: number;
  estimatedCost: number;
}

interface SupplierManagerProps {
  inventoryData: InventoryRawData[];
  onDataUpdate: () => void;
}

const SupplierManager: React.FC<SupplierManagerProps> = ({ inventoryData, onDataUpdate }) => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [selectedSupplier, setSelectedSupplier] = useState<string>('');
  const [newSupplier, setNewSupplier] = useState<Partial<Supplier>>({});
  const [showAddSupplier, setShowAddSupplier] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    loadSuppliers();
  }, []);

  const loadSuppliers = async () => {
    try {
      const { data, error } = await supabase
        .from('suppliers')
        .select('*')
        .order('name');

      if (error) throw error;
      setSuppliers(data || []);
    } catch (error: any) {
      toast({
        title: "Error Loading Suppliers",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const addSupplier = async () => {
    if (!newSupplier.name) {
      toast({
        title: "Error",
        description: "Supplier name is required",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase
        .from('suppliers')
        .insert([newSupplier as any]);

      if (error) throw error;

      setNewSupplier({});
      setShowAddSupplier(false);
      loadSuppliers();
      
      toast({
        title: "Success",
        description: "Supplier added successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error Adding Supplier",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const getSupplierOrderSummary = (): SupplierOrderSummary[] => {
    const supplierGroups = inventoryData.reduce((acc, item) => {
      const supplier = item.supplier_name || 'Unassigned';
      if (!acc[supplier]) {
        acc[supplier] = [];
      }
      acc[supplier].push(item);
      return acc;
    }, {} as Record<string, InventoryRawData[]>);

    return Object.entries(supplierGroups).map(([supplier, products]) => {
      const productSummaries = products
        .filter(p => (p.recommended_quantity_for_reordering || 0) > 0)
        .map(p => ({
          sku: p.sku,
          title: p.title || 'N/A',
          reorderQty: p.recommended_quantity_for_reordering || 0,
          currentStock: p.fba_fbm_stock,
          unitCost: p.margin ? (p.margin * 0.7) : undefined, // Rough estimate
          totalCost: p.margin && p.recommended_quantity_for_reordering 
            ? (p.margin * 0.7 * p.recommended_quantity_for_reordering) 
            : undefined
        }));

      return {
        supplier,
        products: productSummaries,
        totalItems: productSummaries.length,
        totalUnits: productSummaries.reduce((sum, p) => sum + p.reorderQty, 0),
        estimatedCost: productSummaries.reduce((sum, p) => sum + (p.totalCost || 0), 0)
      };
    }).filter(summary => summary.totalItems > 0);
  };

  const getFilteredProducts = () => {
    if (!selectedSupplier || selectedSupplier === 'all') return inventoryData;
    return inventoryData.filter(item => 
      selectedSupplier === 'unassigned' 
        ? !item.supplier_name 
        : item.supplier_name === selectedSupplier
    );
  };

  const exportSupplierOrder = async (supplierSummary: SupplierOrderSummary) => {
    // Fetch detailed supplier contact information
    let supplierContact = 'Contact information not available';
    try {
      const { data: supplierData } = await supabase
        .from('suppliers')
        .select('name, company_name, contact_person, email, phone, mobile, website, address, city, country')
        .or(`name.ilike.%${supplierSummary.supplier}%,company_name.ilike.%${supplierSummary.supplier}%`)
        .single();
      
      if (supplierData) {
        const contactParts = [];
        if (supplierData.contact_person) contactParts.push(`Contact: ${supplierData.contact_person}`);
        if (supplierData.email) contactParts.push(`Email: ${supplierData.email}`);
        if (supplierData.phone) contactParts.push(`Phone: ${supplierData.phone}`);
        if (supplierData.mobile) contactParts.push(`Mobile: ${supplierData.mobile}`);
        if (supplierData.website) contactParts.push(`Website: ${supplierData.website}`);
        if (supplierData.address) contactParts.push(`Address: ${supplierData.address}`);
        if (supplierData.city) contactParts.push(`City: ${supplierData.city}`);
        if (supplierData.country) contactParts.push(`Country: ${supplierData.country}`);
        
        supplierContact = contactParts.join(' | ');
      }
    } catch (error) {
      console.log('Could not fetch supplier contact details:', error);
    }

    const csvContent = [
      [`PURCHASE ORDER - ${supplierSummary.supplier}`],
      [`Date: ${new Date().toLocaleDateString()}`],
      [`Generated by: Miles Kay Australia`],
      [],
      [`SUPPLIER DETAILS:`],
      [`${supplierContact}`],
      [],
      [`ORDER SUMMARY:`],
      [`Total Items: ${supplierSummary.totalItems}`],
      [`Total Units: ${supplierSummary.totalUnits}`],
      [`Estimated Total Cost: $${supplierSummary.estimatedCost.toFixed(2)}`],
      [],
      [`DETAILED ORDER:`],
      ['SKU', 'Product Title', 'Current Stock', 'Reorder Qty', 'Unit Cost', 'Total Cost'],
      ...supplierSummary.products.map(p => [
        p.sku,
        p.title,
        p.currentStock.toString(),
        p.reorderQty.toString(),
        p.unitCost ? `$${p.unitCost.toFixed(2)}` : 'N/A',
        p.totalCost ? `$${p.totalCost.toFixed(2)}` : 'N/A'
      ]),
      [],
      [`Notes:`],
      [`Please confirm receipt of this order and provide estimated delivery date.`],
      [`Contact us at admin@mileskayaustralia.com for any questions.`]
    ].map(row => row.join(',')).join('\n');

    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PO-${supplierSummary.supplier.replace(/\s+/g, '-')}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);

    toast({
      title: "Purchase Order Exported",
      description: `Complete purchase order for ${supplierSummary.supplier} with contact details exported successfully`,
    });
  };

  const exportAllOrders = () => {
    const summaries = getSupplierOrderSummary();
    summaries.forEach(summary => {
      setTimeout(() => exportSupplierOrder(summary), 100);
    });
  };

  const supplierSummaries = getSupplierOrderSummary();
  const filteredProducts = getFilteredProducts();
  const allSupplierNames = [...new Set(inventoryData.map(item => item.supplier_name).filter(Boolean))];

  return (
    <div className="space-y-6">
      {/* Header Controls */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Building2 className="h-5 w-5" />
            Supplier Management
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 mb-4">
            <div className="flex-1">
              <Label htmlFor="supplier-filter">Filter by Supplier</Label>
              <Select value={selectedSupplier} onValueChange={setSelectedSupplier}>
                <SelectTrigger>
                  <SelectValue placeholder="All suppliers" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All suppliers</SelectItem>
                  <SelectItem value="unassigned">Unassigned</SelectItem>
                  {suppliers.map(supplier => (
                    <SelectItem key={supplier.id} value={supplier.name}>{supplier.name}</SelectItem>
                  ))}
                  {allSupplierNames.filter(name => !suppliers.some(s => s.name === name)).map(name => (
                    <SelectItem key={name} value={name}>{name} (from inventory)</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <Dialog open={showAddSupplier} onOpenChange={setShowAddSupplier}>
              <DialogTrigger asChild>
                <Button variant="outline" className="flex items-center gap-2">
                  <Plus className="h-4 w-4" />
                  Add Supplier
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Add New Supplier</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="supplier-name">Supplier Name *</Label>
                    <Input
                      id="supplier-name"
                      value={newSupplier.name || ''}
                      onChange={(e) => setNewSupplier({...newSupplier, name: e.target.value})}
                      placeholder="Enter supplier name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="contact-person">Contact Person</Label>
                    <Input
                      id="contact-person"
                      value={newSupplier.contact_person || ''}
                      onChange={(e) => setNewSupplier({...newSupplier, contact_person: e.target.value})}
                      placeholder="Contact person name"
                    />
                  </div>
                  <div>
                    <Label htmlFor="email">Email</Label>
                    <Input
                      id="email"
                      type="email"
                      value={newSupplier.email || ''}
                      onChange={(e) => setNewSupplier({...newSupplier, email: e.target.value})}
                      placeholder="supplier@example.com"
                    />
                  </div>
                  <div>
                    <Label htmlFor="phone">Phone</Label>
                    <Input
                      id="phone"
                      value={newSupplier.phone || ''}
                      onChange={(e) => setNewSupplier({...newSupplier, phone: e.target.value})}
                      placeholder="Phone number"
                    />
                  </div>
                  <div className="flex justify-end gap-2">
                    <Button variant="outline" onClick={() => setShowAddSupplier(false)}>
                      Cancel
                    </Button>
                    <Button onClick={addSupplier} disabled={loading}>
                      {loading ? 'Adding...' : 'Add Supplier'}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>

          <div className="flex gap-2">
            <Button 
              onClick={exportAllOrders}
              className="flex items-center gap-2"
              disabled={supplierSummaries.length === 0}
            >
              <Download className="h-4 w-4" />
              Export All Orders
            </Button>
            <Badge variant="secondary">
              {supplierSummaries.length} suppliers with reorders
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* Supplier Order Summaries */}
      <div className="grid gap-6">
        {supplierSummaries.map((summary) => (
          <Card key={summary.supplier}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  {summary.supplier}
                </CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="outline">
                    {summary.totalItems} items
                  </Badge>
                  <Badge variant="outline">
                    {summary.totalUnits} units
                  </Badge>
                  <Badge variant="outline">
                    ${summary.estimatedCost.toFixed(2)}
                  </Badge>
                  <Button
                    size="sm"
                    onClick={() => exportSupplierOrder(summary)}
                    className="flex items-center gap-2"
                  >
                    <FileText className="h-4 w-4" />
                    Export Order
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>SKU</TableHead>
                    <TableHead>Product Title</TableHead>
                    <TableHead>Current Stock</TableHead>
                    <TableHead>Reorder Qty</TableHead>
                    <TableHead>Est. Unit Cost</TableHead>
                    <TableHead>Est. Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.products.map((product) => (
                    <TableRow key={product.sku}>
                      <TableCell className="font-mono text-xs">{product.sku}</TableCell>
                      <TableCell className="max-w-xs truncate">{product.title}</TableCell>
                      <TableCell>{product.currentStock}</TableCell>
                      <TableCell className="font-semibold">{product.reorderQty}</TableCell>
                      <TableCell>
                        {product.unitCost ? `$${product.unitCost.toFixed(2)}` : 'N/A'}
                      </TableCell>
                      <TableCell>
                        {product.totalCost ? `$${product.totalCost.toFixed(2)}` : 'N/A'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ))}
      </div>

      {supplierSummaries.length === 0 && (
        <Card>
          <CardContent className="text-center py-8">
            <p className="text-muted-foreground">
              No reorder quantities found. Generate a forecast first to see supplier orders.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default SupplierManager;