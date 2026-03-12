
-- 1. New table: bank_transactions (local cache for Xero bank transactions)
CREATE TABLE public.bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  xero_transaction_id text NOT NULL,
  bank_account_id text,
  bank_account_name text,
  date date,
  amount numeric DEFAULT 0,
  currency text DEFAULT 'AUD',
  description text,
  reference text,
  contact_name text,
  transaction_type text DEFAULT 'RECEIVE',
  created_at timestamptz DEFAULT now(),
  fetched_at timestamptz DEFAULT now(),
  UNIQUE (user_id, xero_transaction_id)
);

ALTER TABLE public.bank_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own bank transactions"
  ON public.bank_transactions FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE INDEX idx_bank_transactions_user_date
  ON public.bank_transactions(user_id, date);

-- 2. Add confidence_score to payment_verifications
ALTER TABLE public.payment_verifications
  ADD COLUMN IF NOT EXISTS confidence_score numeric DEFAULT 0;
