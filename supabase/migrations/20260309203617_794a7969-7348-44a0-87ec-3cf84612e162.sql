ALTER TABLE public.settlements
  ADD COLUMN IF NOT EXISTS xero_invoice_number text,
  ADD COLUMN IF NOT EXISTS xero_status text;