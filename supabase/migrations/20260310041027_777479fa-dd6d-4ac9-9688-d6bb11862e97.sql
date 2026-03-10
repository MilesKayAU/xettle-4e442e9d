CREATE UNIQUE INDEX IF NOT EXISTS idx_validation_unique_period 
  ON public.marketplace_validation(user_id, marketplace_code, period_label);