
-- Table to cache Xero invoice/journal matches for settlements
CREATE TABLE public.xero_accounting_matches (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  settlement_id TEXT NOT NULL,
  marketplace_code TEXT NOT NULL,
  xero_invoice_id TEXT,
  xero_invoice_number TEXT,
  xero_status TEXT,
  xero_type TEXT DEFAULT 'invoice',
  match_method TEXT NOT NULL DEFAULT 'reference',
  confidence NUMERIC NOT NULL DEFAULT 1.0,
  matched_amount NUMERIC,
  matched_date DATE,
  matched_contact TEXT,
  matched_reference TEXT,
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(user_id, settlement_id)
);

ALTER TABLE public.xero_accounting_matches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own matches"
  ON public.xero_accounting_matches
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_xero_matches_updated_at
  BEFORE UPDATE ON public.xero_accounting_matches
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
