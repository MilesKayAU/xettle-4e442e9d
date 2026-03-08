
import { useState, useEffect } from 'react';
import { ProductImageService, ProductImage } from '@/services/product-image-service';
import { toast } from "@/hooks/use-toast";

/**
 * Hook for managing product images with Supabase Storage
 */
export function useProductImagesSupabase() {
  const [productImages, setProductImages] = useState<{ [slug: string]: ProductImage }>({});
  const [isUploading, setIsUploading] = useState(false);

  // Get product images for a specific product
  const getProductImages = async (productSlug: string, forceRefresh = false): Promise<ProductImage> => {
    if (productImages[productSlug] && !forceRefresh) {
      return productImages[productSlug];
    }

    try {
      const images = await ProductImageService.getProductImages(productSlug);
      setProductImages(prev => ({ ...prev, [productSlug]: images }));
      return images;
    } catch (error) {
      console.error('Error getting product images:', error);
      return ProductImageService.getDefaultProductImage();
    }
  };

  // Force refresh images for a product
  const refreshProductImages = async (productSlug: string) => {
    try {
      const images = await ProductImageService.getProductImages(productSlug);
      setProductImages(prev => ({ ...prev, [productSlug]: images }));
      return images;
    } catch (error) {
      console.error('Error refreshing product images:', error);
      return ProductImageService.getDefaultProductImage();
    }
  };

  // Upload an image
  const uploadImage = async (
    file: File,
    productSlug: string,
    imageType: 'main' | 'gallery',
    galleryIndex?: number
  ) => {
    setIsUploading(true);
    try {
      const result = await ProductImageService.uploadImage(file, productSlug, imageType, galleryIndex);
      
      if (result.success) {
        // Force refresh images for this product
        await refreshProductImages(productSlug);
        
        toast({
          title: "Image uploaded",
          description: imageType === 'main' ? "Main image updated" : `Gallery image ${(galleryIndex || 0) + 1} updated`,
        });
      } else {
        throw new Error(result.error);
      }

      return result;
    } catch (error: any) {
      toast({
        title: "Upload failed",
        description: error.message,
        variant: "destructive",
      });
      return { success: false, error: error.message };
    } finally {
      setIsUploading(false);
    }
  };

  // Delete an image
  const deleteImage = async (
    productSlug: string,
    imageType: 'main' | 'gallery',
    galleryIndex?: number
  ) => {
    setIsUploading(true);
    try {
      const result = await ProductImageService.deleteImage(productSlug, imageType, galleryIndex);
      
      if (result.success) {
        // Force refresh images for this product
        await refreshProductImages(productSlug);
        
        toast({
          title: "Image removed",
          description: imageType === 'main' ? "Main image removed" : `Gallery image ${(galleryIndex || 0) + 1} removed`,
        });
      } else {
        throw new Error(result.error);
      }

      return result;
    } catch (error: any) {
      toast({
        title: "Delete failed",
        description: error.message,
        variant: "destructive",
      });
      return { success: false, error: error.message };
    } finally {
      setIsUploading(false);
    }
  };

  return {
    getProductImages,
    refreshProductImages,
    uploadImage,
    deleteImage,
    isUploading
  };
}
