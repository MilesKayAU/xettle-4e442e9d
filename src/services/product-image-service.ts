
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export interface ProductImage {
  main: string | null;
  gallery: (string | null)[];
}

/**
 * Service for managing product images in Supabase Storage
 */
export const ProductImageService = {
  /**
   * Initialize storage bucket if it doesn't exist
   */
  async initializeBucket(): Promise<void> {
    try {
      const { data: buckets, error: listError } = await supabase.storage.listBuckets();
      
      if (listError) {
        console.error('Error listing buckets:', listError);
        return;
      }
      
      const bucketExists = buckets?.some(bucket => bucket.name === 'product-images');
      
      if (!bucketExists) {
        const { error: createError } = await supabase.storage.createBucket('product-images', {
          public: true,
          allowedMimeTypes: ['image/*'],
          fileSizeLimit: 5242880 // 5MB
        });
        
        if (createError) {
          console.error('Error creating bucket:', createError);
        } else {
          console.log('Product images bucket created successfully');
        }
      }
    } catch (error) {
      console.error('Error initializing bucket:', error);
    }
  },

  /**
   * Get product images for a specific product
   */
  async getProductImages(productSlug: string): Promise<ProductImage> {
    try {
      // Initialize bucket first
      await this.initializeBucket();
      
      const { data: files, error } = await supabase.storage
        .from('product-images')
        .list(productSlug, {
          limit: 10,
          sortBy: { column: 'name', order: 'asc' }
        });

      if (error) {
        console.error('Error fetching product images:', error);
        return this.getDefaultProductImage();
      }

      const images: ProductImage = {
        main: null,
        gallery: [null, null, null, null]
      };

      if (files && files.length > 0) {
        for (const file of files) {
          // Add timestamp to prevent caching issues
          const timestamp = new Date().getTime();
          const { data: { publicUrl } } = supabase.storage
            .from('product-images')
            .getPublicUrl(`${productSlug}/${file.name}?t=${timestamp}`);

          if (file.name.includes('main')) {
            images.main = publicUrl;
          } else if (file.name.includes('gallery')) {
            const galleryMatch = file.name.match(/gallery-(\d+)/);
            if (galleryMatch) {
              const galleryIndex = parseInt(galleryMatch[1]);
              if (galleryIndex < 4) {
                images.gallery[galleryIndex] = publicUrl;
              }
            }
          }
        }
      }

      return images;
    } catch (error) {
      console.error('Error in getProductImages:', error);
      return this.getDefaultProductImage();
    }
  },

  /**
   * Upload an image for a product
   */
  async uploadImage(
    file: File,
    productSlug: string,
    imageType: 'main' | 'gallery',
    galleryIndex?: number
  ): Promise<{ success: boolean; url?: string; error?: string }> {
    try {
      // Initialize bucket first
      await this.initializeBucket();
      
      const fileExt = file.name.split('.').pop();
      const fileName = imageType === 'main' 
        ? `main.${fileExt}` 
        : `gallery-${galleryIndex}.${fileExt}`;
      
      const filePath = `${productSlug}/${fileName}`;

      console.log('Uploading file to path:', filePath);

      // First, try to remove any existing file with the same path
      await this.deleteImage(productSlug, imageType, galleryIndex);

      // Upload new file
      const { data, error: uploadError } = await supabase.storage
        .from('product-images')
        .upload(filePath, file, {
          upsert: true,
          cacheControl: '0' // Prevent caching
        });

      if (uploadError) {
        console.error('Upload error:', uploadError);
        return { success: false, error: uploadError.message };
      }

      // Get public URL with timestamp to prevent caching
      const timestamp = new Date().getTime();
      const { data: { publicUrl } } = supabase.storage
        .from('product-images')
        .getPublicUrl(`${filePath}?t=${timestamp}`);

      console.log('Upload successful, public URL:', publicUrl);
      return { success: true, url: publicUrl };
    } catch (error: any) {
      console.error('Error uploading image:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Delete an image for a product
   */
  async deleteImage(
    productSlug: string,
    imageType: 'main' | 'gallery',
    galleryIndex?: number
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const fileName = imageType === 'main' 
        ? 'main' 
        : `gallery-${galleryIndex}`;
      
      console.log('Looking for files to delete with prefix:', fileName);
      
      // List files to find the exact filename with extension
      const { data: files, error: listError } = await supabase.storage
        .from('product-images')
        .list(productSlug);

      if (listError) {
        console.error('List error:', listError);
        return { success: false, error: listError.message };
      }

      console.log('Found files:', files);

      const fileToDelete = files?.find(file => file.name.startsWith(fileName));
      
      if (!fileToDelete) {
        console.log('No file found to delete');
        return { success: true }; // File doesn't exist, consider it deleted
      }

      const filePath = `${productSlug}/${fileToDelete.name}`;
      console.log('Deleting file:', filePath);

      const { error: deleteError } = await supabase.storage
        .from('product-images')
        .remove([filePath]);

      if (deleteError) {
        console.error('Delete error:', deleteError);
        return { success: false, error: deleteError.message };
      }

      console.log('File deleted successfully');
      return { success: true };
    } catch (error: any) {
      console.error('Error deleting image:', error);
      return { success: false, error: error.message };
    }
  },

  /**
   * Get default product image structure
   */
  getDefaultProductImage(): ProductImage {
    return {
      main: null,
      gallery: [null, null, null, null]
    };
  }
};
