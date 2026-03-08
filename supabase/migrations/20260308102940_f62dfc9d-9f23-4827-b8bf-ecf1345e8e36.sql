CREATE TABLE public.amazon_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  selling_partner_id text NOT NULL,
  marketplace_id text NOT NULL DEFAULT 'A39IBJ37TRP1C6',
  refresh_token text NOT NULL,
  access_token text,
  expires_at timestamptz,
  region text NOT NULL DEFAULT 'fe',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, selling_partner_id)
);

ALTER TABLE public.amazon_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own amazon tokens"
  ON public.amazon_tokens FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own amazon tokens"
  ON public.amazon_tokens FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own amazon tokens"
  ON public.amazon_tokens FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own amazon tokens"
  ON public.amazon_tokens FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

CREATE TRIGGER update_amazon_tokens_updated_at
  BEFORE UPDATE ON public.amazon_tokens
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();