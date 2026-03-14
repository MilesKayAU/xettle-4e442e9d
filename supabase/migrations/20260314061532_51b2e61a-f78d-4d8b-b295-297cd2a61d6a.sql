CREATE TABLE public.settlement_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  settlement_id text NOT NULL,
  marketplace_code text NOT NULL,
  currency text NOT NULL DEFAULT 'AUD',
  period_start date NOT NULL,
  period_end date NOT NULL,
  sales_ex_tax numeric DEFAULT 0,
  sales_tax numeric DEFAULT 0,
  refunds_ex_tax numeric DEFAULT 0,
  refunds_tax numeric DEFAULT 0,
  fees_ex_tax numeric DEFAULT 0,
  fees_tax numeric DEFAULT 0,
  reimbursements numeric DEFAULT 0,
  other_adjustments numeric DEFAULT 0,
  promotional_discounts numeric DEFAULT 0,
  advertising_costs numeric DEFAULT 0,
  storage_fees numeric DEFAULT 0,
  tax_collected_by_platform numeric DEFAULT 0,
  payout_total numeric DEFAULT 0,
  payout_gst_inclusive numeric DEFAULT 0,
  commerce_gross_total numeric DEFAULT 0,
  gst_rate numeric DEFAULT 10,
  payout_vs_deposit_diff numeric DEFAULT 0,
  reconciled boolean DEFAULT false,
  source text DEFAULT 'parser',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (user_id, settlement_id, marketplace_code)
);

ALTER TABLE public.settlement_components ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own settlement components"
  ON public.settlement_components
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

ALTER TABLE public.outstanding_invoices_cache ADD COLUMN IF NOT EXISTS sub_total numeric DEFAULT 0