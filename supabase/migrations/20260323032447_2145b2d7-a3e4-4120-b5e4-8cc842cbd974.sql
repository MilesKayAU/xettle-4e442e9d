
CREATE TABLE public.mirakl_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  marketplace_label text NOT NULL DEFAULT 'Bunnings',
  base_url text NOT NULL,
  client_id text NOT NULL,
  client_secret text NOT NULL,
  seller_company_id text NOT NULL,
  access_token text,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, base_url, seller_company_id)
);

ALTER TABLE public.mirakl_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own mirakl tokens"
  ON public.mirakl_tokens FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own mirakl tokens"
  ON public.mirakl_tokens FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own mirakl tokens"
  ON public.mirakl_tokens FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own mirakl tokens"
  ON public.mirakl_tokens FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());
