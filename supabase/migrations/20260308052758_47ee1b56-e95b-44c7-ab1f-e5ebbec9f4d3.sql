-- 1. App role enum and user_roles table
CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read their own roles"
  ON public.user_roles FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE OR REPLACE FUNCTION public.has_role(_role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = auth.uid() AND role = _role
  )
$$;

-- 2. Xero tokens table
CREATE TABLE public.xero_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  tenant_id TEXT NOT NULL,
  tenant_name TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_type TEXT DEFAULT 'Bearer',
  expires_at TIMESTAMPTZ NOT NULL,
  scope TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, tenant_id)
);

ALTER TABLE public.xero_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own tokens"
  ON public.xero_tokens FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own tokens"
  ON public.xero_tokens FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own tokens"
  ON public.xero_tokens FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own tokens"
  ON public.xero_tokens FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 3. Settlements table
CREATE TABLE public.settlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  settlement_id TEXT NOT NULL,
  marketplace TEXT DEFAULT 'AU',
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  deposit_date DATE,
  bank_deposit NUMERIC(12,2) DEFAULT 0,
  status TEXT DEFAULT 'parsed',
  sales_principal NUMERIC(12,2) DEFAULT 0,
  sales_shipping NUMERIC(12,2) DEFAULT 0,
  promotional_discounts NUMERIC(12,2) DEFAULT 0,
  seller_fees NUMERIC(12,2) DEFAULT 0,
  fba_fees NUMERIC(12,2) DEFAULT 0,
  storage_fees NUMERIC(12,2) DEFAULT 0,
  refunds NUMERIC(12,2) DEFAULT 0,
  reimbursements NUMERIC(12,2) DEFAULT 0,
  other_fees NUMERIC(12,2) DEFAULT 0,
  net_ex_gst NUMERIC(12,2) DEFAULT 0,
  gst_on_income NUMERIC(12,2) DEFAULT 0,
  gst_on_expenses NUMERIC(12,2) DEFAULT 0,
  reconciliation_status TEXT DEFAULT 'pending',
  xero_journal_id TEXT,
  is_split_month BOOLEAN DEFAULT false,
  split_month_1_data JSONB,
  split_month_2_data JSONB,
  xero_journal_id_1 TEXT,
  xero_journal_id_2 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own settlements"
  ON public.settlements FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own settlements"
  ON public.settlements FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own settlements"
  ON public.settlements FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own settlements"
  ON public.settlements FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 4. Settlement lines table
CREATE TABLE public.settlement_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  settlement_id TEXT NOT NULL,
  transaction_type TEXT,
  amount_type TEXT,
  amount_description TEXT,
  accounting_category TEXT,
  amount NUMERIC(12,2) DEFAULT 0,
  order_id TEXT,
  sku TEXT,
  posted_date DATE,
  marketplace_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.settlement_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own settlement lines"
  ON public.settlement_lines FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own settlement lines"
  ON public.settlement_lines FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own settlement lines"
  ON public.settlement_lines FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 5. Settlement unmapped rows table
CREATE TABLE public.settlement_unmapped (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  settlement_id TEXT NOT NULL,
  transaction_type TEXT,
  amount_type TEXT,
  amount_description TEXT,
  amount NUMERIC(12,2) DEFAULT 0,
  raw_row JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.settlement_unmapped ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own unmapped rows"
  ON public.settlement_unmapped FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own unmapped rows"
  ON public.settlement_unmapped FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own unmapped rows"
  ON public.settlement_unmapped FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- 6. App settings table
CREATE TABLE public.app_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  key TEXT NOT NULL,
  value TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, key)
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own settings"
  ON public.app_settings FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own settings"
  ON public.app_settings FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own settings"
  ON public.app_settings FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

-- 7. Updated_at trigger function and triggers
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER update_xero_tokens_updated_at
  BEFORE UPDATE ON public.xero_tokens
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_settlements_updated_at
  BEFORE UPDATE ON public.settlements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();