
ALTER TABLE public.settlements
  ADD COLUMN IF NOT EXISTS international_sales numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS international_fees numeric DEFAULT 0;
