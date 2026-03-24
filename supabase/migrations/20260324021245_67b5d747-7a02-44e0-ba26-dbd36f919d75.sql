
CREATE TABLE public.cached_inventory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  platform text NOT NULL,
  items jsonb NOT NULL DEFAULT '[]',
  has_more boolean DEFAULT false,
  partial boolean DEFAULT false,
  error text,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, platform)
);

ALTER TABLE public.cached_inventory ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users read own inventory cache"
  ON public.cached_inventory FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Service role manages inventory cache"
  ON public.cached_inventory FOR ALL
  TO service_role USING (true);
