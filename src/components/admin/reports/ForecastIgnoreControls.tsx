import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { EyeOff, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { ForecastWithInventory } from '@/types/inventory';
import { 
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface ForecastIgnoreControlsProps {
  forecastData: ForecastWithInventory[];
  onIgnoreProducts: () => void;
}

export const ForecastIgnoreControls: React.FC<ForecastIgnoreControlsProps> = ({
  forecastData,
  onIgnoreProducts
}) => {
  const [selectedSkus, setSelectedSkus] = useState<Set<string>>(new Set());
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [ignoreType, setIgnoreType] = useState<'permanent' | 'upload'>('upload');
  const [reason, setReason] = useState('');
  const [processing, setProcessing] = useState(false);

  const handleSelectSku = (sku: string, checked: boolean) => {
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
      const allSkus = new Set(forecastData.map(item => item.inventory.sku));
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

      // Get upload_id from the first item (all items should have the same upload_id)
      const uploadId = forecastData[0]?.inventory.upload_id;

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
      setIsDialogOpen(false);
      setReason('');
      onIgnoreProducts();
    } catch (error) {
      console.error('Error ignoring products:', error);
      toast.error('Failed to ignore products');
    } finally {
      setProcessing(false);
    }
  };

  const isAllSelected = selectedSkus.size === forecastData.length && forecastData.length > 0;
  const isPartialSelected = selectedSkus.size > 0 && selectedSkus.size < forecastData.length;

  return (
    <Card className="mb-6">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <EyeOff className="h-5 w-5" />
          Product Ignore Controls
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <Checkbox
                id="select-all"
                checked={isAllSelected}
                onCheckedChange={handleSelectAll}
                className={isPartialSelected ? "data-[state=checked]:bg-primary/50" : ""}
              />
              <Label htmlFor="select-all" className="font-medium">
                Select All ({selectedSkus.size} of {forecastData.length} selected)
              </Label>
            </div>
            
            {selectedSkus.size > 0 && (
              <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
                <DialogTrigger asChild>
                  <Button variant="destructive" size="sm">
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
                          <RadioGroupItem value="upload" id="upload" />
                          <Label htmlFor="upload">This upload only</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                          <RadioGroupItem value="permanent" id="permanent" />
                          <Label htmlFor="permanent">Permanently (all future uploads)</Label>
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
                    
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">Products to ignore:</Label>
                      <div className="max-h-32 overflow-y-auto border rounded p-2 space-y-1">
                        {Array.from(selectedSkus).map(sku => {
                          const item = forecastData.find(f => f.inventory.sku === sku);
                          return (
                            <div key={sku} className="text-sm">
                              <span className="font-medium">{sku}</span>
                              {item?.inventory.title && (
                                <span className="text-muted-foreground ml-2">- {item.inventory.title}</span>
                              )}
                            </div>
                          );
                        })}
                      </div>
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
          </div>

          {selectedSkus.size > 0 && (
            <div className="flex flex-wrap gap-2">
              {Array.from(selectedSkus).slice(0, 10).map(sku => (
                <Badge key={sku} variant="secondary" className="cursor-pointer" onClick={() => handleSelectSku(sku, false)}>
                  {sku} ×
                </Badge>
              ))}
              {selectedSkus.size > 10 && (
                <Badge variant="outline">
                  +{selectedSkus.size - 10} more
                </Badge>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 gap-2 max-h-64 overflow-y-auto">
            {forecastData.map((item) => (
              <div key={item.inventory.sku} className="flex items-center space-x-2 p-2 border rounded">
                <Checkbox
                  id={`product-${item.inventory.sku}`}
                  checked={selectedSkus.has(item.inventory.sku)}
                  onCheckedChange={(checked) => handleSelectSku(item.inventory.sku, checked as boolean)}
                />
                <Label htmlFor={`product-${item.inventory.sku}`} className="flex-1 cursor-pointer">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="font-medium">{item.inventory.sku}</span>
                      {item.inventory.title && (
                        <span className="text-sm text-muted-foreground ml-2">{item.inventory.title}</span>
                      )}
                    </div>
                    <Badge variant={item.urgency_level === 'critical' ? 'destructive' : 
                                   item.urgency_level === 'warning' ? 'default' : 'secondary'}>
                      {item.urgency_level}
                    </Badge>
                  </div>
                </Label>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
};