
-- Table: order_shipping_estimates
CREATE TABLE public.order_shipping_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  shopify_order_id bigint NOT NULL,
  shopify_fulfillment_id text NOT NULL,
  marketplace_code text,
  tracking_number text,
  estimated_cost numeric NOT NULL,
  estimate_quality text NOT NULL DEFAULT 'low',
  weight_grams numeric,
  from_postcode text,
  to_postcode text,
  service_code text,
  source text NOT NULL DEFAULT 'pac_estimate',
  carrier text NOT NULL DEFAULT 'auspost',
  fulfilled_at timestamptz,
  calculation_basis jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Unique constraint: one estimate per fulfillment per user
ALTER TABLE public.order_shipping_estimates
  ADD CONSTRAINT uq_user_fulfillment UNIQUE (user_id, shopify_fulfillment_id);

-- Indexes for performance
CREATE INDEX idx_ose_user_fulfilled ON public.order_shipping_estimates (user_id, fulfilled_at DESC);
CREATE INDEX idx_ose_user_marketplace ON public.order_shipping_estimates (user_id, marketplace_code);

-- RLS
ALTER TABLE public.order_shipping_estimates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own shipping estimates"
  ON public.order_shipping_estimates
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Table: marketplace_shipping_stats
CREATE TABLE public.marketplace_shipping_stats (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  marketplace_code text NOT NULL,
  avg_shipping_cost_60 numeric,
  avg_shipping_cost_14 numeric,
  sample_size integer NOT NULL DEFAULT 0,
  last_updated timestamptz NOT NULL DEFAULT now()
);

-- RLS
ALTER TABLE public.marketplace_shipping_stats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own shipping stats"
  ON public.marketplace_shipping_stats
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
