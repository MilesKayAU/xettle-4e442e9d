import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { InventoryRawData } from '@/types/inventory';
import { COLUMN_MAPPING } from '@/constants/inventory-mapping';

export const useInventoryUpload = () => {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const saveInventoryData = useCallback(async (rawData: any[], sessionName: string): Promise<InventoryRawData[]> => {
    setLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        throw new Error('User not authenticated');
      }

      const uploadId = crypto.randomUUID();
      
      // Normalize and map the data to database columns
      const inventoryData = rawData.map(row => {
        const normalizedRow: any = {
          user_id: userData.user.id,
          upload_id: uploadId,
          upload_session_name: sessionName,
          sku: row['SKU'] || '',
          fba_fbm_stock: parseInt(row['FBA/FBM Stock']) || 0,
          stock_value: parseFloat(row['Stock value']) || 0,
          estimated_sales_velocity: parseFloat(row['Estimated Sales Velocity']) || 1,
          margin: parseFloat(row['Margin']) || 0,
        };

        // Map all other columns using the column mapping
        Object.entries(COLUMN_MAPPING).forEach(([excelCol, dbCol]) => {
          if (row[excelCol] !== undefined && row[excelCol] !== '') {
            if (dbCol.includes('_days') || dbCol.includes('_stock') || dbCol.includes('quantity')) {
              normalizedRow[dbCol] = parseInt(row[excelCol]) || null;
            } else if (dbCol.includes('percent') || dbCol.includes('value') || dbCol.includes('profit')) {
              normalizedRow[dbCol] = parseFloat(row[excelCol]) || null;
            } else {
              normalizedRow[dbCol] = row[excelCol];
            }
          }
        });

        return normalizedRow;
      });

      const { data, error } = await supabase
        .from('uploaded_inventory_raw')
        .insert(inventoryData)
        .select();

      if (error) throw error;

      toast({
        title: "Data Saved",
        description: `Successfully saved ${data.length} inventory items to database.`,
      });

      return data;
    } catch (error: any) {
      toast({
        title: "Save Failed",
        description: error.message,
        variant: "destructive",
      });
      throw error;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  return {
    loading,
    saveInventoryData,
  };
};