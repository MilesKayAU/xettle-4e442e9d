
-- Settlement ID Aliases table for universal dedup
CREATE TABLE public.settlement_id_aliases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_settlement_id text NOT NULL,
  alias_id text NOT NULL,
  user_id uuid NOT NULL,
  source text,
  created_at timestamptz DEFAULT now(),
  UNIQUE(alias_id, user_id)
);

ALTER TABLE public.settlement_id_aliases ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own aliases"
  ON public.settlement_id_aliases
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Add source_reference column to settlements
ALTER TABLE public.settlements ADD COLUMN IF NOT EXISTS source_reference text;
