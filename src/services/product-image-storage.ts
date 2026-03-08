
import { ProductImage, ProductImagesMap } from '@/types/product-images';
import { getDefaultProductImage } from '@/utils/image-utils';

/**
 * Service for managing product image storage
 */
export const ProductImageStorage = {
  /**
   * Fetch all product images from localStorage
   */
  fetchAll: (): ProductImagesMap => {
    try {
      const savedImages = localStorage.getItem('allProductImages');
      if (savedImages) {
        try {
          const parsedImages = JSON.parse(savedImages);
          console.log("Loaded images from localStorage:", parsedImages);
          return parsedImages;
        } catch (error) {
          console.error("Error parsing product images from localStorage:", error);
          // Initialize with empty object if parsing fails
          localStorage.setItem('allProductImages', JSON.stringify({}));
          return {};
        }
      } else {
        // Initialize empty storage if none exists
        localStorage.setItem('allProductImages', JSON.stringify({}));
        return {};
      }
    } catch (error) {
      console.error("Error in fetchProductImages:", error);
      return {};
    }
  },

  /**
   * Get product images for a specific product
   */
  getForProduct: (productId: string, allImages: ProductImagesMap): ProductImage => {
    return allImages[productId] || getDefaultProductImage();
  },

  /**
   * Save all product images to localStorage
   */
  saveAll: (images: ProductImagesMap): void => {
    localStorage.setItem('allProductImages', JSON.stringify(images));
  }
};
