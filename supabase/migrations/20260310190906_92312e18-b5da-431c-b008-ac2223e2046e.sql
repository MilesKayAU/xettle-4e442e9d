
ALTER TABLE public.marketplace_file_fingerprints 
  ADD COLUMN IF NOT EXISTS split_column text,
  ADD COLUMN IF NOT EXISTS split_mappings jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_multi_marketplace boolean DEFAULT false;
