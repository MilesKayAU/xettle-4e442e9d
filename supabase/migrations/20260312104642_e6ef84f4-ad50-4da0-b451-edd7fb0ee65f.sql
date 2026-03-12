
-- Update fingerprint to derive currency from marketplace code (deterministic mapping)
CREATE OR REPLACE FUNCTION public.generate_settlement_fingerprint()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
DECLARE
  derived_currency text;
BEGIN
  -- Derive currency from marketplace code (deterministic, no extra column needed)
  derived_currency := CASE
    WHEN NEW.marketplace ILIKE '%_us' THEN 'USD'
    WHEN NEW.marketplace ILIKE '%_uk' OR NEW.marketplace ILIKE '%_gb' THEN 'GBP'
    WHEN NEW.marketplace ILIKE '%_eu' OR NEW.marketplace ILIKE '%_de' OR NEW.marketplace ILIKE '%_fr' OR NEW.marketplace ILIKE '%_it' OR NEW.marketplace ILIKE '%_es' THEN 'EUR'
    WHEN NEW.marketplace ILIKE '%_ca' THEN 'CAD'
    WHEN NEW.marketplace ILIKE '%_jp' THEN 'JPY'
    WHEN NEW.marketplace ILIKE '%_in' THEN 'INR'
    WHEN NEW.marketplace ILIKE '%_sg' THEN 'SGD'
    WHEN NEW.marketplace ILIKE '%_nz' THEN 'NZD'
    ELSE 'AUD'
  END;

  NEW.settlement_fingerprint := encode(
    sha256(
      convert_to(
        COALESCE(NEW.marketplace, 'unknown') || '|' ||
        derived_currency || '|' ||
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

-- Backfill all existing settlements with the new formula
UPDATE public.settlements
SET settlement_fingerprint = encode(
  sha256(
    convert_to(
      COALESCE(marketplace, 'unknown') || '|' ||
      CASE
        WHEN marketplace ILIKE '%_us' THEN 'USD'
        WHEN marketplace ILIKE '%_uk' OR marketplace ILIKE '%_gb' THEN 'GBP'
        WHEN marketplace ILIKE '%_eu' OR marketplace ILIKE '%_de' OR marketplace ILIKE '%_fr' OR marketplace ILIKE '%_it' OR marketplace ILIKE '%_es' THEN 'EUR'
        WHEN marketplace ILIKE '%_ca' THEN 'CAD'
        WHEN marketplace ILIKE '%_jp' THEN 'JPY'
        WHEN marketplace ILIKE '%_in' THEN 'INR'
        WHEN marketplace ILIKE '%_sg' THEN 'SGD'
        WHEN marketplace ILIKE '%_nz' THEN 'NZD'
        ELSE 'AUD'
      END || '|' ||
      period_start::text || '|' ||
      period_end::text || '|' ||
      COALESCE(net_ex_gst, 0)::text,
      'UTF8'
    )
  ),
  'hex'
);
