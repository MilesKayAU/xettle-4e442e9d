CREATE TABLE public.marketplace_file_fingerprints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  marketplace_code text NOT NULL,
  column_signature jsonb NOT NULL DEFAULT '[]',
  file_pattern text,
  column_mapping jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, marketplace_code, column_signature)
);

ALTER TABLE public.marketplace_file_fingerprints ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own fingerprints"
  ON public.marketplace_file_fingerprints FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);