-- Update default for marketplace column from 'AU' to 'amazon_au'
ALTER TABLE public.settlements ALTER COLUMN marketplace SET DEFAULT 'amazon_au';