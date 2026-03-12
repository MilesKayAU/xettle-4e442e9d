
-- Add connection_id to settlements and settlement_lines
ALTER TABLE public.settlements ADD COLUMN IF NOT EXISTS connection_id text;
CREATE INDEX IF NOT EXISTS idx_settlements_connection_id ON public.settlements(connection_id) WHERE connection_id IS NOT NULL;

ALTER TABLE public.settlement_lines ADD COLUMN IF NOT EXISTS connection_id text;

-- Create marketplace_account_mapping table for COA integration
CREATE TABLE IF NOT EXISTS public.marketplace_account_mapping (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  marketplace_code text NOT NULL,
  category text NOT NULL,
  account_code text NOT NULL,
  account_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, marketplace_code, category)
);

ALTER TABLE public.marketplace_account_mapping ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own account mappings" ON public.marketplace_account_mapping
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Create marketplace_discovery_log for unknown channel logging
CREATE TABLE IF NOT EXISTS public.marketplace_discovery_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  detected_value text NOT NULL,
  detection_field text NOT NULL,
  suggested_code text,
  status text NOT NULL DEFAULT 'pending',
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketplace_discovery_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own discovery log" ON public.marketplace_discovery_log
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
