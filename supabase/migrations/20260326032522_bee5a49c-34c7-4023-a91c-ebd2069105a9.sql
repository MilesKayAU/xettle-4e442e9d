ALTER TABLE public.marketplace_validation 
ADD COLUMN IF NOT EXISTS gap_acknowledged boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS gap_acknowledged_reason text,
ADD COLUMN IF NOT EXISTS gap_acknowledged_at timestamptz,
ADD COLUMN IF NOT EXISTS gap_acknowledged_by uuid;