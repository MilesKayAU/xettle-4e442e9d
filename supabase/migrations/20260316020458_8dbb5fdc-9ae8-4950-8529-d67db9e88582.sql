
CREATE TABLE public.ebay_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  ebay_username text,
  refresh_token text NOT NULL,
  access_token text,
  expires_at timestamptz,
  refresh_token_expires_at timestamptz,
  scopes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

ALTER TABLE public.ebay_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own ebay tokens" ON public.ebay_tokens FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can insert own ebay tokens" ON public.ebay_tokens FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update own ebay tokens" ON public.ebay_tokens FOR UPDATE TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "Users can delete own ebay tokens" ON public.ebay_tokens FOR DELETE TO authenticated USING (auth.uid() = user_id);
