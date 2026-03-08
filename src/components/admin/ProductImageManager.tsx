import React, { useEffect } from 'react';
import { Plus, Upload, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { useProductImages } from '@/hooks/use-product-images';
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

interface ProductImageManagerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedProductId: string;
}

const ProductImageManager: React.FC<ProductImageManagerProps> = ({
  open,
  onOpenChange,
  selectedProductId
}) => {
  const { 
    isUploading, 
    getProductImages,
    handleImageUpload: uploadProductImage,
    clearImage: clearProductImage,
    usingLocalStorage,
    fetchProductImages
  } = useProductImages();
  
  // Refresh images when component opens
  useEffect(() => {
    if (open) {
      fetchProductImages();
    }
  }, [open, fetchProductImages]);
  
  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>, key: 'main' | 'gallery', index: number | null = null) => {
    const file = event.target.files?.[0];
    if (!file || !selectedProductId) return;
    
    try {
      const result = await uploadProductImage(file, selectedProductId, key, index);
      
      if (result.success) {
        toast({
          title: "Image uploaded",
          description: index !== null 
            ? `Gallery image ${index + 1} has been updated.` 
            : `Main product image has been updated.`,
        });
      }
    } catch (error: any) {
      toast({
        title: "Upload failed",
        description: error.message || "An error occurred during upload",
        variant: "destructive",
      });
    }
  };
  
  const handleClearImage = async (key: 'main' | 'gallery', index: number | null = null) => {
    if (!selectedProductId) return;
    
    try {
      const result = await clearProductImage(selectedProductId, key, index);
      
      if (result.success) {
        toast({
          title: "Image removed",
          description: index !== null 
            ? `Gallery image ${index + 1} has been removed.` 
            : `Main product image has been removed.`,
        });
      }
    } catch (error: any) {
      toast({
        title: "Error removing image",
        description: error.message || "An error occurred while removing the image",
        variant: "destructive",
      });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Manage Product Images</DialogTitle>
          <DialogDescription>
            Upload and manage images for your product.
          </DialogDescription>
        </DialogHeader>
        
        <Alert className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Local Storage Only</AlertTitle>
          <AlertDescription>
            Images are stored in your browser's local storage and will only be visible on this device.
          </AlertDescription>
        </Alert>
        
        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-medium mb-3">Main Product Image</h3>
            <div className="flex items-center gap-4">
              <div className="w-32 h-32 border rounded-md overflow-hidden flex items-center justify-center bg-gray-100">
                {getProductImages(selectedProductId).main ? (
                  <img 
                    src={getProductImages(selectedProductId).main || ""} 
                    alt="Main product" 
                    className="w-full h-full object-contain"
                  />
                ) : (
                  <Plus className="h-6 w-6 text-gray-400" />
                )}
              </div>
              <div className="flex gap-2 flex-col">
                <Button variant="outline" size="sm" asChild disabled={isUploading}>
                  <label className="cursor-pointer">
                    <Upload className="h-4 w-4 mr-1" />
                    {isUploading ? 'Uploading...' : 'Upload Main Image'}
                    <input
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      onChange={(e) => handleImageUpload(e, 'main')}
                      disabled={isUploading}
                    />
                  </label>
                </Button>
                {getProductImages(selectedProductId).main && (
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={() => handleClearImage('main')}
                    disabled={isUploading}
                  >
                    <Trash2 className="h-4 w-4 mr-1" />
                    Remove Image
                  </Button>
                )}
              </div>
            </div>
          </div>
          
          <div>
            <h3 className="text-sm font-medium mb-3">Gallery Images</h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {getProductImages(selectedProductId).gallery.map((image, index) => (
                <div key={index} className="relative group">
                  <div className="w-full h-32 border rounded-md overflow-hidden flex items-center justify-center bg-gray-100">
                    {image ? (
                      <img 
                        src={image} 
                        alt={`Gallery item ${index + 1}`} 
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <Plus className="h-6 w-6 text-gray-400" />
                    )}
                  </div>
                  <div className="flex justify-center mt-1 space-x-1">
                    <Button variant="outline" size="sm" className="w-full py-1 px-2" asChild disabled={isUploading}>
                      <label className="cursor-pointer">
                        <Upload className="h-3 w-3" />
                        <input
                          type="file"
                          accept="image/*"
                          className="sr-only"
                          onChange={(e) => handleImageUpload(e, 'gallery', index)}
                          disabled={isUploading}
                        />
                      </label>
                    </Button>
                    {image && (
                      <Button 
                        variant="outline" 
                        size="sm" 
                        className="w-full py-1 px-2"
                        onClick={() => handleClearImage('gallery', index)}
                        disabled={isUploading}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default ProductImageManager;
