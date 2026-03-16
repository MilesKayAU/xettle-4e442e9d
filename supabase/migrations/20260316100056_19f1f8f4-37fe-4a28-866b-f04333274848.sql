CREATE TABLE IF NOT EXISTS public.xero_tax_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  tax_type text NOT NULL,
  name text NOT NULL,
  effective_rate numeric,
  status text DEFAULT 'ACTIVE',
  can_apply_to_revenue boolean DEFAULT false,
  can_apply_to_expenses boolean DEFAULT false,
  synced_at timestamptz DEFAULT now(),
  UNIQUE(user_id, tax_type)
);

ALTER TABLE public.xero_tax_rates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own tax rates"
  ON public.xero_tax_rates
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can manage own tax rates"
  ON public.xero_tax_rates
  FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());