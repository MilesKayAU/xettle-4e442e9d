
-- Add settlement_fingerprint column
ALTER TABLE public.settlements ADD COLUMN IF NOT EXISTS settlement_fingerprint text;

-- Create index for fingerprint lookups
CREATE INDEX IF NOT EXISTS idx_settlements_fingerprint ON public.settlements (settlement_fingerprint) WHERE settlement_fingerprint IS NOT NULL;

-- Create a function to generate fingerprints deterministically
CREATE OR REPLACE FUNCTION public.generate_settlement_fingerprint()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Fingerprint = sha256 of marketplace|period_start|period_end|bank_deposit
  NEW.settlement_fingerprint := encode(
    sha256(
      convert_to(
        COALESCE(NEW.marketplace, 'unknown') || '|' ||
        NEW.period_start::text || '|' ||
        NEW.period_end::text || '|' ||
        COALESCE(NEW.bank_deposit, 0)::text,
        'UTF8'
      )
    ),
    'hex'
  );
  RETURN NEW;
END;
$$;

-- Trigger to auto-generate fingerprint on insert/update
CREATE TRIGGER trg_settlement_fingerprint
BEFORE INSERT OR UPDATE OF marketplace, period_start, period_end, bank_deposit
ON public.settlements
FOR EACH ROW
EXECUTE FUNCTION public.generate_settlement_fingerprint();

-- Backfill existing settlements
UPDATE public.settlements
SET settlement_fingerprint = encode(
  sha256(
    convert_to(
      COALESCE(marketplace, 'unknown') || '|' ||
      period_start::text || '|' ||
      period_end::text || '|' ||
      COALESCE(bank_deposit, 0)::text,
      'UTF8'
    )
  ),
  'hex'
);
