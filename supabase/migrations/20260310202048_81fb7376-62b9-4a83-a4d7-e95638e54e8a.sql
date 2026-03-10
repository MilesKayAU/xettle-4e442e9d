
CREATE TABLE public.shopify_sub_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  source_name text NOT NULL,
  marketplace_label text NOT NULL,
  marketplace_code text,
  settlement_type text NOT NULL DEFAULT 'shopify_payments',
  ignored boolean NOT NULL DEFAULT false,
  order_count integer DEFAULT 0,
  total_revenue numeric DEFAULT 0,
  first_seen_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, source_name)
);

ALTER TABLE public.shopify_sub_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own sub channels"
  ON public.shopify_sub_channels
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
