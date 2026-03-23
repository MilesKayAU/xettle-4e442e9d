CREATE OR REPLACE FUNCTION public.calculate_validation_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  -- If explicitly marked as already_recorded (pre-boundary historical data), preserve it
  IF NEW.overall_status = 'already_recorded' THEN
    NEW.updated_at := now();
    NEW.last_checked_at := now();
    RETURN NEW;
  END IF;

  IF NEW.xero_pushed = true AND NEW.bank_matched = true THEN
    NEW.overall_status := 'complete';
  ELSIF NEW.xero_pushed = true AND NEW.bank_matched = false THEN
    NEW.overall_status := 'pushed_to_xero';
  ELSIF NEW.settlement_uploaded = true AND NEW.reconciliation_status IN ('warning', 'alert') THEN
    NEW.overall_status := 'gap_detected';
  ELSIF NEW.settlement_uploaded = true AND NEW.xero_pushed = false AND NEW.reconciliation_status = 'matched' THEN
    -- Guard: zero-value settlements are not ready to push
    IF COALESCE(NEW.settlement_net, 0) = 0 THEN
      NEW.overall_status := 'settlement_needed';
    ELSE
      NEW.overall_status := 'ready_to_push';
    END IF;
  ELSIF NEW.settlement_uploaded = false AND NEW.orders_found = true THEN
    NEW.overall_status := 'settlement_needed';
  ELSIF NEW.settlement_uploaded = true AND NEW.xero_pushed = false THEN
    -- Settlement exists but not yet in Xero
    -- Guard: zero-value settlements should not be pushed
    IF COALESCE(NEW.settlement_net, 0) = 0 THEN
      NEW.overall_status := 'settlement_needed';
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
$function$