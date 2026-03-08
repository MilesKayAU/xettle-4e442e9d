
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export interface Product {
  id: string;
  title: string;
  description: string;
  category: string;
  slug: string;
  created_at?: string;
  updated_at?: string;
}

export interface ProductFormData {
  title: string;
  description: string;
  category: string;
}

/**
 * Service for managing products in Supabase
 */
export const ProductService = {
  /**
   * Fetch all products from Supabase
   */
  async fetchAll(): Promise<Product[]> {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) {
        console.error('Error fetching products:', error);
        throw new Error(`Failed to fetch products: ${error.message}`);
      }

      return data || [];
    } catch (error) {
      console.error('Error in fetchAll products:', error);
      return [];
    }
  },

  /**
   * Get a single product by slug
   */
  async getBySlug(slug: string): Promise<Product | null> {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('slug', slug)
        .maybeSingle();

      if (error) {
        console.error('Error fetching product by slug:', error);
        throw new Error(`Failed to fetch product: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('Error in getBySlug:', error);
      return null;
    }
  },

  /**
   * Create a new product
   */
  async create(productData: ProductFormData): Promise<Product | null> {
    try {
      // Generate slug from title
      const slug = productData.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

      const { data, error } = await supabase
        .from('products')
        .insert([{
          title: productData.title,
          description: productData.description,
          category: productData.category,
          slug: slug
        }])
        .select()
        .single();

      if (error) {
        console.error('Error creating product:', error);
        throw new Error(`Failed to create product: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('Error in create product:', error);
      return null;
    }
  },

  /**
   * Update an existing product
   */
  async update(id: string, productData: ProductFormData): Promise<Product | null> {
    try {
      // Generate slug from title
      const slug = productData.title
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/(^-|-$)/g, '');

      const { data, error } = await supabase
        .from('products')
        .update({
          title: productData.title,
          description: productData.description,
          category: productData.category,
          slug: slug,
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();

      if (error) {
        console.error('Error updating product:', error);
        throw new Error(`Failed to update product: ${error.message}`);
      }

      return data;
    } catch (error) {
      console.error('Error in update product:', error);
      return null;
    }
  },

  /**
   * Delete a product
   */
  async delete(id: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('products')
        .delete()
        .eq('id', id);

      if (error) {
        console.error('Error deleting product:', error);
        throw new Error(`Failed to delete product: ${error.message}`);
      }

      return true;
    } catch (error) {
      console.error('Error in delete product:', error);
      return false;
    }
  },

  /**
   * Initialize default products if none exist
   */
  async initializeDefaultProducts(): Promise<void> {
    try {
      const existingProducts = await this.fetchAll();
      
      if (existingProducts.length === 0) {
        const defaultProducts = [
          {
            title: "Coffee Machine Cleaning Tablets",
            description: "Industrial cleaning tablets for coffee machines",
            category: "Cleaning",
            slug: "coffee-tablets"
          },
          {
            title: "Descalers",
            description: "Powerful descaling solution for commercial machines",
            category: "Maintenance",
            slug: "descalers"
          },
          {
            title: "PVA Solutions",
            description: "Professional strength cleaning solutions",
            category: "Cleaning",
            slug: "pva-solutions"
          }
        ];

        for (const product of defaultProducts) {
          await this.create(product);
        }

        console.log('Default products initialized');
      }
    } catch (error) {
      console.error('Error initializing default products:', error);
    }
  }
};
