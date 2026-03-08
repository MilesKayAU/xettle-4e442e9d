import React, { useState, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trash2, Plus, Search, Ban, Unlink2 } from 'lucide-react';
import { toast } from 'sonner';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Tables } from '@/integrations/supabase/types';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { useInventoryData } from '@/hooks/use-inventory-data';

type IgnoredProduct = Tables<'ignored_products'>;
type InventoryItem = Tables<'uploaded_inventory_raw'>;

export const ProductIgnoreManager: React.FC = () => {
  const [ignoredProducts, setIgnoredProducts] = useState<IgnoredProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());
  const [isIgnoreDialogOpen, setIsIgnoreDialogOpen] = useState(false);
  const [ignoreType, setIgnoreType] = useState<'permanent' | 'upload'>('permanent');
  const [reason, setReason] = useState('');
  const [processing, setProcessing] = useState(false);

  // Get current inventory data
  const { uploadedData, loadUserInventoryData } = useInventoryData();

  useEffect(() => {
    loadIgnoredProducts();
    loadUserInventoryData();
  }, []);

  const loadIgnoredProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('ignored_products')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      setIgnoredProducts(data || []);
    } catch (error) {
      console.error('Error loading ignored products:', error);
      toast.error('Failed to load ignored products');
    } finally {
      setLoading(false);
    }
  };

  // Filter available products (not already ignored)
  const availableProducts = useMemo(() => {
    const ignoredSkus = new Set(ignoredProducts.map(ip => ip.sku));
    return uploadedData.filter(item => !ignoredSkus.has(item.sku));
  }, [uploadedData, ignoredProducts]);

  // Filter products based on search
  const filteredAvailableProducts = useMemo(() => {
    if (!searchTerm) return availableProducts;
    const search = searchTerm.toLowerCase();
    return availableProducts.filter(item => 
      item.sku.toLowerCase().includes(search) ||
      item.title?.toLowerCase().includes(search) ||
      item.supplier_name?.toLowerCase().includes(search)
    );
  }, [availableProducts, searchTerm]);

  // Filter ignored products based on search
  const filteredIgnoredProducts = useMemo(() => {
    if (!searchTerm) return ignoredProducts;
    const search = searchTerm.toLowerCase();
    return ignoredProducts.filter(item => 
      item.sku.toLowerCase().includes(search) ||
      item.reason?.toLowerCase().includes(search)
    );
  }, [ignoredProducts, searchTerm]);

  const handleSelectProduct = (sku: string, checked: boolean) => {
    const newSelected = new Set(selectedSkus);
    if (checked) {
      newSelected.add(sku);
    } else {
      newSelected.delete(sku);
    }
    setSelectedSkus(newSelected);
  };

  const handleSelectAll = (checked: boolean) => {
    if (checked) {
      const allSkus = new Set(filteredAvailableProducts.map(item => item.sku));
      setSelectedSkus(allSkus);
    } else {
      setSelectedSkus(new Set());
    }
  };

  const handleIgnoreProducts = async () => {
    if (selectedSkus.size === 0) {
      toast.error('Please select at least one product to ignore');
      return;
    }

    setProcessing(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error('Please log in to continue');
        return;
      }

      // Get upload_id from the first selected item
      const firstProduct = filteredAvailableProducts.find(p => selectedSkus.has(p.sku));
      const uploadId = firstProduct?.upload_id;

      const ignoreEntries = Array.from(selectedSkus).map(sku => ({
        user_id: user.id,
        sku,
        ignore_type: ignoreType,
        upload_id: ignoreType === 'upload' ? uploadId : null,
        reason: reason.trim() || null
      }));

      const { error } = await supabase
        .from('ignored_products')
        .insert(ignoreEntries);

      if (error) throw error;

      toast.success(`${selectedSkus.size} products ${ignoreType === 'permanent' ? 'permanently' : 'temporarily'} ignored`);
      setSelectedSkus(new Set());
      setIsIgnoreDialogOpen(false);
      setReason('');
      loadIgnoredProducts();
    } catch (error) {
      console.error('Error ignoring products:', error);
      toast.error('Failed to ignore products');
    } finally {
      setProcessing(false);
    }
  };

  const removeIgnoredProduct = async (id: string) => {
    try {
      const { error } = await supabase
        .from('ignored_products')
        .delete()
        .eq('id', id);

      if (error) throw error;

      toast.success('Product removed from ignore list');
      loadIgnoredProducts();
    } catch (error) {
      console.error('Error removing ignored product:', error);
      toast.error('Failed to remove product from ignore list');
    }
  };

  const isAllSelected = selectedSkus.size === filteredAvailableProducts.length && filteredAvailableProducts.length > 0;
  const isPartialSelected = selectedSkus.size > 0 && selectedSkus.size < filteredAvailableProducts.length;

  if (loading) {
    return <div>Loading ignored products...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Ban className="h-5 w-5" />
        <h2 className="text-xl font-semibold">Product Ignore Management</h2>
      </div>
      <p className="text-muted-foreground">
        Select products from your current inventory to ignore in future forecasts. 
        Ignored products can be managed and removed at any time.
      </p>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
        <Input
          placeholder="Search by SKU, product title, or supplier..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-10"
        />
      </div>

      {/* Available Products to Ignore */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Current Inventory Products</CardTitle>
            <p className="text-sm text-muted-foreground">
              Select products to ignore in future forecasts ({filteredAvailableProducts.length} products available)
            </p>
          </div>
          
          {selectedSkus.size > 0 && (
            <Dialog open={isIgnoreDialogOpen} onOpenChange={setIsIgnoreDialogOpen}>
              <DialogTrigger asChild>
                <Button variant="destructive">
                  <Ban className="h-4 w-4 mr-2" />
                  Ignore Selected ({selectedSkus.size})
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Ignore Selected Products</DialogTitle>
                </DialogHeader>
                <div className="space-y-4">
                  <div>
                    <Label className="text-sm font-medium">Ignore Type</Label>
                    <RadioGroup value={ignoreType} onValueChange={(value: 'permanent' | 'upload') => setIgnoreType(value)}>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="permanent" id="permanent" />
                        <Label htmlFor="permanent">Permanently (all future uploads)</Label>
                      </div>
                      <div className="flex items-center space-x-2">
                        <RadioGroupItem value="upload" id="upload" />
                        <Label htmlFor="upload">This upload only</Label>
                      </div>
                    </RadioGroup>
                  </div>
                  
                  <div>
                    <Label className="text-sm font-medium">Reason (optional)</Label>
                    <Textarea
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      placeholder="Why are these products being ignored?"
                      rows={3}
                    />
                  </div>
                  
                  <Button 
                    onClick={handleIgnoreProducts} 
                    disabled={processing}
                    className="w-full"
                  >
                    {processing ? 'Processing...' : `Ignore ${selectedSkus.size} Products`}
                  </Button>
                </div>
              </DialogContent>
            </Dialog>
          )}
        </CardHeader>
        <CardContent>
          {filteredAvailableProducts.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {availableProducts.length === 0 
                ? "No inventory data available. Please upload an inventory sheet first." 
                : "No products match your search criteria."}
            </p>
          ) : (
            <>
              {/* Select All */}
              <div className="flex items-center space-x-2 mb-4 p-3 border rounded-lg bg-muted/50">
                <Checkbox
                  id="select-all"
                  checked={isAllSelected}
                  onCheckedChange={handleSelectAll}
                  className={isPartialSelected ? "data-[state=checked]:bg-primary/50" : ""}
                />
                <Label htmlFor="select-all" className="font-medium">
                  Select All ({selectedSkus.size} of {filteredAvailableProducts.length} selected)
                </Label>
              </div>

              {/* Products Table */}
              <div className="space-y-2">
                <div className="grid grid-cols-12 gap-4 text-sm font-medium text-muted-foreground border-b pb-2">
                  <div className="col-span-1"></div>
                  <div className="col-span-2">SKU</div>
                  <div className="col-span-4">Product Title</div>
                  <div className="col-span-2">Current Sheet Supplier</div>
                  <div className="col-span-2">Upload Session</div>
                  <div className="col-span-1">Stock</div>
                </div>
                
                {filteredAvailableProducts.map((product) => (
                  <div key={product.sku} className="grid grid-cols-12 gap-4 items-center p-3 border rounded-lg hover:bg-muted/50">
                    <div className="col-span-1">
                      <Checkbox
                        id={`product-${product.sku}`}
                        checked={selectedSkus.has(product.sku)}
                        onCheckedChange={(checked) => handleSelectProduct(product.sku, checked as boolean)}
                      />
                    </div>
                    <div className="col-span-2 font-medium">{product.sku}</div>
                    <div className="col-span-4 text-sm">{product.title || 'No title'}</div>
                    <div className="col-span-2 text-sm">{product.supplier_name || 'Unassigned'}</div>
                    <div className="col-span-2 text-sm">{product.upload_session_name}</div>
                    <div className="col-span-1 text-sm">{product.fba_fbm_stock || 0}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Separator />

      {/* Ignored Products List */}
      <Card>
        <CardHeader>
          <CardTitle>Ignored Products</CardTitle>
          <p className="text-sm text-muted-foreground">
            Products that are currently ignored in forecasts ({filteredIgnoredProducts.length} total)
          </p>
        </CardHeader>
        <CardContent>
          {filteredIgnoredProducts.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">
              {ignoredProducts.length === 0 
                ? "No products are currently ignored." 
                : "No ignored products match your search criteria."}
            </p>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-4 text-sm font-medium text-muted-foreground border-b pb-2">
                <div className="col-span-2">SKU</div>
                <div className="col-span-2">Ignore Type</div>
                <div className="col-span-4">Reason</div>
                <div className="col-span-2">Date Added</div>
                <div className="col-span-2">Actions</div>
              </div>
              
              {filteredIgnoredProducts.map((product) => (
                <div key={product.id} className="grid grid-cols-12 gap-4 items-center p-3 border rounded-lg">
                  <div className="col-span-2 font-medium">{product.sku}</div>
                  <div className="col-span-2">
                    <Badge variant={product.ignore_type === 'permanent' ? 'destructive' : 'secondary'}>
                      {product.ignore_type}
                    </Badge>
                  </div>
                  <div className="col-span-4 text-sm">{product.reason || 'No reason provided'}</div>
                  <div className="col-span-2 text-sm">
                    {new Date(product.created_at).toLocaleDateString()}
                  </div>
                  <div className="col-span-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeIgnoredProduct(product.id)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Unlink2 className="h-4 w-4 mr-1" />
                      Remove
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
};