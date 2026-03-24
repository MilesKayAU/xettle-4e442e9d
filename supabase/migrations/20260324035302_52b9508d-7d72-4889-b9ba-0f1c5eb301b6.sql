
ALTER TABLE public.marketplace_validation ADD COLUMN IF NOT EXISTS settlement_source text;

UPDATE public.marketplace_validation mv
SET settlement_source = s.source
FROM public.settlements s
WHERE mv.settlement_id = s.settlement_id
  AND mv.settlement_source IS NULL;
