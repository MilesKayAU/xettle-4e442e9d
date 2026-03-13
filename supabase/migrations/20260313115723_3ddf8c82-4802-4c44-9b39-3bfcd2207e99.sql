
-- Create outstanding_invoices_cache table
CREATE TABLE public.outstanding_invoices_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  xero_invoice_id text NOT NULL,
  xero_tenant_id text,
  invoice_number text,
  reference text,
  contact_name text,
  date date,
  due_date date,
  amount_due numeric DEFAULT 0,
  total numeric DEFAULT 0,
  currency_code text DEFAULT 'AUD',
  status text,
  fetched_at timestamptz DEFAULT now(),
  UNIQUE(user_id, xero_invoice_id)
);

-- Enable RLS
ALTER TABLE public.outstanding_invoices_cache ENABLE ROW LEVEL SECURITY;

-- RLS policies scoped to auth.uid()
CREATE POLICY "Users can select own invoice cache"
  ON public.outstanding_invoices_cache FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own invoice cache"
  ON public.outstanding_invoices_cache FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own invoice cache"
  ON public.outstanding_invoices_cache FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own invoice cache"
  ON public.outstanding_invoices_cache FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
