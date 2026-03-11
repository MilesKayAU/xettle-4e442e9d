ALTER TABLE public.shopify_orders
  ADD COLUMN IF NOT EXISTS note_attributes jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS total_tax numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_discounts numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS processed_at timestamp with time zone DEFAULT NULL;