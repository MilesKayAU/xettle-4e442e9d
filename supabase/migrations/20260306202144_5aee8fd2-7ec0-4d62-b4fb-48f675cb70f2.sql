
-- Settlements table
CREATE TABLE public.settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  settlement_id text NOT NULL,
  marketplace text NOT NULL DEFAULT 'AU',
  period_start date,
  period_end date,
  deposit_date date,
  currency text DEFAULT 'AUD',
  sales_principal numeric DEFAULT 0,
  sales_shipping numeric DEFAULT 0,
  promotional_discounts numeric DEFAULT 0,
  seller_fees numeric DEFAULT 0,
  fba_fees numeric DEFAULT 0,
  storage_fees numeric DEFAULT 0,
  refunds numeric DEFAULT 0,
  reimbursements numeric DEFAULT 0,
  other_fees numeric DEFAULT 0,
  net_ex_gst numeric DEFAULT 0,
  gst_on_income numeric DEFAULT 0,
  gst_on_expenses numeric DEFAULT 0,
  bank_deposit numeric DEFAULT 0,
  reconciliation_status text DEFAULT 'pending',
  status text DEFAULT 'pending',
  xero_journal_id text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(settlement_id, user_id)
);

ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own settlements"
  ON public.settlements FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Settlement lines table
CREATE TABLE public.settlement_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id text NOT NULL,
  user_id uuid NOT NULL,
  transaction_type text,
  amount_type text,
  amount_description text,
  accounting_category text,
  amount numeric DEFAULT 0,
  order_id text,
  sku text,
  posted_date date,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.settlement_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own settlement lines"
  ON public.settlement_lines FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Settlement unmapped table
CREATE TABLE public.settlement_unmapped (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id text NOT NULL,
  user_id uuid NOT NULL,
  transaction_type text,
  amount_type text,
  amount_description text,
  amount numeric DEFAULT 0,
  raw_row jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.settlement_unmapped ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage their own settlement unmapped"
  ON public.settlement_unmapped FOR ALL
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
