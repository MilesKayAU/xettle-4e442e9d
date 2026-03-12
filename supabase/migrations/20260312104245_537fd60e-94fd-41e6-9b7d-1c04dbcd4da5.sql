
-- Update fingerprint function to use net_ex_gst instead of bank_deposit
CREATE OR REPLACE FUNCTION public.generate_settlement_fingerprint()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.settlement_fingerprint := encode(
    sha256(
      convert_to(
        COALESCE(NEW.marketplace, 'unknown') || '|' ||
        NEW.period_start::text || '|' ||
        NEW.period_end::text || '|' ||
        COALESCE(NEW.net_ex_gst, 0)::text,
        'UTF8'
      )
    ),
    'hex'
  );
  RETURN NEW;
END;
$$;

-- Update trigger to fire on net_ex_gst changes instead of bank_deposit
DROP TRIGGER IF EXISTS trg_settlement_fingerprint ON public.settlements;
CREATE TRIGGER trg_settlement_fingerprint
BEFORE INSERT OR UPDATE OF marketplace, period_start, period_end, net_ex_gst
ON public.settlements
FOR EACH ROW
EXECUTE FUNCTION public.generate_settlement_fingerprint();

-- Backfill with new formula
UPDATE public.settlements
SET settlement_fingerprint = encode(
  sha256(
    convert_to(
      COALESCE(marketplace, 'unknown') || '|' ||
      period_start::text || '|' ||
      period_end::text || '|' ||
      COALESCE(net_ex_gst, 0)::text,
      'UTF8'
    )
  ),
  'hex'
);
