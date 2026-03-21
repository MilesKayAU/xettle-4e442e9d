
CREATE TABLE public.api_call_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  integration text NOT NULL,
  endpoint text NOT NULL,
  method text NOT NULL DEFAULT 'GET',
  status_code integer,
  latency_ms integer,
  request_context jsonb DEFAULT '{}'::jsonb,
  error_summary text,
  rate_limit_remaining integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_api_call_log_user_integration_created 
  ON public.api_call_log (user_id, integration, created_at DESC);

ALTER TABLE public.api_call_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on api_call_log"
  ON public.api_call_log
  FOR ALL
  TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "Admin users can read api_call_log"
  ON public.api_call_log
  FOR SELECT
  TO authenticated
  USING (has_role('admin'::app_role));
