
-- Add reference_hash column to xero_accounting_matches for fast lookup
ALTER TABLE public.xero_accounting_matches ADD COLUMN IF NOT EXISTS reference_hash TEXT;

-- Create indexes for cache-first lookups
CREATE INDEX IF NOT EXISTS idx_xero_matches_user_settlement ON public.xero_accounting_matches(user_id, settlement_id);
CREATE INDEX IF NOT EXISTS idx_xero_matches_user_refhash ON public.xero_accounting_matches(user_id, reference_hash);
CREATE INDEX IF NOT EXISTS idx_xero_matches_user_invoice ON public.xero_accounting_matches(user_id, xero_invoice_id);
