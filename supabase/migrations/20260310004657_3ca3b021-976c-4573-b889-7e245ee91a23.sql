
-- Create entity_library table
CREATE TABLE public.entity_library (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid,
  entity_name text NOT NULL,
  entity_type text NOT NULL CHECK (
    entity_type IN ('marketplace', 'aggregator', 'gateway', 'software', 'bank', 'other')
  ),
  accounting_impact text NOT NULL CHECK (
    accounting_impact IN ('revenue', 'cost', 'gateway_fee', 'neutral')
  ),
  detection_field text CHECK (
    detection_field IN ('tags', 'note_attributes', 'payment_method', 'gateway')
  ),
  notes text,
  confirmed_count integer DEFAULT 1,
  source text DEFAULT 'user',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(entity_name, user_id)
);

-- Enable RLS
ALTER TABLE public.entity_library ENABLE ROW LEVEL SECURITY;

-- Users see global + own entries
CREATE POLICY "Read entity library"
  ON public.entity_library FOR SELECT
  TO authenticated
  USING (user_id IS NULL OR user_id = auth.uid());

-- Users insert own entries
CREATE POLICY "Insert own entities"
  ON public.entity_library FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users update own entries
CREATE POLICY "Update own entities"
  ON public.entity_library FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id);

-- Seed known global entities
INSERT INTO public.entity_library 
  (user_id, entity_name, entity_type, accounting_impact, detection_field, notes, confirmed_count, source)
VALUES
  (NULL, 'Kogan', 'marketplace', 'revenue', 'tags', 'Kogan marketplace orders via Shopify', 10, 'system'),
  (NULL, 'MyDeal', 'marketplace', 'revenue', 'tags', 'MyDeal marketplace orders via Shopify', 10, 'system'),
  (NULL, 'Bunnings MarketLink', 'marketplace', 'revenue', 'tags', 'Bunnings MarketLink orders via Shopify', 10, 'system'),
  (NULL, 'Catch', 'marketplace', 'revenue', 'tags', 'Catch.com.au marketplace orders', 10, 'system'),
  (NULL, 'Amazon', 'marketplace', 'revenue', 'tags', 'Amazon AU marketplace orders', 10, 'system'),
  (NULL, 'eBay', 'marketplace', 'revenue', 'tags', 'eBay AU marketplace orders', 10, 'system'),
  (NULL, 'Woolworths MarketPlus', 'marketplace', 'revenue', 'tags', 'Woolworths Everyday Market orders', 10, 'system'),
  (NULL, 'Shopify POS', 'gateway', 'revenue', 'gateway', 'Shopify Point of Sale', 10, 'system'),
  (NULL, 'shopify_payments', 'gateway', 'gateway_fee', 'gateway', 'Shopify Payments (Stripe-based)', 10, 'system'),
  (NULL, 'paypal', 'gateway', 'gateway_fee', 'gateway', 'PayPal payment gateway', 10, 'system'),
  (NULL, 'afterpay', 'gateway', 'gateway_fee', 'gateway', 'Afterpay / Block payment gateway', 10, 'system'),
  (NULL, 'zip', 'gateway', 'gateway_fee', 'gateway', 'Zip Pay / Zip Money gateway', 10, 'system'),
  (NULL, 'stripe', 'gateway', 'gateway_fee', 'gateway', 'Stripe direct payment gateway', 10, 'system'),
  (NULL, 'Mirakl', 'aggregator', 'neutral', 'note_attributes', 'Mirakl aggregator platform', 10, 'system'),
  (NULL, 'Marketplacer', 'aggregator', 'neutral', 'note_attributes', 'Marketplacer aggregator', 10, 'system'),
  (NULL, 'ShipStation', 'software', 'cost', NULL, 'ShipStation shipping software', 10, 'system'),
  (NULL, 'Sendle', 'software', 'cost', NULL, 'Sendle shipping provider', 10, 'system'),
  (NULL, 'Australia Post', 'software', 'cost', NULL, 'AusPost shipping', 10, 'system');
