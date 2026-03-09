ALTER TABLE public.settlements
  ADD COLUMN IF NOT EXISTS bank_verified boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS bank_verified_amount numeric,
  ADD COLUMN IF NOT EXISTS bank_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS bank_verified_by uuid;