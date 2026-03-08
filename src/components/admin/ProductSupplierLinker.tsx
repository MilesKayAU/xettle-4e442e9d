import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Link2, Unlink, Search, CheckSquare, Square } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from '@/integrations/supabase/client';

interface InventoryRawData {
  id: string;
  sku: string;
  title?: string;
  supplier_name?: string;
}

interface Supplier {
  id: string;
  name: string;
  company?: string;
  contact_person?: string;
}

interface ProductSupplierLink {
  id: string;
  sku: string;
  supplier_id: string;
  product_title?: string;
  supplier_name?: string;
}

interface ProductSupplierLinkerProps {
  inventoryData: InventoryRawData[];
  onDataUpdate: () => void;
}

const ProductSupplierLinker: React.FC<ProductSupplierLinkerProps> = ({ inventoryData, onDataUpdate }) => {
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [existingLinks, setExistingLinks] = useState<ProductSupplierLink[]>([]);
  const [searchSku, setSearchSku] = useState('');
  const [loading, setLoading] = useState(false);
  const [selectedProducts, setSelectedProducts] = useState<Set<string>>(new Set());
  const [bulkSupplierId, setBulkSupplierId] = useState('');

  useEffect(() => {
    loadSuppliers();
    loadExistingLinks();
  }, []);

  const loadSuppliers = async () => {
    try {
      const { data, error } = await supabase
        .from('suppliers')
        .select('id, name, company, contact_person')
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

  const loadExistingLinks = async () => {
    try {
      const { data, error } = await supabase
        .from('product_supplier_links')
        .select(`
          id,
          sku,
          supplier_id,
          product_title,
          suppliers(name)
        `);

      if (error) throw error;
      
      const linksWithSupplierNames = (data || []).map(link => ({
        id: link.id,
        sku: link.sku,
        supplier_id: link.supplier_id,
        product_title: link.product_title,
        supplier_name: (link.suppliers as any)?.name || 'Unknown'
      }));
      
      setExistingLinks(linksWithSupplierNames);
    } catch (error: any) {
      toast({
        title: "Error Loading Links",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const linkProductToSupplier = async (sku: string, productTitle: string, supplierId: string) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('product_supplier_links')
        .upsert({
          sku,
          supplier_id: supplierId,
          product_title: productTitle,
          user_id: (await supabase.auth.getUser()).data.user?.id
        }, {
          onConflict: 'user_id,sku'
        });

      if (error) throw error;

      loadExistingLinks();
      toast({
        title: "Success",
        description: `Product ${sku} linked to supplier successfully`,
      });
    } catch (error: any) {
      toast({
        title: "Error Linking Product",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const unlinkProduct = async (linkId: string) => {
    setLoading(true);
    try {
      const { error } = await supabase
        .from('product_supplier_links')
        .delete()
        .eq('id', linkId);

      if (error) throw error;

      loadExistingLinks();
      toast({
        title: "Success",
        description: "Product unlinked from supplier successfully",
      });
    } catch (error: any) {
      toast({
        title: "Error Unlinking Product",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const bulkLinkProducts = async () => {
    if (!bulkSupplierId || selectedProducts.size === 0) {
      toast({
        title: "Error",
        description: "Please select products and a supplier",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const user = (await supabase.auth.getUser()).data.user;
      if (!user) throw new Error("User not authenticated");

      const linksToCreate = Array.from(selectedProducts).map(sku => {
        const product = filteredInventory.find(item => item.sku === sku);
        return {
          sku,
          supplier_id: bulkSupplierId,
          product_title: product?.title || '',
          user_id: user.id
        };
      });

      const { error } = await supabase
        .from('product_supplier_links')
        .upsert(linksToCreate, {
          onConflict: 'user_id,sku'
        });

      if (error) throw error;

      loadExistingLinks();
      setSelectedProducts(new Set());
      setBulkSupplierId('');
      
      toast({
        title: "Success",
        description: `${selectedProducts.size} products linked to supplier successfully`,
      });
    } catch (error: any) {
      toast({
        title: "Error Bulk Linking Products",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleProductSelection = (sku: string) => {
    const newSelection = new Set(selectedProducts);
    if (newSelection.has(sku)) {
      newSelection.delete(sku);
    } else {
      newSelection.add(sku);
    }
    setSelectedProducts(newSelection);
  };

  const toggleSelectAll = () => {
    if (selectedProducts.size === filteredInventory.length) {
      setSelectedProducts(new Set());
    } else {
      setSelectedProducts(new Set(filteredInventory.map(item => item.sku)));
    }
  };

  const getLinkedSupplier = (sku: string) => {
    return existingLinks.find(link => link.sku === sku);
  };

  const filteredInventory = inventoryData.filter(item => 
    !searchSku || item.sku.toLowerCase().includes(searchSku.toLowerCase()) ||
    (item.title && item.title.toLowerCase().includes(searchSku.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Link2 className="h-5 w-5" />
            Product-Supplier Permanent Links
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Create permanent links between your products and suppliers. These links persist even when inventory sheets are updated.
          </p>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by SKU or product title..."
                value={searchSku}
                onChange={(e) => setSearchSku(e.target.value)}
                className="pl-10"
              />
            </div>
            <Badge variant="outline">
              {existingLinks.length} products linked
            </Badge>
          </div>

          {/* Bulk Actions Bar */}
          {selectedProducts.size > 0 && (
            <Card className="mb-4 bg-blue-50 border-blue-200">
              <CardContent className="pt-4">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <CheckSquare className="h-4 w-4 text-blue-600" />
                    <span className="font-medium text-blue-900">
                      {selectedProducts.size} products selected
                    </span>
                  </div>
                  
                  <Select value={bulkSupplierId} onValueChange={setBulkSupplierId}>
                    <SelectTrigger className="w-64">
                      <SelectValue placeholder="Choose supplier to link to" />
                    </SelectTrigger>
                    <SelectContent>
                      {suppliers.map((supplier) => (
                        <SelectItem key={supplier.id} value={supplier.id}>
                          {supplier.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  
                  <Button 
                    onClick={bulkLinkProducts}
                    disabled={loading || !bulkSupplierId}
                    className="flex items-center gap-2"
                  >
                    <Link2 className="h-4 w-4" />
                    Link Selected Products
                  </Button>
                  
                  <Button 
                    variant="outline"
                    onClick={() => setSelectedProducts(new Set())}
                  >
                    Clear Selection
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">
                    <Checkbox
                      checked={selectedProducts.size === filteredInventory.length && filteredInventory.length > 0}
                      onCheckedChange={toggleSelectAll}
                      aria-label="Select all products"
                    />
                  </TableHead>
                  <TableHead>SKU</TableHead>
                  <TableHead>Product Title</TableHead>
                  <TableHead>Current Sheet Supplier</TableHead>
                  <TableHead>Permanent Link</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredInventory.map((item) => {
                  const linkedSupplier = getLinkedSupplier(item.sku);
                  
                  return (
                    <TableRow key={item.id}>
                      <TableCell>
                        <Checkbox
                          checked={selectedProducts.has(item.sku)}
                          onCheckedChange={() => toggleProductSelection(item.sku)}
                          aria-label={`Select ${item.sku}`}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-xs">
                        {item.sku}
                      </TableCell>
                      <TableCell className="max-w-xs truncate">
                        {item.title || 'N/A'}
                      </TableCell>
                      <TableCell>
                        {item.supplier_name ? (
                          <Badge variant="outline">{item.supplier_name}</Badge>
                        ) : (
                          <span className="text-muted-foreground">Unassigned</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {linkedSupplier ? (
                          <Badge className="bg-green-100 text-green-800 hover:bg-green-200">
                            {linkedSupplier.supplier_name}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">Not linked</span>
                        )}
                      </TableCell>
                      <TableCell>
                        {linkedSupplier ? (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => unlinkProduct(linkedSupplier.id)}
                            disabled={loading}
                            className="flex items-center gap-2"
                          >
                            <Unlink className="h-3 w-3" />
                            Unlink
                          </Button>
                        ) : (
                          <Select
                            onValueChange={(supplierId) => 
                              linkProductToSupplier(item.sku, item.title || '', supplierId)
                            }
                            disabled={loading}
                          >
                            <SelectTrigger className="w-40">
                              <SelectValue placeholder="Link supplier" />
                            </SelectTrigger>
                            <SelectContent>
                              {suppliers.map((supplier) => (
                                <SelectItem key={supplier.id} value={supplier.id}>
                                  {supplier.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {filteredInventory.length === 0 && (
            <div className="text-center py-8">
              <p className="text-muted-foreground">
                No products found matching your search.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Summary of existing links */}
      {existingLinks.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Linked Products Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4">
              {suppliers.map(supplier => {
                const supplierLinks = existingLinks.filter(link => link.supplier_id === supplier.id);
                if (supplierLinks.length === 0) return null;
                
                return (
                  <div key={supplier.id} className="border rounded-lg p-4">
                    <h4 className="font-semibold flex items-center gap-2">
                      {supplier.name}
                      <Badge variant="outline">{supplierLinks.length} products</Badge>
                    </h4>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {supplierLinks.map(link => (
                        <Badge key={link.id} variant="secondary" className="text-xs">
                          {link.sku}
                        </Badge>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default ProductSupplierLinker;