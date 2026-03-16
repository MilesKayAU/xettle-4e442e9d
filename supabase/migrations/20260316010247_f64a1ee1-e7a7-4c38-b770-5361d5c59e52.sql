
-- Add repost tracking columns to settlements for safe-repost audit trail
ALTER TABLE public.settlements 
  ADD COLUMN IF NOT EXISTS repost_chain_id uuid DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS repost_of_invoice_id text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS repost_reason text DEFAULT NULL;

-- Index for efficient chain lookups
CREATE INDEX IF NOT EXISTS idx_settlements_repost_chain 
  ON public.settlements (repost_chain_id) 
  WHERE repost_chain_id IS NOT NULL;

COMMENT ON COLUMN public.settlements.repost_chain_id IS 'Groups original + reposted settlements into an audit chain. All related settlements share the same UUID.';
COMMENT ON COLUMN public.settlements.repost_of_invoice_id IS 'The Xero InvoiceID that was voided to create this repost. NULL for originals.';
COMMENT ON COLUMN public.settlements.repost_reason IS 'User-provided reason for the repost (e.g. "Wrong account codes", "Missing refund line").';
