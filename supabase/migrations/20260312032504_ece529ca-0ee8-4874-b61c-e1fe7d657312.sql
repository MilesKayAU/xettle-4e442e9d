-- Payment Verification Layer (Build Fix 72)
-- Stores audit trail for gateway payment matching (PayPal, Shopify Payments, etc.)
-- This is VERIFICATION ONLY — never creates accounting entries.
-- See: ARCHITECTURE.md Rule #11

CREATE TABLE public.payment_verifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  settlement_id text NOT NULL,
  gateway_code text NOT NULL,
  xero_tx_id text,
  match_amount numeric,
  match_method text,
  match_confidence text,
  match_confirmed_at timestamptz,
  match_confirmed_by uuid,
  order_count integer DEFAULT 0,
  narration text,
  transaction_date date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(settlement_id, gateway_code, user_id)
);

ALTER TABLE public.payment_verifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own payment verifications"
  ON public.payment_verifications FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_payment_verifications_updated_at
  BEFORE UPDATE ON public.payment_verifications
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();