import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

interface SupplierInfo {
  id: string;
  name: string;
  company_name?: string;
  contact_person?: string;
  email?: string;
  phone?: string;
}

interface SkuSupplierMap {
  [sku: string]: SupplierInfo | null;
}

export const useSupplierMapping = () => {
  const [supplierMapping, setSupplierMapping] = useState<SkuSupplierMap>({});
  const [loading, setLoading] = useState(false);

  const fetchSupplierMapping = async (skus: string[]) => {
    if (skus.length === 0) return;
    
    setLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

      const { data, error } = await supabase
        .from('product_supplier_links')
        .select(`
          sku,
          supplier:suppliers(
            id,
            name,
            company_name,
            contact_person,
            email,
            phone
          )
        `)
        .eq('user_id', userData.user.id)
        .in('sku', skus);

      if (error) throw error;

      const mapping: SkuSupplierMap = {};
      
      // Initialize all SKUs with null (unassigned)
      skus.forEach(sku => {
        mapping[sku] = null;
      });

      // Override with actual supplier data where available
      data?.forEach(item => {
        if (item.supplier && item.sku) {
          mapping[item.sku] = item.supplier as SupplierInfo;
        }
      });

      setSupplierMapping(mapping);
    } catch (error) {
      console.error('Failed to fetch supplier mapping:', error);
    } finally {
      setLoading(false);
    }
  };

  return {
    supplierMapping,
    loading,
    fetchSupplierMapping,
  };
};