-- Add new stockout fields to forecast_calculations table
ALTER TABLE public.forecast_calculations 
ADD COLUMN stockout_risk_days integer,
ADD COLUMN stockout_warning text;