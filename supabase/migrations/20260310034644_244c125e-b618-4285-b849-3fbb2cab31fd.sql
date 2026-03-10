
-- Create marketplace_validation table
CREATE TABLE public.marketplace_validation (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  marketplace_code text NOT NULL,
  period_label text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  
  orders_found boolean DEFAULT false,
  orders_count integer DEFAULT 0,
  orders_total numeric DEFAULT 0,
  orders_fetched_at timestamptz,
  
  settlement_id text,
  settlement_uploaded boolean DEFAULT false,
  settlement_net numeric DEFAULT 0,
  settlement_uploaded_at timestamptz,
  
  reconciliation_status text DEFAULT 'pending',
  reconciliation_difference numeric DEFAULT 0,
  
  xero_pushed boolean DEFAULT false,
  xero_invoice_id text,
  xero_pushed_at timestamptz,
  
  bank_matched boolean DEFAULT false,
  bank_amount numeric,
  bank_matched_at timestamptz,
  bank_reference text,
  
  overall_status text DEFAULT 'missing',
  
  last_checked_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  
  UNIQUE(user_id, marketplace_code, period_label)
);

ALTER TABLE public.marketplace_validation ENABLE ROW LEVEL SECURITY;

CREATE POLICY "User owns validation records"
  ON public.marketplace_validation
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create trigger function for overall_status calculation
CREATE OR REPLACE FUNCTION public.calculate_validation_status()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.xero_pushed = true AND NEW.bank_matched = true THEN
    NEW.overall_status := 'complete';
  ELSIF NEW.xero_pushed = true AND NEW.bank_matched = false THEN
    NEW.overall_status := 'pushed_to_xero';
  ELSIF NEW.settlement_uploaded = true AND NEW.reconciliation_status IN ('warning', 'alert') THEN
    NEW.overall_status := 'gap_detected';
  ELSIF NEW.settlement_uploaded = true AND NEW.xero_pushed = false AND NEW.reconciliation_status = 'matched' THEN
    NEW.overall_status := 'ready_to_push';
  ELSIF NEW.settlement_uploaded = true AND NEW.xero_pushed = false THEN
    NEW.overall_status := 'settlement_needed';
  ELSIF NEW.orders_found = true AND NEW.settlement_uploaded = false THEN
    NEW.overall_status := 'settlement_needed';
  ELSE
    NEW.overall_status := 'missing';
  END IF;
  
  NEW.updated_at := now();
  NEW.last_checked_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_calculate_validation_status
  BEFORE INSERT OR UPDATE ON public.marketplace_validation
  FOR EACH ROW
  EXECUTE FUNCTION public.calculate_validation_status();

-- Enable realtime for this table
ALTER PUBLICATION supabase_realtime ADD TABLE public.marketplace_validation;
