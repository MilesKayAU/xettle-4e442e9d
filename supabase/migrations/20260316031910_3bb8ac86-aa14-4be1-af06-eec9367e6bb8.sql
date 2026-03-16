
-- Part A1: Add lifecycle fields to marketplace_file_fingerprints
ALTER TABLE public.marketplace_file_fingerprints
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS created_by uuid,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS confidence numeric,
  ADD COLUMN IF NOT EXISTS parser_type text NOT NULL DEFAULT 'generic';

-- Backfill existing rows to active (they were already trusted)
UPDATE public.marketplace_file_fingerprints SET status = 'active' WHERE status = 'draft';

-- Part A2: Add fingerprint_id to settlements for traceability
ALTER TABLE public.settlements
  ADD COLUMN IF NOT EXISTS fingerprint_id uuid;

-- Part C0: Create atomic promote+save RPC
CREATE OR REPLACE FUNCTION public.promote_and_save_settlement(
  p_fingerprint_id uuid,
  p_settlement jsonb,
  p_should_promote boolean DEFAULT false,
  p_system_event jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_result jsonb;
  v_settlement_db_id uuid;
BEGIN
  -- Step 1: If promotion requested, promote fingerprint atomically
  IF p_should_promote AND p_fingerprint_id IS NOT NULL THEN
    UPDATE public.marketplace_file_fingerprints
    SET status = 'active', last_seen_at = now()
    WHERE id = p_fingerprint_id AND status = 'draft';
    
    IF NOT FOUND THEN
      -- Fingerprint not found or not in draft state - check if already active
      PERFORM 1 FROM public.marketplace_file_fingerprints
      WHERE id = p_fingerprint_id AND status = 'active';
      
      IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'error', 'Fingerprint not found or in rejected state');
      END IF;
    END IF;
  END IF;

  -- Step 2: Insert settlement (caller passes the full row as JSONB)
  INSERT INTO public.settlements (
    user_id, settlement_id, marketplace, period_start, period_end,
    sales_principal, sales_shipping, seller_fees, refunds, reimbursements,
    other_fees, gst_on_income, gst_on_expenses, bank_deposit,
    source, source_reference, status, reconciliation_status, fingerprint_id
  )
  VALUES (
    (p_settlement->>'user_id')::uuid,
    p_settlement->>'settlement_id',
    p_settlement->>'marketplace',
    (p_settlement->>'period_start')::date,
    (p_settlement->>'period_end')::date,
    COALESCE((p_settlement->>'sales_principal')::numeric, 0),
    COALESCE((p_settlement->>'sales_shipping')::numeric, 0),
    COALESCE((p_settlement->>'seller_fees')::numeric, 0),
    COALESCE((p_settlement->>'refunds')::numeric, 0),
    COALESCE((p_settlement->>'reimbursements')::numeric, 0),
    COALESCE((p_settlement->>'other_fees')::numeric, 0),
    COALESCE((p_settlement->>'gst_on_income')::numeric, 0),
    COALESCE((p_settlement->>'gst_on_expenses')::numeric, 0),
    COALESCE((p_settlement->>'bank_deposit')::numeric, 0),
    COALESCE(p_settlement->>'source', 'csv_upload'),
    p_settlement->>'source_reference',
    COALESCE(p_settlement->>'status', 'saved'),
    COALESCE(p_settlement->>'reconciliation_status', 'reconciled'),
    p_fingerprint_id
  )
  RETURNING id INTO v_settlement_db_id;

  -- Step 3: Log system event if provided
  IF p_system_event IS NOT NULL THEN
    INSERT INTO public.system_events (user_id, event_type, severity, marketplace_code, settlement_id, details)
    VALUES (
      (p_system_event->>'user_id')::uuid,
      p_system_event->>'event_type',
      COALESCE(p_system_event->>'severity', 'info'),
      p_system_event->>'marketplace_code',
      p_system_event->>'settlement_id',
      p_system_event->'details'
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'settlement_db_id', v_settlement_db_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
