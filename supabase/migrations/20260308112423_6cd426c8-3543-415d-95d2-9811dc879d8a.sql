ALTER TABLE public.settlements ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';
COMMENT ON COLUMN public.settlements.source IS 'How the settlement was imported: manual or api';