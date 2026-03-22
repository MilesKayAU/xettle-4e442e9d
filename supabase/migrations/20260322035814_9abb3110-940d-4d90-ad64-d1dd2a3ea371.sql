
CREATE TABLE public.mcf_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  shopify_order_id bigint NOT NULL,
  shopify_order_name text,
  amazon_fulfillment_order_id text,
  seller_fulfillment_order_id text,
  status text NOT NULL DEFAULT 'pending',
  tracking_number text,
  carrier text,
  estimated_arrival timestamptz,
  items jsonb DEFAULT '[]'::jsonb,
  destination_address jsonb DEFAULT '{}'::jsonb,
  shipping_speed text DEFAULT 'Standard',
  raw_amazon_response jsonb,
  error_detail text,
  retry_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.mcf_orders ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin full access on mcf_orders"
  ON public.mcf_orders FOR ALL
  TO authenticated
  USING (has_role('admin'::app_role))
  WITH CHECK (has_role('admin'::app_role));

CREATE POLICY "Service role full access on mcf_orders"
  ON public.mcf_orders FOR ALL
  TO public
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
