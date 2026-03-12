-- Add bank match tracking fields to settlements
ALTER TABLE public.settlements
  ADD COLUMN IF NOT EXISTS bank_tx_id text,
  ADD COLUMN IF NOT EXISTS bank_match_method text,
  ADD COLUMN IF NOT EXISTS bank_match_confidence text,
  ADD COLUMN IF NOT EXISTS bank_match_confirmed_at timestamptz,
  ADD COLUMN IF NOT EXISTS bank_match_confirmed_by uuid;