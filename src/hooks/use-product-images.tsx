
import { useState, useEffect } from 'react';
import { toast } from "@/hooks/use-toast";
import { ProductImage, ProductImagesMap } from '@/types/product-images';
import { fileToBase64 } from '@/utils/image-utils';
import { ProductImageStorage } from '@/services/product-image-storage';

/**
 * Hook for managing product images
 */
export function useProductImages() {
  const [allProductImages, setAllProductImages] = useState<ProductImagesMap>({});
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [usingLocalStorage, setUsingLocalStorage] = useState(true);
  
  // Load images on hook mount
  useEffect(() => {
    fetchProductImages();
  }, []);
  
  // Get product images for a specific product
  const getProductImages = (productId: string): ProductImage => {
    return ProductImageStorage.getForProduct(productId, allProductImages);
  };
  
  // Fetch product images from localStorage
  const fetchProductImages = async () => {
    const images = ProductImageStorage.fetchAll();
    setAllProductImages(images);
    return images;
  };
  
  // Handle image upload
  const handleImageUpload = async (
    file: File | null, 
    productId: string, 
    key: 'main' | 'gallery', 
    index: number | null = null
  ) => {
    if (!file) return { success: false, error: 'No file selected' };
    
    setIsUploading(true);
    setUploadError('');
    
    try {
      // Convert file to base64 for local storage
      const imageUrl = await fileToBase64(file);
      
      // Update state with the new image URL
      const currentProductImages = getProductImages(productId);
      
      let updatedProductImages: ProductImage;
      
      if (key === 'gallery' && index !== null) {
        // Gallery image
        const updatedGallery = [...currentProductImages.gallery];
        updatedGallery[index] = imageUrl;
        
        updatedProductImages = {
          ...currentProductImages,
          gallery: updatedGallery
        };
      } else {
        // Main image
        updatedProductImages = {
          ...currentProductImages,
          main: imageUrl
        };
      }
      
      const updatedAllProductImages = {
        ...allProductImages,
        [productId]: updatedProductImages
      };
      
      // Update state
      setAllProductImages(updatedAllProductImages);
      
      // Save to localStorage
      ProductImageStorage.saveAll(updatedAllProductImages);
      
      toast({
        title: "Image Uploaded",
        description: index !== null
          ? `Gallery image ${index + 1} for product has been updated.`
          : `Main product image has been updated.`,
      });
      
      return { success: true };
    } catch (error: any) {
      console.error("Error uploading image:", error);
      setUploadError(error.message || "Upload failed");
      
      toast({
        title: "Upload Failed",
        description: error.message || "An error occurred during upload",
        variant: "destructive",
      });
      
      return { success: false, error: error.message };
    } finally {
      setIsUploading(false);
    }
  };
  
  // Clear image
  const clearImage = async (productId: string, key: 'main' | 'gallery', index: number | null = null) => {
    try {
      setIsUploading(true);
      setUploadError('');
      
      // Update local state
      const currentProductImages = getProductImages(productId);
      
      let updatedProductImages: ProductImage;
      
      if (key === 'gallery' && index !== null) {
        // Gallery image
        const updatedGallery = [...currentProductImages.gallery];
        updatedGallery[index] = null;
        
        updatedProductImages = {
          ...currentProductImages,
          gallery: updatedGallery
        };
      } else {
        // Main image
        updatedProductImages = {
          ...currentProductImages,
          main: null
        };
      }
      
      const updatedAllProductImages = {
        ...allProductImages,
        [productId]: updatedProductImages
      };
      
      // Update state
      setAllProductImages(updatedAllProductImages);
      
      // Update localStorage
      ProductImageStorage.saveAll(updatedAllProductImages);
      
      toast({
        title: "Image Removed",
        description: index !== null
          ? `Gallery image ${index + 1} has been removed.`
          : `Main product image has been removed.`,
      });
      
      return { success: true };
    } catch (error: any) {
      console.error("Error clearing image:", error);
      setUploadError(error.message || "Failed to remove image");
      
      toast({
        title: "Error Removing Image",
        description: error.message || "An error occurred while removing the image",
        variant: "destructive",
      });
      
      return { success: false, error: error.message };
    } finally {
      setIsUploading(false);
    }
  };
  
  return {
    allProductImages,
    isUploading,
    uploadError,
    setUploadError,
    usingLocalStorage,
    getProductImages,
    fetchProductImages,
    handleImageUpload,
    clearImage
  };
}
