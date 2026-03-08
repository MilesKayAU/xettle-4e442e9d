export interface InventoryRawData {
  id: string;
  user_id: string;
  upload_id: string;
  upload_session_name: string;
  sku: string;
  asin?: string;
  title?: string;
  roi_percent?: number;
  fba_fbm_stock: number;
  stock_value: number;
  estimated_sales_velocity: number;
  margin: number;
  manuf_time_days?: number;
  fba_buffer_days?: number;
  supplier_name?: string;
  supplier_contact?: string;
  recommended_quantity_for_reordering?: number;
  [key: string]: any; // For other Excel columns
}

export interface ForecastCalculation {
  id: string;
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
  created_at: string;
  updated_at: string;
}

export interface ForecastWithInventory extends ForecastCalculation {
  inventory: InventoryRawData;
}

export interface ForecastSettings {
  leadTimeDays: number;
  bufferDays: number;
  safetyStockMultiplier: number;
}