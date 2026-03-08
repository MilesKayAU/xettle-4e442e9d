import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { InventoryRawData } from '@/types/inventory';

export const useInventoryData = () => {
  const [loading, setLoading] = useState(false);
  const [uploadedData, setUploadedData] = useState<InventoryRawData[]>([]);
  const { toast } = useToast();

  const loadUserInventoryData = useCallback(async () => {
    setLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

      const { data, error } = await supabase
        .from('uploaded_inventory_raw')
        .select('*')
        .eq('user_id', userData.user.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setUploadedData(data || []);
    } catch (error: any) {
      console.error('Failed to load inventory data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const updateInventoryItem = useCallback(async (id: string, updates: Partial<InventoryRawData>) => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

      const { error } = await supabase
        .from('uploaded_inventory_raw')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', userData.user.id);

      if (error) throw error;

      // Update local state
      setUploadedData(prev => 
        prev.map(item => 
          item.id === id ? { ...item, ...updates } : item
        )
      );
    } catch (error: any) {
      toast({
        title: "Update Failed",
        description: error.message,
        variant: "destructive",
      });
      throw error;
    }
  }, [toast]);

  const clearUserData = useCallback(async () => {
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

      await supabase
        .from('uploaded_inventory_raw')
        .delete()
        .eq('user_id', userData.user.id);

      setUploadedData([]);
      
      toast({
        title: "Data Cleared",
        description: "All inventory data has been cleared.",
      });
    } catch (error: any) {
      toast({
        title: "Clear Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  }, [toast]);

  return {
    loading,
    uploadedData,
    loadUserInventoryData,
    updateInventoryItem,
    clearUserData,
    setUploadedData,
  };
};