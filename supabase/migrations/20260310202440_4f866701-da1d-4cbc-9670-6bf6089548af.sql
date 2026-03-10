
CREATE TABLE public.channel_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_name text NOT NULL,
  first_seen_at timestamptz DEFAULT now(),
  order_count integer DEFAULT 0,
  total_revenue numeric DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  actioned_at timestamptz,
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id, source_name)
);

ALTER TABLE public.channel_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own channel alerts"
  ON public.channel_alerts
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
