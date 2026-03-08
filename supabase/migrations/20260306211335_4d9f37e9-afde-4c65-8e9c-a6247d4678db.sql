
ALTER TABLE public.settlements
  ADD COLUMN IF NOT EXISTS is_split_month boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS split_month_1_start date,
  ADD COLUMN IF NOT EXISTS split_month_1_end date,
  ADD COLUMN IF NOT EXISTS split_month_1_ratio numeric,
  ADD COLUMN IF NOT EXISTS split_month_2_start date,
  ADD COLUMN IF NOT EXISTS split_month_2_end date,
  ADD COLUMN IF NOT EXISTS split_month_2_ratio numeric,
  ADD COLUMN IF NOT EXISTS split_month_1_data jsonb,
  ADD COLUMN IF NOT EXISTS split_month_2_data jsonb,
  ADD COLUMN IF NOT EXISTS xero_journal_id_1 text,
  ADD COLUMN IF NOT EXISTS xero_journal_id_2 text;
