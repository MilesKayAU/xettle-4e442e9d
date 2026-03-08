
import React, { useEffect, useState } from 'react';
import { Plus, Upload, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useProductImagesSupabase } from '@/hooks/use-product-images-supabase';
import { ProductImage } from '@/services/product-image-service';
import { toast } from "@/hooks/use-toast";

interface ProductImageManagerSupabaseProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  productSlug: string;
}

const ProductImageManagerSupabase: React.FC<ProductImageManagerSupabaseProps> = ({
  open,
  onOpenChange,
  productSlug
}) => {
  const { getProductImages, refreshProductImages, uploadImage, deleteImage, isUploading } = useProductImagesSupabase();
  const [images, setImages] = useState<ProductImage>({ main: null, gallery: [null, null, null, null] });
  const [isLoading, setIsLoading] = useState(false);
  const [imageKey, setImageKey] = useState(0); // Force image re-render
  
  // Load images when dialog opens
  useEffect(() => {
    if (open && productSlug) {
      loadImages();
    }
  }, [open, productSlug]);

  const loadImages = async () => {
    setIsLoading(true);
    try {
      console.log('Loading images for product:', productSlug);
      const productImages = await getProductImages(productSlug, true); // Force refresh
      console.log('Loaded images:', productImages);
      setImages(productImages);
      setImageKey(prev => prev + 1); // Force re-render of images
    } catch (error) {
      console.error('Error loading images:', error);
      toast({
        title: "Error loading images",
        description: "Failed to load product images",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleImageUpload = async (event: React.ChangeEvent<HTMLInputElement>, imageType: 'main' | 'gallery', galleryIndex?: number) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    console.log('Uploading image:', { file: file.name, imageType, galleryIndex, productSlug });
    
    const result = await uploadImage(file, productSlug, imageType, galleryIndex);
    if (result.success) {
      console.log('Upload successful, reloading images');
      await loadImages(); // Refresh images and force re-render
    } else {
      console.error('Upload failed:', result.error);
    }
    
    // Clear the input
    event.target.value = '';
  };
  
  const handleDeleteImage = async (imageType: 'main' | 'gallery', galleryIndex?: number) => {
    console.log('Deleting image:', { imageType, galleryIndex, productSlug });
    
    const result = await deleteImage(productSlug, imageType, galleryIndex);
    if (result.success) {
      console.log('Delete successful, reloading images');
      await loadImages(); // Refresh images and force re-render
    } else {
      console.error('Delete failed:', result.error);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Manage Product Images - {productSlug}</DialogTitle>
          <DialogDescription>
            Upload and manage images for your product using Supabase Storage.
          </DialogDescription>
        </DialogHeader>
        
        <Alert className="mb-4">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Cloud Storage</AlertTitle>
          <AlertDescription>
            Images are stored in Supabase Storage and will be available across all devices.
          </AlertDescription>
        </Alert>
        
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <p>Loading images...</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-medium mb-3">Main Product Image</h3>
              <div className="flex items-center gap-4">
                <div className="w-32 h-32 border rounded-md overflow-hidden flex items-center justify-center bg-gray-100">
                  {images.main ? (
                    <img 
                      key={`main-${imageKey}`}
                      src={images.main} 
                      alt="Main product" 
                      className="w-full h-full object-contain"
                      onError={(e) => {
                        console.error('Error loading main image:', e);
                        e.currentTarget.style.display = 'none';
                      }}
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
                  {images.main && (
                    <Button 
                      variant="outline" 
                      size="sm" 
                      onClick={() => handleDeleteImage('main')}
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
                {images.gallery.map((image, index) => (
                  <div key={index} className="relative group">
                    <div className="w-full h-32 border rounded-md overflow-hidden flex items-center justify-center bg-gray-100">
                      {image ? (
                        <img 
                          key={`gallery-${index}-${imageKey}`}
                          src={image} 
                          alt={`Gallery item ${index + 1}`} 
                          className="w-full h-full object-contain"
                          onError={(e) => {
                            console.error(`Error loading gallery image ${index}:`, e);
                            e.currentTarget.style.display = 'none';
                          }}
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
                          onClick={() => handleDeleteImage('gallery', index)}
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
        )}
      </DialogContent>
    </Dialog>
  );
};

export default ProductImageManagerSupabase;
