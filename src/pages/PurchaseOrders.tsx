import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Copy, ClipboardCheck, Package, Truck, FileText, Plus } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";
import { supabase } from '@/integrations/supabase/client';
import { useForecastCalculations } from '@/hooks/use-forecast-calculations';
import { useSupplierMapping } from '@/hooks/useSupplierMapping';
import { usePurchaseOrders } from '@/hooks/use-purchase-orders';
import { ForecastWithInventory } from '@/types/inventory';
import CreatePODialog from '@/components/purchase-orders/CreatePODialog';
import SavedPOList from '@/components/purchase-orders/SavedPOList';
import SendPODialog from '@/components/purchase-orders/SendPODialog';
import { PurchaseOrderWithSupplier, CreatePurchaseOrderInput } from '@/types/purchase-orders';
import { EditableCell } from '@/components/purchase-orders/EditableCell';

// Track overridden values for items
interface ItemOverrides {
  quantity?: number;
  unitPrice?: number;
}

interface SupplierGroup {
  supplierName: string;
  supplierId: string | null;
  skus: ForecastWithInventory[];
}

interface POGeneratorOptions {
  includeSafetyStock: boolean;
  includeBuffer: boolean;
}

const PurchaseOrders = () => {
  const navigate = useNavigate();
  const { forecastData, loading, loadForecastData } = useForecastCalculations();
  const { supplierMapping, loading: supplierLoading, fetchSupplierMapping } = useSupplierMapping();
  const { 
    purchaseOrders, 
    loading: poLoading, 
    creating,
    fetchPurchaseOrders, 
    createPurchaseOrder,
    updatePurchaseOrderStatus,
    deletePurchaseOrder 
  } = usePurchaseOrders();
  
  const [supplierGroups, setSupplierGroups] = useState<SupplierGroup[]>([]);
  const [options, setOptions] = useState<POGeneratorOptions>({
    includeSafetyStock: true,
    includeBuffer: true
  });
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [copiedSupplier, setCopiedSupplier] = useState<string | null>(null);
  const [activeCountry, setActiveCountry] = useState<string>('all');
  
  // Item selection state
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  
  // Item overrides state (quantity and price edits from main dashboard)
  const [itemOverrides, setItemOverrides] = useState<Record<string, ItemOverrides>>({});
  
  // Dialog states
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [selectedSupplierGroup, setSelectedSupplierGroup] = useState<SupplierGroup | null>(null);
  const [sendDialogOpen, setSendDialogOpen] = useState(false);
  const [selectedPO, setSelectedPO] = useState<PurchaseOrderWithSupplier | null>(null);
  
  // Track overrides to pass to dialog
  const [dialogOverrides, setDialogOverrides] = useState<Record<string, ItemOverrides>>({});

  // Load data on mount
  useEffect(() => {
    loadForecastData();
    fetchPurchaseOrders();
  }, [loadForecastData, fetchPurchaseOrders]);

  useEffect(() => {
    if (forecastData.length > 0) {
      groupBySupplier();
    }
  }, [forecastData]);

  const groupBySupplier = async () => {
    const reorderItems = forecastData.filter(item => 
      item.reorder_quantity_required && item.reorder_quantity_required > 0
    );

    if (reorderItems.length === 0) {
      setSupplierGroups([]);
      return;
    }

    const skus = reorderItems.map(item => item.inventory.sku);
    
    try {
      const { data: supplierData, error } = await supabase
        .from('product_supplier_links')
        .select(`
          sku,
          supplier:suppliers(
            id,
            name,
            company_name,
            contact_person,
            email,
            phone
          )
        `)
        .in('sku', skus);

      if (error) {
        console.error('Failed to fetch supplier data:', error);
        return;
      }

      const currentSupplierMapping: Record<string, any> = {};
      supplierData?.forEach(item => {
        if (item.supplier && item.sku) {
          currentSupplierMapping[item.sku] = item.supplier;
        }
      });

      const groups: Record<string, { supplierId: string | null; items: ForecastWithInventory[] }> = {};
      
      reorderItems.forEach(item => {
        const sku = item.inventory.sku;
        const supplier = currentSupplierMapping[sku];
        
        const supplierName = supplier?.name || 
                            supplier?.company_name || 
                            item.inventory.supplier_name || 
                            'Unassigned';
        
        if (!groups[supplierName]) {
          groups[supplierName] = {
            supplierId: supplier?.id || null,
            items: []
          };
        }
        groups[supplierName].items.push(item);
      });

      const supplierGroupsArray = Object.entries(groups).map(([supplierName, data]) => ({
        supplierName,
        supplierId: data.supplierId,
        skus: data.items.sort((a, b) => {
          const urgencyOrder = { 'critical': 0, 'warning': 1, 'good': 2, 'inactive': 3 };
          return urgencyOrder[a.urgency_level as keyof typeof urgencyOrder] - 
                 urgencyOrder[b.urgency_level as keyof typeof urgencyOrder];
        })
      }));

      setSupplierGroups(supplierGroupsArray);
    } catch (error) {
      console.error('Error grouping by supplier:', error);
    }
  };

  const getUrgencyBadge = (urgencyLevel: string) => {
    const badgeProps = {
      critical: { variant: "destructive" as const, label: "URGENT" },
      warning: { variant: "secondary" as const, label: "WARNING" },
      good: { variant: "default" as const, label: "NORMAL" },
      inactive: { variant: "outline" as const, label: "INACTIVE" }
    };

    const props = badgeProps[urgencyLevel as keyof typeof badgeProps] || badgeProps.good;
    return <Badge variant={props.variant}>{props.label}</Badge>;
  };

  const generateSupplierTable = (supplier: SupplierGroup) => {
    let tableText = `**Supplier: ${supplier.supplierName}**\n\n`;
    tableText += `| SKU | Product Name | Reorder Qty | Notes |\n`;
    tableText += `|-----|---------------|-------------|-------|\n`;
    
    supplier.skus.forEach(item => {
      const sku = item.inventory.sku || '';
      const title = item.inventory.title || 'No Title';
      const reorderQty = item.reorder_quantity_required || 0;
      const note = notes[item.id] || (item.urgency_level === 'critical' ? 'URGENT' : '');
      
      tableText += `| ${sku} | ${title} | ${reorderQty.toLocaleString()} | ${note} |\n`;
    });
    
    return tableText;
  };

  const copyToClipboard = async (supplier: SupplierGroup) => {
    try {
      const tableText = generateSupplierTable(supplier);
      await navigator.clipboard.writeText(tableText);
      setCopiedSupplier(supplier.supplierName);
      toast({
        title: "Copied to Clipboard",
        description: `Purchase order for ${supplier.supplierName} copied successfully.`,
      });
      setTimeout(() => setCopiedSupplier(null), 3000);
    } catch (error) {
      toast({
        title: "Copy Failed",
        description: "Failed to copy to clipboard. Please try again.",
        variant: "destructive",
      });
    }
  };

  const updateNote = (itemId: string, note: string) => {
    setNotes(prev => ({ ...prev, [itemId]: note }));
  };

  // Item override helpers
  const updateItemQuantity = (itemId: string, quantity: number) => {
    setItemOverrides(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], quantity }
    }));
  };

  const updateItemPrice = (itemId: string, unitPrice: number) => {
    setItemOverrides(prev => ({
      ...prev,
      [itemId]: { ...prev[itemId], unitPrice }
    }));
  };

  const getDisplayQuantity = (item: ForecastWithInventory) => {
    return itemOverrides[item.id]?.quantity ?? (item.reorder_quantity_required || 0);
  };

  const getDisplayPrice = (item: ForecastWithInventory) => {
    return itemOverrides[item.id]?.unitPrice ?? (item.cog_per_unit || 0);
  };

  const getDisplayTotal = (item: ForecastWithInventory) => {
    const qty = getDisplayQuantity(item);
    const price = getDisplayPrice(item);
    return qty * price;
  };

  const isQuantityModified = (item: ForecastWithInventory) => {
    return itemOverrides[item.id]?.quantity !== undefined;
  };

  const isPriceModified = (item: ForecastWithInventory) => {
    return itemOverrides[item.id]?.unitPrice !== undefined;
  };

  const getTotalReorderValue = (supplier: SupplierGroup) => {
    return supplier.skus.reduce((total, item) => {
      return total + getDisplayTotal(item);
    }, 0);
  };

  // Item selection helpers
  const toggleItemSelection = (itemId: string) => {
    setSelectedItems(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) {
        next.delete(itemId);
      } else {
        next.add(itemId);
      }
      return next;
    });
  };

  const toggleSupplierSelection = (supplier: SupplierGroup) => {
    const allSelected = supplier.skus.every(item => selectedItems.has(item.id));
    setSelectedItems(prev => {
      const next = new Set(prev);
      supplier.skus.forEach(item => {
        if (allSelected) {
          next.delete(item.id);
        } else {
          next.add(item.id);
        }
      });
      return next;
    });
  };

  const isItemSelected = (itemId: string) => selectedItems.has(itemId);

  const getSelectedCountForSupplier = (supplier: SupplierGroup) => {
    return supplier.skus.filter(item => selectedItems.has(item.id)).length;
  };

  const areAllSupplierItemsSelected = (supplier: SupplierGroup) => {
    return supplier.skus.length > 0 && supplier.skus.every(item => selectedItems.has(item.id));
  };

  const areSomeSupplierItemsSelected = (supplier: SupplierGroup) => {
    const count = getSelectedCountForSupplier(supplier);
    return count > 0 && count < supplier.skus.length;
  };

  const handleCreatePO = (supplier: SupplierGroup) => {
    const selectedForSupplier = supplier.skus.filter(item => selectedItems.has(item.id));
    const itemsToUse = selectedForSupplier.length > 0 ? selectedForSupplier : supplier.skus;
    
    // Collect overrides for items being passed to dialog
    const overridesForDialog: Record<string, ItemOverrides> = {};
    itemsToUse.forEach(item => {
      if (itemOverrides[item.id]) {
        overridesForDialog[item.id] = itemOverrides[item.id];
      }
    });
    
    setDialogOverrides(overridesForDialog);
    setSelectedSupplierGroup({
      ...supplier,
      skus: itemsToUse
    });
    setCreateDialogOpen(true);
  };

  const handleCreatePOSubmit = async (input: CreatePurchaseOrderInput) => {
    const result = await createPurchaseOrder(input);
    if (result) {
      fetchPurchaseOrders();
    }
    return result;
  };

  const handleSendPO = (po: PurchaseOrderWithSupplier) => {
    setSelectedPO(po);
    setSendDialogOpen(true);
  };

  const handleViewPO = (po: PurchaseOrderWithSupplier) => {
    // TODO: Implement view PO details dialog
    toast({ title: 'View PO', description: `Viewing ${po.po_number}` });
  };

  const handleDeletePO = async (poId: string) => {
    const success = await deletePurchaseOrder(poId);
    if (success) {
      fetchPurchaseOrders();
    }
  };

  const handleMarkComplete = async (poId: string) => {
    const success = await updatePurchaseOrderStatus(poId, 'completed');
    if (success) {
      fetchPurchaseOrders();
    }
  };

  const filteredPOs = activeCountry === 'all' 
    ? purchaseOrders 
    : purchaseOrders.filter(po => po.country === activeCountry);

  if (loading || supplierLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex items-center space-x-4 mb-6">
          <Button variant="ghost" onClick={() => navigate('/admin')} className="flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Reports
          </Button>
        </div>
        <div className="text-center py-8">
          {loading ? 'Loading forecast data...' : 'Loading supplier information...'}
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center space-x-4">
          <Button variant="ghost" onClick={() => navigate('/admin')} className="flex items-center gap-2">
            <ArrowLeft className="h-4 w-4" />
            Back to Reports
          </Button>
          <div>
            <h1 className="text-3xl font-bold flex items-center gap-2">
              <Package className="h-8 w-8" />
              Purchase Order Generator
            </h1>
            <p className="text-muted-foreground">Generate and send purchase orders to suppliers</p>
          </div>
        </div>
      </div>

      {/* Country Tabs */}
      <Tabs value={activeCountry} onValueChange={setActiveCountry} className="mb-6">
        <TabsList className="bg-muted/80">
          <TabsTrigger value="all" className="data-[state=inactive]:text-foreground/70">All</TabsTrigger>
          <TabsTrigger value="Australia" className="data-[state=inactive]:text-foreground/70">🇦🇺 Australia</TabsTrigger>
          <TabsTrigger value="UK" className="data-[state=inactive]:text-foreground/70">🇬🇧 UK</TabsTrigger>
          <TabsTrigger value="USA" className="data-[state=inactive]:text-foreground/70">🇺🇸 USA</TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Saved Purchase Orders */}
      <div className="mb-8">
        <SavedPOList
          purchaseOrders={filteredPOs}
          onSendPO={handleSendPO}
          onViewPO={handleViewPO}
          onDeletePO={handleDeletePO}
          onMarkComplete={handleMarkComplete}
        />
      </div>

      {/* Options Panel */}
      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-5 w-5" />
            Generation Options
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-6">
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="safety-stock"
                checked={options.includeSafetyStock}
                onCheckedChange={(checked) => setOptions(prev => ({ ...prev, includeSafetyStock: !!checked }))}
              />
              <Label htmlFor="safety-stock">Include safety stock calculations</Label>
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox 
                id="buffer"
                checked={options.includeBuffer}
                onCheckedChange={(checked) => setOptions(prev => ({ ...prev, includeBuffer: !!checked }))}
              />
              <Label htmlFor="buffer">Include buffer days in calculations</Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Supplier Groups */}
      <h2 className="text-xl font-semibold mb-4 flex items-center gap-2">
        <FileText className="h-5 w-5" />
        Items Requiring Reorder
      </h2>
      
      {supplierGroups.length === 0 ? (
        <Card>
          <CardContent className="text-center py-8">
            <Package className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <h3 className="text-lg font-semibold mb-2">No Items Need Reordering</h3>
            <p className="text-muted-foreground">
              All items have sufficient stock based on your forecast settings.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {supplierGroups.map((supplier) => (
            <Card key={supplier.supplierName} className="overflow-hidden">
              <CardHeader className="pb-4">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-xl">{supplier.supplierName}</CardTitle>
                    <p className="text-sm text-muted-foreground">
                      {supplier.skus.length} SKU{supplier.skus.length !== 1 ? 's' : ''} requiring reorder • 
                      Total Value: ${getTotalReorderValue(supplier).toLocaleString()}
                      {getSelectedCountForSupplier(supplier) > 0 && (
                        <span className="ml-2 text-primary font-medium">
                          • {getSelectedCountForSupplier(supplier)} selected
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button 
                      onClick={() => copyToClipboard(supplier)}
                      variant={copiedSupplier === supplier.supplierName ? "secondary" : "outline"}
                      className="flex items-center gap-2"
                    >
                      {copiedSupplier === supplier.supplierName ? (
                        <>
                          <ClipboardCheck className="h-4 w-4" />
                          Copied!
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4" />
                          Copy
                        </>
                      )}
                    </Button>
                    <Button 
                      onClick={() => handleCreatePO(supplier)}
                      className="flex items-center gap-2"
                    >
                      <Plus className="h-4 w-4" />
                      Create PO
                      {getSelectedCountForSupplier(supplier) > 0 && (
                        <Badge variant="secondary" className="ml-1">
                          {getSelectedCountForSupplier(supplier)}
                        </Badge>
                      )}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-10">
                        <Checkbox 
                          checked={areAllSupplierItemsSelected(supplier)}
                          ref={(el) => {
                            if (el) {
                              (el as any).indeterminate = areSomeSupplierItemsSelected(supplier);
                            }
                          }}
                          onCheckedChange={() => toggleSupplierSelection(supplier)}
                          aria-label="Select all items for this supplier"
                        />
                      </TableHead>
                      <TableHead>SKU</TableHead>
                      <TableHead>Product Name</TableHead>
                      <TableHead className="text-right">Qty</TableHead>
                      <TableHead className="text-right">Unit Price</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead>Urgency</TableHead>
                      <TableHead>Notes</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {supplier.skus.map((item) => (
                      <TableRow 
                        key={item.id}
                        className={isItemSelected(item.id) ? "bg-primary/5" : ""}
                      >
                        <TableCell>
                          <Checkbox 
                            checked={isItemSelected(item.id)}
                            onCheckedChange={() => toggleItemSelection(item.id)}
                            aria-label={`Select ${item.inventory.sku}`}
                          />
                        </TableCell>
                        <TableCell className="font-mono text-sm">
                          {item.inventory.sku}
                        </TableCell>
                        <TableCell className="max-w-xs truncate">
                          {item.inventory.title || 'No Title'}
                        </TableCell>
                        <TableCell className="text-right">
                          <EditableCell
                            value={getDisplayQuantity(item)}
                            onChange={(value) => updateItemQuantity(item.id, value)}
                            isModified={isQuantityModified(item)}
                          />
                        </TableCell>
                        <TableCell className="text-right">
                          <EditableCell
                            value={getDisplayPrice(item)}
                            onChange={(value) => updateItemPrice(item.id, value)}
                            prefix="$"
                            isModified={isPriceModified(item)}
                          />
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          ${getDisplayTotal(item).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </TableCell>
                        <TableCell>
                          {getUrgencyBadge(item.urgency_level || 'good')}
                        </TableCell>
                        <TableCell>
                          <Input
                            placeholder={item.urgency_level === 'critical' ? 'URGENT' : 'Add note...'}
                            value={notes[item.id] || ''}
                            onChange={(e) => updateNote(item.id, e.target.value)}
                            className="max-w-32"
                          />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Create PO Dialog */}
      {selectedSupplierGroup && (
        <CreatePODialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          supplierName={selectedSupplierGroup.supplierName}
          supplierId={selectedSupplierGroup.supplierId}
          items={selectedSupplierGroup.skus}
          itemOverrides={dialogOverrides}
          onCreatePO={handleCreatePOSubmit}
          creating={creating}
        />
      )}

      {/* Send PO Dialog */}
      <SendPODialog
        open={sendDialogOpen}
        onOpenChange={setSendDialogOpen}
        purchaseOrder={selectedPO}
        onSent={() => fetchPurchaseOrders()}
      />
    </div>
  );
};

export default PurchaseOrders;
