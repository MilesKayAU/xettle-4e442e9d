
-- IMPROVEMENT 1: Add marketplace_period_id as regular column + trigger
ALTER TABLE public.marketplace_validation
ADD COLUMN marketplace_period_id text;

CREATE OR REPLACE FUNCTION public.set_marketplace_period_id()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  NEW.marketplace_period_id := NEW.marketplace_code || '_' || to_char(NEW.period_start, 'YYYY_MM');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_set_marketplace_period_id
  BEFORE INSERT OR UPDATE ON public.marketplace_validation
  FOR EACH ROW
  EXECUTE FUNCTION public.set_marketplace_period_id();

CREATE INDEX idx_validation_period_id 
  ON marketplace_validation(marketplace_period_id);

-- IMPROVEMENT 2: Add processing state columns
ALTER TABLE public.marketplace_validation
ADD COLUMN processing_state text DEFAULT 'idle',
ADD COLUMN processing_started_at timestamptz,
ADD COLUMN processing_completed_at timestamptz,
ADD COLUMN processing_error text;

-- IMPROVEMENT 3: Add reconciliation confidence
ALTER TABLE public.marketplace_validation
ADD COLUMN reconciliation_confidence numeric DEFAULT null,
ADD COLUMN reconciliation_confidence_reason text;

-- IMPROVEMENT 4: Create system_events table
CREATE TABLE public.system_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  event_type text NOT NULL,
  marketplace_code text,
  settlement_id text,
  period_label text,
  details jsonb DEFAULT '{}'::jsonb,
  severity text DEFAULT 'info',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.system_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "User owns system events"
  ON public.system_events
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_system_events_user_type 
  ON system_events(user_id, event_type, created_at DESC);

CREATE INDEX idx_system_events_marketplace 
  ON system_events(user_id, marketplace_code, created_at DESC);

-- Validation triggers
CREATE OR REPLACE FUNCTION public.validate_processing_state()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.processing_state IS NOT NULL AND NEW.processing_state NOT IN ('idle', 'processing', 'processed', 'processing_failed') THEN
    RAISE EXCEPTION 'Invalid processing_state: %', NEW.processing_state;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_processing_state
  BEFORE INSERT OR UPDATE ON public.marketplace_validation
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_processing_state();

CREATE OR REPLACE FUNCTION public.validate_reconciliation_confidence()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.reconciliation_confidence IS NOT NULL AND (NEW.reconciliation_confidence < 0 OR NEW.reconciliation_confidence > 1) THEN
    RAISE EXCEPTION 'reconciliation_confidence must be between 0 and 1';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_validate_reconciliation_confidence
  BEFORE INSERT OR UPDATE ON public.marketplace_validation
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_reconciliation_confidence();

ALTER PUBLICATION supabase_realtime ADD TABLE public.system_events;
