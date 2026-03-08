import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ForecastWithInventory, InventoryRawData } from '@/types/inventory';
import { Tables } from '@/integrations/supabase/types';

type IgnoredProduct = Pick<Tables<'ignored_products'>, 'id' | 'sku' | 'ignore_type' | 'upload_id'>;

export const useIgnoredProducts = () => {
  const [ignoredProducts, setIgnoredProducts] = useState<IgnoredProduct[]>([]);
  const [loading, setLoading] = useState(true);

  const loadIgnoredProducts = async () => {
    try {
      const { data, error } = await supabase
        .from('ignored_products')
        .select('id, sku, ignore_type, upload_id');

      if (error) throw error;
      setIgnoredProducts(data || []);
    } catch (error) {
      console.error('Error loading ignored products:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadIgnoredProducts();
  }, []);

  const filterInventoryData = (inventoryData: InventoryRawData[]): InventoryRawData[] => {
    return inventoryData.filter(item => {
      // Check if this SKU is permanently ignored
      const permanentlyIgnored = ignoredProducts.some(ignored => 
        ignored.sku === item.sku && ignored.ignore_type === 'permanent'
      );

      if (permanentlyIgnored) return false;

      // Check if this SKU is ignored for this specific upload
      const uploadIgnored = ignoredProducts.some(ignored => 
        ignored.sku === item.sku && 
        ignored.ignore_type === 'upload' && 
        ignored.upload_id === item.upload_id
      );

      return !uploadIgnored;
    });
  };

  const filterForecastData = (forecastData: ForecastWithInventory[]): ForecastWithInventory[] => {
    return forecastData.filter(item => {
      // Check if this SKU is permanently ignored
      const permanentlyIgnored = ignoredProducts.some(ignored => 
        ignored.sku === item.inventory.sku && ignored.ignore_type === 'permanent'
      );

      if (permanentlyIgnored) return false;

      // Check if this SKU is ignored for this specific upload
      const uploadIgnored = ignoredProducts.some(ignored => 
        ignored.sku === item.inventory.sku && 
        ignored.ignore_type === 'upload' && 
        ignored.upload_id === item.inventory.upload_id
      );

      return !uploadIgnored;
    });
  };

  return {
    ignoredProducts,
    loading,
    loadIgnoredProducts,
    filterInventoryData,
    filterForecastData
  };
};