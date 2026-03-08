import { InventoryRawData, ForecastSettings } from '@/types/inventory';
import { DEFAULT_FORECAST_SETTINGS } from '@/constants/inventory-mapping';

export interface CalculatedForecast {
  user_id: string;
  inventory_raw_id: string;
  forecast_period_months: number;
  cog_per_unit: number;
  days_of_stock_remaining: number;
  forecasted_sales: number;
  reorder_quantity_required: number;
  forecasted_profit: number;
  missed_profit: number;
  total_cashflow_required: number;
  urgency_level: 'critical' | 'warning' | 'good' | 'inactive';
  stockout_risk_days?: number;
  stockout_warning?: string;
}

export const calculateForecastForItem = (
  item: InventoryRawData,
  userId: string,
  forecastPeriodMonths: number = 3,
  settings?: Partial<ForecastSettings & { calculationMode?: 'from_today' | 'post_arrival' }>
): CalculatedForecast => {
  const {
    DAYS_PER_MONTH,
    DEFAULT_LEAD_TIME,
    DEFAULT_BUFFER_DAYS,
    SAFETY_STOCK_MULTIPLIER,
  } = DEFAULT_FORECAST_SETTINGS;

  const leadTimeDays = settings?.leadTimeDays ?? item.manuf_time_days ?? DEFAULT_LEAD_TIME;
  const bufferDays = settings?.bufferDays ?? item.fba_buffer_days ?? DEFAULT_BUFFER_DAYS;
  const safetyMultiplier = settings?.safetyStockMultiplier ?? SAFETY_STOCK_MULTIPLIER;
  const calculationMode = settings?.calculationMode ?? 'post_arrival';
  const totalLeadTime = leadTimeDays + bufferDays;

  // Parse and validate input values
  const baseStock = Math.max(0, item.fba_fbm_stock || 0);
  const orderedStock = Math.max(0, item.ordered || 0);
  const reservedStock = Math.max(0, item.reserved || 0);
  const sentToFba = Math.max(0, item.sent_to_fba || 0);
  
  // Calculate effective current stock: base stock + ordered goods + sent to FBA - reserved goods
  const currentStock = Math.max(0, baseStock + orderedStock + sentToFba - reservedStock);
  
  const stockValue = Math.max(0, item.stock_value || 0);
  const salesVelocity = Math.max(0, item.estimated_sales_velocity || 0);
  const margin = item.margin || 0;
  const roiPercent = item.roi_percent || 0;

  // Cost calculations - COG = Stock value / FBA/FBM Stock
  const cogPerUnit = (currentStock > 0 && stockValue > 0) ? Number((stockValue / currentStock).toFixed(2)) : 0;
  
  // Days of stock remaining calculation
  const daysOfStockRemaining = (salesVelocity > 0 && currentStock > 0) 
    ? Number((currentStock / salesVelocity).toFixed(1)) 
    : (currentStock > 0 ? 999999 : 0);

  // Forecast calculations with improved lead time consideration
  const forecastPeriodDays = DAYS_PER_MONTH * forecastPeriodMonths;
  const forecastedSales = Number((salesVelocity * forecastPeriodDays).toFixed(1));
  const dailySalesRate = salesVelocity;
  const leadTimeWithBuffer = totalLeadTime;
  
  // Determine urgency level first (needed for reorder calculation)
  let urgencyLevel: 'critical' | 'warning' | 'good' | 'inactive';
  let stockoutRiskDays = 0;
  let stockoutWarning = '';
  
  // Calculate dynamic thresholds based on forecast period and lead time
  const criticalThreshold = forecastPeriodDays + leadTimeWithBuffer;
  const warningThreshold = forecastPeriodDays * 1.5 + leadTimeWithBuffer;

  // Determine urgency level with improved logic based on custom forecast period
  if (dailySalesRate === 0 || currentStock === 0) {
    urgencyLevel = 'inactive';
  } else {
    // Check if current stock will last through lead time
    const stockDaysRemaining = currentStock / dailySalesRate;
    
    if (stockDaysRemaining < leadTimeWithBuffer) {
      // Will run out of stock during lead time
      stockoutRiskDays = Math.ceil(leadTimeWithBuffer - stockDaysRemaining);
      stockoutWarning = `⚠ Estimated stockout for ${stockoutRiskDays} days before new inventory arrives`;
      urgencyLevel = 'critical';
    } else if (daysOfStockRemaining < criticalThreshold) {
      urgencyLevel = 'critical';
    } else if (daysOfStockRemaining < warningThreshold) {
      urgencyLevel = 'warning';
    } else {
      urgencyLevel = 'good';
    }
  }

  // Calculate reorder quantity based on urgency level and calculation mode
  let reorderQuantityRequired: number = 0;
  
  if (urgencyLevel === 'critical') {
    // Critical items: Full reorder calculation
    if (calculationMode === 'from_today') {
      const totalDemandFromToday = dailySalesRate * forecastPeriodDays;
      reorderQuantityRequired = Math.max(0, totalDemandFromToday - currentStock);
    } else {
      const salesDuringLeadTime = dailySalesRate * leadTimeWithBuffer;
      const demandAfterArrival = dailySalesRate * forecastPeriodDays;
      const totalDemandIncludingLeadTime = demandAfterArrival + salesDuringLeadTime;
      reorderQuantityRequired = Math.max(0, totalDemandIncludingLeadTime - currentStock);
    }
    
    // Apply safety stock multiplier for critical items
    if (safetyMultiplier && safetyMultiplier > 1) {
      reorderQuantityRequired = Math.ceil(reorderQuantityRequired * safetyMultiplier);
    }
    
  } else if (urgencyLevel === 'warning') {
    // Warning items: Only reorder if needed to maintain minimum stock through lead time + forecast
    const minStockNeeded = dailySalesRate * (leadTimeWithBuffer + (forecastPeriodDays * 0.5)); // Half forecast period as buffer
    if (currentStock < minStockNeeded) {
      reorderQuantityRequired = Math.ceil(minStockNeeded - currentStock);
      
      // Apply reduced safety stock for warning items
      if (safetyMultiplier && safetyMultiplier > 1) {
        const reducedMultiplier = 1 + ((safetyMultiplier - 1) * 0.5); // 50% of the safety multiplier
        reorderQuantityRequired = Math.ceil(reorderQuantityRequired * reducedMultiplier);
      }
    }
  }
  // Good and inactive items: reorderQuantityRequired remains 0

  // Calculate other forecast metrics
  const reorderPoint = Math.ceil(dailySalesRate * leadTimeWithBuffer);
  const forecastedProfit = margin * forecastedSales;
  const missedProfit = margin * Math.max(0, forecastedSales - currentStock);
  const totalCashflowRequired = reorderQuantityRequired * cogPerUnit;

  return {
    user_id: userId,
    inventory_raw_id: item.id,
    forecast_period_months: forecastPeriodMonths,
    cog_per_unit: isNaN(cogPerUnit) ? 0 : cogPerUnit,
    days_of_stock_remaining: isNaN(daysOfStockRemaining) ? 0 : daysOfStockRemaining,
    forecasted_sales: isNaN(forecastedSales) ? 0 : forecastedSales,
    reorder_quantity_required: isNaN(reorderQuantityRequired) ? 0 : reorderQuantityRequired,
    forecasted_profit: isNaN(forecastedProfit) ? 0 : forecastedProfit,
    missed_profit: isNaN(missedProfit) ? 0 : missedProfit,
    total_cashflow_required: isNaN(totalCashflowRequired) ? 0 : totalCashflowRequired,
    urgency_level: urgencyLevel,
    stockout_risk_days: stockoutRiskDays,
    stockout_warning: stockoutWarning
  };
};

export const calculateForecastForItems = (
  inventoryData: InventoryRawData[],
  userId: string,
  forecastPeriodMonths: number = 3,
  settings?: Partial<ForecastSettings & { calculationMode?: 'from_today' | 'post_arrival' }>
): CalculatedForecast[] => {
  return inventoryData.map(item => 
    calculateForecastForItem(item, userId, forecastPeriodMonths, settings)
  );
};