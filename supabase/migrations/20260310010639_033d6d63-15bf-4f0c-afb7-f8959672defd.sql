
CREATE TABLE public.reconciliation_checks (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  marketplace_code text NOT NULL,
  period_label text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  shopify_order_total numeric DEFAULT 0,
  settlement_net_received numeric DEFAULT 0,
  expected_commission numeric DEFAULT 0,
  actual_commission numeric DEFAULT 0,
  difference numeric DEFAULT 0,
  status text DEFAULT 'pending',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, marketplace_code, period_label)
);

-- Validation trigger for status
CREATE OR REPLACE FUNCTION public.validate_reconciliation_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.status IS NOT NULL AND NEW.status NOT IN ('matched', 'warning', 'alert', 'pending') THEN
    RAISE EXCEPTION 'Invalid status: %', NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_reconciliation_status
  BEFORE INSERT OR UPDATE ON public.reconciliation_checks
  FOR EACH ROW EXECUTE FUNCTION public.validate_reconciliation_status();

ALTER TABLE public.reconciliation_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "User owns reconciliation checks"
  ON public.reconciliation_checks
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
