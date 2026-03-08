import { useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { InventoryRawData, ForecastWithInventory, ForecastSettings } from '@/types/inventory';
import { calculateForecastForItems } from '@/utils/inventory-calculations';

export const useForecastCalculations = () => {
  const [loading, setLoading] = useState(false);
  const [forecastData, setForecastData] = useState<ForecastWithInventory[]>([]);
  const { toast } = useToast();

  const calculateAndSaveForecast = useCallback(async (
    inventoryData: InventoryRawData[], 
    forecastPeriodMonths: number = 3,
    settings?: Partial<ForecastSettings>
  ) => {
    setLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        throw new Error('User not authenticated');
      }

      const forecastCalculations = calculateForecastForItems(
        inventoryData, 
        userData.user.id, 
        forecastPeriodMonths, 
        settings
      );

      // Delete existing forecasts for this period first
      await supabase
        .from('forecast_calculations')
        .delete()
        .eq('user_id', userData.user.id)
        .eq('forecast_period_months', forecastPeriodMonths)
        .in('inventory_raw_id', inventoryData.map(item => item.id));

      // Insert new calculations
      const { data, error } = await supabase
        .from('forecast_calculations')
        .insert(forecastCalculations)
        .select(`
          *,
          inventory:uploaded_inventory_raw(*)
        `);

      if (error) throw error;

      setForecastData(data as ForecastWithInventory[]);
      
      toast({
        title: "Forecast Calculated",
        description: `Generated forecasts for ${data.length} SKUs.`,
      });

      return data;
    } catch (error: any) {
      toast({
        title: "Calculation Failed",
        description: error.message,
        variant: "destructive",
      });
      throw error;
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadForecastData = useCallback(async (forecastPeriodMonths: number = 3) => {
    setLoading(true);
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) return;

      const { data, error } = await supabase
        .from('forecast_calculations')
        .select(`
          *,
          inventory:uploaded_inventory_raw(*)
        `)
        .eq('user_id', userData.user.id)
        .eq('forecast_period_months', forecastPeriodMonths)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setForecastData(data as ForecastWithInventory[] || []);
    } catch (error: any) {
      console.error('Failed to load forecast data:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    loading,
    forecastData,
    calculateAndSaveForecast,
    loadForecastData,
    setForecastData,
  };
};