
CREATE TABLE public.settlement_profit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  marketplace_code text NOT NULL,
  period_label text NOT NULL,
  settlement_id text NOT NULL,
  gross_revenue numeric NOT NULL DEFAULT 0,
  total_cogs numeric NOT NULL DEFAULT 0,
  marketplace_fees numeric NOT NULL DEFAULT 0,
  gross_profit numeric NOT NULL DEFAULT 0,
  margin_percent numeric NOT NULL DEFAULT 0,
  orders_count integer NOT NULL DEFAULT 0,
  units_sold integer NOT NULL DEFAULT 0,
  uncosted_sku_count integer NOT NULL DEFAULT 0,
  uncosted_revenue numeric NOT NULL DEFAULT 0,
  calculated_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE(user_id, marketplace_code, settlement_id)
);

ALTER TABLE public.settlement_profit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own profit" ON public.settlement_profit FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own profit" ON public.settlement_profit FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own profit" ON public.settlement_profit FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own profit" ON public.settlement_profit FOR DELETE TO authenticated USING (auth.uid() = user_id);
