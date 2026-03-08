-- Marketplace connections table
CREATE TABLE public.marketplace_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  marketplace_code text NOT NULL,
  marketplace_name text NOT NULL,
  country_code text NOT NULL DEFAULT 'AU',
  connection_type text NOT NULL DEFAULT 'manual',
  connection_status text NOT NULL DEFAULT 'active',
  settings jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, marketplace_code, country_code)
);

-- Enable RLS
ALTER TABLE public.marketplace_connections ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Users can view their own marketplace connections"
  ON public.marketplace_connections FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own marketplace connections"
  ON public.marketplace_connections FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own marketplace connections"
  ON public.marketplace_connections FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own marketplace connections"
  ON public.marketplace_connections FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Updated at trigger
CREATE TRIGGER update_marketplace_connections_updated_at
  BEFORE UPDATE ON public.marketplace_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();