
-- Update fingerprint function to include currency
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
        COALESCE((SELECT s.raw_payload->>'currency' FROM public.settlements s WHERE s.id = NEW.id), 'AUD') || '|' ||
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
