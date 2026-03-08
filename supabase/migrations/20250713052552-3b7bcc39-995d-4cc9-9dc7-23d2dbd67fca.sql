-- Add total_cashflow_required column to forecast_calculations table
ALTER TABLE public.forecast_calculations 
ADD COLUMN IF NOT EXISTS total_cashflow_required numeric DEFAULT 0;