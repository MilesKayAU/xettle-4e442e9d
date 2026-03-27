
CREATE TABLE public.expected_woolworths_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  bank_payment_id text NOT NULL,
  paid_date date NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  csv_uploaded boolean NOT NULL DEFAULT false,
  pdf_uploaded boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'manual',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, bank_payment_id)
);

ALTER TABLE public.expected_woolworths_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own expected payments"
  ON public.expected_woolworths_payments
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
