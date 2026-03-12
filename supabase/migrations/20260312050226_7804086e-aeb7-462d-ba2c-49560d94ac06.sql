
-- Step 1: Create xero_chart_of_accounts table
CREATE TABLE public.xero_chart_of_accounts (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  xero_account_id text,
  account_code text,
  account_name text NOT NULL,
  account_type text,
  tax_type text,
  description text,
  is_active boolean DEFAULT true,
  synced_at timestamptz DEFAULT now(),
  UNIQUE(user_id, xero_account_id)
);

ALTER TABLE public.xero_chart_of_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own chart of accounts"
  ON public.xero_chart_of_accounts
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Step 2: Add suggested_at to marketplace_connections
ALTER TABLE public.marketplace_connections
  ADD COLUMN IF NOT EXISTS suggested_at timestamptz;
