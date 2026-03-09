
CREATE TABLE public.shopify_tokens (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  shop_domain text NOT NULL,
  access_token text NOT NULL,
  scope text,
  installed_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, shop_domain)
);

ALTER TABLE public.shopify_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own shopify tokens"
  ON public.shopify_tokens
  FOR ALL
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE TRIGGER update_shopify_tokens_updated_at
  BEFORE UPDATE ON public.shopify_tokens
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
