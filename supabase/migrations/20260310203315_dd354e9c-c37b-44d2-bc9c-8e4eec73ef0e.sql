
CREATE TABLE public.shopify_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  shopify_order_id bigint NOT NULL,
  order_name text,
  source_name text,
  gateway text,
  tags text,
  total_price numeric DEFAULT 0,
  financial_status text,
  created_at_shopify timestamptz,
  synced_at timestamptz DEFAULT now(),
  UNIQUE(user_id, shopify_order_id)
);

ALTER TABLE public.shopify_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own shopify orders"
  ON public.shopify_orders FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX idx_shopify_orders_source ON public.shopify_orders(user_id, source_name);
