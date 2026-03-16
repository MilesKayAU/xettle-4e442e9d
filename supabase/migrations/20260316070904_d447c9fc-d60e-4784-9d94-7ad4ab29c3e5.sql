ALTER TABLE public.rail_posting_settings 
  ADD COLUMN IF NOT EXISTS invoice_status text NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN IF NOT EXISTS auto_repost_after_rollback boolean NOT NULL DEFAULT false;