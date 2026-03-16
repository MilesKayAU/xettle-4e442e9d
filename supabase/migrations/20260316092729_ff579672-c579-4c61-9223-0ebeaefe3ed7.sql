
-- xero_invoice_cache: stores fetched Xero invoice details for evidence + comparison
CREATE TABLE public.xero_invoice_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  xero_invoice_id text NOT NULL,
  xero_invoice_number text,
  status text,
  date date,
  due_date date,
  contact_name text,
  contact_id text,
  currency_code text DEFAULT 'AUD',
  total numeric,
  sub_total numeric,
  total_tax numeric,
  reference text,
  line_items jsonb DEFAULT '[]'::jsonb,
  raw_json jsonb DEFAULT '{}'::jsonb,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, xero_invoice_id)
);

CREATE INDEX idx_xero_invoice_cache_user_fetched ON public.xero_invoice_cache (user_id, fetched_at);

ALTER TABLE public.xero_invoice_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own invoice cache"
  ON public.xero_invoice_cache FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
