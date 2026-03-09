CREATE TABLE public.marketplace_ad_spend (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  marketplace_code text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  spend_amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'AUD',
  source text NOT NULL DEFAULT 'manual',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, marketplace_code, period_start)
);

ALTER TABLE public.marketplace_ad_spend ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can select own ad spend" ON public.marketplace_ad_spend FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own ad spend" ON public.marketplace_ad_spend FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own ad spend" ON public.marketplace_ad_spend FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own ad spend" ON public.marketplace_ad_spend FOR DELETE USING (auth.uid() = user_id);

CREATE TRIGGER update_marketplace_ad_spend_updated_at
  BEFORE UPDATE ON public.marketplace_ad_spend
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();