ALTER TABLE public.channel_alerts 
  ADD COLUMN IF NOT EXISTS deposit_amount numeric DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deposit_date date DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS deposit_description text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS match_confidence integer DEFAULT NULL;