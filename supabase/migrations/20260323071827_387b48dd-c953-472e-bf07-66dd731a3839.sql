-- Update trigger: cap reconciliation-only settlements at settlement_needed
-- Derives decision from the actual linked settlement row, not validation fields
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
BEGIN
  -- If explicitly marked as already_recorded (pre-boundary historical data), preserve it
  IF NEW.overall_status = 'already_recorded' THEN
    NEW.updated_at := now();
    NEW.last_checked_at := now();
    RETURN NEW;
  END IF;

  -- Check if the linked settlement is reconciliation-only by looking at the actual settlement row
  IF NEW.settlement_id IS NOT NULL THEN
    SELECT source, settlement_id, marketplace
    INTO _settlement_source, _settlement_sid, _settlement_marketplace
    FROM public.settlements
    WHERE settlement_id = NEW.settlement_id
    LIMIT 1;

    IF _settlement_source = 'api_sync' AND (
      _settlement_marketplace LIKE 'shopify_orders_%'
      OR _settlement_sid LIKE 'shopify_auto_%'
    ) THEN
      _is_recon_only := true;
    END IF;
  END IF;

  -- Reconciliation-only settlements can never go beyond settlement_needed
  IF _is_recon_only THEN
    NEW.overall_status := 'settlement_needed';
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
$function$;

-- Downgrade shopify_auto_ api_sync settlements that are incorrectly ready
-- Never touch exported, pushed_to_xero, or locked statuses
UPDATE public.settlements
SET status = 'ingested'
WHERE source = 'api_sync'
  AND settlement_id LIKE 'shopify_auto_%'
  AND status IN ('ready_to_push', 'validated', 'matched');

-- Suppress api_sync settlements where real CSV/API data exists for same marketplace+period
-- Include null-period safety
UPDATE public.settlements s
SET status = 'duplicate_suppressed',
    duplicate_reason = 'CSV/API upload takes priority over Shopify-derived data'
WHERE s.source = 'api_sync'
  AND s.settlement_id LIKE 'shopify_auto_%'
  AND s.status NOT IN ('duplicate_suppressed', 'pushed_to_xero', 'exported', 'locked')
  AND s.period_start IS NOT NULL
  AND s.period_end IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.settlements csv
    WHERE csv.marketplace = s.marketplace
      AND csv.source IN ('csv_upload', 'manual', 'api', 'ebay_api', 'mirakl_api')
      AND csv.status NOT IN ('duplicate_suppressed')
      AND csv.period_start IS NOT NULL
      AND csv.period_end IS NOT NULL
      AND csv.period_start <= s.period_end
      AND csv.period_end >= s.period_start
  );

-- Refresh marketplace_validation rows that reference reconciliation-only settlements
-- This triggers the updated calculate_validation_status trigger
UPDATE public.marketplace_validation mv
SET updated_at = now()
WHERE mv.settlement_id IS NOT NULL
  AND mv.settlement_id LIKE 'shopify_auto_%'
  AND mv.overall_status IN ('ready_to_push', 'gap_detected');