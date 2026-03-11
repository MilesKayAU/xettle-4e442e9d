
-- Known marketplaces registry (system-wide, not per-user)
CREATE TABLE public.marketplace_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  marketplace_code text UNIQUE NOT NULL,
  marketplace_name text NOT NULL,
  country text DEFAULT 'AU',
  type text DEFAULT 'marketplace',
  detection_keywords jsonb DEFAULT '[]'::jsonb,
  xero_contact_patterns jsonb DEFAULT '[]'::jsonb,
  bank_narration_patterns jsonb DEFAULT '[]'::jsonb,
  shopify_source_names jsonb DEFAULT '[]'::jsonb,
  settlement_file_patterns jsonb DEFAULT '[]'::jsonb,
  is_active boolean DEFAULT true,
  added_by text DEFAULT 'system',
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Payment processors registry (system-wide, not per-user)
CREATE TABLE public.payment_processor_registry (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  processor_code text UNIQUE NOT NULL,
  processor_name text NOT NULL,
  type text DEFAULT 'payment_gateway',
  detection_keywords jsonb DEFAULT '[]'::jsonb,
  xero_contact_patterns jsonb DEFAULT '[]'::jsonb,
  bank_narration_patterns jsonb DEFAULT '[]'::jsonb,
  country text DEFAULT 'AU',
  is_active boolean DEFAULT true,
  added_by text DEFAULT 'system',
  notes text,
  created_at timestamptz DEFAULT now()
);

-- RLS: Admins can manage, authenticated can read
ALTER TABLE public.marketplace_registry ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_processor_registry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read marketplace registry"
  ON public.marketplace_registry FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage marketplace registry"
  ON public.marketplace_registry FOR ALL TO authenticated
  USING (public.has_role('admin'::app_role))
  WITH CHECK (public.has_role('admin'::app_role));

CREATE POLICY "Authenticated users can read payment processor registry"
  ON public.payment_processor_registry FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage payment processor registry"
  ON public.payment_processor_registry FOR ALL TO authenticated
  USING (public.has_role('admin'::app_role))
  WITH CHECK (public.has_role('admin'::app_role));

-- Seed marketplaces
INSERT INTO public.marketplace_registry (marketplace_code, marketplace_name, country, type, detection_keywords, xero_contact_patterns, bank_narration_patterns, shopify_source_names) VALUES
('amazon_au', 'Amazon AU', 'AU', 'marketplace', '["amazon","amazon.com.au","amazon au"]', '["Amazon","Amazon Seller","Amazon AU","Amazon.com.au"]', '["AMAZON","AMZN"]', '["amazon"]'),
('bigw', 'Big W', 'AU', 'marketplace', '["bigw","big w","big-w"]', '["BIG W","BigW","Big W Marketplace"]', '["BIGW","BIG W"]', '["bigw"]'),
('mydeal', 'MyDeal', 'AU', 'marketplace', '["mydeal","my deal"]', '["MyDeal","My Deal","MyDeal Marketplace"]', '["MYDEAL"]', '["mydeal"]'),
('kogan', 'Kogan', 'AU', 'marketplace', '["kogan","kogan.com"]', '["Kogan","Kogan.com","Kogan Marketplace"]', '["KOGAN"]', '["kogan"]'),
('catch', 'Catch', 'AU', 'marketplace', '["catch","catch.com.au"]', '["Catch","Catch.com.au","Catch Marketplace"]', '["CATCH"]', '["catch"]'),
('everyday_market', 'Everyday Market', 'AU', 'marketplace', '["everyday market","woolworths marketplace","woolworths"]', '["Everyday Market","Woolworths Group","Woolworths Marketplace"]', '["EVERYDAY MKT","WOOLWORTHS"]', '["everyday_market"]'),
('bunnings', 'Bunnings', 'AU', 'marketplace', '["bunnings","bunnings marketplace"]', '["Bunnings","Bunnings Marketplace"]', '["BUNNINGS"]', '["bunnings"]'),
('ebay_au', 'eBay AU', 'AU', 'marketplace', '["ebay","ebay au","ebay australia"]', '["eBay","eBay AU","eBay Australia"]', '["EBAY","EBAY AU"]', '["ebay"]'),
('tiktok_shop', 'TikTok Shop', 'AU', 'marketplace', '["tiktok","tiktok shop"]', '["TikTok","TikTok Shop"]', '["TIKTOK"]', '["tiktok"]'),
('facebook', 'Facebook/Instagram Shop', 'AU', 'marketplace', '["facebook","instagram","meta"]', '["Facebook","Instagram","Meta"]', '["FACEBOOK","INSTAGRAM"]', '["facebook"]'),
('shopify_payments', 'Shopify Payments', 'AU', 'marketplace', '["shopify","shopify payments"]', '["Shopify","Shopify Payments"]', '["SHOPIFY"]', '["web","online_store"]'),
('theiconic', 'The Iconic', 'AU', 'marketplace', '["iconic","the iconic","theiconic"]', '["The Iconic","THE ICONIC"]', '["ICONIC","THE ICONIC"]', '["theiconic"]'),
('etsy', 'Etsy', 'AU', 'marketplace', '["etsy"]', '["Etsy"]', '["ETSY"]', '["etsy"]'),
('woolworths_marketplus', 'Woolworths MarketPlus', 'AU', 'marketplace', '["woolworths marketplus","marketplus"]', '["Woolworths MarketPlus"]', '["MARKETPLUS"]', '[]');

-- Seed payment processors
INSERT INTO public.payment_processor_registry (processor_code, processor_name, type, detection_keywords, xero_contact_patterns, bank_narration_patterns) VALUES
('paypal', 'PayPal', 'payment_gateway', '["paypal"]', '["PayPal","PayPal Australia"]', '["PAYPAL","PP*"]'),
('stripe', 'Stripe', 'payment_gateway', '["stripe"]', '["Stripe","Stripe Payments"]', '["STRIPE"]'),
('afterpay', 'Afterpay', 'bnpl', '["afterpay"]', '["Afterpay"]', '["AFTERPAY"]'),
('zip', 'Zip/ZipPay', 'bnpl', '["zip","zippay","zip pay"]', '["Zip","ZipPay","Zip Co"]', '["ZIP","ZIPPAY"]'),
('klarna', 'Klarna', 'bnpl', '["klarna"]', '["Klarna"]', '["KLARNA"]'),
('laybuy', 'Laybuy', 'bnpl', '["laybuy"]', '["Laybuy"]', '["LAYBUY"]'),
('humm', 'Humm', 'bnpl', '["humm","hummgroup"]', '["Humm","Humm Group"]', '["HUMM"]'),
('openpay', 'Openpay', 'bnpl', '["openpay"]', '["Openpay"]', '["OPENPAY"]'),
('square', 'Square', 'payment_gateway', '["square","square payments"]', '["Square","Square Australia"]', '["SQUARE","SQ *"]'),
('tyro', 'Tyro', 'payment_gateway', '["tyro"]', '["Tyro","Tyro Payments"]', '["TYRO"]'),
('braintree', 'Braintree', 'payment_gateway', '["braintree"]', '["Braintree"]', '["BRAINTREE"]'),
('latitude', 'Latitude', 'bnpl', '["latitude","latitude pay"]', '["Latitude","Latitude Financial"]', '["LATITUDE"]');
