ALTER TABLE outstanding_invoices_cache 
  ADD COLUMN IF NOT EXISTS line_amount_types text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS total_tax numeric DEFAULT 0;