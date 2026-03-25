CREATE OR REPLACE FUNCTION public.calculate_validation_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  _settlement_source text;
  _settlement_sid text;
  _settlement_marketplace text;
  _is_recon_only boolean := false;
  _pushable_sources text[] := ARRAY['csv_upload', 'manual', 'api', 'ebay_api', 'mirakl_api', 'amazon_api'];
  _recon_diff numeric;
BEGIN
  IF NEW.overall_status = 'already_recorded' THEN
    NEW.updated_at := now();
    NEW.last_checked_at := now();
    RETURN NEW;
  END IF;

  IF NEW.settlement_id IS NOT NULL THEN
    SELECT source, settlement_id, marketplace
    INTO _settlement_source, _settlement_sid, _settlement_marketplace
    FROM public.settlements
    WHERE settlement_id = NEW.settlement_id
    LIMIT 1;

    IF _settlement_source IS NOT NULL AND NOT (_settlement_source = ANY(_pushable_sources)) THEN
      _is_recon_only := true;
    END IF;

    IF _settlement_sid LIKE 'shopify_auto_%' THEN
      _is_recon_only := true;
    END IF;
  END IF;

  IF _is_recon_only THEN
    NEW.overall_status := 'settlement_needed';
    NEW.updated_at := now();
    NEW.last_checked_at := now();
    RETURN NEW;
  END IF;

  -- Compute absolute reconciliation difference for gap gating
  _recon_diff := COALESCE(ABS(NEW.reconciliation_difference), 0);

  IF NEW.xero_pushed = true AND NEW.bank_matched = true THEN
    NEW.overall_status := 'complete';
  ELSIF NEW.xero_pushed = true AND NEW.bank_matched = false THEN
    NEW.overall_status := 'pushed_to_xero';
  ELSIF NEW.settlement_uploaded = true AND NEW.reconciliation_status IN ('warning', 'alert') THEN
    NEW.overall_status := 'gap_detected';
  ELSIF NEW.settlement_uploaded = true AND NEW.xero_pushed = false AND NEW.reconciliation_status = 'matched' THEN
    -- Defense-in-depth: even if sweep says 'matched', block if gap > $1
    IF COALESCE(NEW.settlement_net, 0) = 0 THEN
      NEW.overall_status := 'settlement_needed';
    ELSIF _recon_diff > 1.00 THEN
      NEW.overall_status := 'gap_detected';
    ELSE
      NEW.overall_status := 'ready_to_push';
    END IF;
  ELSIF NEW.settlement_uploaded = false AND NEW.orders_found = true THEN
    NEW.overall_status := 'settlement_needed';
  ELSIF NEW.settlement_uploaded = true AND NEW.xero_pushed = false THEN
    IF COALESCE(NEW.settlement_net, 0) = 0 THEN
      NEW.overall_status := 'settlement_needed';
    ELSIF _recon_diff > 1.00 THEN
      NEW.overall_status := 'gap_detected';
    ELSE
      NEW.overall_status := 'ready_to_push';
    END IF;
  ELSE
    NEW.overall_status := 'missing';
  END IF;
  
  NEW.updated_at := now();
  NEW.last_checked_at := now();
  RETURN NEW;
END;
$function$;