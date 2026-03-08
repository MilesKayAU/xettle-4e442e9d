
import { useState, useEffect } from 'react';
import { ProductService, Product } from '@/services/product-service';
import { toast } from "@/hooks/use-toast";

/**
 * Hook for managing products with Supabase
 */
export function useProducts() {
  const [products, setProducts] = useState<Product[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Fetch products from Supabase
  const fetchProducts = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await ProductService.fetchAll();
      setProducts(data);
    } catch (err: any) {
      console.error('Error fetching products:', err);
      setError(err.message);
      toast({
        title: "Error loading products",
        description: "Failed to load products from database",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  // Initialize products on mount
  useEffect(() => {
    const initializeProducts = async () => {
      // Initialize default products if needed
      await ProductService.initializeDefaultProducts();
      // Then fetch all products
      await fetchProducts();
    };

    initializeProducts();
  }, []);

  return {
    products,
    setProducts,
    isLoading,
    error,
    fetchProducts
  };
}
