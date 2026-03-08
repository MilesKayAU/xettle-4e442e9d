import { useInventoryUpload } from './use-inventory-upload';
import { useForecastCalculations } from './use-forecast-calculations';
import { useInventoryData } from './use-inventory-data';

// Re-export types for backward compatibility
export type { 
  InventoryRawData, 
  ForecastCalculation, 
  ForecastWithInventory,
  ForecastSettings 
} from '@/types/inventory';

// Re-export constants for backward compatibility
export { COLUMN_MAPPING } from '@/constants/inventory-mapping';

export const useInventoryDatabase = () => {
  const uploadHook = useInventoryUpload();
  const forecastHook = useForecastCalculations();
  const dataHook = useInventoryData();

  // Combine loading states
  const loading = uploadHook.loading || forecastHook.loading || dataHook.loading;

  return {
    // Combined state
    loading,
    uploadedData: dataHook.uploadedData,
    forecastData: forecastHook.forecastData,
    
    // Upload operations
    saveInventoryData: uploadHook.saveInventoryData,
    
    // Forecast operations
    calculateAndSaveForecast: forecastHook.calculateAndSaveForecast,
    loadForecastData: forecastHook.loadForecastData,
    
    // Data operations
    loadUserInventoryData: dataHook.loadUserInventoryData,
    updateInventoryItem: dataHook.updateInventoryItem,
    clearUserData: dataHook.clearUserData,
  };
};