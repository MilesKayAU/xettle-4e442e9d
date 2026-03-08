-- Create tables for inventory forecasting system

-- 1. Store raw Excel uploads (1 row per SKU)
CREATE TABLE public.uploaded_inventory_raw (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  upload_id UUID NOT NULL DEFAULT gen_random_uuid(),
  upload_session_name TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Original Excel columns (normalized names)
  asin TEXT,
  sku TEXT NOT NULL,
  title TEXT,
  roi_percent DECIMAL,
  fba_fbm_stock INTEGER DEFAULT 0,
  stock_value DECIMAL DEFAULT 0,
  estimated_sales_velocity DECIMAL DEFAULT 0,
  days_of_stock_left INTEGER,
  recommended_quantity_for_reordering INTEGER,
  running_out_of_stock TEXT,
  reserved INTEGER,
  sent_to_fba INTEGER,
  ordered INTEGER,
  time_to_reorder TEXT,
  margin DECIMAL DEFAULT 0,
  profit_forecast_30_days DECIMAL,
  comment TEXT,
  marketplace TEXT,
  target_stock_range_after_new_order_days INTEGER,
  fba_buffer_days INTEGER,
  manuf_time_days INTEGER,
  use_a_prep_center TEXT,
  shipping_to_prep_center_days INTEGER,
  shipping_to_fba_days INTEGER,
  box_param_length DECIMAL,
  box_param_width DECIMAL,
  box_param_height DECIMAL,
  box_param_units_in_box INTEGER,
  color TEXT,
  size TEXT,
  multipack_size TEXT,
  item_number TEXT,
  fnsku TEXT,
  recommended_ship_in_quantity_by_amazon INTEGER,
  recommended_ship_in_date_by_amazon DATE,
  historical_days_of_supply INTEGER,
  supplier_sku TEXT,
  fba_prep_stock_gold_coast INTEGER,
  fba_prep_stock_prep_center_2_stock INTEGER,
  fba_prep_stock_prep_center_3_stock INTEGER,
  fba_prep_stock_prep_center_4_stock INTEGER,
  missed_profit_est DECIMAL,
  
  -- Add constraint for unique SKU per upload session
  UNIQUE(user_id, upload_id, sku)
);

-- 2. Store calculated forecast metrics
CREATE TABLE public.forecast_calculations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  inventory_raw_id UUID NOT NULL REFERENCES public.uploaded_inventory_raw(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Forecast parameters
  forecast_period_months INTEGER NOT NULL DEFAULT 3,
  
  -- Calculated values
  cog_per_unit DECIMAL DEFAULT 0,
  days_of_stock_remaining DECIMAL DEFAULT 0,
  forecasted_sales DECIMAL DEFAULT 0,
  reorder_quantity_required INTEGER DEFAULT 0,
  forecasted_profit DECIMAL DEFAULT 0,
  missed_profit DECIMAL DEFAULT 0,
  urgency_level TEXT CHECK (urgency_level IN ('critical', 'warning', 'good', 'inactive')) DEFAULT 'good',
  
  -- Add constraint for unique forecast per inventory item and period
  UNIQUE(inventory_raw_id, forecast_period_months)
);

-- 3. Store user setting overrides
CREATE TABLE public.forecast_settings_overrides (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  inventory_raw_id UUID NOT NULL REFERENCES public.uploaded_inventory_raw(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  
  -- Override settings
  lead_time_days INTEGER,
  buffer_days INTEGER,
  velocity_override DECIMAL,
  cost_override DECIMAL,
  margin_override DECIMAL,
  
  -- Add constraint for unique overrides per inventory item
  UNIQUE(user_id, inventory_raw_id)
);

-- Enable RLS on all tables
ALTER TABLE public.uploaded_inventory_raw ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forecast_calculations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.forecast_settings_overrides ENABLE ROW LEVEL SECURITY;

-- RLS Policies for uploaded_inventory_raw
CREATE POLICY "Users can manage their own inventory uploads"
ON public.uploaded_inventory_raw
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- RLS Policies for forecast_calculations
CREATE POLICY "Users can manage their own forecast calculations"
ON public.forecast_calculations
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- RLS Policies for forecast_settings_overrides
CREATE POLICY "Users can manage their own forecast settings"
ON public.forecast_settings_overrides
FOR ALL
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create triggers for updated_at
CREATE TRIGGER update_uploaded_inventory_raw_updated_at
  BEFORE UPDATE ON public.uploaded_inventory_raw
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_forecast_calculations_updated_at
  BEFORE UPDATE ON public.forecast_calculations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_forecast_settings_overrides_updated_at
  BEFORE UPDATE ON public.forecast_settings_overrides
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create indexes for better performance
CREATE INDEX idx_uploaded_inventory_raw_user_upload ON public.uploaded_inventory_raw(user_id, upload_id);
CREATE INDEX idx_uploaded_inventory_raw_sku ON public.uploaded_inventory_raw(user_id, sku);
CREATE INDEX idx_forecast_calculations_inventory_raw ON public.forecast_calculations(inventory_raw_id);
CREATE INDEX idx_forecast_calculations_user ON public.forecast_calculations(user_id);
CREATE INDEX idx_forecast_settings_overrides_user_inventory ON public.forecast_settings_overrides(user_id, inventory_raw_id);